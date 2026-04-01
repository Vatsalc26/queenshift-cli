# Language Packs

This file documents the evidence-driven language packs on the fuller real-swarm path.

## Active Packs

1. `JavaScript / TypeScript`
   Repo map now surfaces file counts, sample files, exported symbol hints, framework hints, pack depth, verification lanes, and evidence. When repo hints justify it, the pack can recommend `npm test`, `npx tsc --noEmit`, `Vitest`, `Jest`, and `ESLint` through the bounded `npx vitest run`, `npx jest --runInBand`, and `npx eslint .` lanes.
2. `Python`
   Repo map now surfaces file counts, sample files, function/class hints, framework hints, pack depth, verification lanes, and evidence. When repo hints justify it, the pack can recommend `python -m pytest` and `python -m unittest`.
3. `Go`
   Repo map now surfaces a verification-only repo-map pack with file counts, sample files, symbol hints, the recommended `go test ./...` lane, and evidence such as `go.mod` or `.go` files. This is not a deep planning pack.
4. `Rust`
   Repo map now surfaces a verification-only repo-map pack with file counts, sample files, symbol hints, the recommended `cargo test` lane, and evidence such as `Cargo.toml` or `.rs` files. This is not a deep planning pack.

## Reliability Matrix

1. `LANGUAGE_RELIABILITY_MATRIX.md` records which language lanes have deep repo-map guidance versus verification-only coverage.
2. Deep language-pack coverage is intentionally limited to JavaScript / TypeScript and Python.
3. Go and Rust now surface as verification-only repo-map packs so `repo:map` and `repo:onboard` can answer language questions without implying deep parity.

## Verification Profile Classes

1. `local_npm_test_v1` -> `npm test`
2. `local_node_verify_script_v1` -> `node scripts/verify.js`
3. `local_npx_tsc_v1` -> `npx tsc --noEmit`
4. `local_npx_vitest_v1` -> `npx vitest run`
5. `local_npx_jest_v1` -> `npx jest --runInBand`
6. `local_npx_eslint_v1` -> `npx eslint .`
7. `local_python_pytest_v1` -> `python -m pytest`
8. `local_python_unittest_v1` -> `python -m unittest`
9. `local_go_test_v1` -> `go test ./...`
10. `local_cargo_test_v1` -> `cargo test`

## Repo-Map Language-Pack Fields

1. `id`
2. `depth`
3. `frameworkHints`
4. `verificationLanes`
5. `evidence`

## Where They Apply

1. `repo:map`
2. `repo:onboard --scaffoldProfile`
3. `npm.cmd run verify:repo-map`
4. `npm.cmd run verify:profiles`
5. verification profile manifest validation
6. medium-lane planning context via repo-map artifacts
7. targeted verification-coverage evaluators on harder tasks
8. task-corpus and benchmark evidence for medium and cross-language lanes

## Boundaries

1. Only JavaScript / TypeScript and Python are deep language packs today.
2. Go and Rust are verification-only repo-map packs, not deep planning packs.
3. Framework hints reflect detected repo evidence; they do not imply universal framework support.
4. These packs deepen only when repo evidence justifies it; there is no fake parity across unsupported languages.
5. They improve local hints and verification defaults; they do not claim universal refactor understanding.
6. Public release boundaries still come from the release checklists and proof bundles, not from language-pack presence alone.
