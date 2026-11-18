import { z } from "zod";
import { AmountSchema, CurrencySchema, UrlSchema, tag } from "./common";

/** What a TikTok Shop listing shows. Every field is optional: screenshots crop differently. */
export const ListingSchema = z.object({
  shopName: z.string().optional(),
  price: AmountSchema.optional(),
  currency: CurrencySchema.optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.int().nonnegative().optional(),
  unitsSold: z.int().nonnegative().optional().describe('Lower bound: "10K+ sold" is 10000'),
});
export type Listing = z.infer<typeof ListingSchema>;

/** Everything read from the submitted video or listing, before the product is identified. */
export const SourceContentSchema = z.object({
  platform: tag("tiktok"),
  sourceType: z.enum(["creator_video", "shop_listing"]),
  url: UrlSchema.optional(),
  caption: z.string().optional(),
  creatorHandle: z.string().optional(),
  description: z.string().optional(),
  visibleText: z.string().optional(),
  rawSignals: z
    .array(z.string())
    .describe('Verbatim text that may matter later, e.g. "Creator earns commission", "#ad", a discount code'),
  listing: ListingSchema.optional(),
});
export type SourceContent = z.infer<typeof SourceContentSchema>;
