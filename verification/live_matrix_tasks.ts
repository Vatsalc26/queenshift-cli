import fs from "node:fs"
import path from "node:path"

import { buildScopedTaskContract, mergeTaskContracts, type TaskContract } from "../src/run/TaskContract"

export type MatrixVerdictClass = "pass" | "review_required" | "failed" | "infra_blocked"

export type LiveMatrixTask = {
	id: string
	workspace: string
	task: string
	taskContract: TaskContract
	expectedTerminalClass: MatrixVerdictClass
	usefulnessNote?: string
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

const ROOT = resolveRootDir()

function workspacePath(name: string): string {
	return path.join(ROOT, "verification", name)
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

export const LIVE_MATRIX_TASKS: LiveMatrixTask[] = [
	{
		id: "final-hello-comment",
		workspace: workspacePath("dogfood_repo_copy_final"),
		task: 'add the exact comment "// matrix: final hello" to hello.ts',
		taskContract: snippetContract(["hello.ts"], {
			requiredContentSnippets: [{ path: "hello.ts", snippet: "// matrix: final hello" }],
		}),
		expectedTerminalClass: "pass",
		usefulnessNote: "Proves one-file comment edits still work on the final dogfood copy.",
	},
	{
		id: "final-create-summary",
		workspace: workspacePath("dogfood_repo_copy_final"),
		task: 'create matrix_summary.md with the exact sentence "This repo copy is for safe matrix verification."',
		taskContract: snippetContract(["matrix_summary.md"], {
			requiredCreatedFiles: ["matrix_summary.md"],
			requiredContentSnippets: [{ path: "matrix_summary.md", snippet: "This repo copy is for safe matrix verification." }],
		}),
		expectedTerminalClass: "pass",
	},
	{
		id: "final-notes-sync",
		workspace: workspacePath("dogfood_repo_copy_final"),
		task: 'update notes.md so it contains the exact sentence "Matrix verification keeps this repo copy stable."',
		taskContract: snippetContract(["notes.md"], {
			requiredContentSnippets: [{ path: "notes.md", snippet: "Matrix verification keeps this repo copy stable." }],
		}),
		expectedTerminalClass: "pass",
	},
	{
		id: "final-three-file-scope",
		workspace: workspacePath("dogfood_repo_copy_final"),
		task:
			'update hello.ts, utils.ts, and notes.md together so hello.ts includes "// matrix: final scoped hello", utils.ts includes "// matrix: final scoped utils", and notes.md contains "hello.ts and utils.ts stay aligned in this matrix task."',
		taskContract: snippetContract(["hello.ts", "utils.ts", "notes.md"], {
			requiredContentSnippets: [
				{ path: "hello.ts", snippet: "// matrix: final scoped hello" },
				{ path: "utils.ts", snippet: "// matrix: final scoped utils" },
				{ path: "notes.md", snippet: "hello.ts and utils.ts stay aligned in this matrix task." },
			],
		}),
		expectedTerminalClass: "pass",
		usefulnessNote: "Exercises the scoped 3-file lane without touching unrelated files.",
	},
	{
		id: "pass-hello-comment",
		workspace: workspacePath("dogfood_repo_copy_pass"),
		task: 'add the exact comment "// matrix: pass hello" to hello.ts',
		taskContract: snippetContract(["hello.ts"], {
			requiredContentSnippets: [{ path: "hello.ts", snippet: "// matrix: pass hello" }],
		}),
		expectedTerminalClass: "pass",
	},
	{
		id: "pass-create-facts",
		workspace: workspacePath("dogfood_repo_copy_pass"),
		task: 'create matrix_facts.md with the exact sentence "This pass repo copy is used for deterministic matrix checks."',
		taskContract: snippetContract(["matrix_facts.md"], {
			requiredCreatedFiles: ["matrix_facts.md"],
			requiredContentSnippets: [
				{ path: "matrix_facts.md", snippet: "This pass repo copy is used for deterministic matrix checks." },
			],
		}),
		expectedTerminalClass: "pass",
	},
	{
		id: "pass-two-file-sync",
		workspace: workspacePath("dogfood_repo_copy_pass"),
		task:
			'update hello.ts and notes.md together so hello.ts includes "// matrix: pass pair" and notes.md contains "The pair task updated hello.ts on purpose."',
		taskContract: snippetContract(["hello.ts", "notes.md"], {
			requiredContentSnippets: [
				{ path: "hello.ts", snippet: "// matrix: pass pair" },
				{ path: "notes.md", snippet: "The pair task updated hello.ts on purpose." },
			],
		}),
		expectedTerminalClass: "pass",
	},
	{
		id: "pass-four-file-scope",
		workspace: workspacePath("dogfood_repo_copy_pass"),
		task:
			'update hello.ts, utils.ts, notes.md, and hello.py together so hello.ts includes "// matrix: pass four hello", utils.ts includes "// matrix: pass four utils", notes.md contains "The four-file matrix task touched code and docs together.", and hello.py includes "# matrix: pass four python".',
		taskContract: snippetContract(["hello.ts", "utils.ts", "notes.md", "hello.py"], {
			requiredContentSnippets: [
				{ path: "hello.ts", snippet: "// matrix: pass four hello" },
				{ path: "utils.ts", snippet: "// matrix: pass four utils" },
				{ path: "notes.md", snippet: "The four-file matrix task touched code and docs together." },
				{ path: "hello.py", snippet: "# matrix: pass four python" },
			],
		}),
		expectedTerminalClass: "pass",
		usefulnessNote: "Exercises the scoped 4-file lane across TS, docs, and Python without planner fan-out.",
	},
	{
		id: "seq-utils-comment",
		workspace: workspacePath("dogfood_repo_copy_seq"),
		task: 'add the exact comment "// matrix: seq utils" to utils.ts',
		taskContract: snippetContract(["utils.ts"], {
			requiredContentSnippets: [{ path: "utils.ts", snippet: "// matrix: seq utils" }],
		}),
		expectedTerminalClass: "pass",
	},
	{
		id: "seq-create-report",
		workspace: workspacePath("dogfood_repo_copy_seq"),
		task: 'create matrix_report.md with the exact sentence "This seq repo copy is reserved for matrix reporting."',
		taskContract: snippetContract(["matrix_report.md"], {
			requiredCreatedFiles: ["matrix_report.md"],
			requiredContentSnippets: [{ path: "matrix_report.md", snippet: "This seq repo copy is reserved for matrix reporting." }],
		}),
		expectedTerminalClass: "pass",
	},
	{
		id: "seq-two-file-sync",
		workspace: workspacePath("dogfood_repo_copy_seq"),
		task:
			'update hello.ts and utils.ts together so hello.ts includes "// matrix: seq pair hello" and utils.ts includes "// matrix: seq pair utils".',
		taskContract: snippetContract(["hello.ts", "utils.ts"], {
			requiredContentSnippets: [
				{ path: "hello.ts", snippet: "// matrix: seq pair hello" },
				{ path: "utils.ts", snippet: "// matrix: seq pair utils" },
			],
		}),
		expectedTerminalClass: "pass",
	},
	{
		id: "seq-three-file-scope",
		workspace: workspacePath("dogfood_repo_copy_seq"),
		task:
			'update hello.ts, utils.ts, and notes.md together so hello.ts includes "// matrix: seq scoped hello", utils.ts includes "// matrix: seq scoped utils", and notes.md contains "The seq scoped task changed both code files and the note."',
		taskContract: snippetContract(["hello.ts", "utils.ts", "notes.md"], {
			requiredContentSnippets: [
				{ path: "hello.ts", snippet: "// matrix: seq scoped hello" },
				{ path: "utils.ts", snippet: "// matrix: seq scoped utils" },
				{ path: "notes.md", snippet: "The seq scoped task changed both code files and the note." },
			],
		}),
		expectedTerminalClass: "pass",
	},
]

export function validateLiveMatrixTasks(tasks: LiveMatrixTask[] = LIVE_MATRIX_TASKS): string[] {
	const issues: string[] = []
	const uniqueIds = new Set<string>()
	const workspaces = new Set<string>()

	if (tasks.length < 10 || tasks.length > 15) {
		issues.push(`Expected 10-15 matrix rows, found ${tasks.length}.`)
	}

	for (const task of tasks) {
		if (uniqueIds.has(task.id)) issues.push(`Duplicate matrix task id: ${task.id}`)
		uniqueIds.add(task.id)
		workspaces.add(task.workspace)
		if (!task.taskContract.scope?.allowedFiles?.length) {
			issues.push(`Matrix task ${task.id} is missing a scoped allowlist.`)
		}
	}

	if (workspaces.size < 3) {
		issues.push(`Expected at least 3 repo copies in the matrix, found ${workspaces.size}.`)
	}

	return issues
}
