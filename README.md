# Queenshift

Queenshift is a bounded coding CLI built around a governance-first control model.

It treats stochastic coding workers as execution surfaces inside a stricter control system, keeping review, replay, incident handling, and run artifacts explicit instead of burying them inside one opaque prompt loop.

This public repo is the bounded first code slice behind that architecture. It is serious enough to inspect, use, and contribute to, but it is still not a broad general-use coding claim.

`Queenshift` is the public product name. `Queenshift CLI` is the longer public label when that helps. `swarmengine` remains the shipped bounded engine, and `queenbee` remains experimental behind the scenes.

## Start Here

1. read [docs/install.md](./docs/install.md) for the current install status and audience split
2. if you are evaluating from a checked-out repo, read [QUICKSTART.md](./QUICKSTART.md)
3. keep your first real task tiny, explicit, and file-named

## What This Beta Is Good At

- small named-file updates
- bounded source-and-test pairs where you name the source file and its direct local test
- bounded docs-and-source sync
- artifact-backed review and incident follow-up
- calm first-run demos in a disposable repo

## Why Contribute

- help make the bounded JS/TS lane calmer, clearer, and more trustworthy
- improve install, onboarding, and support surfaces for noncoder owners and careful contributors
- strengthen review, replay, incident, and verification surfaces instead of adding opaque behavior
- help the public repo stay aligned with the architecture note's governance-first thesis

## What This Beta Does Not Claim

- broad general-use autonomous coding
- open-ended repo-wide refactors
- marketplace install or broad packaged cross-platform parity
- `queenbee` as a shipped public engine

For a current evidence summary covering live anchors, experimental boundaries, and benchmark gaps on one public surface, read [docs/evidence.md](./docs/evidence.md).

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

## Current Install Status

1. the simplest supported first-time install surface today is still the local Windows bundle
2. the public product command is `queenshift`
3. the repo-root package identity is now `queenshift-cli`
4. inside a checked-out repo, `npm link` gives one real `queenshift` binary path without claiming a published npm registry install yet
5. the checked-out-repo path remains a contributor-style or evaluator path and does not present itself as packaged parity
6. once the command is available, the recommended product path is `queenshift doctor -> queenshift owner:guided:demo -> queenshift demo:run -> queenshift repo:onboard --workspace <repo> -> queenshift "<task>" --workspace <repo> --admitOnly`
7. checkout-only preparation stays in `docs/install.md` and `QUICKSTART.md` so this README can stay on the product path

## Recommended Product Path

1. run `queenshift doctor`
2. run `queenshift owner:guided:demo` when you want the guided first pass
3. run `queenshift demo:gallery` and `queenshift demo:run` before a real target repo
4. use `queenshift repo:onboard --workspace <repo>` before a real target repo
5. preflight the task with `queenshift "<task>" --workspace <repo> --admitOnly`
6. if the run stops, use the short recovery loop: `queenshift incident:latest --workspace <repo>` shows what failed, `queenshift owner:quick-actions --workspace <repo>` shows the safest next command, `queenshift replay:latest --workspace <repo>` shows the recorded timeline, and `queenshift resume:latest --workspace <repo>` is there when resumability evidence exists

## Citation And Release Trail

1. architecture note DOI: [10.5281/zenodo.19323465](https://doi.org/10.5281/zenodo.19323465)
2. first public software DOI: [10.5281/zenodo.19374972](https://doi.org/10.5281/zenodo.19374972)
3. first public GitHub prerelease tag: `v0.1.0-rc1`
4. the note and the software release are meant to be cited as separate artifacts that describe the architecture thesis and the bounded implementation surface

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
13. [SUPPORTED_INSTALL_SURFACES.md](./SUPPORTED_INSTALL_SURFACES.md)
14. [OWNER_OVERSIGHT_GUIDE.md](./OWNER_OVERSIGHT_GUIDE.md)
15. [VERIFICATION_CATALOG.md](./VERIFICATION_CATALOG.md)
16. [GENERAL_USE_READINESS_DECISION.md](./GENERAL_USE_READINESS_DECISION.md)
17. [TASK_CORPUS.md](./TASK_CORPUS.md)

This repo is intentionally curated and keeps the release surface bounded. It is not a broad general-use promise, a default-engine switch, or a benchmark-victory statement.
