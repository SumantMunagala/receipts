# Receipts

[![CI](https://github.com/SumantMunagala/receipts/actions/workflows/ci.yml/badge.svg)](https://github.com/SumantMunagala/receipts/actions/workflows/ci.yml)

**Check the hype before you buy.** Receipts checks a TikTok Shop product from a TikTok link or screenshot. It answers four questions: is the hype paid, is the product actually good, is the seller legit, and is it a good deal. The result is a shareable verdict card.

- `api/`: Go API service (chi)
- `web/`: Next.js web app and the TypeScript agent routes
- `contracts/openapi.yaml`: the API contract both services are generated from

Architecture, decisions, and local run commands are in [CLAUDE.md](CLAUDE.md).

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request, with `EXTERNALS_MODE=mock`, so no API keys are needed.

| Check | Runs when | What it does |
|---|---|---|
| `go` | `api/`, `Makefile`, or the workflow changed | `go vet`, golangci-lint, `go test -race`, `go build` |
| `web` | `web/` or the workflow changed | eslint, `next typegen` + `tsc --noEmit`, Vitest, `next build` |
| `contract` | always | Redocly lint of `contracts/openapi.yaml`; `make gen` must leave no diff |

A check skipped by its path filter reports as **skipped**. GitHub counts that as passing for required checks, so a Go-only PR isn't blocked waiting on `web`.

## Branch protection (manual GitHub settings)

`main` only accepts changes through pull requests with all checks passing. GitHub's free plan enforces this only on public repositories. These are one-time settings in the GitHub UI:

1. **Make the repo public:** Settings → General → Danger Zone → Change repository visibility → Public.
2. **Protect `main`:** Settings → Branches → Add classic branch protection rule:
   - Branch name pattern: `main`
   - Turn on **Require a pull request before merging**. Set required approvals to 0, since a solo maintainer can't approve their own PRs.
   - Turn on **Require status checks to pass before merging**, plus **Require branches to be up to date before merging**. Then search for and add `go`, `web`, and `contract`.
   - Turn on **Do not allow bypassing the above settings**, so the rule applies to admins too.
   - Click **Create**.

The status checks only appear in that search box after CI has run at least once. Merge the first CI pull request before step 2.
