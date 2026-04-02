# Queenshift Security

Queenshift is a bounded experimental coding CLI, and security reports are welcome.

The goal is to make responsible reporting easy without asking reporters to guess the right lane.

## What To Report

1. workspace escape or filesystem-boundary bypass
2. destructive command execution outside documented boundaries
3. secret leakage, credential exposure, or unsafe artifact publication
4. unintended network exfiltration or auth confusion
5. install, wrapper, or CLI behavior that creates real security impact

## What Not To File Here

1. bounded refusals or unsupported task families
2. normal product bugs without security impact
3. roadmap or feature-scope requests

Use the public bug template for normal bugs and the task-family template for scope requests.

## How To Report

1. prefer a private vulnerability-reporting surface if this repo provides one
2. if no private security surface is available yet, open a minimal public issue without exploit details and ask for a private follow-up channel before sharing proof-of-concept, secrets, or sensitive repo data
3. include the version, install surface, operating system, exact commands, impact, and relevant artifact paths
4. redact tokens, customer data, and private repo material

## Maintainer Review Gate

Maintainers review outside pull requests conservatively.

For the current maintainer workflow, GitHub settings baseline, and local-review safety rules, use [MAINTAINER_PR_SECURITY.md](./MAINTAINER_PR_SECURITY.md).

## Response Goals

1. acknowledge real security reports quickly
2. reproduce the issue with the smallest bounded proof
3. ship the smallest safe fix or mitigation first
4. coordinate disclosure after the fix path is clear
