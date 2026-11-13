import { z } from "zod";

/**
 * Per-feature environment getters.
 *
 * Nothing is read at import time, so the app boots before every key exists.
 * Each getter validates only its own feature's keys and throws an error that
 * names every missing or invalid key when that feature is first used.
 *
 * NEXT_PUBLIC_* values must be read with literal `process.env.NEXT_PUBLIC_X`
 * access: Next.js only inlines them into client bundles that way.
 */

type Raw = Record<string, string | undefined>;

const required = z.string().min(1);
const optional = z.string().optional();

function parse<T>(feature: string, schema: z.ZodType<T>, raw: Raw): T {
  // Treat empty strings ("KEY=" in an env file) as unset.
  const cleaned: Raw = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;

  const missing = new Set<string>();
  const invalid: string[] = [];
  for (const issue of result.error.issues) {
    const key = String(issue.path[0]);
    if (cleaned[key] === undefined) missing.add(key);
    else invalid.push(`${key} (${issue.message})`);
  }

  const parts: string[] = [];
  if (missing.size > 0) {
    parts.push(`Missing required env var${missing.size > 1 ? "s" : ""} ${[...missing].join(", ")}`);
  }
  if (invalid.length > 0) {
    parts.push(`Invalid env var${invalid.length > 1 ? "s" : ""} ${invalid.join(", ")}`);
  }
  throw new Error(`${parts.join("; ")} (needed for: ${feature})`);
}

export const env = {
  externalsMode: () =>
    parse("externals", z.object({ EXTERNALS_MODE: z.enum(["live", "mock"]) }), {
      EXTERNALS_MODE: process.env.EXTERNALS_MODE,
    }).EXTERNALS_MODE,

  llm: () =>
    parse(
      "llm",
      z.object({
        GOOGLE_API_KEY: required,
        GEMINI_DEFAULT_MODEL: required,
        GEMINI_FALLBACK_MODEL: required,
        MODEL_INGEST: optional,
        MODEL_IDENTIFY: optional,
        MODEL_DISCLOSURE: optional,
        MODEL_REVIEWS: optional,
        MODEL_HYPE: optional,
        MODEL_RISK: optional,
        MODEL_DEAL: optional,
        MODEL_SYNTHESIZE: optional,
        MODEL_JUDGE: optional,
      }),
      {
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        GEMINI_DEFAULT_MODEL: process.env.GEMINI_DEFAULT_MODEL,
        GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL,
        MODEL_INGEST: process.env.MODEL_INGEST,
        MODEL_IDENTIFY: process.env.MODEL_IDENTIFY,
        MODEL_DISCLOSURE: process.env.MODEL_DISCLOSURE,
        MODEL_REVIEWS: process.env.MODEL_REVIEWS,
        MODEL_HYPE: process.env.MODEL_HYPE,
        MODEL_RISK: process.env.MODEL_RISK,
        MODEL_DEAL: process.env.MODEL_DEAL,
        MODEL_SYNTHESIZE: process.env.MODEL_SYNTHESIZE,
        MODEL_JUDGE: process.env.MODEL_JUDGE,
      },
    ),

  search: () =>
    parse(
      "search",
      z.object({
        SEARCH_PROVIDER: z.enum(["tavily"]).default("tavily"),
        SEARCH_API_KEY: required,
      }),
      {
        SEARCH_PROVIDER: process.env.SEARCH_PROVIDER,
        SEARCH_API_KEY: process.env.SEARCH_API_KEY,
      },
    ),

  youtube: () =>
    parse("youtube", z.object({ YOUTUBE_API_KEY: optional }), {
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    }),

  reddit: () =>
    parse("reddit", z.object({ REDDIT_CLIENT_ID: optional, REDDIT_CLIENT_SECRET: optional }), {
      REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
      REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    }),

  internalApi: () =>
    parse(
      "internal API",
      z.object({ API_INTERNAL_BASE_URL: z.url(), INTERNAL_API_SECRET: required }),
      {
        API_INTERNAL_BASE_URL: process.env.API_INTERNAL_BASE_URL,
        INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
      },
    ),

  publicApi: () =>
    parse("public API", z.object({ NEXT_PUBLIC_API_BASE_URL: z.url() }), {
      NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    }),

  supabasePublic: () =>
    parse(
      "supabase",
      z.object({ NEXT_PUBLIC_SUPABASE_URL: z.url(), NEXT_PUBLIC_SUPABASE_ANON_KEY: required }),
      {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
    ),

  turnstile: () =>
    parse("turnstile", z.object({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: required }), {
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    }),

  langsmith: () =>
    parse(
      "langsmith",
      z.object({
        LANGSMITH_API_KEY: required,
        LANGSMITH_TRACING: z
          .enum(["true", "false"])
          .default("true")
          .transform((v) => v === "true"),
        LANGSMITH_PROJECT: z.string().default("receipts"),
      }),
      {
        LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY,
        LANGSMITH_TRACING: process.env.LANGSMITH_TRACING,
        LANGSMITH_PROJECT: process.env.LANGSMITH_PROJECT,
      },
    ),

  posthog: () =>
    parse(
      "posthog",
      z.object({ NEXT_PUBLIC_POSTHOG_KEY: required, NEXT_PUBLIC_POSTHOG_HOST: z.url() }),
      {
        NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
        NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      },
    ),

  sentry: () =>
    parse("sentry", z.object({ NEXT_PUBLIC_SENTRY_DSN: z.url() }), {
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    }),
};
