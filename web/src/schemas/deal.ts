import { z } from "zod";
import { AmountSchema, CurrencySchema, MoneySchema, NonEmptySchema, UnavailableSchema, UrlSchema, tag } from "./common";

export const OutsidePriceSchema = z.object({
  amount: AmountSchema,
  currency: CurrencySchema,
  retailer: NonEmptySchema,
  url: UrlSchema,
});

/** TikTok price minus the best outside price; positive means TikTok costs more. */
export const PriceDifferenceSchema = z.object({
  amount: z.number(),
  percent: z.number(),
});

export const GenericEquivalentSchema = z.object({
  title: NonEmptySchema,
  price: AmountSchema,
  currency: CurrencySchema,
  url: UrlSchema,
});

export const AlternativeSchema = z.object({
  name: NonEmptySchema,
  reason: NonEmptySchema,
  url: UrlSchema.optional(),
});

const extras = {
  genericEquivalent: GenericEquivalentSchema.optional(),
  alternatives: z.array(AlternativeSchema),
};

export const DealOkSchema = z.object({
  status: tag("ok"),
  tiktokPrice: MoneySchema,
  bestOutsidePrice: OutsidePriceSchema,
  difference: PriceDifferenceSchema,
  ...extras,
});

export const DealNoTikTokPriceSchema = z.object({
  status: tag("no_tiktok_price"),
  bestOutsidePrice: OutsidePriceSchema.optional(),
  ...extras,
});

export const DealNoOutsidePriceSchema = z.object({
  status: tag("no_outside_price"),
  tiktokPrice: MoneySchema,
  ...extras,
});

export const DealComparisonSchema = z.discriminatedUnion("status", [
  DealOkSchema,
  DealNoTikTokPriceSchema,
  DealNoOutsidePriceSchema,
  UnavailableSchema,
]);
export type DealComparison = z.infer<typeof DealComparisonSchema>;
