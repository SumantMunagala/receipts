import { z } from "zod";

/**
 * Fixed string value for discriminators (status, kind, ...). Use this instead of
 * z.literal: a literal becomes JSON Schema `const`, which Gemini's structured
 * output ignores (Phase 1 probe: it returned status "disclosed"). A one-value
 * enum becomes `enum`, which Gemini enforces.
 */
export const tag = <const T extends string>(value: T) => z.enum([value]);

/** Non-blank text. Used for evidence and reasons, which must always say something. */
export const NonEmptySchema = z.string().regex(/\S/, "must not be blank");

/** http(s) URL on a real domain. Used for every source and evidence link. */
export const UrlSchema = z.httpUrl();

/** ISO 4217 currency code, e.g. "USD". */
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, "must be an ISO 4217 code like USD");

export const AmountSchema = z.number().nonnegative();

export const MoneySchema = z.object({
  amount: AmountSchema,
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

/**
 * Shared "this check failed" variant. Every section can degrade to this, so a
 * failed check still produces a valid result instead of failing the whole run.
 */
export const UnavailableSchema = z.object({
  status: tag("unavailable"),
  reason: NonEmptySchema,
});
export type Unavailable = z.infer<typeof UnavailableSchema>;
