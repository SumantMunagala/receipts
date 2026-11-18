# External integrations: live and mock

Every external dependency (Gemini, search, oEmbed, YouTube, RDAP, CPSC, and anything added later) has two implementations with the same interface. `EXTERNALS_MODE` chooses between them at runtime:

| `EXTERNALS_MODE` | Used by | Behavior |
|---|---|---|
| `live` | local dev, evals | Real network calls with real keys |
| `mock` | CI, Playwright E2E, k6 load tests | Fixtures, simulated latency, no network, no keys |

**Rule: an integration isn't done until its mock exists.** Add the mock beside the live implementation in the same PR. CI runs only in mock mode, so an integration with no mock can't be tested there.

## Layout

```
externals/
  <name>.types.ts   # the interface both implementations satisfy
  <name>.live.ts    # the only file that imports the provider SDK or calls its API
  <name>.mock.ts    # same interface; fixtures + simulated latency + injectable failures
  fixtures/<name>.ts
```

Gemini is the reference implementation: `gemini.types.ts`, `gemini.live.ts`, `gemini.mock.ts`, and `fixtures/llm.ts`, used through `src/lib/llm.ts`.

## What a mock must do

1. **Return realistic, valid data.** Fixtures must pass the same Zod schemas as live output, and a test checks every fixture against its schema.
2. **Simulate latency.** The default is 800-2500 ms, set by `MOCK_LATENCY_MIN_MS` / `MOCK_LATENCY_MAX_MS`. Load tests should measure this system, not unrealistically fast fakes. Tests set the latency to 0.
3. **Inject failures on demand.** Errors should look like the real provider's (for example a 429 with `status` and `retryDelay`), so retry, fallback, and `unavailable` handling run through the same code path as in live mode. See `configureMockLlm({ rateLimits, failures })`.
4. **Never touch the network.** The caller loads the live module with a dynamic `import()` only in live mode, and mock tests stub `fetch` to throw.

## Adding an integration

1. Define the interface in `<name>.types.ts`, and the result type with a Zod schema in `src/schemas/` when an LLM or the API exposes it.
2. Write `<name>.live.ts` with a timeout on every call and a typed failure, never an unhandled throw.
3. Write `<name>.mock.ts` and its fixtures.
4. Load the implementation through `EXTERNALS_MODE` with a dynamic `import()`.
5. Test mock behavior in Vitest. Live checks go in a `*.live.test.ts` file that skips when the key is missing.
