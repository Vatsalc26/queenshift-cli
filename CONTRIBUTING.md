# Contributing to Queenshift

Queenshift stays proof-first, bounded, explicit, and welcoming.

Pull requests are welcome. For bigger changes, open an issue first so we can keep the scope bounded and useful.

## Community Basics

1. read `CODE_OF_CONDUCT.md` and `SECURITY.md` before opening a new public thread
2. assume good intent, keep feedback concrete, and critique code or behavior rather than people
3. if something looks security-sensitive, stop and use the path in `SECURITY.md` instead of posting exploit details publicly

## Start Here

1. read `README.md`, `QUICKSTART.md`, and `docs/task-families.md`
2. keep your first change small, named-file, and easy to review
3. use the issue templates before proposing a broader task-family change
4. if you are new, start with docs, onboarding clarity, or a small named-file fix

## Before Opening a Pull Request

1. run `npm.cmd test`
2. explain the smallest useful fix scope and the named files you touched
3. update the matching docs when behavior, install truth, or task-family wording changes
4. do not widen the public claim beyond the bounded beta surface

## How Pull Requests Are Handled

1. small bounded fixes are the best first pull requests
2. broader features or architecture changes should start as an issue or discussion first
3. security-sensitive work should go through `SECURITY.md`, not a public pull request first
4. reviewers will care about bounded scope, proof, and whether the docs still match the real product

## Reporting Paths

1. use the public bug template for normal product bugs and regressions
2. use the task-family template for bounded scope requests and family-shape gaps
3. use `SECURITY.md` for anything involving workspace escape, destructive-command bypass, secret leakage, or other security impact

## Good First Contributions

1. small named-file fixes
2. direct source-and-test follow-up changes
3. bounded docs updates that keep install and task-family truth aligned
4. issue-template or onboarding clarity improvements backed by proof

## Contribution License

By submitting a contribution to Queenshift, you agree that your contribution will be made available under the MIT License that covers this repository.

## Current Public Boundary

1. `swarmengine` remains the shipped bounded engine
2. `queenbee` remains experimental
3. broad repo-wide autonomy, open-ended refactors, and hidden control planes are out of scope for this beta surface
