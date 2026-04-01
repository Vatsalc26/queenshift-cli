import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { findLatestRunSummary } from "../src/run/RunArtifacts"
import { resetBuiltInTestWorkspace } from "./test_workspace_baseline"

export type VerificationTask = {
	label: string
	task: string
}

export type VerificationResult = {
	label: string
	task: string
	passed: boolean
	status: string
	stopReason: string
	durationMs: number
	summaryPath: string | null
}

export const BASIC_VERIFICATION_TASKS: VerificationTask[] = [
	{ label: "create-file", task: "create hello.py with hello world" },
	{ label: "one-file-edit", task: "add a comment to hello.ts" },
	{ label: "two-file-task", task: "update utils.ts and hello.ts together" },
]

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
	return path.join(candidate, "..")
}

function ensureLiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const next = { ...env }
	const oauthPath = path.join(os.homedir(), ".gemini", "oauth_creds.json")
	if (!next["SWARM_PROVIDER"] && !next["OPENAI_API_KEY"] && fs.existsSync(oauthPath)) {
		next["SWARM_PROVIDER"] = "gemini"
		next["SWARM_GEMINI_AUTH"] = next["SWARM_GEMINI_AUTH"] ?? "cli"
	}
	return next
}

export async function runBasicVerification(
	tasks: VerificationTask[],
	resetWorkspace: () => Promise<void>,
	executeTask: (task: VerificationTask) => Promise<VerificationResult>,
): Promise<VerificationResult[]> {
	const results: VerificationResult[] = []
	for (const task of tasks) {
		await resetWorkspace()
		results.push(await executeTask(task))
	}
	return results
}

export function formatVerificationResults(results: VerificationResult[]): string {
	const lines = ["Task | Result | Duration | Stop reason", "--- | --- | --- | ---"]
	for (const result of results) {
		lines.push(
			`${result.label} | ${result.passed ? "PASS" : "FAIL"} | ${result.durationMs}ms | ${result.stopReason || result.status}`,
		)
	}
	return lines.join("\n")
}

async function runSwarmTask(rootDir: string, workspace: string, task: VerificationTask): Promise<VerificationResult> {
	const startedAt = Date.now()
	const env = ensureLiveEnv(process.env)

	return await new Promise<VerificationResult>((resolve, reject) => {
		const child = spawn(process.execPath, ["dist/swarm.js", "--task", task.task, "--workspace", workspace], {
			cwd: rootDir,
			env,
			windowsHide: true,
			stdio: "inherit",
		})

		child.once("error", reject)
		child.once("close", () => {
			const summaryPath = findLatestRunSummary(workspace)
			let status = "missing_summary"
			let stopReason = "missing_summary"

			if (summaryPath && fs.existsSync(summaryPath)) {
				const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as { status?: unknown; stopReason?: unknown }
				status = typeof summary.status === "string" ? summary.status : "unknown"
				stopReason = typeof summary.stopReason === "string" ? summary.stopReason : "unknown"
			}

			resolve({
				label: task.label,
				task: task.task,
				passed: status === "done",
				status,
				stopReason,
				durationMs: Date.now() - startedAt,
				summaryPath,
			})
		})
	})
}

async function main(): Promise<void> {
	const rootDir = resolveRootDir()
	const workspace = path.join(rootDir, "verification", "test_workspace")

	const results = await runBasicVerification(
		BASIC_VERIFICATION_TASKS,
		async () => {
			await resetBuiltInTestWorkspace(rootDir)
		},
		async (task) => runSwarmTask(rootDir, workspace, task),
	)

	const output = formatVerificationResults(results)
	console.log(output)

	const failed = results.some((result) => !result.passed)
	process.exit(failed ? 1 : 0)
}

if (require.main === module) {
	main().catch((err) => {
		console.error(`[verify:live:basic] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
