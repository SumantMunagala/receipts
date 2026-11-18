# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

## Project state

Update this section after every task: what exists, what changed from the plan, and environment quirks a fresh session needs.

**What exists (Phase 0 Task 1):** monorepo skeleton. `api/` is Go module `receipts/api` (chi router, `GET /healthz`, `internal/config`, slog JSON logs, graceful shutdown, air, golangci-lint v2 config). `web/` is Next.js 16.4 (App Router, src/, Tailwind 4, Zod 4, Vitest 5, tsx) with `src/lib/env.ts` per-feature getters and a `check` CLI stub. Also `contracts/openapi.yaml` (/healthz only), `docker-compose.yml` (Postgres 17, Redis 7), Makefile, and both `.env.example` files.

**Changed from plan:**
- Next.js 16 removed `next lint`; web lint is `eslint` via `pnpm --dir web lint`.
- Go requires only `EXTERNALS_MODE` and `PORT` so far; each phase adds its keys to the required list in `api/internal/config` when it first uses them.
- Vitest uses Vite's native `resolve.tsconfigPaths`, not the `vite-tsconfig-paths` plugin.

**Environment quirks (Windows dev box):**
- Repo lives in OneDrive (`Desktop\triplet\receipts`); expect occasional sync locks on `node_modules`/`.next`.
- `go test -race` needs cgo. `C:\MinGW` (old 32-bit gcc 6.3) is first on the system PATH, so Go is pointed at WinLibs gcc via `go env -w CC=...\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_...\mingw64\bin\gcc.exe`.
- make (ezwinports) runs recipes under cmd.exe: keep recipes shell-neutral, no quotes in `echo`.
- air can't send interrupts on Windows (uses TASKKILL), so graceful shutdown only shows on Ctrl+C in a console or on Linux.
- pnpm 12 blocks dependency build scripts; allowed ones are listed under `allowBuilds` in `web/pnpm-workspace.yaml` (esbuild is allowed for tsx).
- Docker Desktop needs the Windows "Virtual Machine Platform" feature (WSL2). If the engine pipe is missing, run `wsl --status`; fix with admin `wsl.exe --install --no-distribution` + reboot. Docker Desktop doesn't auto-start, so launch it before `docker compose up`.
- Verified: `docker compose up -d --wait` (Postgres 17.12 and Redis 7 healthy); SIGTERM in a `golang:1.27` container logs "shutting down" then "shutdown complete" and exits 0.

**LLM calls (Phase 1 Task 2):** nodes call only `structured(step, schema, input)` from `web/src/lib/llm.ts`.
- `getModel(step)` resolves `MODEL_<STEP>` or the default model, plus a fallback that is never the same model.
- Each attempt has a 20s timeout. A 429 is retried once on the same model after Gemini's `retryDelay` (capped at 5s); then `withFallbacks` moves to the fallback model. Non-429 errors and schema-invalid output go straight to the fallback.
- Output is validated with Zod. If both models fail, it throws `LlmError`, which nodes turn into `unavailable`.
- `onLlmCall(listener)` gets one record per call (step, model, fallbackUsed, attempts, rateLimitRetries, tokens, latency, ok, mock); a default listener logs `[llm] {json}` outside tests.
- `maxRetries: 0` on `ChatGoogleGenerativeAI` is deliberate, because LangChain's default 6 retries would hide this policy.
- **Schema conversion:** `@langchain/google-genai@2.3.4` sends schemas as Gemini's *legacy* `responseSchema`, which **ignores `oneOf`**: a probe returned `{"disclosure_result": ...}` for a discriminated union. So `toGeminiSchema()` converts Zod to JSON Schema with `oneOf` renamed to `anyOf`, and passes that to `withStructuredOutput(json, { method: "jsonSchema", includeRaw: true })`. 4/4 union probes were then valid, including a full Verdict.
- The live/mock pattern is in `web/src/lib/externals/README.md`: `<name>.live.ts` + `<name>.mock.ts` + `fixtures/`; mocks inject 429s/failures via `configureMockLlm`. Live tests are `*.live.test.ts`, which skip without a key or outside `EXTERNALS_MODE=live`.
- `env.llmModels()` resolves model names without an API key (mock mode/CI).

**Schemas (Phase 1 Task 1):** `web/src/schemas/` holds one file per schema plus `common.ts` and an `index.ts` barrel; import from `@/schemas`. Each check section is a discriminated union on `status` with an `unavailable` variant (`{ status, reason }`), so a failed check still validates. Each `ok` variant is exported separately (e.g. `ReviewSummaryOkSchema`) so nodes can give the LLM only the ok shape and build `unavailable` in code. Product rules live in the schemas: TikTok-only URLs, evidence required for paid signals, sources required for a sentiment verdict, risk level matching the signal count, hype counts ≤ sample size, `bottomLine` ≤ 200 chars. **Use `tag("x")` (a one-value enum) for discriminators, never `z.literal`:** literals become JSON Schema `const`, which Gemini ignores (a live probe returned `status: "disclosed"`), while `enum` is enforced. Gemini also may not enforce `pattern`/length/refinements, so every LLM response must still go through `schema.safeParse`.

**CI (Phase 0 Task 3):** `.github/workflows/ci.yml` runs on every push/PR with `EXTERNALS_MODE=mock`. Jobs: `changes` (dorny/paths-filter) → `go` (api/, Makefile, workflow), `web` (web/, workflow), and `contract` (always: Redocly lint + `make gen` with no diff). Path filtering uses job-level `if:`, because a skipped job counts as passing for required checks while workflow-level `paths:` would leave required checks pending. `main` is protected (requires `go`, `web`, `contract`, no bypass), so **all changes land through PRs**. The repo is public (`SumantMunagala/receipts`). Redocly is pinned to 2.72.1 in the workflow; config is in `redocly.yaml`, and accepted per-location exceptions are in `.redocly.lint-ignore.yaml`. `info-license` is off until a license is chosen.
- **Verified 2026-11-17 (PR #2, closed unmerged):** a Go type error failed `go` (at `go vet`) with `web` skipped by the path filter; an added TS error failed `web` (at `typecheck`); merging was blocked for everyone, including admin; reverting both turned the checks green.
- **CI quirks:** on a PR the path filter compares the PR's *net* diff with `main`, so a PR whose changes cancel out shows `go`/`web` as skipped (the push run still runs them against the previous commit). Jobs can sit queued for minutes on free runners; that's normal. Unauthenticated GitHub API calls are limited to 60/hour, so check CI in the browser or poll sparingly.

**Phase 0 Task 2 results (2026-11-17, `pnpm --dir web smoke`, `web/scripts/smoke-data-access.ts`):**
- **TikTok oEmbed: no captions.** 3/3 real videos answered, but returned no `title` and no `author_name`, only `html` (a bare 332-char embed with no text), `embed_product_id`, and `embed_type`. A link alone gives the video ID; the handle comes from the URL path (`/@handle/video/<id>`). Caption and commission label need a screenshot, so for link input, ask for one.
- **Tavily TikTok coverage: ~12 videos/product on average** (3 runs: 13.2, 11.6, 11.8; 8-17 per product) over 5 skincare products x 3 query variants (`include_domains: ["tiktok.com"]`, 20 results each). That's below the 20-post target, so the **YouTube supplement is needed**. About 50 of each product's results are non-video tiktok.com pages (discover/tag). About 50% of video snippets are caption-like (hashtags/@mentions, including disclosures such as `#GlowPartner`); the rest are TikTok's generated prose summaries, so the paid-signal classifier must not treat summary prose as the creator's caption. Cost: 15 credits per run.
- **Gemini grounding: not available.** Every grounded call returns 429 on the Free tier; the pricing page lists grounding as "Not available" there. All lookups use Tavily instead (see Decisions log).
- **Gemini 3.5 Flash-Lite (default): works.** Structured text took ~1.1s (88 tokens). Vision on a TikTok Shop listing took ~2.8s (1,215 tokens; the image is ~1.1k prompt tokens) and extracted every field correctly (brand, title, $25.00, "33 sold", no rating, no commission label) with zero thinking tokens. Schema-valid JSON every time via `responseJsonSchema` from `z.toJSONSchema()` (with `$schema` removed).
- **Gemini 3.8 Flash (fallback): unusable on the free tier.** It timed out at 15s or returned 503 "high demand" on every call across 3 runs over ~1 hour; 3.5/3.6/3.7 Flash did the same. Its free RPD is only 20, so it can't be a real fallback: retry Flash-Lite first, and treat Flash as best-effort.
- **Gemini models:** 2.5-series models are closed to new users (404). `thinkingLevel: "minimal"` isn't supported on 3.8 Flash (400).
- **AI Studio free-tier limits (project `Receipts`, read 2026-11-17):** 3.5 Flash-Lite 15 RPM / 250K TPM / 500 RPD; 3.8 Flash 5 RPM / 250K TPM / 20 RPD.
- **Other free allowances:** Tavily 1,000 credits/month (no card; basic search = 1 credit). YouTube Data API 10,000 units/day; `search.list` costs 1 unit but is capped at 100 calls/day, and `videos.list` costs 1 unit (Google's getting-started docs).
- **RDAP:** works through `rdap.org` only with a descriptive User-Agent (403 otherwise), and redirects to the registry. cerave.com was registered 2004-11-18; dr-melaxin.com 2026-10-07 (41 days old). `.us` domains return 404 (not in the bootstrap).
- **CPSC:** the API answers fast (JSON array). It covers consumer products, not cosmetics (FDA), and matches substrings ("facial" matched a VR headset face pad).
- **YouTube Data API: works** (2026-11-17, key in the `Receipts` Google project, no billing). `search.list` (type=video, 10 results) for "Medicube Zero Pore Pads" returned 10 relevant review/how-to videos in ~0.6s; `videos.list` (part=snippet) returned all 10 snippets. Cost: 2 units per product (1 search + 1 details call), so the 100 searches/day cap binds long before the 10,000 units do. **Reddit:** skipped (not configured).
- **Isolation verified:** with a bad Tavily key, only that section failed and the rest of the report ran.

**Product:** Receipts (repo and LangSmith project `receipts`). Tagline: "Check the hype before you buy." Before launch: confirm a domain, check no similar consumer app uses the name, search USPTO. Never use "TikTok" or "Tok" in the name.

## Product

A viewer-facing platform for verifying TikTok Shop products before buying. **TikTok and TikTok Shop only.** Input: a TikTok video link, or a screenshot of a TikTok video or TikTok Shop listing. An agent pipeline identifies the product and answers four questions:

1. **Is the hype paid?** Sponsorship signals on the submitted video, plus a hype meter sampling public creator posts.
2. **Is it actually good?** Outside-TikTok reviews (especially Reddit), plus any gap with the TikTok Shop rating.
3. **Is the seller legit?** Risk signals: brand legitimacy, retailer presence, dropship matches, complaints, recalls.
4. **Is it a good deal?** TikTok Shop price vs outside retailers and generic equivalents.

The headline is a **hype x quality quadrant** (see Pipeline details), shown on a shareable verdict card.

**Positioning:** the independent skeptic on the viewer's side. Competitors earn money when users buy; Receipts never uses affiliate links.

**Hard rules:**
1. **Every feature works for the first user.** Nothing depends on data from earlier users. Caching only makes repeat checks faster.
2. **Never accuse.** Say what was detected ("commission label detected," "no disclosure found," "risk signals found"). Never "this creator is lying," "this creator is paid" without a detected signal, or "this is a scam." Every signal shows its evidence; the hype meter is always labeled a sample.

**Goal:** AI agents for TikTok Shop verification on a Go backend, run like a real startup: real users, a live site, real metrics, startup-grade engineering. Every piece of infrastructure needs a reason in Key decisions.

## Stack
- **Go API service (Render):** chi + oapi-codegen, pgx + sqlc, goose, go-redis, Inngest Go SDK, PostHog and Sentry SDKs
- **Agent service (TypeScript, inside the Next.js app on Vercel):** LangGraph.js, `@langchain/google-genai`, Zod
- **Web app:** Next.js (App Router), React, Tailwind, generated API client
- **Contract:** `contracts/openapi.yaml` for the public API and the internal Go <-> agent API; Go types, TS types, and Zod schemas are generated from it
- **Data/infra:** Supabase (Postgres, Auth, Storage, Realtime), Upstash Redis, Inngest
- **Models:** Gemini only. Flash-Lite by default for every step; Flash as fallback and per-step upgrade path
- **External data:** Tavily via `searchWeb()` for every web lookup (reviews, prices, brand/retailer/complaint lookups, hype captions, dropship listings), with Flash-Lite reading the results; TikTok oEmbed; YouTube Data API (optional hype supplement); RDAP; CPSC recalls API; Reddit API only if approved
- **Security:** Supabase Auth (JWTs verified in Go), RLS as defense in depth, Redis rate limiting, HMAC-signed internal calls, Turnstile (launch week)
- **Quality/ops:** LangSmith, Sentry (errors + distributed tracing), GitHub Actions (CI, eval gate, contract drift), Go testing, Vitest, Playwright, k6, PostHog, pnpm

## Architecture
```
Browser (Next.js on Vercel)
    v  link or screenshot
Go API (Render)  POST /v1/identify
    rate limit, quota pre-check, store screenshot
    -> agent  POST /internal/agent/identify  (HMAC-signed)
         ingest + identify -> SourceContent + ProductCandidate
    persist check (awaiting_confirmation)
    |
Viewer confirms or corrects the product
    |
Go API  POST /v1/checks/{id}/run -> Inngest event -> returns checkId
    |
Inngest -> Go "run-check" (concurrency-limited, retried, durable)
    per section: cached -> use | another check running it -> wait | else lock it
    -> agent  POST /internal/agent/run  {source, product, sectionsToRun, providedResults, sheddingLevel}
         LangGraph.js (skips provided sections):
             START -+- disclosure  (commission label, #ad, affiliate links; n/a for listings)
                    |- reviews     (web search + LLM read)
                    |- hype        (~40 public creator posts -> paid vs organic)
                    |- risk        (brand, retailers, dropship, complaints, recalls)
                    `- deal        (TikTok price vs outside and generic)
                          v  join
                    synthesize     (code-computed quadrant + ratings gap; LLM writes bottom line + caveats)
         every external call first asks Go: POST /internal/quota/reserve
         streams node events as NDJSON
    Go: event -> check_events row + Realtime broadcast (check:<id>); cache "ok" sections; persist verdict
    |
Browser: live progress -> verdict -> shareable /v/[id] + OG image
```

- **Two services:** Go owns all state and platform concerns (API, auth, limits, quota, cache, coalescing, orchestration, data, progress). The agent is stateless: Go says what to run and passes cached results in. Agent routes live in the Next.js deploy, so there are two deploys total.
- **Pipeline shape:** identification is confirmed before anything else runs; the five checks fan out in parallel; each degrades to `unavailable` instead of failing the check; only the synthesizer sees everything.
- **Inngest:** durable runs that survive restarts, retries, a global concurrency limit that queues bursts, and crons (cleanup, keep-warm, post-launch jobs).
- **Realtime:** Go broadcasts progress on a channel keyed by the check UUID; `check_events` lets reconnecting clients replay.
- **Internal API:** both directions require an HMAC signature + timestamp; defined in the same OpenAPI spec.

## Pipeline details
- **Hype meter:** search public `tiktok.com` posts about the product (several queries); add the YouTube supplement only if under 20 posts. Classify paid signals with deterministic patterns first (Amazon `tag=`, LTK, ShopMy, `#ad`, `#sponsored`, `#tiktokshop`, "use my code"), LLM only for ambiguous posts. Count organic discussion separately. Output sample size, paid count, level (`mostly_paid` / `mixed` / `mostly_organic` / `not_enough_data`), and examples. Always "of N public posts we found."
- **Quadrant:** computed in code from hype level x review sentiment:

| Hype \ Quality | Good | Poor | Mixed / insufficient |
|---|---|---|---|
| **Mostly organic** | Genuinely loved | Hyped but disappointing | Mixed signals |
| **Mostly paid** | Paid, but actually good | Overhyped, likely slop | Mixed signals |
| **Mixed** | Mixed signals | Mixed signals | Mixed signals |
| **Not enough data** | Not enough evidence | Not enough evidence | Not enough evidence |

- **Risk:** one search + LLM read covers brand site, retailer presence, and complaints; RDAP for domain age (send a User-Agent; some ccTLDs such as `.us` have no RDAP, which is reported as "not checked," never as a signal); search for AliExpress/Temu matches; CPSC for recalls (covers devices only, since cosmetics are FDA-regulated; substring matching, so filter results for relevance). Output a level (`no_signals_found` / `some_signals` / `multiple_signals`), signals with evidence and sources, and which checks ran.
- **Deal:** TikTok price from the screenshot (or typed by the viewer); outside prices from one search + LLM read, each with a source URL (approximate). The synthesizer attaches the risk check's generic match as a cheaper equivalent.
- **Ratings gap:** flag when the TikTok Shop rating and outside sentiment disagree (e.g. 4.8 stars, negative reviews).
- **Quota budget:** all free tiers, no billing anywhere. Go keeps Redis counters per budget (Gemini requests per model/day, Tavily credits/month, YouTube units/day and search calls/day). Tavily is the binding budget (1,000 credits/month); dev runs share it, so use `EXTERNALS_MODE=mock` unless testing live data. The agent reserves before every external call. Shedding order as budgets drop: YouTube supplement off -> hype sample 20 -> dropship off -> no new uncached checks. Uncached checks are refused up front if they can't finish. At capacity, cached verdicts and trending still load.
- **No scraping TikTok:** TikTok data comes only from user screenshots, the official oEmbed endpoint, and search results. No caption from oEmbed -> ask for a screenshot.

## Project structure (planned)
```
receipts/
|-- .github/workflows/        # ci.yml (Go, TS, contract drift), evals.yml, e2e.yml
|-- contracts/openapi.yaml    # single source of truth for both APIs
|-- api/                      # Go service
|   |-- cmd/server, cmd/measure
|   |-- internal/             # httpapi, checks, jobs, agentclient, cache, coalesce, quota,
|   |                         # ratelimit, auth, turnstile, realtime, storage, db, analytics, config
|   |-- migrations/           # goose (+ RLS)
|   `-- sqlc.yaml, Dockerfile
|-- web/                      # Next.js: UI + internal agent routes
|   |-- src/app/              # page.tsx, v/[id], history, how-it-works, privacy, admin,
|   |                         # api/agent/{identify,run} (HMAC-verified)
|   |-- src/agent/            # state.ts, graph.ts, quadrant.ts, nodes/, prompts/
|   |-- src/lib/              # env, llm, search, ingest, externals/ (live + mock),
|   |                         # paid-signals, urls, product-key, quota-client, api/, realtime, flags
|   |-- src/schemas/          # generated Zod + agent-internal schemas
|   |-- evals/                # dataset/, gate.json, run-evals.ts
|   `-- scripts/              # check-cli.ts, smoke-data-access.ts
|-- load-tests/, tests/       # k6, Playwright
|-- Makefile                  # gen, dev-api, test, lint, migrate
`-- docker-compose.yml        # local Postgres + Redis
```

## Key decisions
**Architecture**
- **Go API + LangGraph.js agent service** -- Go for the platform and backend credibility; LangGraph for the agent graph.
- **Contract-first** -- one OpenAPI spec generates code for both services; CI fails on drift.
- **Stateless agent** -- never touches Redis or Postgres; one owner for every piece of state.
- **HMAC-signed internal calls** -- agent routes are public URLs, so every call is signed and timestamped.
- **Render (Go) + Vercel Hobby (web)** -- free with no card; an Inngest keep-warm ping avoids Render's 15-minute sleep within 750 free hours.
- **Inngest for durable runs** -- retries, concurrency limit, survives disconnects.
- **Realtime broadcast + `check_events` replay** -- progress decoupled from the request that started the run.
- **Sentry distributed tracing** -- one trace from Go through the agent and back; LangSmith holds LLM traces, linked by checkId.

**Agent**
- **LangGraph.js** -- typed state, parallel fan-out and join, streaming, LangSmith tracing.
- **Two-step identify -> confirm -> check** -- the biggest accuracy lever; a wrong product poisons every check.
- **Deterministic first** -- paid-signal patterns before LLM; quadrant from a config table, not the LLM.
- **Risk signals, never scam verdicts** -- evidence-backed signals only.
- **Zod at every LLM boundary** -- `withStructuredOutput(schema)`; Go validates requests against contract types.
- **Graceful degradation** -- failed nodes write `unavailable`; the synthesizer handles gaps.
- **Gemini only, Flash-Lite default** -- best free-tier usage; Groq ruled out (daily token cap = ~10 checks).
- **Per-step models** -- `MODEL_<STEP>` overrides one step, only when evals justify it; Flash is fallback after one retry.
- **Merged screenshot read + identify** -- saves a call per check.
- **Tavily for all lookups, not Gemini grounding** -- grounding is "Not available" on the Gemini Free tier (Phase 0); Tavily's 1,000 free credits/month suit demo-scale use at $0. Lookups sit behind `searchWeb()`, so moving to grounding with billing later is a provider swap. Sources are the result URLs.
- **Eval gate in CI** -- agent PRs run a fixed subset against `web/evals/gate.json` thresholds.

**Input and data**
- **TikTok only, screenshot-first** -- screenshots capture the commission label and survive oEmbed changes; Shop listing screenshots give price, rating, units sold.
- **Hype meter computed live per check** -- satisfies the first-user rule.
- **Per-section cache by product key** -- hype 24h, prices 24h, reviews 7d, risk 3d; disclosure and the deal comparison always run.
- **Request coalescing** -- Redis locks in Go let one run do each section while concurrent checks wait; TTLs and takeover handle crashes.
- **Quota budget with atomic reserves and shedding** -- runs degrade in order instead of failing.
- **`EXTERNALS_MODE=mock`** -- every external dependency has a fixture mock with realistic latency, for CI and load tests.

**Product and ops**
- **Free at launch, no billing anywhere** -- capacity is limited by free tiers, enforced by the quota budget; paid tiers are a later decision.
- **One free Google project per environment** -- testing never spends production quota; no extra projects to multiply quota.
- **Optional auth** -- checks never require sign-in; accounts add history and higher limits.
- **Turnstile in launch week** -- rate limits and the daily cap protect costs until then.
- **Admin console + correction requests** -- needed given labeling stakes.
- **No affiliate links** -- outbound links are stripped of affiliate params.
- **Privacy disclosure** -- Gemini free-tier terms allow Google to use submitted content; disclosed under the upload button and on the privacy page; screenshots deleted after 30 days.
- **Lean ops** -- Sentry alerts instead of an uptime service; three Playwright smoke tests; A/B tests only after launch traffic.

## Scope
- **Launch:** link/video screenshot/listing screenshot input, confirmation, all four checks, quadrant verdict card, share page + OG image, optional accounts, corrections, methodology and privacy pages, quota budget with at-capacity mode.
- **Post-launch (Phase 7):** follow-up questions, price-drop alerts, weekly hype digest.
- **Out of scope:** other platforms, native apps, extensions, scraping TikTok, affiliate revenue, seller analytics, any billing.
- **Launch category:** skincare (code is category-agnostic; only prompts, evals, and marketing are tuned).
- **Launch discipline:** set a launch date at the start of Phase 4; Phase 5 may not push it more than a week. Anything that would moves post-launch and gets logged.

## Known risks
- **oEmbed captions** -- confirmed missing in Phase 0 (no title/author, 0/3 videos); link input must ask for a screenshot to get the caption and commission label.
- **Reddit API** requires approval -- reviews work without it.
- **TikTok search coverage** -- measured in Phase 0 at ~12 videos/product (target 20); the YouTube supplement is needed, and the hype meter must state its sample size.
- **Labeling accuracy** -- false "paid" or risk claims are defamation risks; conservative wording, evidence, corrections.
- **Dropship false matches** -- reported as "similar generic items found," never fact.
- **Free-tier limits** change and Gemini's aren't published -- record real limits from AI Studio in Phase 0.
- **Free-tier data use** -- disclosed; screenshots deleted after 30 days.
- **Capacity ceilings** -- dozens of new products/day; cache and coalescing make repeats free.
- **Unsourced claims** -- claims the LLM can't tie to a search-result URL are dropped.
- **Tavily capacity** -- ~60-120 uncached checks/month (estimate; measure in Phase 5). At capacity, cached verdicts still load. Real traffic means a paid plan or grounding with billing.
- **Free-tier Flash availability** -- every Gemini Flash model returned 503 "high demand" or timed out during Phase 0 while Flash-Lite answered in ~1s; the fallback must tolerate the fallback being down too.
- **Render cold starts** -- keep-warm cron and Inngest retries; measured in Phase 5.
- **Cross-service complexity** -- contract drift check, distributed tracing, E2E on every preview.
- **Supabase from Render** -- use the session-mode pooler (IPv4), not the direct connection.
- **Vercel Hobby is non-commercial** -- fine while free.
- **Scope creep** -- see launch discipline.

## Environment variables

**Go API (`api/.env`, Render):**
```
EXTERNALS_MODE=live
PORT=8080
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWKS_URL=
REDIS_URL=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
AGENT_BASE_URL=
INTERNAL_API_SECRET=
TURNSTILE_SECRET_KEY=
POSTHOG_KEY=
POSTHOG_HOST=
SENTRY_DSN=
IP_HASH_SALT=
DAILY_CHECK_CAP=
QUOTA_GEMINI_DEFAULT_RPD=
QUOTA_GEMINI_FALLBACK_RPD=
QUOTA_TAVILY_MONTHLY=
QUOTA_YOUTUBE_DAILY_UNITS=
QUOTA_YOUTUBE_SEARCH_DAILY=
ADMIN_EMAILS=
WEB_ORIGIN=
```

**Web + agent (`web/.env.local`, Vercel):**
```
EXTERNALS_MODE=live
NEXT_PUBLIC_API_BASE_URL=
API_INTERNAL_BASE_URL=
INTERNAL_API_SECRET=
GOOGLE_API_KEY=
GEMINI_DEFAULT_MODEL=
GEMINI_FALLBACK_MODEL=
MODEL_INGEST=
MODEL_IDENTIFY=
MODEL_DISCLOSURE=
MODEL_REVIEWS=
MODEL_HYPE=
MODEL_RISK=
MODEL_DEAL=
MODEL_SYNTHESIZE=
MODEL_JUDGE=
SEARCH_PROVIDER=tavily
SEARCH_API_KEY=
YOUTUBE_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
LANGSMITH_API_KEY=
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=receipts
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
NEXT_PUBLIC_SENTRY_DSN=
MOCK_LATENCY_MIN_MS=
MOCK_LATENCY_MAX_MS=
```

- Commit only `api/.env.example` and `web/.env.example`. CI secrets in GitHub Actions; production values in Render and Vercel.
- `INTERNAL_API_SECRET` matches in both services. Model and search keys live only in web; database and Redis credentials only in Go.
- `DATABASE_URL` = Supabase session-mode pooler. `REDIS_URL` = Upstash `rediss://` URL.
- `GEMINI_DEFAULT_MODEL` = a Flash-Lite model, `GEMINI_FALLBACK_MODEL` = a Flash model; `MODEL_<STEP>`, `YOUTUBE_API_KEY`, and `REDDIT_*` are optional.
- Dev/CI and production use separate free-tier Google projects; no billing anywhere. `QUOTA_*` = production free-tier limits from Phase 0 (Go applies a 10% margin).
- `EXTERNALS_MODE=mock` for CI, E2E, and load tests; evals always live. `MOCK_LATENCY_MIN_MS`/`MOCK_LATENCY_MAX_MS` set the simulated latency (default 800/2500).
- Go validates config at startup and exits on missing values; web uses per-feature Zod getters in `web/src/lib/env.ts`.

## Running locally
```bash
make gen                                   # regenerate code from contracts/openapi.yaml
docker compose up -d                       # local Postgres + Redis
make migrate                               # goose migrations
make dev-api                               # Go API on :8080 (air hot reload)
pnpm --dir web dev                         # Next.js + agent routes on :3000
npx inngest-cli@latest dev -u http://localhost:8080/api/inngest
pnpm --dir web check "<url-or-image-path>" # agent pipeline from the CLI
pnpm --dir web smoke                       # data-access smoke test (live; ~15 Tavily credits, ~5 Gemini calls)
pnpm --dir web evals                       # full eval set (live)
pnpm --dir web evals:gate                  # CI gate subset
make test                                  # go test -race ./... + Vitest
make lint                                  # golangci-lint + eslint (Next 16 has no `next lint`)
pnpm --dir web typecheck                   # next typegen + tsc (plain tsc misses Next's generated route types)
npx @redocly/cli@2.72.1 lint contracts/openapi.yaml  # contract lint (same as CI)
pnpm e2e                                   # Playwright (mock mode)
k6 run load-tests/check-burst.js           # load test (mock-mode deployment)
```

## Development guidelines
- Explain reasoning before implementing; build the smallest working unit first; one task per session, committed before moving on
- `main` is protected: work on a branch, push, and merge through a PR once `go`/`web`/`contract` pass
- Never move forward until the current piece runs correctly
- Every PR passes CI; never merge past a failing eval gate without a Decisions log entry
- Change APIs in `contracts/openapi.yaml` first, then `make gen`; never hand-edit generated code
- Go: wrap errors with context, no panics in handlers, `context.Context` with deadlines everywhere, `-race` in CI, golangci-lint clean
- Verify LangGraph.js, LangChain.js, Next.js, Inngest, Supabase, oapi-codegen, sqlc, and provider SDK APIs against current docs (context7) before using them
- Every external call has a timeout, a typed failure result, and a mock
- Never claim a creator is paid without a detected signal; never present the hype meter as all of TikTok
- Log provider, model, tokens/units, and latency for every LLM and search call into check metadata
- New infrastructure gets a one-line reason in Key decisions first

## Metrics tracking

Record each number with its measurement method and sample size. These feed resume bullets, the pitch, and interviews.

**Usage (PostHog):** unique users `--` | signed up `--` | WAU `--` | week-1 retention `--` | checks/week `--` | shares `--` | input split (link / video / listing) `--` | quadrant distribution `--` | deal coverage `--` | product correction rate `--` | A/B results `--`

**Performance:** p50/p95 time to verdict `--` | time to first progress event `--` | fan-out vs sequential gain `--` | cache hit rate per section `--` | coalesced runs per section `--` | Go -> agent hop p95 `--` | Render cold starts `--`

**Load testing (k6, mock):** peak sustained check rate `--` | p95 under load `--` | error rate `--` | dropped checks (target 0) `--` | coalescing savings `--` | share page p95 `--`

**Quota and cost:** quota per uncached check by budget `--` | uncached checks/day allowed `--` | time at capacity `--` | share served from cache/coalescing `--` | YouTube supplement usage `--` | paid-equivalent cost per check `--` | fallback rate `--` | steps upgraded to Flash (gain, cost) `--` | LLM calls per check `--`

**Accuracy (eval set):** product ID accuracy `--` (n=`--`) | disclosure precision/recall `--` | hype classifier precision `--` | listing extraction accuracy `--` | risk signal precision `--` | quadrant agreement `--` | prompt iterations and gains `--` | regressions blocked by gate `--`

**Reliability:** failed checks `--` | degraded checks `--` | corrections received/resolved `--` | CI duration `--`

**How to measure:**
- **Product ID accuracy** -- brand + product match after normalization (logged LLM judge for near-matches); correct / total.
- **Disclosure precision/recall** -- against hand labels; precision matters most (a false positive is a false accusation).
- **Risk signal and hype classifier precision** -- hand-review 50 each; report deterministic-only vs with LLM for hype.
- **p95 time to verdict** -- from `requested_at` / `completed_at`; cached and uncached separately.
- **Load tests** -- mock externals with realistic latency, so numbers measure this system; record the scenario with each number.
- **Quota per check** -- mean usage per budget over 50+ uncached checks; daily capacity = (limit - margin) / mean, smallest wins.
- **Paid-equivalent cost** -- same usage priced in `api/cmd/measure`; planning only.
- **Coalescing savings** -- k6 viral-product test, enabled vs disabled: (runs_off - runs_on) / runs_off.
- **Cache hit rate** -- hits / lookups per section.

## Progress tracking

Update after every task and phase. This is the first thing a new session reads.

### Current status
- **Current phase:** Phase 1 -- Agent pipeline in isolation (Phase 0 manual validation test still open)
- **Current task:** Phase 1, Task 3 -- Input ingestion
- **Last completed task:** Phase 1, Task 2 -- Model factory, fallback, and mock mode (2026-11-17)
- **Next task:** Phase 1, Task 4 -- Product identification node
- **Launch date:** not set (set at the start of Phase 4)

### Phase completion
- [ ] Phase 0 -- Validation and setup
- [ ] Phase 1 -- Agent pipeline in isolation
- [ ] Phase 2 -- Observability, evals, and the CI eval gate
- [ ] Phase 3 -- Accuracy iteration
- [ ] Phase 4 -- Go API, agent service, and web app
- [ ] Phase 5 -- Startup-grade launch readiness
- [ ] Phase 6 -- Launch and metrics
- [ ] Phase 7 -- Post-launch features

### Phase 0 tasks
- [ ] Manual validation test (non-coding)
- [x] Task 1 -- Scaffold the monorepo
- [x] Task 2 -- Data-access smoke test
- [x] Task 3 -- CI baseline

### Phase 1 tasks
- [x] Task 1 -- Zod schemas
- [x] Task 2 -- Model factory, fallback, and mock mode
- [ ] Task 3 -- Input ingestion
- [ ] Task 4 -- Product identification node
- [ ] Task 5 -- Disclosure check node
- [ ] Task 6 -- Web search (`searchWeb()`) and review research node
- [ ] Task 7 -- Hype meter node
- [ ] Task 8 -- Risk check node
- [ ] Task 9 -- Deal comparison node
- [ ] Task 10 -- Synthesizer node with quadrant
- [ ] Task 11 -- Graph assembly with parallel fan-out
- [ ] Task 12 -- End-to-end CLI run on real products

### Phase 2 tasks
- [ ] Task 1 -- LangSmith tracing and run names
- [ ] Task 2 -- Labeled eval set
- [ ] Task 3 -- Eval runner
- [ ] Task 4 -- Eval gate in CI

### Phase 4 tasks
- [ ] Task 1 -- OpenAPI contract and code generation
- [ ] Task 2 -- Database schema, migrations, sqlc, and RLS
- [ ] Task 3 -- Agent service endpoints
- [ ] Task 4 -- Go identify endpoint
- [ ] Task 5 -- Durable check runs on Inngest (Go)
- [ ] Task 6 -- Realtime progress
- [ ] Task 7 -- Caching, request coalescing, and rate limiting (Go)
- [ ] Task 8 -- Quota service and at-capacity mode (Go)
- [ ] Task 9 -- Input and confirm UI
- [ ] Task 10 -- Progress and verdict UI
- [ ] Task 11 -- Shareable verdict page and OG image
- [ ] Task 12 -- Accounts and check history

### Phase 5 tasks
- [ ] Task 1 -- Analytics, error tracking, distributed tracing, and feature flags
- [ ] Task 2 -- Quota, cost, and latency measurement
- [ ] Task 3 -- Load testing with k6
- [ ] Task 4 -- Admin console and correction requests
- [ ] Task 5 -- Edge cases, limits, methodology, and privacy pages
- [ ] Task 6 -- Health endpoint, alerting, keep-warm, and Turnstile
- [ ] Task 7 -- Production deploy (Render + Vercel) and E2E in CI

### Phase 7 tasks
- [ ] Task 1 -- Follow-up questions
- [ ] Task 2 -- Price-drop alerts
- [ ] Task 3 -- Weekly hype digest
- [ ] Task 4 -- Uptime monitoring and status page (optional)

### Decisions log
Architectural decisions made during the build that weren't in the original design.

| Decision | Reason | Tradeoff |
|----------|--------|----------|
| godotenv loads `api/.env` in dev | `make dev-api` works the same in any shell (cmd, PowerShell, bash) | One extra dependency; a missing file is ignored, so production must set real env vars |
| Go required env vars grow per phase | The server boots now; each key becomes required in the phase that first uses it | Config must be updated in every phase that adds a dependency |
| Go module path `github.com/SumantMunagala/receipts/api` | Was `receipts/api` until the GitHub remote existed; renamed in Task 3 | None |
| Public repo for branch protection | GitHub Free enforces branch protection only on public repos; public also means unlimited Actions minutes | Plans, CLAUDE.md, and test fixtures URLs are visible; never commit secrets (history checked clean at the switch) |
| Tavily for all web lookups; no Gemini grounding (2026-11-17) | Phase 0: grounding is "Not available" on the Free tier (all grounded calls 429). Enabling billing makes every token in the project billable, so spend can't be held at $0, and the spend cap is experimental with ~10 min overage. Demo-scale use fits Tavily's 1,000 free credits/month | Capacity ~60-120 uncached checks/month; answer quality depends on Tavily results + Flash-Lite reading them. Upgrade path: grounding in a separate billed project behind `searchWeb()` |
| LangChain packages pinned exactly (`@langchain/google-genai@2.3.4`, `@langchain/core@1.3.3`) | Structured-output schema handling changes between releases; a probe verified this exact pair | Upgrades are deliberate: re-run `pnpm --dir web test` with the live tests before bumping |
| Retry/fallback policy owned by `llm.ts`, not LangChain | One 429 retry with Gemini's own delay, then a model with separate quota; LangChain's default backoff would hide 429s and burn quota | Custom code to maintain (covered by mock tests that inject 429s) |
| Section schemas as discriminated unions on `status` | Makes "ok without data" and "unavailable with data" unrepresentable; each node's LLM gets only its ok variant | Consumers switch on `status` instead of reading optional fields |
| `@google/genai` for raw Gemini calls in scripts | Official SDK; shows exactly what the provider returns (usage, errors) without the LangChain layer | Two Gemini client libraries once Phase 1 adds `@langchain/google-genai` |
| Models: `gemini-3.5-flash-lite` default, `gemini-3.8-flash` fallback | Newest stable (non-preview) Lite and Flash available to the key; 2.5 models are closed to new users (404) | Free-tier Flash was overloaded (503) during Phase 0; revisit if that persists |

### Issues log
Bugs and how they were resolved -- what broke and how you fixed it is great interview material.

| Issue | Root cause | Resolution |
|-------|------------|------------|
| Docker engine never came up (`dockerDesktopLinuxEngine` pipe missing) | Windows "Virtual Machine Platform" feature was off, so WSL2 couldn't run (BIOS virtualization was fine) | Admin `wsl.exe --install --no-distribution` + reboot |
| `go test -race` failed to find a usable C compiler | Old 32-bit `C:\MinGW` gcc 6.3 is first on the system PATH | Installed WinLibs gcc and set `go env -w CC=` to it, leaving PATH alone |
| air failed with "invalid escape sequence: \s" | Windows path in a TOML basic string (`"tmp\server.exe"`) | TOML literal string `'tmp\server.exe'` |
| Every rdap.org lookup returned 403 | rdap.org's CDN blocks Node's default User-Agent | Send a descriptive `user-agent` header |
| Every grounded Gemini call returned 429 "exceeded your current quota" with no quota details | Grounding is not offered on the Free tier at all; it isn't a rate limit | Confirmed on the pricing page; moved all lookups to Tavily |
| CI `tsc --noEmit` failed: "Cannot find name 'LayoutProps'" (passed locally) | Next generates route type globals into `.next/types` via `next-env.d.ts`, both gitignored; local runs reused files from earlier `dev`/`build`, a clean CI checkout had none | `pnpm typecheck` = `next typegen && tsc --noEmit`, used locally and in CI; reproduced by deleting `.next`/`next-env.d.ts` first |
| LangChain `withStructuredOutput` returned `parsed: null` for every discriminated-union schema while plain objects worked | `@langchain/google-genai` sends Gemini's legacy `responseSchema`, which ignores `oneOf`, so the output was unconstrained (`{"disclosure_result": ...}`) | `toGeminiSchema()` renames `oneOf` to `anyOf` and passes the JSON Schema with `method: "jsonSchema"`; Zod validates afterwards |
| Gemini returned `status: "disclosed"` for a discriminated-union schema (accepted the schema, broke the contract) | `z.literal` exports as JSON Schema `const`, which Gemini's structured output doesn't enforce | `tag()` helper (one-value `z.enum`, exported as `enum`) for every discriminator; a test fails if any LLM-facing schema contains `const`; 3/3 live runs then valid |
| Polling CI through the GitHub API stopped returning data | Unauthenticated API limit is 60 requests/hour; polling every 10s used it up | Check CI in the browser, or poll at long intervals with the full commit SHA |
| Smoke report counted a skipped vision call as passed | Helper returned a boolean, so skip and pass collapsed together | Return `pass`/`fail`/`skip` and count each separately |