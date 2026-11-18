import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getModel, onLlmCall, structured, type LlmCallRecord } from "./llm";
import { ProductCandidateSchema, SourceContentSchema } from "@/schemas";

// Live Gemini calls (2 Flash-Lite requests). Runs only when .env.local has a
// key and EXTERNALS_MODE=live, so CI skips it.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the suite below is skipped.
}

const live = Boolean(process.env.GOOGLE_API_KEY) && process.env.EXTERNALS_MODE === "live";
const SCREENSHOT = "scripts/fixtures/smoke-screenshot.png";

describe.skipIf(!live)("structured() against live Gemini", () => {
  const records: LlmCallRecord[] = [];
  let unsubscribe: () => void;
  beforeAll(() => {
    unsubscribe = onLlmCall((r) => records.push(r));
  });
  afterAll(() => unsubscribe());

  it("returns a validated object for a text input", { timeout: 60_000 }, async () => {
    const out = await structured(
      "identify",
      ProductCandidateSchema,
      'Identify the product. TikTok Shop listing title: "medicube Zero Pore Pads 2.0 (70 pads)". productKey is brand:product in lowercase kebab-case.',
    );
    expect(ProductCandidateSchema.safeParse(out).success).toBe(true);
    expect(out.brand.toLowerCase()).toContain("medicube");
    expect(records.at(-1)).toMatchObject({ ok: true, mock: false, model: getModel("identify").model, fallbackUsed: false });
    expect(records.at(-1)?.totalTokens).toBeGreaterThan(0);
  });

  it.skipIf(!existsSync(SCREENSHOT))("returns a validated object for an image input", { timeout: 60_000 }, async () => {
    const out = await structured("ingest", SourceContentSchema, {
      text: "Read this TikTok screenshot. Leave out any field that isn't visible.",
      images: [{ base64: readFileSync(SCREENSHOT).toString("base64"), mimeType: "image/png" }],
    });
    expect(SourceContentSchema.safeParse(out).success).toBe(true);
    expect(out.platform).toBe("tiktok");
    expect(records.at(-1)).toMatchObject({ ok: true, mock: false, model: getModel("ingest").model, fallbackUsed: false });
    expect(records.at(-1)?.inputTokens).toBeGreaterThan(500); // the image accounts for ~1k tokens
  });
});
