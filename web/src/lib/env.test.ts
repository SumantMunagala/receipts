import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env", () => {
  it("names every missing required key and the feature", () => {
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
    vi.stubEnv("GEMINI_FALLBACK_MODEL", "gemini-flash");
    expect(() => env.llm()).toThrow(
      "Missing required env vars GOOGLE_API_KEY, GEMINI_DEFAULT_MODEL (needed for: llm)",
    );
  });

  it("reports invalid values separately from missing ones", () => {
    vi.stubEnv("EXTERNALS_MODE", "fake");
    expect(() => env.externalsMode()).toThrow(/Invalid env var EXTERNALS_MODE/);
  });

  it("returns typed values with defaults applied", () => {
    vi.stubEnv("LANGSMITH_API_KEY", "ls-key");
    vi.stubEnv("LANGSMITH_TRACING", "false");
    vi.stubEnv("LANGSMITH_PROJECT", "");
    expect(env.langsmith()).toEqual({
      LANGSMITH_API_KEY: "ls-key",
      LANGSMITH_TRACING: false,
      LANGSMITH_PROJECT: "receipts",
    });
  });

  it("does not throw for features whose keys are all optional", () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    expect(env.youtube()).toEqual({ YOUTUBE_API_KEY: undefined });
  });
});
