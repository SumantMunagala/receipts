import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { configureMockLlm, resetMockLlm } from "./externals/gemini.mock";
import { llmFixtures } from "./externals/fixtures/llm";
import { LlmError, STEPS, getModel, onLlmCall, retryDelayMs, structured, type LlmCallRecord } from "./llm";
import { ProductCandidateSchema } from "@/schemas";

const DEFAULT = "test-flash-lite";
const FALLBACK = "test-flash";

let records: LlmCallRecord[] = [];
let unsubscribe: () => void;

beforeEach(() => {
  vi.stubEnv("EXTERNALS_MODE", "mock");
  vi.stubEnv("GEMINI_DEFAULT_MODEL", DEFAULT);
  vi.stubEnv("GEMINI_FALLBACK_MODEL", FALLBACK);
  vi.stubEnv("GOOGLE_API_KEY", "");
  for (const step of STEPS) vi.stubEnv(`MODEL_${step.toUpperCase()}`, "");
  // Mock mode must never touch the network.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("network access in mock mode")));
  configureMockLlm({ latencyMs: { min: 0, max: 0 }, retryDelaySeconds: 0 });
  records = [];
  unsubscribe = onLlmCall((r) => records.push(r));
});

afterEach(() => {
  unsubscribe();
  resetMockLlm();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getModel", () => {
  it("uses the default model and the fallback model for every step", () => {
    for (const step of STEPS) {
      expect(getModel(step)).toEqual({ step, model: DEFAULT, fallback: FALLBACK });
    }
  });

  it("MODEL_SYNTHESIZE switches only the synthesize step", () => {
    vi.stubEnv("MODEL_SYNTHESIZE", "test-pro");
    expect(getModel("synthesize")).toEqual({ step: "synthesize", model: "test-pro", fallback: FALLBACK });
    for (const step of STEPS.filter((s) => s !== "synthesize")) {
      expect(getModel(step).model).toBe(DEFAULT);
    }
  });

  it("an override that is the fallback model falls back to the default model", () => {
    vi.stubEnv("MODEL_REVIEWS", FALLBACK);
    expect(getModel("reviews")).toEqual({ step: "reviews", model: FALLBACK, fallback: DEFAULT });
  });
});

describe("structured() in mock mode", () => {
  it.each(llmFixtures.map((f) => [f.name, f.schema] as const))("returns a valid %s fixture", async (_name, schema) => {
    const out = await structured("identify", schema, "anything");
    expect(schema.safeParse(out).success).toBe(true);
    expect(records.at(-1)).toMatchObject({ ok: true, mock: true, model: DEFAULT, fallbackUsed: false, attempts: 1 });
  });

  it("fails clearly for a schema without a fixture", async () => {
    await expect(structured("identify", z.object({ unknown: z.string() }), "x")).rejects.toThrow(/no fixture/);
  });

  it("a single 429 is retried once on the same model", async () => {
    configureMockLlm({ rateLimits: { [DEFAULT]: 1 } });
    await structured("identify", ProductCandidateSchema, "x");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ok: true,
      model: DEFAULT,
      fallbackUsed: false,
      attempts: 2,
      rateLimitRetries: 1,
    });
  });

  it("a second 429 moves to the fallback model, and the record says so", async () => {
    configureMockLlm({ rateLimits: { [DEFAULT]: 2 } });
    const out = await structured("identify", ProductCandidateSchema, "x");
    expect(ProductCandidateSchema.safeParse(out).success).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ok: true,
      primaryModel: DEFAULT,
      model: FALLBACK,
      fallbackUsed: true,
      attempts: 3,
      rateLimitRetries: 1,
      totalTokens: 150,
    });
  });

  it("a non-429 error goes straight to the fallback without a retry", async () => {
    configureMockLlm({ failures: { [DEFAULT]: 1 } });
    await structured("identify", ProductCandidateSchema, "x");
    expect(records[0]).toMatchObject({ ok: true, model: FALLBACK, fallbackUsed: true, attempts: 2, rateLimitRetries: 0 });
  });

  it("throws LlmError and records ok: false when both models fail", async () => {
    configureMockLlm({ failures: { [DEFAULT]: 1, [FALLBACK]: 1 } });
    const err = await structured("risk", ProductCandidateSchema, "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).modelsTried).toEqual([DEFAULT, FALLBACK]);
    expect(records[0]).toMatchObject({ ok: false, step: "risk", model: FALLBACK, attempts: 2 });
    expect(records[0].error).toMatch(/503/);
  });
});

describe("retryDelayMs", () => {
  const err429 = (retryDelay: string) => ({ status: 429, message: "quota", errorDetails: [{ retryDelay }] });

  it("uses Gemini's RetryInfo delay", () => {
    expect(retryDelayMs(err429("2.5s"))).toBe(2500);
  });

  it("caps the delay at 5 seconds", () => {
    expect(retryDelayMs(err429("30s"))).toBe(5000);
  });

  it("reads 'retry in Xs' from the message, else defaults to 1s", () => {
    expect(retryDelayMs(new Error("Please retry in 3s."))).toBe(3000);
    expect(retryDelayMs(new Error("429 Too Many Requests"))).toBe(1000);
  });
});

describe("mock fixtures", () => {
  it.each(llmFixtures.map((f) => [f.name, f] as const))("%s validates against its schema", (_name, f) => {
    expect(f.schema.safeParse(f.data).error?.issues ?? []).toEqual([]);
  });
});
