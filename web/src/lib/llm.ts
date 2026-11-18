import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { z } from "zod";
import { env } from "./env";
import type { StructuredOutput, StructuredRunnableFactory } from "./externals/gemini.types";

// The one way agent nodes call an LLM. Picks the model per step, retries a 429
// once, falls back to a second model (separate quota), validates the output
// with Zod, and reports every call to onLlmCall listeners.

export const STEPS = [
  "ingest",
  "identify",
  "disclosure",
  "reviews",
  "hype",
  "risk",
  "deal",
  "synthesize",
  "judge",
] as const;
export type Step = (typeof STEPS)[number];

const STEP_OVERRIDE = {
  ingest: "MODEL_INGEST",
  identify: "MODEL_IDENTIFY",
  disclosure: "MODEL_DISCLOSURE",
  reviews: "MODEL_REVIEWS",
  hype: "MODEL_HYPE",
  risk: "MODEL_RISK",
  deal: "MODEL_DEAL",
  synthesize: "MODEL_SYNTHESIZE",
  judge: "MODEL_JUDGE",
} as const satisfies Record<Step, string>;

export const ATTEMPT_TIMEOUT_MS = 20_000;
export const MAX_RETRY_DELAY_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export type ModelChoice = { step: Step; model: string; fallback: string };

/** MODEL_<STEP> if set, else the default model. The fallback is never the same model. */
export function getModel(step: Step): ModelChoice {
  const cfg = env.llmModels();
  const model = cfg[STEP_OVERRIDE[step]] ?? cfg.GEMINI_DEFAULT_MODEL;
  const fallback = model === cfg.GEMINI_FALLBACK_MODEL ? cfg.GEMINI_DEFAULT_MODEL : cfg.GEMINI_FALLBACK_MODEL;
  return { step, model, fallback };
}

// ---------------------------------------------------------------------------
// Input

export type LlmImage = { base64: string; mimeType: string };
export type LlmInput = string | { system?: string; text: string; images?: LlmImage[] };

function toMessages(input: LlmInput): BaseMessage[] {
  if (typeof input === "string") return [new HumanMessage(input)];
  const messages: BaseMessage[] = input.system ? [new SystemMessage(input.system)] : [];
  const images = input.images ?? [];
  messages.push(
    new HumanMessage({
      content: [
        { type: "text", text: input.text },
        ...images.map((img) => ({ type: "image_url" as const, image_url: `data:${img.mimeType};base64,${img.base64}` })),
      ],
    }),
  );
  return messages;
}

// ---------------------------------------------------------------------------
// Schema conversion

/**
 * Zod -> JSON Schema that Gemini enforces. LangChain sends schemas as Gemini's
 * legacy responseSchema, which ignores `oneOf` (Phase 1 probe: a discriminated
 * union came back unconstrained) but enforces `anyOf`. Discriminators already
 * avoid `const` (see tag() in src/schemas/common.ts).
 */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const rename = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rename);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k === "oneOf" ? "anyOf" : k, rename(v)]));
    }
    return node;
  };
  const json = rename(z.toJSONSchema(schema)) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

// ---------------------------------------------------------------------------
// Errors and retry policy

export class LlmError extends Error {
  constructor(
    readonly step: Step,
    readonly modelsTried: string[],
    readonly cause: unknown,
  ) {
    super(`LLM call for step "${step}" failed on ${modelsTried.join(" -> ")}: ${errorMessage(cause)}`);
    this.name = "LlmError";
  }
}

class SchemaMismatchError extends Error {
  constructor(issues: string) {
    super(`model output did not match the schema: ${issues}`);
    this.name = "SchemaMismatchError";
  }
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 300);
}

export function isRateLimit(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 429 || /\b429\b|RESOURCE_EXHAUSTED/.test(errorMessage(err));
}

/** Delay before the single 429 retry: Gemini's RetryInfo, else "retry in Xs", else 1s; capped at 5s. */
export function retryDelayMs(err: unknown): number {
  const details = (err as { errorDetails?: { retryDelay?: string }[] } | null)?.errorDetails ?? [];
  const fromDetails = details.find((d) => typeof d?.retryDelay === "string")?.retryDelay;
  const fromMessage = /retry in ([\d.]+)s/i.exec(errorMessage(err))?.[1];
  const seconds = Number.parseFloat(fromDetails ?? fromMessage ?? "");
  const ms = Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_RETRY_DELAY_MS;
  return Math.min(Math.max(ms, 0), MAX_RETRY_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Call records (cost, latency, fallback rate)

export type LlmCallRecord = {
  step: Step;
  /** Model that produced the result (or the last one tried, on failure). */
  model: string;
  primaryModel: string;
  fallbackUsed: boolean;
  attempts: number;
  rateLimitRetries: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
  mock: boolean;
};

type Listener = (record: LlmCallRecord) => void;
const listeners = new Set<Listener>();

/** Subscribe to one record per structured() call. Returns an unsubscribe function. */
export function onLlmCall(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (process.env.NODE_ENV !== "test") {
  onLlmCall((record) => console.info(`[llm] ${JSON.stringify(record)}`));
}

function emit(record: LlmCallRecord) {
  for (const listener of listeners) {
    try {
      listener(record);
    } catch {
      // A broken listener must never fail the LLM call.
    }
  }
}

// ---------------------------------------------------------------------------
// structured()

async function loadFactory(mock: boolean): Promise<StructuredRunnableFactory> {
  return mock
    ? (await import("./externals/gemini.mock")).structuredRunnable
    : (await import("./externals/gemini.live")).structuredRunnable;
}

/**
 * Run one structured LLM call for a pipeline step and return output validated
 * by `schema`. Throws LlmError if both the primary and fallback model fail;
 * nodes turn that into an "unavailable" section.
 */
export async function structured<T>(
  step: Step,
  schema: z.ZodType<T>,
  input: LlmInput,
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  const { model: primary, fallback } = getModel(step);
  const mock = env.externalsMode() === "mock";
  const factory = await loadFactory(mock);
  const json = toGeminiSchema(schema);
  const trace = { model: primary, attempts: 0, rateLimitRetries: 0, modelsTried: [] as string[] };
  let usage: StructuredOutput["raw"]["usage_metadata"];

  // One model, with a single retry after a 429. Any other error, or invalid
  // output, propagates so withFallbacks moves to the next model.
  const attempt = (model: string) =>
    RunnableLambda.from(async (messages: BaseMessage[]): Promise<T> => {
      const runnable = factory(model, { zod: schema, json });
      trace.modelsTried.push(model);
      for (let retried = false; ; retried = true) {
        trace.model = model;
        trace.attempts++;
        try {
          const signal = opts.signal
            ? AbortSignal.any([opts.signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)])
            : AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
          const out = await runnable.invoke(messages, { signal });
          usage = out.raw?.usage_metadata;
          const parsed = schema.safeParse(out.parsed);
          if (!parsed.success) {
            throw new SchemaMismatchError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
          }
          return parsed.data;
        } catch (err) {
          if (!retried && isRateLimit(err)) {
            trace.rateLimitRetries++;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs(err)));
            continue;
          }
          throw err;
        }
      }
    });

  const chain = attempt(primary).withFallbacks({ fallbacks: [attempt(fallback)] });
  const start = performance.now();
  const record = (ok: boolean, error?: unknown): LlmCallRecord => ({
    step,
    model: trace.model,
    primaryModel: primary,
    fallbackUsed: trace.model !== primary,
    attempts: trace.attempts,
    rateLimitRetries: trace.rateLimitRetries,
    inputTokens: ok ? usage?.input_tokens : undefined,
    outputTokens: ok ? usage?.output_tokens : undefined,
    totalTokens: ok ? usage?.total_tokens : undefined,
    latencyMs: Math.round(performance.now() - start),
    ok,
    error: error === undefined ? undefined : errorMessage(error),
    mock,
  });

  try {
    const result = await chain.invoke(toMessages(input));
    emit(record(true));
    return result;
  } catch (err) {
    emit(record(false, err));
    throw new LlmError(step, [...new Set(trace.modelsTried)], err);
  }
}
