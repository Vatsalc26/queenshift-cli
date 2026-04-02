# Owner Oversight Guide

This guide is for the project owner, noncoder evaluators, or anyone who wants the recommended bounded path through Queenshift.

It is the public-safe version of the owner loop.

## The Main Rule

Do not widen claims from one nice-looking run.

The recommended path is:

1. bounded task
2. visible review and artifacts
3. explicit proof loop
4. honest stop when the evidence is not broad enough yet

## Recommended First Path

1. run `queenshift doctor`
2. run `queenshift owner:guided:demo`
3. run `queenshift demo:run`
4. inspect the changed files and replay surface
5. run `queenshift repo:onboard --workspace <repo>` before a real repo task
6. preflight the task with `queenshift "<task>" --workspace <repo> --admitOnly`

## If A Run Stops

Use the bounded recovery loop:

1. `queenshift incident:latest --workspace <repo>`
2. `queenshift owner:quick-actions --workspace <repo>`
3. `queenshift replay:latest --workspace <repo>`
4. `queenshift resume:latest --workspace <repo>` when resumability evidence exists

## What The Owner Should Expect

1. small explicit tasks are the strongest current lane
2. review and verification are part of the system, not afterthoughts
3. the repo is public and serious, but still bounded
4. `queenbee` remains experimental

## What The Owner Should Not Assume

1. broad general-use autonomous coding
2. open-ended repo-wide refactors
3. parity with every top-tier coding CLI
4. that one green demo means every repo is in scope

## When To Ask For Help

1. when provider setup is unclear
2. when onboarding refuses a repo
3. when incident output is unclear
4. when the requested task seems wider than the current bounded story

## Related Docs

1. `README.md`
2. `QUICKSTART.md`
3. `SUPPORT_ISSUE_INTAKE.md`
4. `SUPPORTED_INSTALL_SURFACES.md`
5. `docs/evidence.md`
