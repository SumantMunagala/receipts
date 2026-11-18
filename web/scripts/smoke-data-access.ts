// Phase 0 data-access smoke test: checks each external source and prints what
// it actually returns. Usage: pnpm --dir web smoke
//
// Every call has a 15s timeout and runs inside its own section, so one failure
// never stops the rest of the report. Secrets are never printed.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import { env } from "../src/lib/env";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: sections that need keys will report the missing ones.
}

const TIMEOUT_MS = 15_000;
const USER_AGENT = "receipts-smoke/0.1";

// Real TikTok videos for the oEmbed check. Only the oEmbed endpoint is called.
const TIKTOK_URLS: string[] = [
  "https://www.tiktok.com/@dietrichcloset/video/7709212074899016990",
  "https://www.tiktok.com/@dealscope/video/7688946374112513294",
  "https://www.tiktok.com/@detected101/video/7638945791855381774",
];

const PRODUCTS = [
  "Medicube Zero Pore Pads",
  "Anua Heartleaf 77% Toner",
  "COSRX Snail Mucin 96 Essence",
  "Glow Recipe Watermelon Glow Niacinamide Dew Drops",
  "Beauty of Joseon Relief Sun",
];
const QUERY_VARIANTS = [
  (p: string) => `${p} site:tiktok.com`,
  (p: string) => `${p} review site:tiktok.com`,
  (p: string) => `${p} tiktok shop site:tiktok.com`,
];
const HYPE_TARGET = 20;

const RDAP_DOMAINS = [
  { domain: "cerave.com", label: "established" },
  { domain: "dr-melaxin.com", label: "new" },
];
const CPSC_TERM = "LED face mask";

const SAMPLE_CAPTION =
  "these pads literally changed my skin 😭 medicube zero pore pads 2.0, link in my shop #skincare #tiktokshop #kbeauty";

const SCREENSHOT_CANDIDATES = ["png", "jpg", "jpeg", "webp"].map((ext) =>
  path.join("scripts", "fixtures", `smoke-screenshot.${ext}`),
);

// ---------------------------------------------------------------------------
// Runner

type Status = "pass" | "fail" | "skip";
type Outcome = { status: Status; finding: string };
type Result = Outcome & { name: string; ms: number };

const results: Result[] = [];

async function section(name: string, fn: (log: (line?: string) => void) => Promise<Outcome>) {
  console.log(`\n=== ${name} ${"=".repeat(Math.max(0, 70 - name.length))}`);
  const log = (line = "") => console.log(`  ${line}`);
  const start = performance.now();
  let outcome: Outcome;
  try {
    outcome = await fn(log);
  } catch (err) {
    outcome = { status: "fail", finding: describeError(err) };
  }
  const ms = Math.round(performance.now() - start);
  log(`-> ${outcome.status.toUpperCase()}: ${outcome.finding} (${ms} ms)`);
  results.push({ name, ms, ...outcome });
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: number }).status;
    const msg = err.message.replace(/\s+/g, " ").slice(0, 200);
    return status ? `HTTP ${status}: ${msg}` : `${err.name}: ${msg}`;
  }
  return String(err).slice(0, 200);
}

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON body (error page): keep the text.
  }
  if (!res.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw Object.assign(new Error(detail.slice(0, 200)), { status: res.status });
  }
  return { status: res.status, body };
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

// ---------------------------------------------------------------------------
// Gemini helpers

function genai() {
  const { GOOGLE_API_KEY } = env.llm();
  // One attempt only: the report should show raw 429s, not hide them behind retries.
  return new GoogleGenAI({ apiKey: GOOGLE_API_KEY, httpOptions: { retryOptions: { attempts: 1 } } });
}

function usage(res: GenerateContentResponse): string {
  const u = res.usageMetadata;
  if (!u) return "tokens: n/a";
  return `tokens prompt=${u.promptTokenCount ?? "?"} output=${u.candidatesTokenCount ?? "?"} thoughts=${u.thoughtsTokenCount ?? 0} total=${u.totalTokenCount ?? "?"}`;
}

function jsonSchema(schema: z.ZodType) {
  // Gemini's responseJsonSchema doesn't accept the $schema keyword.
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

const ProductGuess = z.object({
  brand: z.string().nullable(),
  productName: z.string(),
  category: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

const ScreenshotRead = z.object({
  screenType: z.enum(["tiktok_video", "tiktok_shop_listing", "other"]),
  brand: z.string().nullable(),
  productName: z.string().nullable(),
  price: z.string().nullable(),
  rating: z.number().nullable(),
  unitsSold: z.string().nullable(),
  commissionLabelVisible: z.boolean(),
  creatorHandle: z.string().nullable(),
  captionText: z.string().nullable(),
});

async function structuredCall(
  log: (line?: string) => void,
  model: string,
  kind: "text" | "vision",
  screenshot: { data: string; mimeType: string } | null,
): Promise<Status> {
  const label = `${model} ${kind}`;
  if (kind === "vision" && !screenshot) {
    log(`${label}: SKIP (no screenshot at ${SCREENSHOT_CANDIDATES[0]})`);
    return "skip";
  }
  const schema = kind === "text" ? ProductGuess : ScreenshotRead;
  const contents =
    kind === "text"
      ? `Identify the product promoted in this TikTok caption.\n\nCaption: ${SAMPLE_CAPTION}`
      : [
          {
            role: "user",
            parts: [
              {
                text: "This is a screenshot from TikTok. Read what is visible. Use null for anything not shown. commissionLabelVisible is true only if a label such as 'Creator earns commission' is visible.",
              },
              { inlineData: screenshot! },
            ],
          },
        ];

  const start = performance.now();
  try {
    const res = await genai().models.generateContent({
      model,
      contents,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema(schema),
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
    });
    const ms = Math.round(performance.now() - start);
    let parsed: z.ZodSafeParseResult<unknown>;
    try {
      parsed = schema.safeParse(JSON.parse(res.text ?? ""));
    } catch {
      parsed = schema.safeParse(undefined);
    }
    log(`${label}: ${ms} ms, ${usage(res)}, schema ${parsed.success ? "OK" : "INVALID"}`);
    log(`  ${truncate(JSON.stringify(parsed.success ? parsed.data : res.text), 300)}`);
    return parsed.success ? "pass" : "fail";
  } catch (err) {
    log(`${label}: FAIL ${describeError(err)}`);
    return "fail";
  }
}

function loadScreenshot(): { data: string; mimeType: string } | null {
  const file = SCREENSHOT_CANDIDATES.find((f) => existsSync(f));
  if (!file) return null;
  const ext = path.extname(file).slice(1);
  const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return { data: readFileSync(file).toString("base64"), mimeType };
}

// ---------------------------------------------------------------------------
// Sections

async function main() {
  console.log(`Receipts data-access smoke test  ${new Date().toISOString()}`);

  await section("TikTok oEmbed", async (log) => {
    if (TIKTOK_URLS.length === 0) return { status: "skip", finding: "no TikTok URLs configured" };
    let withCaption = 0;
    let ok = 0;
    for (const url of TIKTOK_URLS) {
      try {
        const { body } = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
        const data = body as Record<string, unknown>;
        const title = typeof data.title === "string" ? data.title.trim() : "";
        ok++;
        if (title) withCaption++;
        log(url);
        log(`  fields: ${Object.keys(data).join(", ")}`);
        log(`  title (caption): ${title ? `"${truncate(title, 120)}"` : "MISSING/EMPTY"}`);
        log(`  author_name: ${data.author_name ? `"${data.author_name}"` : "MISSING"}`);
      } catch (err) {
        log(`${url}: FAIL ${describeError(err)}`);
      }
    }
    if (ok === 0) return { status: "fail", finding: "no oEmbed responses" };
    return {
      status: "pass",
      finding: `${ok}/${TIKTOK_URLS.length} responded; captions present in ${withCaption}/${ok}`,
    };
  });

  await section("Tavily: TikTok coverage", async (log) => {
    const { SEARCH_API_KEY } = env.search();
    const videoRe = /^https?:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/\d+/;
    const boilerplateRe = /^(tiktok - make your day|discover videos related to|log in to follow)/i;
    let credits = 0;
    let failures = 0;
    const perProduct: number[] = [];

    for (const product of PRODUCTS) {
      const videos = new Map<string, string>();
      let otherUrls = 0;
      for (const variant of QUERY_VARIANTS) {
        try {
          const { body } = await getJson("https://api.tavily.com/search", {
            method: "POST",
            headers: { authorization: `Bearer ${SEARCH_API_KEY}`, "content-type": "application/json" },
            body: JSON.stringify({
              query: variant(product),
              search_depth: "basic",
              max_results: 20,
              include_domains: ["tiktok.com"],
              include_usage: true,
            }),
          });
          const data = body as {
            results?: { url: string; content?: string }[];
            usage?: { credits?: number };
          };
          credits += data.usage?.credits ?? 0;
          for (const r of data.results ?? []) {
            const m = r.url.match(videoRe);
            if (m) videos.set(m[0], r.content ?? "");
            else otherUrls++;
          }
        } catch (err) {
          failures++;
          log(`${product} / "${variant(product)}": FAIL ${describeError(err)}`);
        }
      }
      const snippets = [...videos.values()].map((s) => s.replace(/\s+/g, " ").trim());
      const usable = snippets.filter((s) => s.length >= 40 && !boilerplateRe.test(s));
      // Hashtags or @mentions suggest real caption text; plain prose is often
      // TikTok's generated page summary rather than the creator's caption.
      const captionLike = usable.filter((s) => /(^|\s)[#@]\w/.test(s));
      perProduct.push(videos.size);
      log(
        `${product}: ${videos.size} unique videos (${otherUrls} non-video tiktok.com URLs); snippets: ${usable.length} non-empty, ${captionLike.length} with #/@ (caption-like)`,
      );
      for (const s of captionLike.slice(0, 1)) log(`  caption-like: "${truncate(s, 140)}"`);
      for (const s of usable.filter((s) => !captionLike.includes(s)).slice(0, 1)) {
        log(`  prose:        "${truncate(s, 140)}"`);
      }
    }

    if (failures === PRODUCTS.length * QUERY_VARIANTS.length) {
      return { status: "fail", finding: "every search failed" };
    }
    const avg = perProduct.reduce((a, b) => a + b, 0) / perProduct.length;
    const verdict = avg >= HYPE_TARGET ? "YouTube supplement not needed" : "below target: YouTube supplement needed";
    log(`credits used: ${credits || "n/a"}`);
    return {
      status: "pass",
      finding: `avg ${avg.toFixed(1)} videos/product (min ${Math.min(...perProduct)}, max ${Math.max(...perProduct)}, target ${HYPE_TARGET}) -> ${verdict}`,
    };
  });

  await section("Gemini: Google Search grounding", async (log) => {
    const { GEMINI_DEFAULT_MODEL } = env.llm();
    const product = PRODUCTS[2];
    const start = performance.now();
    let res: GenerateContentResponse;
    try {
      res = await genai().models.generateContent({
        model: GEMINI_DEFAULT_MODEL,
        contents: `Find independent reviews of "${product}" outside TikTok (Reddit, blogs, publications). Summarize what reviewers like and dislike in under 150 words.`,
        config: { tools: [{ googleSearch: {} }], abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      });
    } catch (err) {
      if ((err as { status?: number }).status === 429) {
        log("429 on a grounded call: Google's pricing page lists grounding as 'Not available' on the Free tier");
        log("(Paid tier only: 5,000 free grounded requests/month across Gemini 3+, then $14 per 1,000)");
      }
      throw err;
    }
    const ms = Math.round(performance.now() - start);
    const meta = res.candidates?.[0]?.groundingMetadata;
    const chunks = meta?.groundingChunks ?? [];
    log(`model ${GEMINI_DEFAULT_MODEL}, ${ms} ms, ${usage(res)}`);
    log(`answer: ${truncate((res.text ?? "").replace(/\s+/g, " "), 600)}`);
    log(`search queries: ${(meta?.webSearchQueries ?? []).join(" | ") || "none"}`);
    log(`sources (${chunks.length}):`);
    for (const c of chunks) log(`  - ${c.web?.title ?? "?"}  ${truncate(c.web?.uri ?? "?", 110)}`);
    if (chunks.length === 0) return { status: "fail", finding: "no grounding sources returned" };
    return { status: "pass", finding: `${chunks.length} grounding sources, ${ms} ms` };
  });

  await section("Gemini: structured output (text + vision)", async (log) => {
    const { GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL } = env.llm();
    const screenshot = loadScreenshot();
    const counts: Record<Status, number> = { pass: 0, fail: 0, skip: 0 };
    for (const model of [GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL]) {
      for (const kind of ["text", "vision"] as const) {
        counts[await structuredCall(log, model, kind, screenshot)]++;
      }
    }
    const ran = counts.pass + counts.fail;
    return {
      status: counts.fail > 0 ? "fail" : ran === 0 ? "skip" : "pass",
      finding: `${counts.pass}/${ran} calls returned schema-valid JSON${counts.skip ? `, ${counts.skip} skipped (no screenshot)` : ""}`,
    };
  });

  await section("YouTube Data API", async (log) => {
    const { YOUTUBE_API_KEY } = env.youtube();
    if (!YOUTUBE_API_KEY) return { status: "skip", finding: "YOUTUBE_API_KEY not set" };
    const q = encodeURIComponent(PRODUCTS[0]);
    const { body: search } = await getJson(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${q}&key=${YOUTUBE_API_KEY}`,
    );
    const ids = ((search as { items?: { id?: { videoId?: string } }[] }).items ?? [])
      .map((i) => i.id?.videoId)
      .filter((id): id is string => Boolean(id));
    log(`search.list: ${ids.length} videos (cost: 1 unit; separately capped at 100 calls/day)`);
    if (ids.length === 0) return { status: "fail", finding: "search.list returned no videos" };
    const { body: videos } = await getJson(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(",")}&key=${YOUTUBE_API_KEY}`,
    );
    const items = (videos as { items?: { snippet?: { title?: string; description?: string } }[] }).items ?? [];
    log(`videos.list: ${items.length} snippets (cost: 1 unit)`);
    for (const v of items.slice(0, 3)) log(`  - ${truncate(v.snippet?.title ?? "?", 100)}`);
    return { status: "pass", finding: `${ids.length} videos found; 2 units per search + details (search capped at 100/day)` };
  });

  await section("RDAP domain age", async (log) => {
    let ok = 0;
    for (const { domain, label } of RDAP_DOMAINS) {
      try {
        // rdap.org's CDN rejects requests without a descriptive User-Agent (403).
        const { body } = await getJson(`https://rdap.org/domain/${domain}`, {
          headers: { accept: "application/rdap+json" },
        });
        const events = (body as { events?: { eventAction: string; eventDate: string }[] }).events ?? [];
        const reg = events.find((e) => e.eventAction === "registration");
        if (!reg) {
          log(`${domain} (${label}): no registration event`);
          continue;
        }
        const days = Math.floor((Date.now() - Date.parse(reg.eventDate)) / 86_400_000);
        log(`${domain} (${label}): registered ${reg.eventDate.slice(0, 10)} (${days} days ago)`);
        ok++;
      } catch (err) {
        log(`${domain} (${label}): FAIL ${describeError(err)}`);
      }
    }
    return ok === RDAP_DOMAINS.length
      ? { status: "pass", finding: `${ok}/${RDAP_DOMAINS.length} registration dates found` }
      : { status: "fail", finding: `${ok}/${RDAP_DOMAINS.length} registration dates found` };
  });

  await section("CPSC recalls API", async (log) => {
    const { body } = await getJson(
      `https://www.saferproducts.gov/RestWebServices/Recall?format=json&ProductName=${encodeURIComponent(CPSC_TERM)}`,
    );
    const recalls = Array.isArray(body) ? (body as { Title?: string; RecallDate?: string }[]) : [];
    log(`"${CPSC_TERM}": ${recalls.length} recalls`);
    for (const r of recalls.slice(0, 2)) log(`  - ${r.RecallDate?.slice(0, 10)} ${truncate(r.Title ?? "?", 120)}`);
    return { status: "pass", finding: `API answered; ${recalls.length} results for "${CPSC_TERM}"` };
  });

  await section("Reddit API", async () => {
    const { REDDIT_CLIENT_ID } = env.reddit();
    if (!REDDIT_CLIENT_ID) return { status: "skip", finding: "not configured" };
    return { status: "skip", finding: "configured, but no Reddit check until API access is approved" };
  });

  console.log(`\n=== Summary ${"=".repeat(62)}`);
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(`  ${r.status.toUpperCase().padEnd(4)}  ${r.name.padEnd(width)}  ${r.finding}`);
  }
}

main().catch((err) => {
  console.error("smoke test crashed:", describeError(err));
  process.exitCode = 1;
});
