import fs from "node:fs"
import path from "node:path"

import type { TaskCorpusId } from "../src/owner/TaskCorpusIds"
import { buildScopedTaskContract, mergeTaskContracts, type TaskContract } from "../src/run/TaskContract"
import type { RepoSupportTier } from "../src/run/AdmissionGate"

export type BetaVerdictClass = "pass" | "review_required" | "failed" | "refused"

export type BetaRepoManifest = {
	id: string
	label: string
	templateDir: string
	workspace: string
	baselineLabel: string
	expectedVerificationProfile: string | null
	expectedSupportTier: RepoSupportTier
	generatedFiles: BetaGeneratedFileSpec[]
}

export type BetaGeneratedFileSpec = {
	root: string
	count: number
	extension: ".ts" | ".md"
	linePrefix: string
}

export type BetaMatrixTask = {
	id: string
	corpusTaskId: TaskCorpusId
	repoId: string
	repoLabel: string
	templateDir: string
	workspace: string
	baselineLabel: string
	task: string
	taskContract: TaskContract
	expectedTerminalClass: BetaVerdictClass
	expectedVerificationProfile: string | null
	expectedSupportTier: RepoSupportTier
	generatedFiles: BetaGeneratedFileSpec[]
	usefulnessNote?: string
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

const ROOT = resolveRootDir()

function templatePath(name: string): string {
	return path.join(ROOT, "verification", "beta_repo_templates", name)
}

function workspacePath(name: string): string {
	return path.join(ROOT, ".swarm", "beta_workspaces", name)
}

function withAcceptance(targetFiles: string[], taskContract: TaskContract): TaskContract {
	return mergeTaskContracts(buildScopedTaskContract(targetFiles), taskContract) ?? buildScopedTaskContract(targetFiles)
}

function snippetContract(
	targetFiles: string[],
	options: {
		requiredCreatedFiles?: string[]
		requiredContentSnippets?: Array<{ path: string; snippet: string }>
		forbiddenChangedFiles?: string[]
	},
): TaskContract {
	return withAcceptance(targetFiles, {
		acceptance: {
			requiredCreatedFiles: options.requiredCreatedFiles ?? [],
			requiredContentSnippets: options.requiredContentSnippets ?? [],
			forbiddenChangedFiles: options.forbiddenChangedFiles ?? [],
		},
	})
}

export const BETA_REPOS: BetaRepoManifest[] = [
	{
		id: "ts-cli-tool",
		label: "TS CLI Tool",
		templateDir: templatePath("ts_cli_tool"),
		workspace: workspacePath("ts_cli_tool"),
		baselineLabel: "beta: ts-cli-tool baseline",
		expectedVerificationProfile: "local-npm-test",
		expectedSupportTier: "small_supported",
		generatedFiles: [],
	},
	{
		id: "docs-playbook",
		label: "Docs Playbook",
		templateDir: templatePath("docs_playbook"),
		workspace: workspacePath("docs_playbook"),
		baselineLabel: "beta: docs-playbook baseline",
		expectedVerificationProfile: null,
		expectedSupportTier: "small_supported",
		generatedFiles: [],
	},
	{
		id: "python-helper",
		label: "Python Helper",
		templateDir: templatePath("python_helper"),
		workspace: workspacePath("python_helper"),
		baselineLabel: "beta: python-helper baseline",
		expectedVerificationProfile: null,
		expectedSupportTier: "small_supported",
		generatedFiles: [],
	},
	{
		id: "config-service",
		label: "Config Service",
		templateDir: templatePath("config_service"),
		workspace: workspacePath("config_service"),
		baselineLabel: "beta: config-service baseline",
		expectedVerificationProfile: "local-node-verify-script",
		expectedSupportTier: "small_supported",
		generatedFiles: [],
	},
	{
		id: "mixed-reporter",
		label: "Mixed Reporter",
		templateDir: templatePath("mixed_reporter"),
		workspace: workspacePath("mixed_reporter"),
		baselineLabel: "beta: mixed-reporter baseline",
		expectedVerificationProfile: null,
		expectedSupportTier: "small_supported",
		generatedFiles: [],
	},
	{
		id: "large-ts-service",
		label: "Large TS Service",
		templateDir: templatePath("large_ts_service"),
		workspace: workspacePath("large_ts_service"),
		baselineLabel: "beta: large-ts-service baseline",
		expectedVerificationProfile: "large-ts-verify",
		expectedSupportTier: "large_supported_tier_2",
		generatedFiles: [
			{
				root: "packages/generated",
				count: 2005,
				extension: ".ts",
				linePrefix: "// generated beta large ts service",
			},
		],
	},
	{
		id: "large-docs-suite",
		label: "Large Docs Suite",
		templateDir: templatePath("large_docs_suite"),
		workspace: workspacePath("large_docs_suite"),
		baselineLabel: "beta: large-docs-suite baseline",
		expectedVerificationProfile: null,
		expectedSupportTier: "large_supported_tier_2",
		generatedFiles: [
			{
				root: "docs/archive",
				count: 2050,
				extension: ".md",
				linePrefix: "# generated beta large docs suite",
			},
		],
	},
]

function repo(id: string): BetaRepoManifest {
	const matched = BETA_REPOS.find((entry) => entry.id === id)
	if (!matched) {
		throw new Error(`Unknown beta repo id: ${id}`)
	}
	return matched
}

function betaTask(
	repoId: string,
	config: Omit<
		BetaMatrixTask,
		"repoId" | "repoLabel" | "templateDir" | "workspace" | "baselineLabel" | "expectedVerificationProfile" | "expectedSupportTier" | "generatedFiles"
	>,
): BetaMatrixTask {
	const matchedRepo = repo(repoId)
	return {
		...config,
		repoId,
		repoLabel: matchedRepo.label,
		templateDir: matchedRepo.templateDir,
		workspace: matchedRepo.workspace,
		baselineLabel: matchedRepo.baselineLabel,
		expectedVerificationProfile: matchedRepo.expectedVerificationProfile,
		expectedSupportTier: matchedRepo.expectedSupportTier,
		generatedFiles: matchedRepo.generatedFiles,
	}
}

export const BETA_MATRIX_TASKS: BetaMatrixTask[] = [
	betaTask("ts-cli-tool", {
		id: "ts-cli-index-comment",
		corpusTaskId: "comment_file",
		task: 'add the exact comment "// beta: cli banner" near the top of src/index.ts',
		taskContract: snippetContract(["src/index.ts"], {
			requiredContentSnippets: [{ path: "src/index.ts", snippet: "// beta: cli banner" }],
		}),
		expectedTerminalClass: "pass",
		usefulnessNote: "Proves the explicit one-file code-edit lane on a tiny TypeScript repo with a verification profile.",
	}),
	betaTask("ts-cli-tool", {
		id: "ts-cli-format-readme-sync",
		corpusTaskId: "sync_docs_with_source",
		task:
			'update src/format.ts and README.md together so src/format.ts includes the exact comment "// beta: formatter sync" and README.md contains "The formatter stays aligned with the CLI banner."',
		taskContract: snippetContract(["src/format.ts", "README.md"], {
			requiredContentSnippets: [
				{ path: "src/format.ts", snippet: "// beta: formatter sync" },
				{ path: "README.md", snippet: "The formatter stays aligned with the CLI banner." },
			],
		}),
		expectedTerminalClass: "pass",
	}),
	betaTask("docs-playbook", {
		id: "docs-create-checklist",
		corpusTaskId: "create_tiny_file",
		task: 'create docs/beta-checklist.md with the exact sentence "This checklist keeps the beta docs lane bounded."',
		taskContract: snippetContract(["docs/beta-checklist.md"], {
			requiredCreatedFiles: ["docs/beta-checklist.md"],
			requiredContentSnippets: [{ path: "docs/beta-checklist.md", snippet: "This checklist keeps the beta docs lane bounded." }],
		}),
		expectedTerminalClass: "pass",
		usefulnessNote: "Exercises one-file create behavior on a docs-only repo copy without any local verification hook.",
	}),
	betaTask("docs-playbook", {
		id: "docs-readme-faq-sync",
		corpusTaskId: "sync_docs_bundle",
		task:
			'update README.md and docs/faq.md together so README.md contains "The beta docs lane only edits named files." and docs/faq.md contains "External beta tasks stay explicit and reviewable."',
		taskContract: snippetContract(["README.md", "docs/faq.md"], {
			requiredContentSnippets: [
				{ path: "README.md", snippet: "The beta docs lane only edits named files." },
				{ path: "docs/faq.md", snippet: "External beta tasks stay explicit and reviewable." },
			],
		}),
		expectedTerminalClass: "pass",
	}),
	betaTask("python-helper", {
		id: "python-helper-comment",
		corpusTaskId: "comment_file",
		task: 'add the exact comment "# beta: normalize inputs" near the top of helpers.py',
		taskContract: snippetContract(["helpers.py"], {
			requiredContentSnippets: [{ path: "helpers.py", snippet: "# beta: normalize inputs" }],
		}),
		expectedTerminalClass: "pass",
	}),
	betaTask("python-helper", {
		id: "python-main-readme-sync",
		corpusTaskId: "sync_docs_with_source",
		task:
			'update main.py and README.md together so main.py includes the exact comment "# beta: main stays small" and README.md contains "The main entry point stays tiny on purpose."',
		taskContract: snippetContract(["main.py", "README.md"], {
			requiredContentSnippets: [
				{ path: "main.py", snippet: "# beta: main stays small" },
				{ path: "README.md", snippet: "The main entry point stays tiny on purpose." },
			],
		}),
		expectedTerminalClass: "pass",
	}),
	betaTask("config-service", {
		id: "config-defaults-beta-mode",
		corpusTaskId: "update_named_file",
		task: 'update config/defaults.json so it contains the exact entry "betaMode": "external-beta"',
		taskContract: snippetContract(["config/defaults.json"], {
			requiredContentSnippets: [{ path: "config/defaults.json", snippet: '"betaMode": "external-beta"' }],
		}),
		expectedTerminalClass: "pass",
		usefulnessNote: "Covers JSON mutation plus a repo-owned npm verification profile on a second template-backed repo.",
	}),
	betaTask("config-service", {
		id: "config-readme-sync",
		corpusTaskId: "sync_docs_with_source",
		task:
			'update src/config.ts and README.md together so src/config.ts includes the exact comment "// beta: config summary" and README.md contains "The config summary helper reads the checked-in defaults."',
		taskContract: snippetContract(["src/config.ts", "README.md"], {
			requiredContentSnippets: [
				{ path: "src/config.ts", snippet: "// beta: config summary" },
				{ path: "README.md", snippet: "The config summary helper reads the checked-in defaults." },
			],
		}),
		expectedTerminalClass: "pass",
	}),
	betaTask("mixed-reporter", {
		id: "mixed-reporter-entry-comment",
		corpusTaskId: "comment_file",
		task: 'add the exact comment "// beta: reporter entry" near the top of src/main.ts',
		taskContract: snippetContract(["src/main.ts"], {
			requiredContentSnippets: [{ path: "src/main.ts", snippet: "// beta: reporter entry" }],
		}),
		expectedTerminalClass: "pass",
	}),
	betaTask("mixed-reporter", {
		id: "mixed-reporter-three-file-sync",
		corpusTaskId: "cross_language_sync",
		task:
			'update src/main.ts, docs/notes.md, and scripts/report.py together so src/main.ts includes the exact comment "// beta: reporter sync", docs/notes.md contains "The reporter sync task touched code, docs, and Python together.", and scripts/report.py includes the exact comment "# beta: reporter sync".',
		taskContract: snippetContract(["src/main.ts", "docs/notes.md", "scripts/report.py"], {
			requiredContentSnippets: [
				{ path: "src/main.ts", snippet: "// beta: reporter sync" },
				{ path: "docs/notes.md", snippet: "The reporter sync task touched code, docs, and Python together." },
				{ path: "scripts/report.py", snippet: "# beta: reporter sync" },
			],
		}),
		expectedTerminalClass: "pass",
	}),
	betaTask("large-ts-service", {
		id: "large-ts-service-route-note",
		corpusTaskId: "comment_file",
		task: 'add the exact comment "// beta: large tier route" near the top of src/routes.ts',
		taskContract: snippetContract(["src/routes.ts"], {
			requiredContentSnippets: [{ path: "src/routes.ts", snippet: "// beta: large tier route" }],
		}),
		expectedTerminalClass: "pass",
		usefulnessNote: "Exercises the explicit one-file lane on a staged tier-2 large TypeScript repo with a manifest-backed verify script.",
	}),
	betaTask("large-docs-suite", {
		id: "large-docs-suite-guide-sync",
		corpusTaskId: "sync_docs_with_source",
		task:
			'update docs/guides/rollout.md and src/config.ts together so docs/guides/rollout.md contains "Large beta docs still stay file-anchored." and src/config.ts includes the exact comment "// beta: docs rollout source".',
		taskContract: snippetContract(["docs/guides/rollout.md", "src/config.ts"], {
			requiredContentSnippets: [
				{ path: "docs/guides/rollout.md", snippet: "Large beta docs still stay file-anchored." },
				{ path: "src/config.ts", snippet: "// beta: docs rollout source" },
			],
		}),
		expectedTerminalClass: "pass",
		usefulnessNote: "Exercises a docs-plus-source row on a staged tier-2 large repo without widening discovery beyond named files.",
	}),
]

export function validateBetaMatrixTasks(tasks: BetaMatrixTask[] = BETA_MATRIX_TASKS): string[] {
	const issues: string[] = []
	const seenIds = new Set<string>()
	const repoTaskCounts = new Map<string, number>()
	const seenWorkspaces = new Set<string>()

	for (const task of tasks) {
		if (seenIds.has(task.id)) issues.push(`Duplicate beta task id: ${task.id}`)
		seenIds.add(task.id)
		seenWorkspaces.add(task.workspace)
		repoTaskCounts.set(task.repoId, (repoTaskCounts.get(task.repoId) ?? 0) + 1)

		if (!fs.existsSync(task.templateDir)) {
			issues.push(`Template directory is missing for ${task.id}: ${task.templateDir}`)
		}
		if (!task.baselineLabel.trim()) {
			issues.push(`Baseline label is missing for ${task.id}.`)
		}
		if (!task.expectedSupportTier) {
			issues.push(`Beta task ${task.id} is missing an expected support tier.`)
		}
		if (!task.taskContract.scope?.allowedFiles?.length) {
			issues.push(`Beta task ${task.id} is missing a scoped allowlist.`)
		}
		if (!task.taskContract.scope?.requiredTargetFiles?.length) {
			issues.push(`Beta task ${task.id} is missing required target files.`)
		}
		const acceptance = task.taskContract.acceptance
		if (!acceptance) {
			issues.push(`Beta task ${task.id} is missing acceptance expectations.`)
		} else if ((acceptance.requiredContentSnippets?.length ?? 0) === 0 && (acceptance.requiredCreatedFiles?.length ?? 0) === 0) {
			issues.push(`Beta task ${task.id} must declare at least one content or created-file expectation.`)
		}

		const profileConfigPath = path.join(task.templateDir, ".swarmcoder.json")
		if (task.expectedVerificationProfile && !fs.existsSync(profileConfigPath)) {
			issues.push(`Beta task ${task.id} expects verification profile "${task.expectedVerificationProfile}" but no .swarmcoder.json exists.`)
		}
		if (!task.expectedVerificationProfile && fs.existsSync(profileConfigPath)) {
			issues.push(`Beta task ${task.id} has a .swarmcoder.json template but no expected verification profile was recorded.`)
		}
	}

	if (seenWorkspaces.size < 7 || seenWorkspaces.size > 12) {
		issues.push(`Expected 7-12 beta repo copies, found ${seenWorkspaces.size}.`)
	}
	if (tasks.length < 12) {
		issues.push(`Expected at least 12 beta rows, found ${tasks.length}.`)
	}

	for (const repoManifest of BETA_REPOS) {
		if ((repoTaskCounts.get(repoManifest.id) ?? 0) === 0) {
			issues.push(`Beta repo ${repoManifest.id} has no task rows.`)
		}
	}

	return issues
}
