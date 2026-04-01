# Provider Setup Guide

This file is the explicit provider setup and diagnostics path for local live runs.

## First Diagnostic Command

Run this first when provider setup is unclear:

```powershell
npm.cmd run owner:provider:diagnose
```

That command prints:

1. the detected provider
2. the auth mode
3. the chosen transport
4. the active retry policy
5. the next bounded diagnostic step

## Supported Provider Paths

1. Gemini CLI OAuth
2. Gemini API key
3. Gemini access token plus project
4. Gemini ADC plus project
5. OpenAI API key

## Fast Checks

1. `npm.cmd run owner:provider:diagnose`
2. `npm.cmd run verify:owner:provider-defaults`
3. `npm.cmd run verify:owner:smoke`
4. `npm.cmd run verify:provider:resilience`

## Recommended Order

1. Confirm the detected transport with `owner:provider:diagnose`.
2. Confirm the printed retry policy before changing credentials or blaming task scope.
3. Use `verify:owner:provider-defaults` when the fallback path itself looks wrong.
4. Use `verify:owner:smoke` for one bounded non-credit live launch check.
5. Use `verify:provider:resilience` when failures look transport-related rather than task-related.

## Fallback Policy

1. Provider fallback must stay explicit in diagnostics and owner defaults output.
2. V2 may resolve between supported transport paths inside the same provider family, but it must surface the chosen transport.
3. Provider retries stay bounded and visible; V2 does not silently hide repeated transport instability behind unbounded retry loops.
4. V2 does not silently switch between Gemini and OpenAI just to make a run succeed.
5. If transport fallback itself looks suspicious, stop and prove it with `verify:owner:provider-defaults` and `verify:provider:resilience` before retrying code-changing work.

## Fail-Closed Boundaries

1. No hidden credential storage is added here.
2. Missing or incomplete credentials stay visible in status and diagnostics output.
3. A live run should not start until the provider path is explicit and ready.
