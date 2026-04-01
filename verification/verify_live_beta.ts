import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

import type { TaskCorpusId } from "../src/owner/TaskCorpusIds"
import { findLatestRunSummary } from "../src/run/RunArtifacts"
import { BETA_MATRIX_TASKS, type BetaMatrixTask, type BetaVerdictClass, validateBetaMatrixTasks } from "./beta_matrix_tasks"

type SummaryLike = {
	status?: unknown
	stopReason?: unknown
	reviewerVerdict?: unknown
	changedFiles?: unknown
	acceptanceGate?: unknown
	verificationProfile?: unknown
}

type AdmissionLike = {
	decision?: unknown
	reasonCodes?: unknown
	repo?: unknown
}

type CapturedCommandResult = {
	stdout: string
	stderr: string
	code: number | null
	timedOut: boolean
}

type GitStatusProbe = {
	entries: string[]
	failureDetail: string | null
}

type BetaExecutionResult = {
	admission: AdmissionLike | null
	admissionDecision: string
	admissionReasonCodes: string[]
	summaryPath: string | null
	summary: SummaryLike | null
	durationMs: number
	repoStatusEntries: string[]
	artifactDir: string
	details: string[]
}

export type BetaRowResult = {
	id: string
	corpusTaskId: TaskCorpusId
	repoId: string
	repoLabel: string
	workspace: string
	task: string
	verdict: BetaVerdictClass
	passed: boolean
	status: string
	stopReason: string
	durationMs: number
	admissionDecision: string
	admissionReasonCodes: string[]
	summaryPath: string | null
	artifactDir: string
	changedFiles: string[]
	repoCleanAfter: boolean
	expectedVerificationProfile: string | null
	observedVerificationProfile: string | null
	expectedSupportTier: string
	observedSupportTier: string | null
	observedSupportTierLabel: string | null
	details: string[]
}

export type BetaCorpusSummary = {
	corpusTaskId: TaskCorpusId
	observed: number
	passCount: number
	passRate: number
	rowIds: string[]
}

export type BetaSupportTierSummary = {
	supportTier: string
	label: string
	observed: number
	passCount: number
	passRate: number
	rowIds: string[]
}

export type BetaFailureBucket = {
	bucket: string
	count: number
	rowIds: string[]
	nextArtifact: string
}

export type BetaRunSummary = {
	generatedAt: string
	totalRows: number
	passCount: number
	reviewRequiredCount: number
	failedCount: number
	refusedCount: number
	passRate: number
	successByCorpus: BetaCorpusSummary[]
	successBySupportTier: BetaSupportTierSummary[]
	topFailureBuckets: BetaFailureBucket[]
	results: BetaRowResult[]
}

const LIVE_ROW_TIMEOUT_MS = 12 * 60 * 1000
const ADMISSION_TIMEOUT_MS = 60_000

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function quoteCmdArg(value: string): string {
	if (!/[\s"]/u.test(value)) return value
	return `"${value.replace(/"/g, '\\"')}"`
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
	options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<CapturedCommandResult> {
	return await new Promise((resolve, reject) => {
		const spawnChild = (childCommand: string, childArgs: string[]) =>
			spawn(childCommand, childArgs, {
				cwd: options.cwd,
				env: options.env ?? process.env,
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			})

		let child
		try {
			child = spawnChild(command, args)
		} catch (err) {
			if (process.platform === "win32" && command.toLowerCase() === "git") {
				const commandLine = [command, ...args].map(quoteCmdArg).join(" ")
				try {
					child = spawnChild(process.env["ComSpec"] ?? "cmd.exe", ["/d", "/s", "/c", commandLine])
				} catch (fallbackErr) {
					const primaryMessage = err instanceof Error ? err.message : String(err)
					const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
					reject(
						new Error(
							`spawn failed for ${command} ${args.join(" ")} (cwd=${options.cwd}): ${primaryMessage}; cmd fallback failed: ${fallbackMessage}`,
						),
					)
					return
				}
			} else {
				const message = err instanceof Error ? err.message : String(err)
				reject(new Error(`spawn failed for ${command} ${args.join(" ")} (cwd=${options.cwd}): ${message}`))
				return
			}
		}

		let stdout = ""
		let stderr = ""
		let timedOut = false

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

		const timeout = setTimeout(() => {
			timedOut = true
			killTree()
		}, options.timeoutMs)
		timeout.unref?.()

		child.once("error", reject)
		child.once("close", (code) => {
			clearTimeout(timeout)
			resolve({
				stdout,
				stderr,
				code: typeof code === "number" ? code : null,
				timedOut,
			})
		})
	})
}

async function runGit(workspace: string, args: string[], timeoutMs = 20_000): Promise<CapturedCommandResult> {
	return await runCommandCapture(
		"git",
		["-c", `safe.directory=${workspace}`, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-C", workspace, ...args],
		{
			cwd: resolveRootDir(),
			timeoutMs,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: process.env["GIT_AUTHOR_NAME"] ?? "SwarmCoder Verification",
				GIT_AUTHOR_EMAIL: process.env["GIT_AUTHOR_EMAIL"] ?? "verification@local",
				GIT_COMMITTER_NAME: process.env["GIT_COMMITTER_NAME"] ?? "SwarmCoder Verification",
				GIT_COMMITTER_EMAIL: process.env["GIT_COMMITTER_EMAIL"] ?? "verification@local",
			},
		},
	)
}

function computeStagingGitTimeoutMs(row: BetaMatrixTask): number {
	const generatedFileCount = (row.generatedFiles ?? []).reduce((total, spec) => total + spec.count, 0)
	if (generatedFileCount >= 2_000) return 180_000
	if (generatedFileCount >= 500) return 90_000
	return 15_000
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function writeCommandArtifacts(artifactDir: string, prefix: string, result: CapturedCommandResult): void {
	fs.mkdirSync(artifactDir, { recursive: true })
	fs.writeFileSync(path.join(artifactDir, `${prefix}.stdout.log`), result.stdout, "utf8")
	fs.writeFileSync(path.join(artifactDir, `${prefix}.stderr.log`), result.stderr, "utf8")
	fs.writeFileSync(
		path.join(artifactDir, `${prefix}.meta.json`),
		`${JSON.stringify({ code: result.code, timedOut: result.timedOut }, null, 2)}\n`,
		"utf8",
	)
}

function copyIfExists(sourcePath: string, destinationPath: string): void {
	if (!fs.existsSync(sourcePath)) return
	fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
	fs.copyFileSync(sourcePath, destinationPath)
}

function writeGeneratedBetaFiles(row: BetaMatrixTask): void {
	for (const spec of row.generatedFiles ?? []) {
		for (let index = 1; index <= spec.count; index++) {
			const bucket = Math.floor((index - 1) / 200) + 1
			const filePath = path.join(
				row.workspace,
				spec.root,
				`chunk-${String(bucket).padStart(2, "0")}`,
				`generated-${String(index).padStart(4, "0")}${spec.extension}`,
			)
			fs.mkdirSync(path.dirname(filePath), { recursive: true })
			const content =
				spec.extension === ".md"
					? `${spec.linePrefix} ${index}\n\nThis staged file keeps the beta repo inside the tier-2 candidate envelope.\n`
					: `${spec.linePrefix} ${index}\nexport const betaGenerated${index} = ${index}\n`
			fs.writeFileSync(filePath, content, "utf8")
		}
	}
}

async function getRepoStatusProbe(workspace: string): Promise<GitStatusProbe> {
	const result = await runGit(workspace, ["status", "--porcelain", "--untracked-files=all"], 15_000)
	if (result.code !== 0) {
		const failureDetail = result.timedOut
			? "git status timed out after 15000ms"
			: (result.stderr || result.stdout || `git status exited ${String(result.code ?? "null")}`).trim()
		return {
			entries: [],
			failureDetail,
		}
	}
	return {
		entries: result.stdout
			.split(/\r?\n/g)
			.map((line) => line.trimEnd())
			.filter(Boolean),
		failureDetail: null,
	}
}

async function getStableRepoStatusEntries(workspace: string, settleWindowMs = 10_000): Promise<GitStatusProbe> {
	const startedAt = Date.now()
	let latestEntries: string[] = []
	let lastFailureDetail: string | null = null

	while (Date.now() - startedAt < settleWindowMs) {
		const probe = await getRepoStatusProbe(workspace)
		if (!probe.failureDetail && probe.entries.length === 0) {
			return probe
		}
		if (probe.entries.length > 0) {
			latestEntries = probe.entries
		}
		if (probe.failureDetail) {
			lastFailureDetail = probe.failureDetail
		}
		await delay(250)
	}

	if (lastFailureDetail) {
		return {
			entries: [`git status failed: ${lastFailureDetail}`],
			failureDetail: lastFailureDetail,
		}
	}

	return {
		entries: latestEntries,
		failureDetail: null,
	}
}

function betaRunsDir(rootDir: string): string {
	return path.join(rootDir, ".swarm", "beta_runs")
}

function createBetaRunDir(rootDir: string): string {
	const runDir = path.join(betaRunsDir(rootDir), `beta-${Date.now()}`)
	fs.mkdirSync(path.join(runDir, "rows"), { recursive: true })
	return runDir
}

export function isolateBetaRunRows(rows: BetaMatrixTask[], runDir: string): BetaMatrixTask[] {
	const workspacesDir = path.join(runDir, "workspaces")
	return rows.map((row) => {
		const workspaceName = path.basename(row.workspace) || row.repoId
		return {
			...row,
			workspace: path.join(workspacesDir, `${row.id}-${workspaceName}`),
		}
	})
}

function writeBetaRunSummary(runDir: string, summary: BetaRunSummary): string {
	const summaryPath = path.join(runDir, "summary.json")
	fs.mkdirSync(runDir, { recursive: true })
	fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
	return summaryPath
}

export function findLatestBetaSummary(rootDir: string): string | null {
	const runsDir = betaRunsDir(rootDir)
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

async function stageBetaWorkspace(row: BetaMatrixTask): Promise<void> {
	if (fs.existsSync(row.workspace)) {
		fs.rmSync(row.workspace, { recursive: true, force: true })
	}
	fs.mkdirSync(path.dirname(row.workspace), { recursive: true })
	fs.cpSync(row.templateDir, row.workspace, { recursive: true, force: true })
	writeGeneratedBetaFiles(row)

	const stagingGitTimeoutMs = computeStagingGitTimeoutMs(row)

	const initResult = await runGit(row.workspace, ["init"], stagingGitTimeoutMs)
	if (initResult.code !== 0) {
		throw new Error(`git init failed: ${initResult.stderr || initResult.stdout}`)
	}
	const addResult = await runGit(row.workspace, ["add", "-A"], stagingGitTimeoutMs)
	if (addResult.code !== 0) {
		throw new Error(`git add failed: ${addResult.stderr || addResult.stdout}`)
	}
	const commitResult = await runGit(row.workspace, ["commit", "-m", row.baselineLabel], stagingGitTimeoutMs)
	if (commitResult.code !== 0) {
		throw new Error(`git commit failed: ${commitResult.stderr || commitResult.stdout}`)
	}
	const statusProbe = await getStableRepoStatusEntries(row.workspace, 12_000)
	if (statusProbe.entries.length > 0) {
		throw new Error(`Workspace remained dirty after staging baseline: ${statusProbe.entries.join("; ")}`)
	}
}

function parseAdmission(stdout: string): AdmissionLike | null {
	const trimmed = stdout.trim()
	if (!trimmed) return null
	try {
		return JSON.parse(trimmed) as AdmissionLike
	} catch {
		return null
	}
}

function snapshotScopedFiles(workspace: string, files: string[], artifactDir: string): void {
	const uniqueFiles = Array.from(new Set(files.filter(Boolean)))
	for (const relPath of uniqueFiles) {
		const sourcePath = path.join(workspace, relPath)
		if (!fs.existsSync(sourcePath)) continue
		const destinationPath = path.join(artifactDir, "files", relPath)
		fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
		fs.copyFileSync(sourcePath, destinationPath)
	}
}

async function executeLiveBetaRow(rootDir: string, row: BetaMatrixTask, artifactDir: string): Promise<BetaExecutionResult> {
	const startedAt = Date.now()
	const env = ensureLiveEnv(process.env)

	const admissionResult = await runCommandCapture(
		process.execPath,
		["dist/swarm.js", "--task", row.task, "--workspace", row.workspace, "--admitOnly", "--json"],
		{ cwd: rootDir, timeoutMs: ADMISSION_TIMEOUT_MS, env },
	)
	writeCommandArtifacts(artifactDir, "admission", admissionResult)

	const parsedAdmission = parseAdmission(admissionResult.stdout)
	if (parsedAdmission) {
		fs.writeFileSync(path.join(artifactDir, "admission.json"), `${JSON.stringify(parsedAdmission, null, 2)}\n`, "utf8")
	}

	const admissionDecision =
		asString(parsedAdmission?.decision) ??
		(admissionResult.code === 2 ? "refuse" : admissionResult.code === 0 ? "allow" : "unknown")
	const admissionReasonCodes = asStringArray(parsedAdmission?.reasonCodes)
	const preflightDetails: string[] = []

	if (!parsedAdmission) {
		preflightDetails.push("admission output was missing or unreadable")
	}
	if (admissionResult.timedOut) {
		preflightDetails.push(`admission check timed out after ${ADMISSION_TIMEOUT_MS}ms`)
	}
	if (admissionDecision === "refuse") {
		const repoStatusProbe = await getStableRepoStatusEntries(row.workspace, 15_000)
		return {
			admission: parsedAdmission,
			admissionDecision,
			admissionReasonCodes,
			summaryPath: null,
			summary: null,
			durationMs: Date.now() - startedAt,
			repoStatusEntries: repoStatusProbe.entries,
			artifactDir,
			details: preflightDetails,
		}
	}

	const liveResult = await runCommandCapture(
		process.execPath,
		["dist/swarm.js", "--task", row.task, "--workspace", row.workspace],
		{ cwd: rootDir, timeoutMs: LIVE_ROW_TIMEOUT_MS, env },
	)
	writeCommandArtifacts(artifactDir, "live", liveResult)

	const latestSummaryPath = findLatestRunSummary(row.workspace)
	let copiedSummaryPath: string | null = null
	let summary: SummaryLike | null = null
	const details = [...preflightDetails]

	if (latestSummaryPath && fs.existsSync(latestSummaryPath)) {
		summary = JSON.parse(fs.readFileSync(latestSummaryPath, "utf8")) as SummaryLike
		copiedSummaryPath = path.join(artifactDir, "summary.json")
		copyIfExists(latestSummaryPath, copiedSummaryPath)
		const runDir = path.dirname(latestSummaryPath)
		copyIfExists(path.join(runDir, "review-pack.json"), path.join(artifactDir, "review-pack.json"))
		copyIfExists(path.join(runDir, "events.ndjson"), path.join(artifactDir, "events.ndjson"))
	} else {
		details.push("live run ended without a summary artifact")
	}

	if (liveResult.timedOut) {
		details.push(`live run timed out after ${LIVE_ROW_TIMEOUT_MS}ms`)
	}
	if (liveResult.code !== 0 && liveResult.code !== 2 && !summary) {
		details.push(`live process exited ${String(liveResult.code ?? "null")} without a summary`)
	}

	snapshotScopedFiles(row.workspace, row.taskContract.scope?.allowedFiles ?? [], artifactDir)
	const repoStatusProbe = await getStableRepoStatusEntries(row.workspace, 15_000)

	return {
		admission: parsedAdmission,
		admissionDecision,
		admissionReasonCodes,
		summaryPath: copiedSummaryPath,
		summary,
		durationMs: Date.now() - startedAt,
		repoStatusEntries: repoStatusProbe.entries,
		artifactDir,
		details,
	}
}

function readWorkspaceFile(workspace: string, relPath: string): string | null {
	const filePath = path.join(workspace, relPath)
	if (!fs.existsSync(filePath)) return null
	try {
		return fs.readFileSync(filePath, "utf8")
	} catch {
		return null
	}
}

function normalizeRepoStatusPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\/+/u, "").replace(/^"+|"+$/gu, "").trim()
}

function extractRepoStatusPaths(entries: string[]): string[] {
	const paths = new Set<string>()

	for (const entry of entries) {
		const trimmed = entry.trimEnd()
		if (!trimmed || trimmed.toLowerCase().startsWith("git status failed:")) continue

		const rawPath = trimmed.length > 3 ? trimmed.slice(3) : ""
		if (!rawPath) continue

		const renameParts = rawPath.split(" -> ")
		const candidate = renameParts[renameParts.length - 1] ?? rawPath
		const normalized = normalizeRepoStatusPath(candidate)
		if (normalized) paths.add(normalized)
	}

	return Array.from(paths)
}

function classifySummaryVerdict(
	admissionDecision: string,
	summary: SummaryLike | null,
	status: string,
	stopReason: string,
): BetaVerdictClass {
	if (admissionDecision === "refuse") return "refused"
	if (stopReason === "dirty_repo_refusal") return "refused"
	if (!summary) return "failed"
	if (status === "review_required") return "review_required"
	if (status === "done") return "pass"
	return "failed"
}

export function evaluateBetaRow(row: BetaMatrixTask, execution: BetaExecutionResult): BetaRowResult {
	const details = [...execution.details]
	const summary = execution.summary
	const status =
		asString(summary?.status) ??
		(execution.admissionDecision === "refuse" ? "admission_refused" : summary ? "unknown" : "missing_summary")
	const stopReason =
		asString(summary?.stopReason) ??
		(execution.admissionDecision === "refuse" ? "admission_refused" : summary ? "unknown" : "missing_summary")
	const changedFiles = asStringArray(summary?.changedFiles)
	const acceptanceGate = asRecord(summary?.acceptanceGate)
	const reviewerVerdict = asString(summary?.reviewerVerdict)
	const verificationProfile = asRecord(summary?.verificationProfile)
	const repoAdmission = asRecord(execution.admission?.repo)
	const observedVerificationProfile = asString(verificationProfile?.profileName)
	const verificationStatus = asString(verificationProfile?.status)
	const observedSupportTier = asString(repoAdmission?.supportTier)
	const observedSupportTierLabel = asString(repoAdmission?.supportTierLabel)

	const expectedChangedFiles = row.taskContract.acceptance?.expectedChangedFiles ?? row.taskContract.scope?.requiredTargetFiles ?? []
	const forbiddenChangedFiles = new Set(row.taskContract.acceptance?.forbiddenChangedFiles ?? [])
	const allowedFiles = new Set(row.taskContract.scope?.allowedFiles ?? [])
	const expectedWorkspacePaths = new Set(
		[
			...allowedFiles,
			...expectedChangedFiles,
			...changedFiles,
			...(row.taskContract.acceptance?.requiredCreatedFiles ?? []),
		].map((file) => normalizeRepoStatusPath(file)),
	)

	const missingExpected = expectedChangedFiles.filter((file) => !changedFiles.includes(file))
	const forbiddenChanged = changedFiles.filter((file) => forbiddenChangedFiles.has(file))
	const unrelatedChanged = allowedFiles.size > 0 ? changedFiles.filter((file) => !allowedFiles.has(file)) : []
	const missingCreatedFiles = (row.taskContract.acceptance?.requiredCreatedFiles ?? []).filter(
		(file) => !fs.existsSync(path.join(row.workspace, file)),
	)
	const unexpectedRepoStatusEntries = execution.repoStatusEntries.filter((entry) => {
		if (entry.trim().toLowerCase().startsWith("git status failed:")) return true
		const repoStatusPaths = extractRepoStatusPaths([entry])
		if (repoStatusPaths.length === 0) return true
		return repoStatusPaths.some((repoStatusPath) => !expectedWorkspacePaths.has(repoStatusPath))
	})

	for (const expectation of row.taskContract.acceptance?.requiredContentSnippets ?? []) {
		const content = readWorkspaceFile(row.workspace, expectation.path)
		if (content === null || !content.includes(expectation.snippet)) {
			details.push(`missing required snippet in ${expectation.path}`)
		}
	}

	for (const expectation of row.taskContract.acceptance?.forbiddenContentSnippets ?? []) {
		const content = readWorkspaceFile(row.workspace, expectation.path)
		if (content !== null && content.includes(expectation.snippet)) {
			details.push(`forbidden snippet was present in ${expectation.path}`)
		}
	}

	if (execution.admissionDecision === "unknown") {
		details.push("admission decision was not captured cleanly")
	}
	if (reviewerVerdict !== null && reviewerVerdict !== "PASS") {
		details.push(`reviewer verdict was ${reviewerVerdict}`)
	}
	if (summary && acceptanceGate?.passed !== true) {
		details.push("acceptance gate did not pass")
	}
	if (missingExpected.length > 0) details.push(`missing expected file changes: ${missingExpected.join(", ")}`)
	if (forbiddenChanged.length > 0) details.push(`forbidden files changed: ${forbiddenChanged.join(", ")}`)
	if (unrelatedChanged.length > 0) details.push(`scope drift detected: ${unrelatedChanged.join(", ")}`)
	if (missingCreatedFiles.length > 0) details.push(`required created files missing: ${missingCreatedFiles.join(", ")}`)
	if (unexpectedRepoStatusEntries.length > 0) {
		details.push(`repo status after row: ${unexpectedRepoStatusEntries.join("; ")}`)
		details.push("workspace was dirty after the row completed")
	}

	if (row.expectedVerificationProfile) {
		if (observedVerificationProfile !== row.expectedVerificationProfile) {
			details.push(
				`expected verification profile ${row.expectedVerificationProfile} but saw ${observedVerificationProfile ?? "none"}`,
			)
		}
		if (verificationStatus !== "passed") {
			details.push(`verification profile did not pass (status=${verificationStatus ?? "missing"})`)
		}
	}
	if (observedSupportTier !== row.expectedSupportTier) {
		details.push(`expected repo support tier ${row.expectedSupportTier} but saw ${observedSupportTier ?? "none"}`)
	}

	let verdict = classifySummaryVerdict(execution.admissionDecision, summary, status, stopReason)
	if (verdict === "pass" && details.length > 0) {
		verdict = "review_required"
	}

	const passed = verdict === row.expectedTerminalClass && (row.expectedTerminalClass !== "pass" || details.length === 0)

	return {
		id: row.id,
		corpusTaskId: row.corpusTaskId,
		repoId: row.repoId,
		repoLabel: row.repoLabel,
		workspace: row.workspace,
		task: row.task,
		verdict,
		passed,
		status,
		stopReason,
		durationMs: execution.durationMs,
		admissionDecision: execution.admissionDecision,
		admissionReasonCodes: execution.admissionReasonCodes,
		summaryPath: execution.summaryPath,
		artifactDir: execution.artifactDir,
		changedFiles,
		repoCleanAfter: unexpectedRepoStatusEntries.length === 0,
		expectedVerificationProfile: row.expectedVerificationProfile,
		observedVerificationProfile,
		expectedSupportTier: row.expectedSupportTier,
		observedSupportTier,
		observedSupportTierLabel,
		details,
	}
}

function summarizeBetaByCorpus(results: BetaRowResult[]): BetaCorpusSummary[] {
	const grouped = new Map<TaskCorpusId, BetaCorpusSummary>()
	for (const result of results) {
		const existing = grouped.get(result.corpusTaskId)
		if (existing) {
			existing.observed += 1
			existing.rowIds.push(result.id)
			if (result.verdict === "pass") {
				existing.passCount += 1
			}
			continue
		}

		grouped.set(result.corpusTaskId, {
			corpusTaskId: result.corpusTaskId,
			observed: 1,
			passCount: result.verdict === "pass" ? 1 : 0,
			passRate: 0,
			rowIds: [result.id],
		})
	}

	return Array.from(grouped.values())
		.map((summary) => ({
			...summary,
			passRate: summary.observed > 0 ? Math.round((summary.passCount / summary.observed) * 1000) / 10 : 0,
		}))
		.sort((left, right) => {
			if (right.observed !== left.observed) return right.observed - left.observed
			return left.corpusTaskId.localeCompare(right.corpusTaskId)
		})
}

function summarizeBetaBySupportTier(results: BetaRowResult[]): BetaSupportTierSummary[] {
	const grouped = new Map<string, BetaSupportTierSummary>()
	for (const result of results) {
		const supportTier = result.observedSupportTier ?? result.expectedSupportTier
		const label = result.observedSupportTierLabel ?? supportTier
		const key = `${supportTier}|${label}`
		const existing = grouped.get(key)
		if (existing) {
			existing.observed += 1
			existing.rowIds.push(result.id)
			if (result.verdict === "pass") {
				existing.passCount += 1
			}
			continue
		}

		grouped.set(key, {
			supportTier,
			label,
			observed: 1,
			passCount: result.verdict === "pass" ? 1 : 0,
			passRate: 0,
			rowIds: [result.id],
		})
	}

	return Array.from(grouped.values())
		.map((summary) => ({
			...summary,
			passRate: summary.observed > 0 ? Math.round((summary.passCount / summary.observed) * 1000) / 10 : 0,
		}))
		.sort((left, right) => {
			if (right.observed !== left.observed) return right.observed - left.observed
			return left.label.localeCompare(right.label)
		})
}

export function classifyBetaFailureBucket(result: BetaRowResult): { bucket: string; nextArtifact: string } {
	const nextArtifact = result.summaryPath ?? result.artifactDir
	const detailText = result.details.join(" | ").toLowerCase()

	if (result.verdict === "refused" || result.stopReason === "admission_refused") {
		return { bucket: "admission refusal", nextArtifact }
	}
	if (
		detailText.includes("workspace was dirty after the row completed") ||
		detailText.includes("repo status after row:") ||
		detailText.includes("git status failed:")
	) {
		return { bucket: "dirty after row", nextArtifact }
	}
	if (
		result.stopReason === "scope_drift" ||
		result.stopReason === "missing_expected_change" ||
		result.stopReason === "too_many_changed_files" ||
		detailText.includes("scope drift")
	) {
		return { bucket: "scope drift", nextArtifact }
	}
	if (detailText.includes("missing required snippet") || detailText.includes("required created files missing")) {
		return { bucket: "content expectation mismatch", nextArtifact }
	}
	if (
		result.stopReason === "review_blocked" ||
		result.stopReason === "reviewer_invalid" ||
		result.stopReason === "reviewer_unavailable" ||
		detailText.includes("reviewer verdict")
	) {
		return { bucket: "review blocked", nextArtifact }
	}
	if (result.stopReason.startsWith("verification_") || detailText.includes("verification profile")) {
		return { bucket: "verification profile", nextArtifact }
	}
	if (result.stopReason === "dirty_repo_refusal") {
		return { bucket: "dirty repo refusal", nextArtifact }
	}
	if (
		result.stopReason === "run_duration_ceiling" ||
		result.stopReason === "model_call_ceiling" ||
		result.stopReason === "usage_budget_ceiling" ||
		result.stopReason === "workspace_run_locked"
	) {
		return { bucket: "guardrail ceiling", nextArtifact }
	}
	if (result.stopReason.startsWith("provider_") || result.stopReason === "command_blocked") {
		return { bucket: "provider or config failure", nextArtifact }
	}
	if (result.stopReason === "no_diff_evidence") {
		return { bucket: "no diff evidence", nextArtifact }
	}
	if (result.stopReason === "missing_summary" || detailText.includes("summary artifact")) {
		return { bucket: "missing summary artifact", nextArtifact }
	}

	return { bucket: "unknown", nextArtifact }
}

export function groupBetaFailures(results: BetaRowResult[]): BetaFailureBucket[] {
	const grouped = new Map<string, BetaFailureBucket>()
	for (const result of results.filter((entry) => entry.verdict !== "pass")) {
		const classification = classifyBetaFailureBucket(result)
		const existing = grouped.get(classification.bucket)
		if (existing) {
			existing.count += 1
			existing.rowIds.push(result.id)
			continue
		}
		grouped.set(classification.bucket, {
			bucket: classification.bucket,
			count: 1,
			rowIds: [result.id],
			nextArtifact: classification.nextArtifact,
		})
	}

	return Array.from(grouped.values()).sort((left, right) => {
		if (right.count !== left.count) return right.count - left.count
		return left.bucket.localeCompare(right.bucket)
	})
}

export function summarizeBetaRun(results: BetaRowResult[], generatedAt = new Date().toISOString()): BetaRunSummary {
	const passCount = results.filter((result) => result.verdict === "pass").length
	const reviewRequiredCount = results.filter((result) => result.verdict === "review_required").length
	const failedCount = results.filter((result) => result.verdict === "failed").length
	const refusedCount = results.filter((result) => result.verdict === "refused").length
	const totalRows = results.length
	const passRate = totalRows > 0 ? Math.round((passCount / totalRows) * 1000) / 10 : 0

	return {
		generatedAt,
		totalRows,
		passCount,
		reviewRequiredCount,
		failedCount,
		refusedCount,
		passRate,
		successByCorpus: summarizeBetaByCorpus(results),
		successBySupportTier: summarizeBetaBySupportTier(results),
		topFailureBuckets: groupBetaFailures(results).slice(0, 5),
		results,
	}
}

export function formatBetaResults(summary: BetaRunSummary): string {
	const lines = [
		"Row | Repo | Support tier | Verdict | Admission | Status | Stop reason | Duration",
		"--- | --- | --- | --- | --- | --- | --- | ---",
	]

	for (const result of summary.results) {
		lines.push(
			`${result.id} | ${result.repoLabel} | ${result.observedSupportTierLabel ?? result.expectedSupportTier} | ${result.passed ? "PASS" : "FAIL"} (${result.verdict}) | ${result.admissionDecision} | ${result.status} | ${result.stopReason} | ${result.durationMs}ms`,
		)
	}

	lines.push("")
	lines.push(`Total rows: ${summary.totalRows}`)
	lines.push(`Pass count: ${summary.passCount}`)
	lines.push(`Review-required count: ${summary.reviewRequiredCount}`)
	lines.push(`Failed count: ${summary.failedCount}`)
	lines.push(`Refused count: ${summary.refusedCount}`)
	lines.push(`Pass rate: ${summary.passRate}%`)
	if (summary.successByCorpus.length === 0) {
		lines.push("Task corpus success: none")
	} else {
		lines.push("Task corpus success:")
		for (const corpus of summary.successByCorpus) {
			lines.push(`- ${corpus.corpusTaskId}: ${corpus.passCount}/${corpus.observed} (${corpus.passRate}%)`)
		}
	}

	if (summary.successBySupportTier.length === 0) {
		lines.push("Support tier success: none")
	} else {
		lines.push("Support tier success:")
		for (const supportTier of summary.successBySupportTier) {
			lines.push(`- ${supportTier.label}: ${supportTier.passCount}/${supportTier.observed} (${supportTier.passRate}%)`)
		}
	}

	if (summary.topFailureBuckets.length === 0) {
		lines.push("Top failure buckets: none")
	} else {
		lines.push("Top failure buckets:")
		for (const bucket of summary.topFailureBuckets) {
			lines.push(`- ${bucket.bucket}: ${bucket.count} (${bucket.rowIds.join(", ")})`)
		}
	}

	return lines.join("\n")
}

export async function runFixedBetaMatrix(
	rows: BetaMatrixTask[],
	artifactDirForRow: (row: BetaMatrixTask) => string,
	resetRow: (row: BetaMatrixTask, artifactDir: string) => Promise<void>,
	executeRow: (row: BetaMatrixTask, artifactDir: string) => Promise<BetaExecutionResult>,
): Promise<BetaRowResult[]> {
	const results: BetaRowResult[] = []
	for (const row of rows) {
		const artifactDir = artifactDirForRow(row)
		fs.mkdirSync(artifactDir, { recursive: true })
		try {
			await resetRow(row, artifactDir)
			const execution = await executeRow(row, artifactDir)
			results.push(evaluateBetaRow(row, execution))
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			fs.writeFileSync(path.join(artifactDir, "runner-error.txt"), `${message}\n`, "utf8")
			results.push({
				id: row.id,
				corpusTaskId: row.corpusTaskId,
				repoId: row.repoId,
				repoLabel: row.repoLabel,
				workspace: row.workspace,
				task: row.task,
				verdict: "failed",
				passed: row.expectedTerminalClass === "failed",
				status: "failed",
				stopReason: "beta_row_failed",
				durationMs: 0,
				admissionDecision: "unknown",
				admissionReasonCodes: [],
				summaryPath: null,
				artifactDir,
				changedFiles: [],
				repoCleanAfter: false,
				expectedVerificationProfile: row.expectedVerificationProfile,
				observedVerificationProfile: null,
				expectedSupportTier: row.expectedSupportTier,
				observedSupportTier: null,
				observedSupportTierLabel: null,
				details: [message],
			})
		}
	}
	return results
}

async function main(): Promise<void> {
	const rootDir = resolveRootDir()
	const validationIssues = validateBetaMatrixTasks()
	if (validationIssues.length > 0) {
		throw new Error(validationIssues.join("\n"))
	}

	const betaRunDir = createBetaRunDir(rootDir)
	const runRows = isolateBetaRunRows(BETA_MATRIX_TASKS, betaRunDir)
	const results = await runFixedBetaMatrix(
		runRows,
		(row) => path.join(betaRunDir, "rows", row.id),
		async (row) => {
			await stageBetaWorkspace(row)
		},
		async (row, artifactDir) => executeLiveBetaRow(rootDir, row, artifactDir),
	)

	const summary = summarizeBetaRun(results)
	const summaryPath = writeBetaRunSummary(betaRunDir, summary)
	console.log(formatBetaResults(summary))
	console.log(`Beta summary: ${summaryPath}`)
	process.exit(results.every((result) => result.passed) ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:live:beta] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
