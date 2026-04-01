# Bounded 1.0 Support Runbook

This runbook is the public support path for the current bounded Queenshift release.

Use it when a contributor or evaluator gets stuck and needs the shortest truthful recovery route.

## First Support Loop

1. confirm the install/setup path they actually used
2. confirm whether they are on a source checkout or another release surface
3. ask for the exact command they ran
4. ask for the artifact-backed output from the latest incident or replay surface
5. keep the report scoped to the smallest failing surface

## Recommended Recovery Commands

1. `queenshift doctor`
2. `queenshift owner:guided:demo`
3. `queenshift demo:run`
4. `queenshift incident:latest --workspace <repo>`
5. `queenshift replay:latest --workspace <repo>`
6. `queenshift owner:quick-actions --workspace <repo>`

## Issue Intake

When the problem should become an issue:

1. use `SUPPORT_ISSUE_INTAKE.md`
2. include the exact command
3. include the artifact paths when they exist
4. keep the issue bounded and evidence-backed

## Current Boundaries

1. the current public story is still bounded
2. small clean repos remain the strongest lane
3. contributor/evaluator source checkout is real, but not the same as a finished normal-user install story
4. `queenbee` stays experimental

## Related Docs

1. `README.md`
2. `QUICKSTART.md`
3. `SUPPORT_ISSUE_INTAKE.md`
4. `SUPPORTED_INSTALL_SURFACES.md`
5. `GENERAL_USE_READINESS_DECISION.md`
