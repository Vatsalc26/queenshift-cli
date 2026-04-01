# Verification Catalog

This file is the public reference for the verification surfaces that matter most in the current Queenshift release.

It exists to answer one question clearly:

Which proof loops should contributors or evaluators use before they widen a claim?

## Core Build And Test Loop

Use this first:

1. `npm test`
2. `npm run verify:pr`

This is the default contributor-safe loop.

## Public Surface And Docs Loop

Use this when you change README, install docs, contribution docs, public wording, or release metadata:

1. `npm run verify:public-pack:readme`
2. `npm run verify:public-pack:quickstart`
3. `npm run verify:public-pack:onboarding`
4. `npm run verify:public-pack:release-docs`
5. `npm run verify:public-pack:export`

## Bounded CLI Surface

Use this when you change the main Queenshift product surface:

1. `npm run verify:queenshift:command`
2. `npm run verify:queenshift:doctor`
3. `npm run verify:demo:run`
4. `npm run verify:queenshift:dogfood`

## Contributor And Repo-Onboarding Surface

Use this when you change contributor setup, onboarding, repo profiles, or verification defaults:

1. `npm run verify:owner:onboarding`
2. `npm run verify:profiles`
3. `npm run verify:repo-map`
4. `npm run verify:context-packs`

## Incident, Replay, And Review Surface

Use this when you change recovery or artifact-backed follow-up behavior:

1. `npm run verify:incident`
2. `npm run verify:incident-triage`
3. `npm run verify:replay-export`
4. `npm run verify:review:queue`

## Experimental QueenBee Surface

These stay experimental:

1. `npm run verify:queenbee:docs`
2. `npm run verify:queenbee:beta-gate`
3. `npm run verify:queenbee:ux`
4. `npm run verify:queenbee:live:first-canonical`
5. `npm run verify:queenbee:live:canonical`
6. `npm run verify:queenbee:live:gateway`

These proofs help document the experimental lane, but they do not turn `queenbee` into the shipped engine.

## Public Reading Rule

1. A green verification command proves only the surface it was designed to prove.
2. Verification does not justify broader autonomy claims by momentum alone.
3. `swarmengine` remains the shipped bounded engine even when QueenBee proofs exist.

## Related Docs

1. `README.md`
2. `docs/evidence.md`
3. `LANGUAGE_PACKS.md`
4. `LANGUAGE_RELIABILITY_MATRIX.md`
5. `GENERAL_USE_READINESS_DECISION.md`
