import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
	buildScopedTaskContract,
	extractRenameSymbolIntent,
	extractTaskFileRefs,
	matchesSafeTaskTemplate,
	type TaskContract,
} from "./TaskContract"
import { discoverSemiOpenTask, listWorkspaceFilesForDiscovery } from "./SemiOpenDiscovery"
import { resolveRuntimeConfig, type RuntimeConfig } from "./RuntimeConfig"
import { loadRepoVerificationProfile } from "./VerificationProfile"

export type AdmissionDecision = "allow" | "allow_with_review_bias" | "refuse"

export type RepoReadinessReasonCode =
	| "not_git_repo"
	| "git_probe_failed"
	| "dirty_workspace"
	| "dirty_workspace_override"
	| "large_repo_tier_2"
	| "repo_file_count_limit_exceeded"
	| "repo_size_limit_exceeded"
	| "binary_or_generated_dominant"
	| "artifact_root_not_writable"

export type TaskAdmissionReasonCode =
	| "unsupported_task_verb"
	| "unsupported_broad_refactor"
	| "too_many_target_files"
	| "missing_verification_profile"
	| "ambiguous_task_scope"
	| "scoped_multi_file_task"
	| "medium_bounded_task"
	| "outside_safe_task_template"
	| "semi_open_task"

export type AdmissionReasonCode = RepoReadinessReasonCode | TaskAdmissionReasonCode

export type RepoReadinessMetrics = {
	fileCount: number
	totalBytes: number
	dirtyEntryCount: number
	binaryOrGeneratedFileCount: number
	binaryOrGeneratedRatio: number
	writableRoot: string
}

export type RepoSupportTier =
	| "small_supported"
	| "medium_supported"
	| "large_supported_tier_2"
	| "large_refused"
	| "binary_refused"
	| "repo_unready"

export type RepoReadinessResult = {
	decision: AdmissionDecision
	reasonCodes: RepoReadinessReasonCode[]
	summary: string
	details: string[]
	metrics: RepoReadinessMetrics
	supportTier: RepoSupportTier
	supportTierLabel: string
}

export type TaskAdmissionResult = {
	decision: AdmissionDecision
	reasonCodes: TaskAdmissionReasonCode[]
	summary: string
	details: string[]
	targetFiles: string[]
	derivedTaskContract: TaskContract | null
	verificationProfile: string | null
	verificationProfilesFound: string[]
}

export type AdmissionReport = {
	decision: AdmissionDecision
	summary: string
	reasonCodes: AdmissionReasonCode[]
	repo: RepoReadinessResult
	task: TaskAdmissionResult
}

export type AdmissionInput = {
	workspace: string
	task: string
	allowDirty?: boolean
	runtimeConfig?: RuntimeConfig
}

type VerificationDemand = {
	label: string
}

const GENERATED_PATTERNS = [/^dist\//u, /^build\//u, /^coverage\//u, /^out\//u, /^\.next\//u, /\.map$/u, /\.min\.[^.]+$/u]
const BINARY_EXTENSIONS = new Set([
	".7z",
	".avi",
	".bin",
	".class",
	".dll",
	".dylib",
	".eot",
	".exe",
	".gif",
	".gz",
	".ico",
	".jar",
	".jpeg",
	".jpg",
	".lockb",
	".mov",
	".mp3",
	".mp4",
	".pdf",
	".png",
	".so",
	".tar",
	".ttf",
	".wasm",
	".webm",
	".webp",
	".woff",
	".woff2",
	".zip",
])

function formatDecisionLabel(decision: AdmissionDecision): string {
	switch (decision) {
		case "allow":
			return "ALLOW"
		case "allow_with_review_bias":
			return "ALLOW WITH REVIEW BIAS"
		case "refuse":
			return "REFUSE"
	}
}

function uniqueStrings<T extends string>(values: T[]): T[] {
	return Array.from(new Set(values.filter(Boolean))) as T[]
}

function combineDecision(current: AdmissionDecision, incoming: AdmissionDecision): AdmissionDecision {
	if (current === "refuse" || incoming === "refuse") return "refuse"
	if (current === "allow_with_review_bias" || incoming === "allow_with_review_bias") return "allow_with_review_bias"
	return "allow"
}

async function runGitCapture(
	workspace: string,
	args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcoder-admission-"))
	const stdoutPath = path.join(tmpDir, "stdout.log")
	const stderrPath = path.join(tmpDir, "stderr.log")
	const stdoutFd = fs.openSync(stdoutPath, "w")
	const stderrFd = fs.openSync(stderrPath, "w")

	const readFile = (filePath: string): string => {
		try {
			return fs.readFileSync(filePath, "utf8")
		} catch {
			return ""
		}
	}

	try {
		return await new Promise((resolve) => {
			const child = spawn("git", ["-c", `safe.directory=${workspace}`, ...args], {
				cwd: workspace,
				windowsHide: true,
				stdio: ["ignore", stdoutFd, stderrFd],
			})

			child.once("error", (error) => {
				resolve({
					ok: false,
					stdout: readFile(stdoutPath),
					stderr: readFile(stderrPath),
					error: error instanceof Error ? error.message : String(error),
				})
			})
			child.once("close", (code) => {
				resolve({
					ok: code === 0,
					stdout: readFile(stdoutPath),
					stderr: readFile(stderrPath),
				})
			})
		})
	} finally {
		try {
			fs.closeSync(stdoutFd)
		} catch {
			// ignore
		}
		try {
			fs.closeSync(stderrFd)
		} catch {
			// ignore
		}
		try {
			fs.unlinkSync(stdoutPath)
		} catch {
			// ignore
		}
		try {
			fs.unlinkSync(stderrPath)
		} catch {
			// ignore
		}
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	}
}

function splitZeroTerminated(input: string): string[] {
	return input
		.split("\u0000")
		.map((entry) => entry.trim())
		.filter(Boolean)
}

function isBinaryOrGenerated(relPath: string): boolean {
	const normalized = relPath.replace(/[\\/]+/g, "/")
	if (GENERATED_PATTERNS.some((pattern) => pattern.test(normalized))) return true
	return BINARY_EXTENSIONS.has(path.extname(normalized).toLowerCase())
}

function detectRefactorLanguagePackId(filePath: string | null): "javascript_typescript" | "python" | null {
	if (!filePath) return null
	const extension = path.extname(filePath).toLowerCase()
	if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"].includes(extension)) return "javascript_typescript"
	if (extension === ".py") return "python"
	return null
}

function detectAnchorSymbolPresence(workspace: string, anchorFile: string | null, sourceSymbol: string): boolean | null {
	if (!anchorFile) return null
	const anchorPath = path.join(workspace, anchorFile)
	if (!fs.existsSync(anchorPath)) return null
	try {
		const content = fs.readFileSync(anchorPath, "utf8")
		const pattern = new RegExp(`\\b${sourceSymbol.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "u")
		return pattern.test(content)
	} catch {
		return null
	}
}

function detectVerificationDemand(taskLower: string): VerificationDemand | null {
	if (/\bnpm\s+test\b/u.test(taskLower) || /\bjest\b/u.test(taskLower) || /\bvitest\b/u.test(taskLower)) {
		return { label: "npm test" }
	}
	if (/\bpytest\b/u.test(taskLower)) {
		return { label: "pytest" }
	}
	if (/\bcargo\s+test\b/u.test(taskLower)) {
		return { label: "cargo test" }
	}
	if (/\bgo\s+test\b/u.test(taskLower)) {
		return { label: "go test" }
	}
	return null
}

function evaluateUnsupportedTask(taskLower: string, targetFiles: string[]): TaskAdmissionReasonCode[] {
	const reasons: TaskAdmissionReasonCode[] = []
	if (
		/\b(npm\s+install|npm\s+ci|pnpm\s+install|pnpm\s+add|yarn\s+install|yarn\s+add|install\s+dependencies?|add\s+dependencies?|upgrade\s+dependencies?|bump\s+dependencies?)\b/u.test(
			taskLower,
		)
	) {
		reasons.push("unsupported_task_verb")
	}
	if (/\b(migrate|migration|schema\s+migration|database\s+migration|db\s+migration)\b/u.test(taskLower)) {
		reasons.push("unsupported_task_verb")
	}
	if (
		targetFiles.length === 0 &&
		(/\b(refactor|rewrite|overhaul|re-architect|rearchitect)\b/u.test(taskLower) ||
			/\b(entire\s+repo|whole\s+repo|throughout\s+the\s+repo|across\s+the\s+repo|every\s+file)\b/u.test(taskLower))
	) {
		reasons.push("unsupported_broad_refactor")
	}
	return uniqueStrings(reasons)
}

function formatRepoSupportTierLabel(tier: RepoSupportTier): string {
	switch (tier) {
		case "small_supported":
			return "Small supported repo"
		case "medium_supported":
			return "Medium supported repo"
		case "large_supported_tier_2":
			return "Large repo tier 2 candidate"
		case "large_refused":
			return "Large repo refused"
		case "binary_refused":
			return "Binary/generated-heavy repo refused"
		default:
			return "Repo not ready"
	}
}

function classifyRepoSupportTier(
	metrics: RepoReadinessMetrics,
	runtimeConfig: RuntimeConfig,
	reasonCodes: RepoReadinessReasonCode[],
): RepoSupportTier {
	if (reasonCodes.includes("not_git_repo") || reasonCodes.includes("git_probe_failed") || reasonCodes.includes("artifact_root_not_writable")) {
		return "repo_unready"
	}
	if (reasonCodes.includes("binary_or_generated_dominant")) {
		return "binary_refused"
	}
	if (reasonCodes.includes("repo_file_count_limit_exceeded") || reasonCodes.includes("repo_size_limit_exceeded")) {
		return "large_refused"
	}
	if (reasonCodes.includes("large_repo_tier_2")) {
		return "large_supported_tier_2"
	}
	const smallFileCount = Math.max(40, Math.floor(runtimeConfig.admissionMaxRepoFileCount * 0.2))
	const smallByteCount = Math.max(750_000, Math.floor(runtimeConfig.admissionMaxRepoBytes * 0.2))
	return metrics.fileCount <= smallFileCount && metrics.totalBytes <= smallByteCount ? "small_supported" : "medium_supported"
}

export async function evaluateRepoReadiness(
	workspace: string,
	options: { allowDirty?: boolean; runtimeConfig?: RuntimeConfig } = {},
): Promise<RepoReadinessResult> {
	const runtimeConfig = options.runtimeConfig ?? resolveRuntimeConfig(process.env)
	let decision: AdmissionDecision = "allow"
	const reasonCodes: RepoReadinessReasonCode[] = []
	const details: string[] = []
	const metrics: RepoReadinessMetrics = {
		fileCount: 0,
		totalBytes: 0,
		dirtyEntryCount: 0,
		binaryOrGeneratedFileCount: 0,
		binaryOrGeneratedRatio: 0,
		writableRoot: fs.existsSync(path.join(workspace, ".swarm")) ? path.join(workspace, ".swarm") : workspace,
	}

	const gitProbe = await runGitCapture(workspace, ["rev-parse", "--is-inside-work-tree"])
	if (!gitProbe.ok) {
		reasonCodes.push(gitProbe.error ? "git_probe_failed" : "not_git_repo")
		details.push(gitProbe.error ? `Git probe failed: ${gitProbe.error}` : "Workspace is not a git repository.")
		const supportTier = classifyRepoSupportTier(metrics, runtimeConfig, reasonCodes)
		return {
			decision: "refuse",
			reasonCodes,
			summary: "Workspace is not ready for SwarmCoder V2.",
			details,
			metrics,
			supportTier,
			supportTierLabel: formatRepoSupportTierLabel(supportTier),
		}
	}

	const statusResult = await runGitCapture(workspace, ["status", "--porcelain", "--untracked-files=all"])
	if (!statusResult.ok) {
		reasonCodes.push("git_probe_failed")
		details.push(`Git status failed: ${(statusResult.stderr || statusResult.error || statusResult.stdout).trim()}`)
		const supportTier = classifyRepoSupportTier(metrics, runtimeConfig, reasonCodes)
		return {
			decision: "refuse",
			reasonCodes,
			summary: "Workspace is not ready for SwarmCoder V2.",
			details,
			metrics,
			supportTier,
			supportTierLabel: formatRepoSupportTierLabel(supportTier),
		}
	}

	const dirtyEntries = statusResult.stdout
		.split(/\r?\n/g)
		.map((line) => line.trimEnd())
		.filter(Boolean)
	metrics.dirtyEntryCount = dirtyEntries.length
	if (dirtyEntries.length > 0) {
		if (options.allowDirty) {
			decision = "allow_with_review_bias"
			reasonCodes.push("dirty_workspace_override")
			details.push(`Workspace has ${dirtyEntries.length} uncommitted entries, but --allowDirty is enabled.`)
		} else {
			decision = "refuse"
			reasonCodes.push("dirty_workspace")
			details.push(`Workspace has ${dirtyEntries.length} uncommitted tracked or untracked entries.`)
		}
	}

	const fileResult = await runGitCapture(workspace, ["ls-files", "-co", "--exclude-standard", "-z"])
	if (!fileResult.ok) {
		reasonCodes.push("git_probe_failed")
		details.push(`Git file inventory failed: ${(fileResult.stderr || fileResult.error || fileResult.stdout).trim()}`)
		const supportTier = classifyRepoSupportTier(metrics, runtimeConfig, uniqueStrings(reasonCodes))
		return {
			decision: "refuse",
			reasonCodes: uniqueStrings(reasonCodes),
			summary: "Workspace is not ready for SwarmCoder V2.",
			details,
			metrics,
			supportTier,
			supportTierLabel: formatRepoSupportTierLabel(supportTier),
		}
	}

	const files = splitZeroTerminated(fileResult.stdout)
	metrics.fileCount = files.length
	for (const relPath of files) {
		const absolutePath = path.join(workspace, relPath)
		try {
			const stat = fs.statSync(absolutePath)
			if (!stat.isFile()) continue
			metrics.totalBytes += stat.size
			if (isBinaryOrGenerated(relPath)) {
				metrics.binaryOrGeneratedFileCount += 1
			}
		} catch {
			// Ignore transient file inventory races.
		}
	}
	metrics.binaryOrGeneratedRatio =
		metrics.fileCount > 0 ? metrics.binaryOrGeneratedFileCount / metrics.fileCount : 0

	const exceedsTier1FileCount = metrics.fileCount > runtimeConfig.admissionMaxRepoFileCount
	const exceedsTier1Bytes = metrics.totalBytes > runtimeConfig.admissionMaxRepoBytes
	const exceedsTier2FileCount = metrics.fileCount > runtimeConfig.admissionTier2MaxRepoFileCount
	const exceedsTier2Bytes = metrics.totalBytes > runtimeConfig.admissionTier2MaxRepoBytes

	if (exceedsTier1FileCount || exceedsTier1Bytes) {
		if (exceedsTier2FileCount || exceedsTier2Bytes) {
			decision = "refuse"
			if (exceedsTier2FileCount) {
				reasonCodes.push("repo_file_count_limit_exceeded")
				details.push(
					`Repo has ${metrics.fileCount} files, above the tier 2 limit of ${runtimeConfig.admissionTier2MaxRepoFileCount}.`,
				)
			}
			if (exceedsTier2Bytes) {
				reasonCodes.push("repo_size_limit_exceeded")
				details.push(
					`Repo content totals ${metrics.totalBytes} bytes, above the tier 2 size limit of ${runtimeConfig.admissionTier2MaxRepoBytes}.`,
				)
			}
		} else {
			decision = combineDecision(decision, "allow_with_review_bias")
			reasonCodes.push("large_repo_tier_2")
			details.push(
				`Repo exceeds the tier 1 envelope (${runtimeConfig.admissionMaxRepoFileCount} files / ${runtimeConfig.admissionMaxRepoBytes} bytes) but fits the bounded tier 2 candidate (${runtimeConfig.admissionTier2MaxRepoFileCount} files / ${runtimeConfig.admissionTier2MaxRepoBytes} bytes).`,
			)
			details.push("Tier 2 repos stay review-biased: use explicit file targets, keep verification profiles current, and avoid broad discovery.")
		}
	}

	if (
		metrics.fileCount >= runtimeConfig.admissionBinaryGeneratedMinFileCount &&
		metrics.binaryOrGeneratedRatio >= runtimeConfig.admissionBinaryGeneratedDominanceRatio
	) {
		decision = "refuse"
		reasonCodes.push("binary_or_generated_dominant")
		details.push(
			`Binary/generated files account for ${Math.round(metrics.binaryOrGeneratedRatio * 100)}% of the repo inventory.`,
		)
	}

	try {
		fs.accessSync(metrics.writableRoot, fs.constants.W_OK)
	} catch {
		decision = "refuse"
		reasonCodes.push("artifact_root_not_writable")
		details.push(`Swarm artifact root is not writable: ${metrics.writableRoot}`)
	}

	if (details.length === 0) {
		details.push("Workspace is a git repo, within the supported size envelope, and writable for Swarm artifacts.")
	}
	const supportTier = classifyRepoSupportTier(metrics, runtimeConfig, uniqueStrings(reasonCodes))
	details.push(`Support tier: ${formatRepoSupportTierLabel(supportTier)}.`)
	details.push(
		`Repo metrics: files=${metrics.fileCount}, bytes=${metrics.totalBytes}, dirty=${metrics.dirtyEntryCount}, binary/generated=${metrics.binaryOrGeneratedFileCount}`,
	)

	return {
		decision,
		reasonCodes: uniqueStrings(reasonCodes),
		summary:
			decision === "allow"
				? "Workspace is ready for SwarmCoder V2."
				: decision === "allow_with_review_bias"
					? "Workspace is usable, but it should proceed with review bias."
					: "Workspace is not ready for SwarmCoder V2.",
		details,
		metrics,
		supportTier,
		supportTierLabel: formatRepoSupportTierLabel(supportTier),
	}
}

export function evaluateTaskAdmission(
	task: string,
	workspace: string,
	options: { runtimeConfig?: RuntimeConfig } = {},
): TaskAdmissionResult {
	const runtimeConfig = options.runtimeConfig ?? resolveRuntimeConfig(process.env)
	const maxSemiOpenFiles = Math.min(4, runtimeConfig.admissionMaxScopedFileCount)
	const mediumLaneMinFiles = 6
	const normalizedTask = task.trim()
	const taskLower = normalizedTask.toLowerCase()
	const targetFiles = extractTaskFileRefs(normalizedTask)
	const workspaceFiles = listWorkspaceFilesForDiscovery(workspace)
	const semiOpen = discoverSemiOpenTask(normalizedTask, workspace, workspaceFiles, { maxFiles: maxSemiOpenFiles })
	const verificationDemand = detectVerificationDemand(taskLower)
	const loadedVerificationProfile = loadRepoVerificationProfile(workspace, { runtimeConfig })
	const verificationProfilesFound = loadedVerificationProfile.profile ? [loadedVerificationProfile.profile.name] : []
	const unsupportedReasons = evaluateUnsupportedTask(taskLower, targetFiles)
	let decision: AdmissionDecision = "allow"
	const reasonCodes: TaskAdmissionReasonCode[] = []
	const details: string[] = []
	let derivedTaskContract: TaskContract | null = null

	if (semiOpen.match) {
		derivedTaskContract = semiOpen.match.taskContract
	} else if (targetFiles.length > 0 && targetFiles.length <= runtimeConfig.admissionMaxScopedFileCount) {
		derivedTaskContract = buildScopedTaskContract(targetFiles)
	}

	const renameIntent = extractRenameSymbolIntent(normalizedTask)
	if (renameIntent && derivedTaskContract) {
		const relatedFiles = derivedTaskContract.scope?.allowedFiles ?? []
		const anchorFile = relatedFiles[0] ?? targetFiles[0] ?? null
		const anchorSymbolPresent = detectAnchorSymbolPresence(workspace, anchorFile, renameIntent.sourceSymbol)
		derivedTaskContract = {
			...derivedTaskContract,
			refactorIntent: {
				kind: "rename_symbol",
				sourceSymbol: renameIntent.sourceSymbol,
				targetSymbol: renameIntent.targetSymbol,
				anchorFile,
				relatedFiles,
				languagePackId: detectRefactorLanguagePackId(anchorFile),
				anchorSymbolPresent,
			},
		}
	}

	if (targetFiles.length > runtimeConfig.admissionMaxScopedFileCount) {
		decision = "refuse"
		reasonCodes.push("too_many_target_files")
		details.push(
			`Task names ${targetFiles.length} files, above the supported scoped limit of ${runtimeConfig.admissionMaxScopedFileCount}.`,
		)
	}

	for (const reason of unsupportedReasons) {
		decision = "refuse"
		reasonCodes.push(reason)
	}
	if (unsupportedReasons.includes("unsupported_task_verb")) {
		details.push("Task requests install, migration, or dependency-changing work that V2 does not admit yet.")
	}
	if (unsupportedReasons.includes("unsupported_broad_refactor")) {
		details.push(
			`Broad refactors without an explicit 1-${runtimeConfig.admissionMaxScopedFileCount} file scope are out of bounds for the proven lane.`,
		)
	}

	if (loadedVerificationProfile.issue) {
		details.push(loadedVerificationProfile.issue)
	}

	if (verificationDemand && !loadedVerificationProfile.profile) {
		decision = "refuse"
		reasonCodes.push("missing_verification_profile")
		details.push(
			`Task requires ${verificationDemand.label}, but the workspace does not declare a verification profile in .swarmcoder.json yet.`,
		)
	}

	if (decision !== "refuse") {
		if (semiOpen.refusal) {
			decision = "refuse"
			reasonCodes.push(semiOpen.refusal.code === "too_many_discovered_files" ? "too_many_target_files" : "ambiguous_task_scope")
			details.push(semiOpen.refusal.summary)
			details.push(...semiOpen.refusal.details)
		} else if (semiOpen.match) {
			decision = "allow_with_review_bias"
			reasonCodes.push("semi_open_task")
			details.push(semiOpen.match.summary)
			details.push(...semiOpen.match.details)
		} else if (targetFiles.length >= mediumLaneMinFiles) {
			decision = "allow_with_review_bias"
			reasonCodes.push("medium_bounded_task")
			details.push(
				`Task explicitly names ${targetFiles.length} files and stays within the supported medium bounded lane (6-${runtimeConfig.admissionMaxScopedFileCount} files).`,
			)
			details.push("Critic review, bounded retry evidence, and checkpoint-aware artifact truth remain mandatory before completion.")
		} else if (targetFiles.length >= 2) {
			decision = "allow_with_review_bias"
			reasonCodes.push("scoped_multi_file_task")
			details.push(`Task is explicitly scoped to ${targetFiles.length} files and stays within the bounded coordinated lane.`)
		} else if (targetFiles.length === 1 && matchesSafeTaskTemplate(normalizedTask)) {
			details.push(`Task matches the safe single-file template for ${targetFiles[0]}.`)
		} else if (targetFiles.length === 1) {
			decision = "allow_with_review_bias"
			reasonCodes.push("outside_safe_task_template")
			details.push(`Task names ${targetFiles[0]} but falls outside the narrow safe task template, so it should land with review bias.`)
		} else {
			decision = "refuse"
			reasonCodes.push("ambiguous_task_scope")
			details.push("Task does not name files and does not fit a supported semi-open task class.")
		}
	}

	if (verificationProfilesFound.length > 0) {
		details.push(`Verification profile found: ${verificationProfilesFound.join(", ")}`)
	}
	if (derivedTaskContract?.refactorIntent) {
		const refactorIntent = derivedTaskContract.refactorIntent
		details.push(
			`Refactor intent: rename ${refactorIntent.sourceSymbol} -> ${refactorIntent.targetSymbol} across ${refactorIntent.relatedFiles.join(", ") || "(no related files)"}.`,
		)
		if (refactorIntent.anchorFile) {
			details.push(
				refactorIntent.anchorSymbolPresent === false
					? `Anchor symbol ${refactorIntent.sourceSymbol} was not found in ${refactorIntent.anchorFile}; keep review bias and verify the bounded rename evidence carefully.`
					: `Anchor rename evidence is tied to ${refactorIntent.anchorFile}.`,
			)
		}
	}

	return {
		decision,
		reasonCodes: uniqueStrings(reasonCodes),
		summary:
			decision === "allow"
				? "Task is inside the proven admission lane."
				: decision === "allow_with_review_bias"
					? "Task is admissible, but it should proceed with review bias."
					: "Task is outside the current proven admission lane.",
		details,
		targetFiles,
		derivedTaskContract,
		verificationProfile: loadedVerificationProfile.profile?.name ?? null,
		verificationProfilesFound,
	}
}

export async function evaluateAdmission(input: AdmissionInput): Promise<AdmissionReport> {
	const runtimeConfig = input.runtimeConfig ?? resolveRuntimeConfig(process.env)
	const repo = await evaluateRepoReadiness(input.workspace, {
		allowDirty: input.allowDirty,
		runtimeConfig,
	})
	const task = evaluateTaskAdmission(input.task, input.workspace, { runtimeConfig })
	const decision = combineDecision(repo.decision, task.decision)
	return {
		decision,
		summary:
			decision === "allow"
				? "Admission decision: ALLOW"
				: decision === "allow_with_review_bias"
					? "Admission decision: ALLOW WITH REVIEW BIAS"
					: "Admission decision: REFUSE",
		reasonCodes: uniqueStrings([...repo.reasonCodes, ...task.reasonCodes]),
		repo,
		task,
	}
}

export function formatAdmissionReport(report: AdmissionReport): string {
	const lines = [
		`Admission decision: ${formatDecisionLabel(report.decision)}`,
		`Repo readiness: ${formatDecisionLabel(report.repo.decision)}`,
		`Repo support tier: ${report.repo.supportTierLabel}`,
		`Task admission: ${formatDecisionLabel(report.task.decision)}`,
	]

	if (report.reasonCodes.length > 0) {
		lines.push("Reason codes:")
		lines.push(...report.reasonCodes.map((reason) => `- ${reason}`))
	}

	lines.push("Repo details:")
	lines.push(...report.repo.details.map((detail) => `- ${detail}`))
	lines.push("Task details:")
	lines.push(...report.task.details.map((detail) => `- ${detail}`))

	if (report.task.targetFiles.length > 0) {
		lines.push(`Target files: ${report.task.targetFiles.join(", ")}`)
	}

	if (report.task.derivedTaskContract) {
		lines.push("Derived task contract:")
		lines.push(JSON.stringify(report.task.derivedTaskContract, null, 2))
	}

	return lines.join("\n")
}
