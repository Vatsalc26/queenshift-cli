# Queenshift Quickstart

This is the recommended repo-based first path for Queenshift.
Use it only when you intentionally start from a checked-out repo as an evaluator or contributor.

Current status:

1. the only supported stranger install surface today is still the local Windows bundle
2. this quickstart keeps the checked-out-repo package path honest and bounded until a published npm release exists
3. the repo-root public package name is `queenshift-cli`, and `npm link` resolves the real `queenshift` command from a checked-out repo
4. this quickstart is the current clean-profile contributor or evaluator acceptance path, not the supported stranger default or the primary public README path
5. the recommended first-run loop is `queenshift doctor -> queenshift owner:guided:demo -> queenshift demo:run -> queenshift repo:onboard --workspace <repo>`
6. use a small clean Git repo and a tiny explicit task for your first real run
7. this quickstart now belongs to an experimental public release surface, not a broad general-use claim
8. `swarmengine` remains the shipped bounded engine, `queenbee` remains experimental, and benchmark-win language stays out of scope

The production-ready normal-user CLI answer for this checked-out-repo route is still `NO`. This guide exists for evaluator or contributor setup while the final published install story is still incomplete.

## 1. Machine Check

You need:

1. Node `24.x`
2. Git on `PATH`
3. one configured provider

If provider setup is still new, use [docs/providers.md](./docs/providers.md), then rerun `queenshift doctor` until it reports a ready provider path before moving on to the guided demo.

Windows PowerShell:

```powershell
node -v
git --version
```

macOS / Linux:

```bash
node -v
git --version
```

## 2. Build The CLI

Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
```

macOS / Linux:

```bash
npm ci
npm run build
npm test
```

Expected result: `npm test` ends with `Level 1: PASS`. This is checkout preparation, not the public product path itself.

## 3. Link The CLI Command

Windows PowerShell:

```powershell
npm.cmd link
```

macOS / Linux:

```bash
npm link
```

Expected result: `queenshift` now resolves on `PATH` from this checked-out repo.

## 4. Check The Product Surface

Windows PowerShell:

```powershell
queenshift --help
queenshift --version
queenshift doctor
```

macOS / Linux:

```bash
queenshift --help
queenshift --version
queenshift doctor
```

Expected result: `queenshift doctor` reports a ready provider path. If it does not, use [docs/providers.md](./docs/providers.md), rerun `queenshift doctor`, and only then continue to the guided demo.

If you need the current clean-profile acceptance proof for this checked-out repo path, run `npm.cmd run verify:owner:smoke` after the provider path is ready.
Once checkout preparation is done, stay on the same product-command loop the README teaches: `queenshift doctor -> queenshift owner:guided:demo -> queenshift demo:run -> queenshift repo:onboard --workspace <repo> -> queenshift "<task>" --workspace <repo> --admitOnly`.

## 5. Run The Guided First Pass

Windows PowerShell:

```powershell
queenshift owner:guided:demo
queenshift demo:run
queenshift demo:gallery
```

macOS / Linux:

```bash
queenshift owner:guided:demo
queenshift demo:run
queenshift demo:gallery
```

The guided demo is the recommended guided first pass. The disposable demo repo shows the same product surface in a bounded workspace before you touch a real repo.

## 6. Try A Real Repo

Choose a small clean Git repo, then onboard and preflight the task first.

Windows PowerShell:

```powershell
queenshift repo:onboard --workspace <repo>
queenshift "add a brief comment to hello.ts" --workspace <repo> --admitOnly
queenshift "add a brief comment to hello.ts" --workspace <repo>
```

macOS / Linux:

```bash
queenshift repo:onboard --workspace <repo>
queenshift "add a brief comment to hello.ts" --workspace <repo> --admitOnly
queenshift "add a brief comment to hello.ts" --workspace <repo>
```

Expected result: Queenshift prints a short `Current focus` line, keeps `Visible progress` and `Next step` visible, and records the bounded run artifacts under `.swarm/runs`.

Stay inside the bounded beta surface:

1. name the file you want to change
2. keep the first task tiny
3. avoid broad repo-wide or dependency-changing requests
4. for source-and-test work, name one source file and its direct local test file

## 7. If You Get Stuck

Windows PowerShell:

```powershell
queenshift doctor
queenshift demo:reset
queenshift incident:latest --workspace <repo>
queenshift resume:latest --workspace <repo>
queenshift owner:quick-actions --workspace <repo>
queenshift replay:latest --workspace <repo>
```

macOS / Linux:

```bash
queenshift doctor
queenshift demo:reset
queenshift incident:latest --workspace <repo>
queenshift resume:latest --workspace <repo>
queenshift owner:quick-actions --workspace <repo>
queenshift replay:latest --workspace <repo>
```

If the guided or disposable demo fails, use `doctor`, then `demo:reset`, and retry the same demo command. For a real repo failure, follow the short recovery loop instead of guessing: `incident:latest` tells you what failed, `owner:quick-actions` gives the safest next command, `replay:latest` gives the recorded timeline, and `resume:latest` is there when resumability evidence exists.
