import { z } from "zod";
import { AmountSchema, CurrencySchema, NonEmptySchema, UnavailableSchema, UrlSchema, tag } from "./common";

/** Risk is reported as signals with evidence, never as a scam verdict. */
export const RiskSignalSchema = z.object({
  type: z.enum([
    "new_domain",
    "no_brand_site",
    "no_major_retailer",
    "similar_generic_items",
    "complaints",
    "recall",
    "other",
  ]),
  summary: NonEmptySchema,
  evidence: NonEmptySchema,
  sourceUrl: UrlSchema.optional(),
});
export type RiskSignal = z.infer<typeof RiskSignalSchema>;

/** A similar generic listing (e.g. AliExpress/Temu). Shown as "similar," never as the same product. */
export const GenericMatchSchema = z.object({
  title: NonEmptySchema,
  price: AmountSchema,
  currency: CurrencySchema,
  url: UrlSchema,
});
export type GenericMatch = z.infer<typeof GenericMatchSchema>;

const minSignals = { no_signals_found: 0, some_signals: 1, multiple_signals: 2 } as const;

export const RiskOkSchema = z
  .object({
    status: tag("ok"),
    level: z.enum(["no_signals_found", "some_signals", "multiple_signals"]),
    signals: z.array(RiskSignalSchema),
    genericMatches: z.array(GenericMatchSchema),
    checked: z.array(NonEmptySchema).describe("Which checks actually ran, e.g. domain_age, recalls"),
  })
  .refine(
    (r) => (r.level === "no_signals_found" ? r.signals.length === 0 : r.signals.length >= minSignals[r.level]),
    { message: "level must match the number of signals", path: ["level"] },
  );

export const RiskResultSchema = z.discriminatedUnion("status", [RiskOkSchema, UnavailableSchema]);
export type RiskResult = z.infer<typeof RiskResultSchema>;
