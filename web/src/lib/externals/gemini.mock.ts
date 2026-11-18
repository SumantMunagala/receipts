import { RunnableLambda } from "@langchain/core/runnables";
import { env } from "../env";
import { findLlmFixture } from "./fixtures/llm";
import type { StructuredRunnableFactory } from "./gemini.types";

// Mock Gemini: same interface as gemini.live.ts, no network. Returns the
// fixture registered for the requested schema after a simulated latency, and
// can inject failures so the real retry/fallback path in llm.ts gets exercised.

type MockLlmConfig = {
  latencyMs?: { min: number; max: number };
  /** Next n calls to this model throw a Gemini-shaped 429. */
  rateLimits: Record<string, number>;
  /** Next n calls to this model throw a non-429 error (e.g. a 503). */
  failures: Record<string, number>;
  /** retryDelay put in simulated 429s, in seconds. */
  retryDelaySeconds: number;
};

const defaults = (): MockLlmConfig => ({ rateLimits: {}, failures: {}, retryDelaySeconds: 1 });

let config: MockLlmConfig = defaults();

export function configureMockLlm(partial: Partial<MockLlmConfig>) {
  config = { ...config, ...partial };
}

export function resetMockLlm() {
  config = defaults();
}

function latencyMs(): number {
  const { min, max } = config.latencyMs ?? (() => {
    const l = env.mockLatency();
    return { min: l.MOCK_LATENCY_MIN_MS, max: l.MOCK_LATENCY_MAX_MS };
  })();
  return min + Math.random() * Math.max(0, max - min);
}

function takeOne(counts: Record<string, number>, model: string): boolean {
  if (!counts[model]) return false;
  counts[model]--;
  return true;
}

/** Same shape as the SDK's GoogleGenerativeAIFetchError for a quota 429. */
function rateLimitError(model: string): Error {
  return Object.assign(
    new Error(`[429 Too Many Requests] mock: quota exceeded for ${model}. Please retry in ${config.retryDelaySeconds}s.`),
    {
      status: 429,
      errorDetails: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: `${config.retryDelaySeconds}s` }],
    },
  );
}

export const structuredRunnable: StructuredRunnableFactory = (model, { zod }) =>
  RunnableLambda.from(async () => {
    await new Promise((resolve) => setTimeout(resolve, latencyMs()));
    if (takeOne(config.rateLimits, model)) throw rateLimitError(model);
    if (takeOne(config.failures, model)) {
      throw Object.assign(new Error(`[503 Service Unavailable] mock: ${model} is overloaded`), { status: 503 });
    }
    const fixture = findLlmFixture(zod);
    if (!fixture) {
      throw new Error("mock LLM: no fixture for this schema; add one in src/lib/externals/fixtures/llm.ts");
    }
    return {
      raw: { usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } },
      parsed: structuredClone(fixture.data),
    };
  });
