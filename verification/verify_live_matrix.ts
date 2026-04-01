import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { findLatestRunSummary } from "../src/run/RunArtifacts"
import { LIVE_MATRIX_TASKS, type LiveMatrixTask, type MatrixVerdictClass, validateLiveMatrixTasks } from "./live_matrix_tasks"

type SummaryLike = {
	status?: unknown
	stopReason?: unknown
	reviewerVerdict?: unknown
	changedFiles?: unknown
	acceptanceGate?: unknown
}

export type MatrixRowResult = {
	id: string
	workspace: string
	task: string
	verdict: MatrixVerdictClass
	passed: boolean
	status: string
	stopReason: string
	durationMs: number
	summaryPath: string | null
	changedFiles: string[]
	repoCleanAfter: boolean
	details: string[]
}

export type MatrixRunSummary = {
	generatedAt: string
	totalRows: number
	results: MatrixRowResult[]
}

const BASELINE_COMMIT_PREFIX = "dogfood:"

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
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

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk)
		})
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk)
		})

		const killTree = () => {
			if (!child.pid) return
			if (process.platform === "win32") {
				try {
					spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
				} catch {
					// ignore
				}
				return
			}
			try {
				child.kill("SIGTERM")
			} catch {
				// ignore
			}
		}

		const timeout = setTimeout(() => killTree(), options.timeoutMs)
		timeout.unref?.()

		child.once("error", reject)
		child.once("close", (code) => {
			clearTimeout(timeout)
			resolve({ stdout, stderr, code: typeof code === "number" ? code : null })
		})
	})
}

async function getRepoStatusEntries(workspace: string): Promise<string[]> {
	const { stdout, code } = await runCommandCapture(
		"git",
		["-c", `safe.directory=${workspace}`, "status", "--porcelain", "--untracked-files=all"],
		{
		cwd: workspace,
		timeoutMs: 15_000,
		},
	)
	if (code !== 0) return ["git status failed"]
	return stdout
		.split(/\r?\n/g)
		.map((line) => line.trimEnd())
		.filter(Boolean)
}

export function findNamedBaselineCommit(logOutput: string, prefix = BASELINE_COMMIT_PREFIX): string | null {
	for (const line of logOutput.split(/\r?\n/g)) {
		const trimmed = line.trim()
		if (!trimmed) continue
		const [commit, ...subjectParts] = trimmed.split("\t")
		const subject = subjectParts.join("\t").trim()
		if (commit && subject.startsWith(prefix)) {
			return commit.trim()
		}
	}
	return null
}

export async function resolveWorkspaceBaselineCommit(workspace: string): Promise<string> {
	const log = await runCommandCapture("git", ["-c", `safe.directory=${workspace}`, "log", "--format=%H%x09%s"], {
		cwd: workspace,
		timeoutMs: 20_000,
	})
	if (log.code !== 0) {
		throw new Error(`git log failed while resolving matrix baseline: ${log.stderr || log.stdout}`)
	}

	const namedBaseline = findNamedBaselineCommit(log.stdout)
	if (namedBaseline) return namedBaseline

	const root = await runCommandCapture("git", ["-c", `safe.directory=${workspace}`, "rev-list", "--max-parents=0", "HEAD"], {
		cwd: workspace,
		timeoutMs: 20_000,
	})
	if (root.code !== 0) {
		throw new Error(`git rev-list failed while resolving matrix baseline: ${root.stderr || root.stdout}`)
	}
	const fallbackCommit = root.stdout
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.find(Boolean)
	if (!fallbackCommit) {
		throw new Error("Unable to resolve any matrix baseline commit.")
	}
	return fallbackCommit
}

export async function captureMatrixBaselines(rows: LiveMatrixTask[]): Promise<Record<string, string>> {
	const baselines: Record<string, string> = {}
	for (const row of rows) {
		if (baselines[row.workspace]) continue
		baselines[row.workspace] = await resolveWorkspaceBaselineCommit(row.workspace)
	}
	return baselines
}

async function resetWorkspaceToCommit(workspace: string, commit: string): Promise<void> {
	let result = await runCommandCapture("git", ["-c", `safe.directory=${workspace}`, "reset", "--hard", commit], {
		cwd: workspace,
		timeoutMs: 20_000,
	})
	if (result.code !== 0) {
		throw new Error(`git reset failed: ${result.stderr || result.stdout}`)
	}
	result = await runCommandCapture("git", ["-c", `safe.directory=${workspace}`, "clean", "-fdx"], {
		cwd: workspace,
		timeoutMs: 20_000,
	})
	if (result.code !== 0) {
		throw new Error(`git clean failed: ${result.stderr || result.stdout}`)
	}
	const status = await getRepoStatusEntries(workspace)
	if (status.length > 0) {
		throw new Error(`Workspace is still dirty after reset: ${status.join("; ")}`)
	}
}

function readLatestRunSummaryAfter(workspace: string, startedAtMs: number): { summaryPath: string | null; summary: SummaryLike | null } {
	const summaryPath = findLatestRunSummary(workspace)
	if (!summaryPath || !fs.existsSync(summaryPath)) return { summaryPath: null, summary: null }
	const stat = fs.statSync(summaryPath)
	if (stat.mtimeMs + 2_000 < startedAtMs) return { summaryPath: null, summary: null }
	return {
		summaryPath,
		summary: JSON.parse(fs.readFileSync(summaryPath, "utf8")) as SummaryLike,
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function classifySummary(summary: SummaryLike | null): MatrixVerdictClass {
	if (!summary) return "infra_blocked"
	const status = typeof summary.status === "string" ? summary.status : "unknown"
	const stopReason = typeof summary.stopReason === "string" ? summary.stopReason : "unknown"

	if (status === "done") return "pass"
	if (status === "review_required") return "review_required"
	if (
		stopReason === "dirty_repo_refusal" ||
		stopReason.startsWith("provider_") ||
		stopReason === "command_blocked" ||
		stopReason === "timeout"
	) {
		return "infra_blocked"
	}
	return "failed"
}

export function evaluateMatrixRow(
	row: LiveMatrixTask,
	result: { summaryPath: string | null; summary: SummaryLike | null; durationMs: number; repoCleanAfter: boolean; details?: string[] },
): MatrixRowResult {
	const summary = result.summary
	const details = [...(result.details ?? [])]
	const status = typeof summary?.status === "string" ? summary.status : "missing_summary"
	const stopReason = typeof summary?.stopReason === "string" ? summary.stopReason : "missing_summary"
	const changedFiles = Array.isArray(summary?.changedFiles)
		? summary.changedFiles.filter((file): file is string => typeof file === "string")
		: []
	const acceptanceGate = asRecord(summary?.acceptanceGate)
	const acceptancePassed = acceptanceGate?.passed === true
	const reviewerVerdict = typeof summary?.reviewerVerdict === "string" ? summary.reviewerVerdict : null

	const expectedChangedFiles = row.taskContract.acceptance?.expectedChangedFiles ?? row.taskContract.scope?.requiredTargetFiles ?? []
	const forbiddenChangedFiles = new Set(row.taskContract.acceptance?.forbiddenChangedFiles ?? [])
	const allowedFiles = new Set(row.taskContract.scope?.allowedFiles ?? [])

	const missingExpected = expectedChangedFiles.filter((file) => !changedFiles.includes(file))
	const forbiddenChanged = changedFiles.filter((file) => forbiddenChangedFiles.has(file))
	const unrelatedChanged = allowedFiles.size > 0 ? changedFiles.filter((file) => !allowedFiles.has(file)) : []

	if (reviewerVerdict !== "PASS") details.push(`reviewer verdict was ${reviewerVerdict ?? "null"}`)
	if (!acceptancePassed) details.push("acceptance gate did not pass")
	if (missingExpected.length > 0) details.push(`missing expected file changes: ${missingExpected.join(", ")}`)
	if (forbiddenChanged.length > 0) details.push(`forbidden files changed: ${forbiddenChanged.join(", ")}`)
	if (unrelatedChanged.length > 0) details.push(`scope drift detected: ${unrelatedChanged.join(", ")}`)
	if (!result.repoCleanAfter) details.push("workspace was dirty after the row completed")

	let verdict = classifySummary(summary)
	if (verdict === "pass" && details.length > 0) {
		verdict = "review_required"
	}

	const passed = verdict === row.expectedTerminalClass && (row.expectedTerminalClass !== "pass" || details.length === 0)

	return {
		id: row.id,
		workspace: row.workspace,
		task: row.task,
		verdict,
		passed,
		status,
		stopReason,
		durationMs: result.durationMs,
		summaryPath: result.summaryPath,
		changedFiles,
		repoCleanAfter: result.repoCleanAfter,
		details,
	}
}

export async function runFixedMatrix(
	rows: LiveMatrixTask[],
	resetRow: (row: LiveMatrixTask) => Promise<void>,
	executeRow: (row: LiveMatrixTask) => Promise<{ summaryPath: string | null; summary: SummaryLike | null; durationMs: number; repoCleanAfter: boolean; details?: string[] }>,
): Promise<MatrixRowResult[]> {
	const results: MatrixRowResult[] = []
	for (const row of rows) {
		try {
			await resetRow(row)
			const execution = await executeRow(row)
			results.push(evaluateMatrixRow(row, execution))
		} catch (err) {
			results.push({
				id: row.id,
				workspace: row.workspace,
				task: row.task,
				verdict: "infra_blocked",
				passed: row.expectedTerminalClass === "infra_blocked",
				status: "failed",
				stopReason: "matrix_reset_failed",
				durationMs: 0,
				summaryPath: null,
				changedFiles: [],
				repoCleanAfter: false,
				details: [err instanceof Error ? err.message : String(err)],
			})
		}
	}
	return results
}

export function formatMatrixResults(results: MatrixRowResult[]): string {
	const lines = ["Row | Verdict | Status | Stop reason | Duration", "--- | --- | --- | --- | ---"]
	for (const result of results) {
		lines.push(`${result.id} | ${result.passed ? "PASS" : "FAIL"} (${result.verdict}) | ${result.status} | ${result.stopReason} | ${result.durationMs}ms`)
	}
	return lines.join("\n")
}

function matrixRunsDir(rootDir: string): string {
	return path.join(rootDir, "verification", ".matrix_runs")
}

function writeMatrixRunSummary(rootDir: string, summary: MatrixRunSummary): string {
	const runDir = path.join(matrixRunsDir(rootDir), `matrix-${Date.now()}`)
	fs.mkdirSync(runDir, { recursive: true })
	const summaryPath = path.join(runDir, "summary.json")
	fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
	return summaryPath
}

export function findLatestMatrixSummary(rootDir: string): string | null {
	const runsDir = matrixRunsDir(rootDir)
	if (!fs.existsSync(runsDir)) return null
	const candidates = fs
		.readdirSync(runsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(runsDir, entry.name, "summary.json"))
		.filter((summaryPath) => fs.existsSync(summaryPath))
		.map((summaryPath) => ({ summaryPath, mtimeMs: fs.statSync(summaryPath).mtimeMs }))
		.sort((left, right) => right.mtimeMs - left.mtimeMs)
	return candidates[0]?.summaryPath ?? null
}

async function executeLiveMatrixRow(rootDir: string, row: LiveMatrixTask): Promise<{
	summaryPath: string | null
	summary: SummaryLike | null
	durationMs: number
	repoCleanAfter: boolean
	details?: string[]
}> {
	const startedAt = Date.now()
	const child = spawn(process.execPath, ["dist/swarm.js", "--task", row.task, "--workspace", row.workspace], {
		cwd: rootDir,
		env: ensureLiveEnv(process.env),
		windowsHide: true,
		stdio: "inherit",
	})

	await new Promise<void>((resolve, reject) => {
		child.once("error", reject)
		child.once("close", () => resolve())
	})

	const latest = readLatestRunSummaryAfter(row.workspace, startedAt)
	const repoCleanAfter = (await getRepoStatusEntries(row.workspace)).length === 0
	return {
		summaryPath: latest.summaryPath,
		summary: latest.summary,
		durationMs: Date.now() - startedAt,
		repoCleanAfter,
	}
}

async function main(): Promise<void> {
	const rootDir = resolveRootDir()
	const validationIssues = validateLiveMatrixTasks()
	if (validationIssues.length > 0) {
		throw new Error(validationIssues.join("\n"))
	}
	const baselines = await captureMatrixBaselines(LIVE_MATRIX_TASKS)

	const results = await runFixedMatrix(
		LIVE_MATRIX_TASKS,
		async (row) => resetWorkspaceToCommit(row.workspace, baselines[row.workspace]!),
		async (row) => executeLiveMatrixRow(rootDir, row),
	)

	const output = formatMatrixResults(results)
	console.log(output)

	const summaryPath = writeMatrixRunSummary(rootDir, {
		generatedAt: new Date().toISOString(),
		totalRows: results.length,
		results,
	})
	console.log(`Matrix summary: ${summaryPath}`)
	process.exit(results.every((result) => result.passed) ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:live:matrix] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
