# Support Issue Intake

Use this guide when a bounded owner run failed, stopped for review in a confusing way, or produced a bug that should be reported upstream.

The goal is simple: capture enough artifact-backed evidence for a useful issue without making the reporter reverse-engineer the repo.

## Use This Intake Path

1. Run `npm.cmd exec -- queenshift incident:latest --workspace <repo>` if the run failed.
2. Run `npm.cmd exec -- queenshift replay:latest --workspace <repo>` if you need the bounded run timeline.
3. Run `npm.cmd exec -- queenshift owner:quick-actions --workspace <repo>` for the shortest artifact-backed next step.
4. File the report with `.github/ISSUE_TEMPLATE/bug_report.md`.

## What To Paste

Paste only the bounded facts you have:

1. the exact task text or guided task preview
2. the exact commands you ran
3. the local artifact paths for `summary.json`, `incident-pack.json`, and `replay.json` when present
4. the failure bucket and stop reason from the incident pack
5. the smallest plausible fix scope
6. the `Failure narrative:` block from `npm.cmd exec -- queenshift incident:latest --workspace <repo>` or `npm.cmd exec -- queenshift resume:latest --workspace <repo>` when present, because it already states `What failed`, `Why it stopped`, `Safest next step`, `Recovery footing`, and `Keep these artifacts authoritative`

## Bundle Reporters

If the report comes from the packaged bundle:

1. mention that you used the local Windows bundle
2. include the helper script you ran first, such as `rc1_install_check.ps1` or `rc1_demo_run.ps1`
3. do not invent source-checkout steps you did not actually run

## Source-Checkout Reporters

If the report comes from a source checkout:

1. include `npm.cmd test`
2. include any extra proof command you ran after the failure
3. include the exact workspace path class, such as demo repo, practice repo, or contributor checkout

## Avoid These Mistakes

1. do not summarize from memory when `incident:latest` already printed a better artifact-backed summary
2. do not paste broad repo speculation when the issue is one bounded run
3. do not widen the requested fix scope beyond the smallest failing surface
4. do not omit the artifact paths if they exist locally

## Related Surfaces

1. `BOUNDED_1_0_SUPPORT_RUNBOOK.md`
2. `.github/ISSUE_TEMPLATE/bug_report.md`
3. `npm.cmd exec -- queenshift incident:latest --workspace <repo>`
4. `npm.cmd exec -- queenshift replay:latest --workspace <repo>`
5. `npm.cmd exec -- queenshift owner:quick-actions --workspace <repo>`
