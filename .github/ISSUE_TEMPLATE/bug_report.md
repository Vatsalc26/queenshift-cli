---
name: Bounded bug report
about: Report a reproducible Queenshift bug with artifact-backed evidence
title: "[bug] "
labels: bug
assignees: ""
---

Use this for normal product bugs and bounded regressions.

If the report is security-sensitive, do not post exploit details here. Follow `SECURITY.md` instead.

## Summary

Describe the bounded behavior you expected and what actually happened.

## Commands

Paste the exact commands you ran:

1. install, demo, or quickstart commands
2. any `repo:onboard` or `--admitOnly` commands
3. the final live command, if you reached one

## Artifact Paths

List the local artifact paths you inspected:

1. `summary.json`
2. `incident-pack.json` or `review-pack.json`
3. `replay.json`

## Failure Narrative

Paste the output from `incident:latest` or `replay:latest` when you have it instead of reconstructing the failure from memory.

## Smallest Fix Scope

Describe the smallest surface that should change to fix the bug.
