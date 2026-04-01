# Supported Install Surfaces

This file defines which install and runtime surfaces Queenshift can describe honestly in the public repo today.

## Status Labels

1. `Supported` means the surface has direct proof and matches the current bounded public story.
2. `Partial` means the surface is real and useful, but it is still a contributor or evaluator route rather than a calm normal-user default.
3. `Out of scope` means the surface is not a current public promise.

## Current Matrix

| Surface | Audience | Status | Current boundary |
| --- | --- | --- | --- |
| Public source checkout plus local install (`npm ci`, `npm run build`, `npm link`) | contributors, evaluators | Partial | real route for contributors and careful evaluators; not yet a polished normal-user install story |
| `npm exec -- queenshift ...` from a checked-out repo | contributors, evaluators | Partial | useful for local evaluation without a global link, but still a source-checkout surface |
| Local Windows RC1 bundle used in the project's release-candidate work | owners, evaluators | Supported project evidence surface | part of the current project evidence, but this curated public repo is a source release, not the bundle itself |
| VS Code Extension Development Host thin shell from source checkout | contributors, evaluators | Partial | wrapper-only developer surface, not a marketplace distribution |
| Published npm package install | normal users | Out of scope | not the current public install claim |
| Marketplace installs or auto-updaters | normal users | Out of scope | not supported today |
| Broad packaged cross-platform parity | normal users | Out of scope | not yet earned |

## Current Public Truth

1. The public repo is a curated source release.
2. The calmest direct path in this repo is still the checked-out contributor or evaluator route.
3. The broader project record still says the only stranger-first install evidence so far comes from the local Windows bundle path used during release-candidate work.
4. That does not make this public repo a finished packaged install surface.

## Recommended Paths

### Contributor or evaluator path

1. `npm ci`
2. `npm run build`
3. `npm test`
4. `npm link` if you want a local `queenshift` command
5. `queenshift doctor`
6. `queenshift owner:guided:demo`
7. `queenshift demo:run`
8. `queenshift repo:onboard --workspace <repo>`

### Stranger-first truth

1. The project is visible publicly now.
2. The stricter normal-user production-ready CLI answer is still `NO`.
3. This repo should be read as a serious bounded source release, not as a claim of packaged parity.

## Related Docs

1. `README.md`
2. `QUICKSTART.md`
3. `CONTRIBUTOR_SOURCE_CHECKOUT.md`
4. `PROVIDER_SETUP_GUIDE.md`
5. `IDE_SURFACES.md`
6. `GENERAL_USE_READINESS_DECISION.md`

## Boundaries

1. This file does not turn the public repo into a broad packaged install story.
2. It keeps the source-checkout route honest.
3. It keeps the stranger-first bundle evidence separate from the current public source release.
