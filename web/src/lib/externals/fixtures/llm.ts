import type { z } from "zod";
import {
  DealOkSchema,
  DisclosureResultSchema,
  HypeOkSchema,
  ProductCandidateSchema,
  ReviewSummaryOkSchema,
  RiskOkSchema,
  SourceContentSchema,
  VerdictSchema,
} from "@/schemas";

// Mock-mode LLM responses, keyed by the schema object the caller passes to
// structured(). Every entry must validate against its schema (checked in tests).

type Fixture = { name: string; schema: z.ZodType; data: unknown };

const fixtures: Fixture[] = [];

function defineFixture<T>(name: string, schema: z.ZodType<T>, data: T) {
  fixtures.push({ name, schema, data });
}

const sourceContent: z.infer<typeof SourceContentSchema> = {
  platform: "tiktok",
  sourceType: "shop_listing",
  rawSignals: ["Flash sale"],
  listing: { shopName: "medicube Official", price: 19.9, currency: "USD", rating: 4.7, reviewCount: 2310, unitsSold: 10000 },
};

const disclosure: z.infer<typeof DisclosureResultSchema> = {
  status: "paid_signal_detected",
  signals: [{ type: "commission_label", evidence: '"Creator earns commission" label on the video' }],
};

const hype: z.infer<typeof HypeOkSchema> = {
  status: "ok",
  level: "mixed",
  sampleSize: 40,
  paidCount: 12,
  organicDiscussionCount: 22,
  examples: [
    { url: "https://www.tiktok.com/@example/video/1", platform: "tiktok", classification: "paid", signal: "#tiktokshop" },
    { url: "https://www.youtube.com/watch?v=example", platform: "youtube", classification: "organic" },
  ],
};

const reviews: z.infer<typeof ReviewSummaryOkSchema> = {
  status: "ok",
  pros: ["Visibly smoother texture after a few weeks"],
  cons: ["Can sting on sensitive skin"],
  sentiment: "positive",
  sources: [{ url: "https://www.reddit.com/r/AsianBeauty/comments/example", title: "Medicube pads review" }],
};

const risk: z.infer<typeof RiskOkSchema> = {
  status: "ok",
  level: "no_signals_found",
  signals: [],
  genericMatches: [],
  checked: ["brand_site", "retailers", "complaints", "domain_age", "recalls"],
};

const deal: z.infer<typeof DealOkSchema> = {
  status: "ok",
  tiktokPrice: { amount: 19.9, currency: "USD" },
  bestOutsidePrice: { amount: 17.5, currency: "USD", retailer: "Amazon", url: "https://www.amazon.com/dp/EXAMPLE" },
  difference: { amount: 2.4, percent: 13.7 },
  alternatives: [],
};

defineFixture("SourceContent", SourceContentSchema, sourceContent);
defineFixture("ProductCandidate", ProductCandidateSchema, {
  brand: "Medicube",
  productName: "Zero Pore Pads 2.0",
  category: "skincare",
  confidence: 0.92,
  evidence: "Listing title and shop name both say medicube Zero Pore Pads 2.0",
  productKey: "medicube:zero-pore-pads-2-0",
});
defineFixture("DisclosureResult", DisclosureResultSchema, disclosure);
defineFixture("HypeOk", HypeOkSchema, hype);
defineFixture("ReviewSummaryOk", ReviewSummaryOkSchema, reviews);
defineFixture("RiskOk", RiskOkSchema, risk);
defineFixture("DealOk", DealOkSchema, deal);
defineFixture("Verdict", VerdictSchema, {
  quadrant: "paid_but_good",
  bottomLine: "Lots of paid promotion, but outside reviews are mostly positive. Slightly cheaper on Amazon.",
  disclosure,
  hype,
  reviews,
  risk,
  deal,
  caveats: ["Hype meter is a sample of 40 public posts we found, not all of TikTok."],
});

export const llmFixtures: readonly Fixture[] = fixtures;

export function findLlmFixture(schema: z.ZodType): Fixture | undefined {
  return fixtures.find((f) => f.schema === schema);
}
