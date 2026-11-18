import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CheckInputSchema,
  DealComparisonSchema,
  DealOkSchema,
  DisclosureResultSchema,
  HypeMeterSchema,
  HypeOkSchema,
  ProductCandidateSchema,
  ReviewSummaryOkSchema,
  ReviewSummarySchema,
  RiskOkSchema,
  RiskResultSchema,
  SourceContentSchema,
  VerdictSchema,
  type DealComparison,
  type DisclosureResult,
  type HypeMeter,
  type ProductCandidate,
  type ReviewSummary,
  type RiskResult,
  type SourceContent,
  type Verdict,
} from "@/schemas";

// ---------------------------------------------------------------------------
// Valid fixtures

const listingSource: SourceContent = {
  platform: "tiktok",
  sourceType: "shop_listing",
  rawSignals: ["Flash sale", "BLACK FRIDAY"],
  listing: { shopName: "medicube Official", price: 19.9, currency: "USD", rating: 4.7, reviewCount: 2310, unitsSold: 10000 },
};

const videoSource: SourceContent = {
  platform: "tiktok",
  sourceType: "creator_video",
  url: "https://www.tiktok.com/@skincarebyalex/video/7709212074899016990",
  caption: "these pads changed my skin 😭 #medicube #tiktokshop",
  creatorHandle: "skincarebyalex",
  rawSignals: ["Creator earns commission"],
};

const product: ProductCandidate = {
  brand: "Medicube",
  productName: "Zero Pore Pads 2.0",
  category: "skincare",
  confidence: 0.92,
  evidence: "Listing title and shop name both say medicube Zero Pore Pads 2.0",
  productKey: "medicube:zero-pore-pads-2-0",
};

const disclosurePaid: DisclosureResult = {
  status: "paid_signal_detected",
  signals: [{ type: "commission_label", evidence: '"Creator earns commission" label on the video' }],
};

const hypeOk: HypeMeter = {
  status: "ok",
  level: "mixed",
  sampleSize: 40,
  paidCount: 12,
  organicDiscussionCount: 22,
  examples: [
    { url: "https://www.tiktok.com/@a/video/1", platform: "tiktok", classification: "paid", signal: "#tiktokshop" },
    { url: "https://www.youtube.com/watch?v=abc", platform: "youtube", classification: "organic" },
  ],
};

const reviewsOk: ReviewSummary = {
  status: "ok",
  pros: ["Visibly smoother texture after a few weeks"],
  cons: ["Can sting on sensitive skin"],
  sentiment: "positive",
  sources: [{ url: "https://www.reddit.com/r/AsianBeauty/comments/xyz", title: "Medicube pads review" }],
};

const riskOk: RiskResult = {
  status: "ok",
  level: "some_signals",
  signals: [
    {
      type: "similar_generic_items",
      summary: "Similar generic pads found on AliExpress",
      evidence: "Listing with the same packaging layout at $4.10",
      sourceUrl: "https://www.aliexpress.com/item/123.html",
    },
  ],
  genericMatches: [{ title: "Exfoliating toner pads 70ct", price: 4.1, currency: "USD", url: "https://www.aliexpress.com/item/123.html" }],
  checked: ["brand_site", "retailers", "complaints", "domain_age", "dropship", "recalls"],
};

const dealOk: DealComparison = {
  status: "ok",
  tiktokPrice: { amount: 19.9, currency: "USD" },
  bestOutsidePrice: { amount: 17.5, currency: "USD", retailer: "Amazon", url: "https://www.amazon.com/dp/B0TEST" },
  difference: { amount: 2.4, percent: 13.7 },
  alternatives: [{ name: "COSRX One Step Pads", reason: "Similar exfoliating pad, often cheaper" }],
};

const verdict: Verdict = {
  quadrant: "paid_but_good",
  bottomLine: "Lots of paid promotion, but outside reviews are mostly positive. Slightly cheaper on Amazon.",
  disclosure: disclosurePaid,
  hype: hypeOk,
  reviews: reviewsOk,
  risk: riskOk,
  deal: dealOk,
  ratingsGap: { tiktokRating: 4.7, outsideSentiment: "positive", note: "Ratings agree" },
  caveats: ["Hype meter is a sample of 40 public posts we found, not all of TikTok."],
};

const unavailable = { status: "unavailable", reason: "Search provider timed out" } as const;

const valid: [string, z.ZodType, unknown][] = [
  ["CheckInput: TikTok link", CheckInputSchema, { kind: "tiktok_link", url: "https://www.tiktok.com/@a/video/123" }],
  ["CheckInput: short link + typed price", CheckInputSchema, { kind: "tiktok_link", url: "https://vm.tiktok.com/ZMabc/", userTikTokPrice: 19.9 }],
  ["CheckInput: screenshot", CheckInputSchema, { kind: "screenshot", imageBase64: "aGVsbG8=", mimeType: "image/png" }],
  ["SourceContent: shop listing", SourceContentSchema, listingSource],
  ["SourceContent: creator video", SourceContentSchema, videoSource],
  ["ProductCandidate", ProductCandidateSchema, product],
  ["Disclosure: paid signal", DisclosureResultSchema, disclosurePaid],
  ["Disclosure: none found", DisclosureResultSchema, { status: "no_disclosure_found", signals: [] }],
  ["Disclosure: not applicable", DisclosureResultSchema, { status: "not_applicable", reason: "Shop listing has no creator" }],
  ["Disclosure: unavailable", DisclosureResultSchema, unavailable],
  ["Hype: ok", HypeMeterSchema, hypeOk],
  [
    "Hype: not enough data",
    HypeMeterSchema,
    { status: "not_enough_data", level: "not_enough_data", sampleSize: 4, paidCount: 1, organicDiscussionCount: 2, examples: [] },
  ],
  ["Hype: unavailable", HypeMeterSchema, unavailable],
  ["Reviews: ok", ReviewSummarySchema, reviewsOk],
  ["Reviews: insufficient, no sources", ReviewSummarySchema, { status: "ok", pros: [], cons: [], sentiment: "insufficient", sources: [] }],
  ["Reviews: unavailable", ReviewSummarySchema, unavailable],
  ["Risk: ok", RiskResultSchema, riskOk],
  ["Risk: no signals", RiskResultSchema, { status: "ok", level: "no_signals_found", signals: [], genericMatches: [], checked: ["recalls"] }],
  ["Risk: unavailable", RiskResultSchema, unavailable],
  ["Deal: ok", DealComparisonSchema, dealOk],
  ["Deal: no TikTok price", DealComparisonSchema, { status: "no_tiktok_price", alternatives: [] }],
  ["Deal: no outside price", DealComparisonSchema, { status: "no_outside_price", tiktokPrice: { amount: 19.9, currency: "USD" }, alternatives: [] }],
  ["Deal: unavailable", DealComparisonSchema, unavailable],
  ["Verdict", VerdictSchema, verdict],
  [
    "Verdict: every section unavailable",
    VerdictSchema,
    {
      quadrant: "not_enough_evidence",
      bottomLine: "We couldn't gather enough evidence for this product.",
      disclosure: unavailable,
      hype: unavailable,
      reviews: unavailable,
      risk: unavailable,
      deal: unavailable,
      caveats: [],
    },
  ],
];

describe("schemas accept valid data", () => {
  it.each(valid)("%s", (_name, schema, value) => {
    const result = schema.safeParse(value);
    expect(result.error?.issues ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invalid data

const verdictWithoutBottomLine: Partial<Verdict> = { ...verdict };
delete verdictWithoutBottomLine.bottomLine;

const invalid: [string, z.ZodType, unknown][] = [
  ["ProductCandidate: confidence 1.5", ProductCandidateSchema, { ...product, confidence: 1.5 }],
  ["Verdict: missing bottomLine", VerdictSchema, verdictWithoutBottomLine],
  ["Verdict: unknown quadrant", VerdictSchema, { ...verdict, quadrant: "pretty_good" }],
  ["Verdict: bottomLine over 200 chars", VerdictSchema, { ...verdict, bottomLine: "x".repeat(201) }],
  ["CheckInput: non-TikTok link", CheckInputSchema, { kind: "tiktok_link", url: "https://www.instagram.com/reel/abc" }],
  ["CheckInput: lookalike TikTok domain", CheckInputSchema, { kind: "tiktok_link", url: "https://tiktok.com.evil.example/x" }],
  ["CheckInput: unsupported image type", CheckInputSchema, { kind: "screenshot", imageBase64: "aGVsbG8=", mimeType: "image/gif" }],
  ["CheckInput: unknown kind", CheckInputSchema, { kind: "video_file", url: "https://www.tiktok.com/@a/video/1" }],
  ["Disclosure: paid signal without evidence", DisclosureResultSchema, { status: "paid_signal_detected", signals: [] }],
  ["Disclosure: blank evidence", DisclosureResultSchema, { status: "paid_signal_detected", signals: [{ type: "ad_tag", evidence: "  " }] }],
  ["Section: unavailable without reason", RiskResultSchema, { status: "unavailable" }],
  ["Hype: paidCount over sampleSize", HypeMeterSchema, { ...hypeOk, paidCount: 41 }],
  ["Hype: ok with not_enough_data level", HypeMeterSchema, { ...hypeOk, level: "not_enough_data" }],
  ["Reviews: positive sentiment without sources", ReviewSummarySchema, { ...reviewsOk, sources: [] }],
  ["Risk: some_signals with no signals", RiskResultSchema, { ...riskOk, signals: [] }],
  ["Deal: negative price", DealComparisonSchema, { ...dealOk, tiktokPrice: { amount: -1, currency: "USD" } }],
  ["Deal: lowercase currency", DealComparisonSchema, { ...dealOk, tiktokPrice: { amount: 19.9, currency: "usd" } }],
  ["Deal: ok without outside price", DealComparisonSchema, { status: "ok", tiktokPrice: { amount: 19.9, currency: "USD" }, alternatives: [] }],
];

describe("schemas reject invalid data", () => {
  it.each(invalid)("%s", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LLM boundary: schemas reach Gemini as JSON Schema (responseJsonSchema), so
// they must convert. Refinements are checked by Zod after the response parses.

describe("schemas convert to JSON Schema for structured output", () => {
  const llmFacing: [string, z.ZodType][] = [
    ["SourceContent", SourceContentSchema],
    ["ProductCandidate", ProductCandidateSchema],
    ["DisclosureResult", DisclosureResultSchema],
    ["HypeOk", HypeOkSchema],
    ["ReviewSummaryOk", ReviewSummaryOkSchema],
    ["RiskOk", RiskOkSchema],
    ["DealOk", DealOkSchema],
    ["Verdict", VerdictSchema],
  ];

  it.each(llmFacing)("%s", (_name, schema) => {
    expect(() => z.toJSONSchema(schema)).not.toThrow();
  });

  // Gemini ignores `const` (it returned status "disclosed" in a live probe), so
  // discriminators must use tag() / one-value enums, which become `enum`.
  it.each(llmFacing)("%s has no `const` keyword", (_name, schema) => {
    expect(JSON.stringify(z.toJSONSchema(schema))).not.toContain('"const"');
  });
});
