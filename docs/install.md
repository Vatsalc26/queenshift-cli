# Queenshift Install Surfaces

## Current Install Status

1. the only supported stranger install surface today is the local Windows bundle
2. a checked-out repo clone is a partial contributor-style path, not packaged parity
3. the repo-root public package name is `queenshift-cli`
4. the repo-root binary install command is `npm link`, which resolves the `queenshift` command on `PATH`
5. this is still not a published npm registry install claim or broad packaged parity
6. the only recorded clean-profile acceptance path today is a checked-out repo for maintainers or evaluators, not a stranger packaged claim
7. the product command surface is `queenshift`, and `npm.cmd exec -- queenshift doctor` remains the Windows check when you want to confirm the linked CLI resolves correctly before a real run

## Public Product Path

1. once `queenshift` is available, stay on the short product loop: `queenshift doctor -> queenshift owner:guided:demo -> queenshift demo:run -> queenshift repo:onboard --workspace <repo> -> queenshift "<task>" --workspace <repo> --admitOnly`
2. checkout-only preparation commands stay in `../QUICKSTART.md` so the primary public README can stay on the product command path instead of contributor-style setup steps

## Recommended First Choice

1. if you have the local Windows bundle, start there first
2. if you are inside a repo checkout, use `../QUICKSTART.md`, run `npm link`, confirm `queenshift --help`, run `queenshift doctor`, and use the guided demo before a real repo; this is the current clean-profile acceptance path for maintainers or evaluators

## Repo-Based Checkout

You need:

1. Node `24.x`
2. Git on `PATH`
3. one configured provider

Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd link
queenshift --help
queenshift doctor
```

macOS / Linux:

```bash
npm ci
npm run build
npm test
npm link
queenshift --help
queenshift doctor
```

Expected result: `npm test` ends with `Level 1: PASS`, `npm link` succeeds, `queenshift --help` prints the CLI surface, and `queenshift doctor` shows a real provider path before you try `owner:guided:demo` or `demo:run`.

## Acceptance Answer

1. clean-profile repo checkout: `PASS` for maintainers or evaluators when Node `24.x`, Git, one configured provider, `npm link`, `queenshift doctor`, and `npm.cmd run verify:owner:smoke` all pass
2. stranger clean-machine path: `NO` beyond the local Windows bundle today
3. this answer does not authorize published npm install, packaged parity, or broader random-user install claims

## Out Of Scope

1. marketplace installs
2. native installers beyond the local Windows bundle
3. auto-updaters
4. broad packaged cross-platform parity
