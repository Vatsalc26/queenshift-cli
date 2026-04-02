# Maintainer PR Security

This repo is public. That means people can read it, clone it, and scrape it. The goal of maintainer security is not to stop public reading; it is to stop unsafe code, workflow abuse, secret exposure, and careless local review habits.

## Default Rule

Treat all outside pull requests as untrusted until reviewed.

Do not merge, run locally, or approve by default.

## Exact GitHub Settings

Turn these on in repository settings:

1. `Private vulnerability reporting`: `ON`
2. `Dependency graph`: `ON`
3. `Dependabot alerts`: `ON`
4. `Dependabot security updates`: `ON`
5. `Grouped security updates`: `ON`
6. `Dependabot version updates`: `OFF` by default unless maintainer capacity clearly supports the extra PR volume
7. `Code scanning`: `ON`
8. `CodeQL analysis`: `ON` with default setup
9. `Copilot Autofix`: optional, not required for the safety baseline

## Branch Ruleset For `main`

Create a ruleset for the default branch with these protections:

1. require a pull request before merging
2. require at least one approval
3. dismiss stale approvals when new commits are pushed
4. require conversation resolution before merge
5. require status checks to pass before merge only after real stable check names exist
6. block force pushes
7. block branch deletion
8. prefer squash merge for outside contributions

At minimum, required checks should include:

1. the main test/check run used by this repo
2. code scanning / CodeQL when present

If stable named status checks are not configured yet, keep required status checks off rather than binding the ruleset to an empty or misleading check list.

Prefer the CodeQL / code-scanning merge gate over the generic code-quality gate for this repo's current public-maintainer setup.

## GitHub Actions Settings

Use the most conservative settings that still allow bounded review:

1. workflow permissions: `Read repository contents and packages`
2. `Allow GitHub Actions to create and approve pull requests`: `OFF`
3. require approval for workflow runs from public forks
4. do not send secrets to workflows from fork pull requests
5. do not send write tokens to workflows from fork pull requests
6. use GitHub-hosted runners only for this public repo
7. do not attach self-hosted runners to this public repo

## Maintainer Review Workflow

Review outside PRs in this order:

1. inspect the PR on GitHub web or with `gh pr view` / `gh pr diff` first
2. read the description and changed files before running anything
3. stop and inspect carefully if the PR touches:
   - `.github/workflows/`
   - install scripts
   - release scripts
   - auth flows
   - network code
   - shell commands
   - filesystem-boundary code
   - lockfiles
4. if the PR is docs-only and obviously safe, web review may be enough
5. if local review is needed, use a disposable clone of the public repo only

## Local Review Safety

Never review unknown PR code inside the private source-of-truth repo.

Never pull an unknown contributor branch into the main working copy that contains private planning material, unpublished notes, or secrets.

If local testing is required:

1. clone the public repo into a disposable folder
2. do not copy private files into that folder
3. do not use real credentials or API keys there
4. do not keep long-lived auth tokens in shell history
5. delete the disposable review copy after the review is complete

## Merge Gate

Merge only after all of the following are true:

1. the diff is understood
2. no workflow or script risk remains unexplained
3. required checks passed
4. the PR does not widen the public claim beyond the repo's documented truth
5. the change is acceptable for the bounded public surface

## If Spam Or Abuse Starts

If bot spam, scraping pressure, or hostile interaction starts to affect maintainers:

1. turn on interaction limits
2. pause non-essential issue triage
3. keep all security-sensitive reports in the private vulnerability lane
4. slow down merges rather than speeding them up

## One Important Truth

Open source does not prevent people from copying or reading public code. The real defense is:

1. keep secrets out of the repo
2. keep the private/source-of-truth repo separate
3. review outside changes conservatively
4. never run unknown code casually on the maintainer machine
