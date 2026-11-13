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
- Not yet verified: `docker compose up` (Docker Desktop engine didn't start during Task 1) and SIGTERM shutdown on Linux. Check both at the start of Task 2.

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
- **External data:** Gemini Google Search grounding (reviews, prices, brand/retailer/complaint lookups); Tavily via `searchWeb()` only where exact text matters (hype captions, dropship listings); TikTok oEmbed; YouTube Data API (optional hype supplement); RDAP; CPSC recalls API; Reddit API only if approved
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
                    |- reviews     (grounded search)
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

- **Risk:** one grounded call covers brand site, retailer presence, and complaints; RDAP for domain age; raw search for AliExpress/Temu matches; CPSC for recalls. Output a level (`no_signals_found` / `some_signals` / `multiple_signals`), signals with evidence and sources, and which checks ran.
- **Deal:** TikTok price from the screenshot (or typed by the viewer); outside prices from one grounded call, each with a source (approximate). The synthesizer attaches the risk check's generic match as a cheaper equivalent.
- **Ratings gap:** flag when the TikTok Shop rating and outside sentiment disagree (e.g. 4.8 stars, negative reviews).
- **Quota budget:** all free tiers, no billing anywhere. Go keeps Redis counters per budget (Gemini requests per model/day, grounded requests/day, Tavily credits/month, YouTube units/day). The agent reserves before every external call. Shedding order as budgets drop: YouTube supplement off -> hype sample 20 -> dropship off -> no new uncached checks. Uncached checks are refused up front if they can't finish. At capacity, cached verdicts and trending still load.
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
|   |-- src/lib/              # env, llm, grounded, search, ingest, externals/ (live + mock),
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
- **Grounded search for most lookups** -- far larger free allowance than Tavily; sources come only from grounding metadata.
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
- **oEmbed captions** may be missing (reported Oct 2026) -- verified in Phase 0; falls back to screenshots.
- **Reddit API** requires approval -- reviews work without it.
- **TikTok search coverage** is uneven -- measured in Phase 0; YouTube supplement exists for this.
- **Labeling accuracy** -- false "paid" or risk claims are defamation risks; conservative wording, evidence, corrections.
- **Dropship false matches** -- reported as "similar generic items found," never fact.
- **Free-tier limits** change and Gemini's aren't published -- record real limits from AI Studio in Phase 0.
- **Free-tier data use** -- disclosed; screenshots deleted after 30 days.
- **Capacity ceilings** -- dozens of new products/day; cache and coalescing make repeats free.
- **Grounding sources** -- claims without a grounding-metadata source are dropped.
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
QUOTA_GROUNDED_RPD=
QUOTA_TAVILY_MONTHLY=
QUOTA_YOUTUBE_DAILY_UNITS=
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
```

- Commit only `api/.env.example` and `web/.env.example`. CI secrets in GitHub Actions; production values in Render and Vercel.
- `INTERNAL_API_SECRET` matches in both services. Model and search keys live only in web; database and Redis credentials only in Go.
- `DATABASE_URL` = Supabase session-mode pooler. `REDIS_URL` = Upstash `rediss://` URL.
- `GEMINI_DEFAULT_MODEL` = a Flash-Lite model, `GEMINI_FALLBACK_MODEL` = a Flash model; `MODEL_<STEP>`, `YOUTUBE_API_KEY`, and `REDDIT_*` are optional.
- Dev/CI and production use separate free-tier Google projects; no billing anywhere. `QUOTA_*` = production free-tier limits from Phase 0 (Go applies a 10% margin).
- `EXTERNALS_MODE=mock` for CI, E2E, and load tests; evals always live.
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
pnpm --dir web evals                       # full eval set (live)
pnpm --dir web evals:gate                  # CI gate subset
make test                                  # go test -race ./... + Vitest
make lint                                  # golangci-lint + eslint (Next 16 has no `next lint`)
pnpm e2e                                   # Playwright (mock mode)
k6 run load-tests/check-burst.js           # load test (mock-mode deployment)
```

## Development guidelines
- Explain reasoning before implementing; build the smallest working unit first; one task per session, committed before moving on
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
- **Current phase:** Phase 0 -- Validation and setup
- **Current task:** Phase 0, Task 2 -- Data-access smoke test
- **Last completed task:** Phase 0, Task 1 -- Scaffold the monorepo (2026-11-13)
- **Next task:** Phase 0, Task 3 -- CI baseline
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
- [ ] Task 2 -- Data-access smoke test
- [ ] Task 3 -- CI baseline

### Phase 1 tasks
- [ ] Task 1 -- Zod schemas
- [ ] Task 2 -- Model factory, fallback, and mock mode
- [ ] Task 3 -- Input ingestion
- [ ] Task 4 -- Product identification node
- [ ] Task 5 -- Disclosure check node
- [ ] Task 6 -- Grounded search, raw search, and review research node
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
| Go module path `receipts/api` | No GitHub remote yet | Rename to `github.com/<owner>/receipts/api` when the remote exists (Task 3) |

### Issues log
Bugs and how they were resolved -- what broke and how you fixed it is great interview material.

| Issue | Root cause | Resolution |
|-------|------------|------------|