# Language Reliability Matrix

This file records the honest proof level for each language lane instead of flattening everything into one "supported" label.

Read it as intentionally asymmetric:

1. Queenshift is currently strongest in bounded JS/TS work
2. other language rows exist so the repo does not fake symmetry

## Matrix

| Language lane | Repo-map pack depth | Framework hints surfaced when detected | Verification profile classes | Repeated proof level | Honest claim today |
| --- | --- | --- | --- | --- | --- |
| JavaScript / TypeScript | Deep language pack | `Vitest`, `Jest`, `ESLint` | `local_npm_test_v1`, `local_node_verify_script_v1`, `local_npx_tsc_v1`, `local_npx_vitest_v1`, `local_npx_jest_v1`, `local_npx_eslint_v1` | Deterministic profile proof plus repo-map framework evidence plus live bounded beta evidence | Strongest bounded contributor and owner lane |
| Python | Deep language pack | `pytest`, `unittest` | `local_python_pytest_v1`, `local_python_unittest_v1` | Deterministic profile proof plus repo-map framework evidence | Real contributor candidate with bounded verification guidance |
| Go | Verification-only repo-map pack | `(none)` | `local_go_test_v1` | Deterministic profile proof plus repo-map verification-only evidence | Manifest-backed contributor verification candidate only |
| Rust | Verification-only repo-map pack | `(none)` | `local_cargo_test_v1` | Deterministic profile proof plus repo-map verification-only evidence | Manifest-backed contributor verification candidate only |

## Proof Sources

1. `npm.cmd run verify:profiles` proves every shipped verification profile class deterministically.
2. `npm.cmd run verify:repo-map` proves that repo-map artifacts surface deep framework hints for JS/TS and Python plus verification-only Go and Rust packs.
3. `npm.cmd run verify:live:beta` proves the current external live lane that feeds broader language confidence.
4. `LANGUAGE_PACKS.md` defines which lanes have deep repo-map guidance versus verification-only coverage.
5. `TASK_CORPUS.md` and the beta forensics surfaces explain which task families are actually landing.

## Boundaries

1. Deep language-pack coverage exists only for JavaScript / TypeScript and Python.
2. Go and Rust now appear in repo-map output, but only as verification-only packs rather than deep refactor-planning packs.
3. Framework hints describe detected repo evidence; they do not imply universal framework fluency.
4. A verification profile class does not imply broad autonomous repo understanding.
5. The matrix is intentionally asymmetric because proof depth is asymmetric.
