# Queenshift

Queenshift is a bounded coding CLI for small clean Git repos.

It helps with small, explicit code changes while keeping review, incident handling, and run artifacts visible.

`Queenshift` is the public product name. `Queenshift CLI` is the longer public label when that helps. `swarmengine` remains the shipped bounded engine, and `queenbee` remains experimental behind the scenes.

## Start Here

1. read [docs/install.md](./docs/install.md) for the current install truth and audience split
2. if you are evaluating from a checked-out repo, read [QUICKSTART.md](./QUICKSTART.md)
3. keep your first real task tiny, explicit, and file-named

## What This Beta Is Good At

- small named-file updates
- bounded source-and-test pairs where you name the source file and its direct local test
- bounded docs-and-source sync
- artifact-backed review and incident follow-up
- calm first-run demos in a disposable repo

## What This Beta Does Not Claim

- broad general-use autonomous coding
- open-ended repo-wide refactors
- marketplace install or broad packaged cross-platform parity
- `queenbee` as a shipped public engine

For one current evidence summary that keeps live anchors, experimental limits, and benchmark gaps on one public surface, read [docs/evidence.md](./docs/evidence.md).

## Experimental Public Release Answer

As of `2026-03-30`, Queenshift is ready for an experimental public release.

That answer stays bounded:

1. broad general-use readiness remains out of scope
2. the fixed benchmark scoreboard is still unresolved rather than promotional
3. `swarmengine` remains the shipped bounded engine
4. `queenbee` remains experimental

## Production-Ready CLI Answer

As of `2026-04-01`, the stricter normal-user production-ready CLI answer is still `NO`.

That answer stays bounded:

1. the experimental public release surface is coherent enough for bounded public visibility
2. Queenshift still does not have one published normal-user install command
3. the local Windows bundle remains the only supported stranger install surface today
4. the checked-out repo path remains evaluator or contributor setup, not the final install story
5. `swarmengine` remains the shipped bounded engine and `queenbee` remains experimental

## Current Install Truth

1. the calmest supported stranger install surface today is still the local Windows bundle
2. the public product command is `queenshift`
3. the repo-root package identity is now `queenshift-cli`
4. inside a checked-out repo, `npm link` gives one real `queenshift` binary path without claiming a published npm registry install yet
5. the checked-out-repo path still stays honest as a contributor-style or evaluator path and does not pretend to be packaged parity
6. once the command is available, the calm product path is `queenshift doctor -> queenshift owner:guided:demo -> queenshift demo:run -> queenshift repo:onboard --workspace <repo> -> queenshift "<task>" --workspace <repo> --admitOnly`
7. checkout-only preparation stays in `docs/install.md` and `QUICKSTART.md` so this README can stay on the product path

## Calm Product Path

1. run `queenshift doctor`
2. run `queenshift owner:guided:demo` when you want the calmest frozen first pass
3. run `queenshift demo:gallery` and `queenshift demo:run` before a real target repo
4. use `queenshift repo:onboard --workspace <repo>` before a real target repo
5. preflight the task with `queenshift "<task>" --workspace <repo> --admitOnly`
6. if the run stops, use the short recovery loop: `queenshift incident:latest --workspace <repo>` shows what failed, `queenshift owner:quick-actions --workspace <repo>` shows the safest next command, `queenshift replay:latest --workspace <repo>` shows the recorded timeline, and `queenshift resume:latest --workspace <repo>` is there when resumability evidence exists

## Public Docs In This Repo

1. [QUICKSTART.md](./QUICKSTART.md)
2. [AUTHORS.md](./AUTHORS.md)
3. [CITATION.cff](./CITATION.cff)
4. [.zenodo.json](./.zenodo.json)
5. [CHANGELOG.md](./CHANGELOG.md)
6. [CONTRIBUTING.md](./CONTRIBUTING.md)
7. [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
8. [SECURITY.md](./SECURITY.md)
9. `.github/pull_request_template.md`
10. [LICENSE](./LICENSE)
11. [docs/README.md](./docs/README.md)
12. [docs/evidence.md](./docs/evidence.md)

This repo is intentionally curated and keeps the claim bounded. It is not a broad general-use promise, a default-engine switch, or a benchmark-victory claim. Private launch drafts and export-prep notes stay out of this public repo by default.
