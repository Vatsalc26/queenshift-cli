# Contributor Source Checkout

This file defines the cross-platform source-checkout candidate for contributors and maintainers.

It is not the stranger install default. The supported stranger path is still the local Windows RC1 bundle.

## Candidate Surface

1. Windows, macOS, or Linux from a checked-out repo clone.
2. Node `v24.14.0` or another Node `24.x` runtime.
3. Git on `PATH`.
4. The checked-in repo layout kept intact.

## Current Status (2026-03-25)

1. This is a partial contributor install surface: the build, test, onboarding, and wrapper rules are documented for Windows, macOS, and Linux.
2. It is the right path for a clean private repo clone, but it is not a packaged stranger install claim.
3. The supported stranger install surface is still the local Windows RC1 bundle, so this file does not turn the broader install-breadth blocker green by itself.

## First Build

### Windows PowerShell

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
```

### macOS / Linux shell

```bash
npm ci
npm run build
npm test
```

Expected result:

1. `dist/swarm.js` exists after build.
2. `npm test` ends with `Level 1: PASS`.

## Command Entry Note

`queenshift` is now the product command surface for the CLI.

From a source checkout, use the repo-local command entry instead of typing `node dist/swarm.js` directly:

### Windows PowerShell

```powershell
npm.cmd exec -- queenshift <args>
```

### macOS / Linux shell

```bash
npm exec -- queenshift <args>
```

That calmer entry still resolves to the compiled `dist/swarm.js` runtime inside this repo, so wrapper and artifact truth stay aligned.

## First Live Prep

Use the same repo-local CLI on every platform.

### Provider diagnose

Windows:

```powershell
npm.cmd exec -- queenshift doctor
```

macOS / Linux:

```bash
npm exec -- queenshift doctor
```

### Repo onboarding

Windows:

```powershell
npm.cmd run repo:onboard -- --workspace <repo>
npm.cmd run repo:onboard -- --workspace <repo> --scaffoldProfile
npm.cmd run repo:onboard -- --workspace <repo> --scaffoldKnowledgePack
```

macOS / Linux:

```bash
npm run repo:onboard -- --workspace <repo>
npm run repo:onboard -- --workspace <repo> --scaffoldProfile
npm run repo:onboard -- --workspace <repo> --scaffoldKnowledgePack
```

## Contributor Proof-First Loop

Use this order before you call a contributor change green.

### Windows PowerShell

```powershell
npm.cmd test
npm.cmd run verify:pr
npm.cmd run repo:onboard -- --workspace <repo>
npm.cmd run verify:profiles
```

### macOS / Linux shell

```bash
npm test
npm run verify:pr
npm run repo:onboard -- --workspace <repo>
npm run verify:profiles
```

If you changed install, bundle, or contributor/community docs, rerun `npm.cmd run verify:bundle:experience` on Windows or `npm run verify:bundle:experience` on macOS/Linux before claiming the surface stayed honest.

Use `CONTRIBUTING.md` for the repo-wide proof contract and `SUPPORT_ISSUE_INTAKE.md` when an outside operator already has artifact-backed failure output.

## IDE Wrapper Surface

For the source-checkout path, the supported IDE wrapper is the VS Code Extension Development Host thin shell described in `IDE_SURFACES.md`.

It previews the exact `queenshift` command before launch, then mirrors the same CLI runtime summary, summary artifact, and forensics truth from local artifacts.

Windows PowerShell:

```powershell
code --new-window --extensionDevelopmentPath "$PWD/vscode_shell"
```

macOS / Linux:

```bash
code --new-window --extensionDevelopmentPath "$PWD/vscode_shell"
```

Command palette entry inside the development host:

- `Queenshift: Open Thin Shell`

## Truth Boundaries

1. This is a contributor source-checkout candidate, not a packaged stranger install claim.
2. The CLI and run artifacts remain authoritative on every platform.
3. Marketplace installs, native installers, and auto-updaters are still out of scope.
4. The verified Node contract remains `24.x` because the checkout carries native modules.
5. `SUPPORTED_INSTALL_SURFACES.md` is the install boundary summary, and `IDE_SURFACES.md` is the wrapper-surface summary.
