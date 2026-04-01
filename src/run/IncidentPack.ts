import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { normalizeMergeOrderArtifact, type MergeOrderArtifact } from "../planning/MergeOrder"
import { formatQueenshiftWorkspaceCommand } from "../cli/CommandSurface"
import { buildFixRedLaneSuggestion, classifyFailureTaxonomy } from "./FailureTaxonomy"
import { createFailureNarrative, formatFailureNarrative, type FailureNarrative } from "./FailureNarrative"
import { classifyStopReason } from "./Forensics"
import { resolveOwnedWorktreeBase } from "./RecoveryManager"
import { buildSupportIssueIntake, type SupportIssueIntake } from "./SupportIssueIntake"
import {
	discardReviewRun,
	ensureReviewPack,
	type ReviewActionResult,
	type ReviewPack,
} from "./ReviewQueue"
import {
	listRunDirs,
	readRunSummary,
	resolveIncidentPackPath,
	resolveRunDir,
	resolveRunSummaryPath,
	updateRunSummary,
	writeIncidentPack,
} from "./RunArtifacts"

type ReviewDecision = "pending" | "approved" | "discarded"

type IncidentCleanupStatus = "pending" | "applied" | "not_needed" | "refused"

type IncidentMergeNegotiation = {
	status: MergeOrderArtifact["status"]
	mode: MergeOrderArtifact["negotiation"]["mode"]
	approvalBranch: string | null
	sourceBranches: string[]
	conflictReview: string[]
	blockers: string[]
	summary: string
}

type IncidentCleanupRecord = {
	action: "discard_review" | "rollback_owned_state" | "inspect_only"
	status: IncidentCleanupStatus
	message: string
	performedAt: string | null
	deletedBranches: string[]
	removedWorktrees: string[]
	removedTmpEntries: string[]
	ambiguousOwnershipReasons: string[]
}

type IncidentSummary = {
	taskId: string
	task: string
	workspace: string
	status: string
	stopReason: string
	message: string
	pathChosen: string | null
	taskContract: Record<string, unknown> | null
	acceptanceGate: Record<string, unknown> | null
	verificationProfile: Record<string, unknown> | null
	reviewerVerdict: string | null
	changedFiles: string[]
	createdFiles: string[]
	git: {
		baseRef: string
		branches: string[]
	}
	mergeOrder: MergeOrderArtifact | null
	review: {
		decision: ReviewDecision
		primaryBranch: string | null
		branchNames: string[]
		ownedWorktreeDir: string | null
		mainWorkspaceTouched: boolean
	} | null
	recovery: Record<string, unknown> | null
	incident: {
		cleanup: IncidentCleanupRecord | null
	} | null
}

export type IncidentPack = {
	runId: string
	task: string
	workspace: string
	status: string
	stopReason: string
	failureBucket: string
	nextPlaceToLook: string
	message: string
	pathChosen: string | null
	taskContract: Record<string, unknown> | null
	reviewerVerdict: string | null
	acceptanceGate: Record<string, unknown> | null
	verificationProfile: Record<string, unknown> | null
	changedFiles: string[]
	createdFiles: string[]
	diffStat: string
	diffPreviewExcerpt: string
	cleanupOwnership: {
		ownedBranchNames: string[]
		primaryBranch: string | null
		ownedWorktreeDir: string | null
		mainWorkspaceTouched: boolean
		recoveryInventory: {
			orphanedWorktrees: string[]
			orphanedSwarmBranches: string[]
			staleTmpEntries: string[]
			incompleteRunArtifacts: string[]
		}
		ambiguousOwnership: boolean
		ambiguousOwnershipReasons: string[]
	}
	mergeNegotiation: IncidentMergeNegotiation | null
	failureNarrative?: FailureNarrative | null
	operatorAudit: {
		requiredApprovals: number
		approvedBy: string[]
		pendingReviewers: string[]
		history: Array<{
			action: string
			recordedAt: string
			actor: string | null
			approvedBy: string[]
		}>
		finalDecisionBy: string | null
	} | null
	latestCleanup: IncidentCleanupRecord | null
	recoveryAction: {
		kind: "discard_review" | "rollback_owned_state" | "inspect_only"
		label: string
		command: string | null
		rationale: string
	}
	nextAction: {
		label: string
		rationale: string
	}
	redLaneHint: {
		recommended: boolean
		rationale: string
		templatePath: string
		suggestedFileName: string
		firstInvariantAtRisk: string
		nearbyProofCommands: string[]
		stageCommand: string
		scaffold: string
	}
	supportIssueIntake: SupportIssueIntake
	artifacts: {
		summaryPath: string
		reviewPackPath: string | null
		incidentPackPath: string
	}
}

export type IncidentRollbackResult = {
	runId: string
	decision: "discarded_review" | "rolled_back" | "not_needed" | "refused"
	message: string
	summaryPath: string
	incidentPackPath: string
	deletedBranches: string[]
	removedWorktrees: string[]
	removedTmpEntries: string[]
}

export type IncidentExportResult = {
	found: boolean
	runId: string | null
	incidentPackPath: string | null
	incident: IncidentPack | null
	error: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function selectPrimaryBranch(branches: string[]): string | null {
	if (branches.length === 0) return null
	return branches.find((branch) => /\/integration$/u.test(branch)) ?? branches[branches.length - 1] ?? null
}

function normalizeSummary(summary: Record<string, unknown> | null, runDir: string): IncidentSummary | null {
	if (!summary) return null
	const git = asRecord(summary["git"])
	const review = asRecord(summary["review"])
	const incident = asRecord(summary["incident"])
	const cleanup = asRecord(incident?.["cleanup"])
	const gitBranches = asStringArray(git?.["branches"])
	const reviewBranchNames = asStringArray(review?.["branchNames"])
	const taskId = asString(summary["taskId"], path.basename(runDir))
	const mergeOrder = normalizeMergeOrderArtifact(taskId, summary["mergeOrder"])
	return {
		taskId,
		task: asString(summary["task"]),
		workspace: asString(summary["workspace"]),
		status: asString(summary["status"]),
		stopReason: asString(summary["stopReason"]),
		message: asString(summary["message"]),
		pathChosen: asString(summary["pathChosen"]) || null,
		taskContract: asRecord(summary["taskContract"]),
		acceptanceGate: asRecord(summary["acceptanceGate"]),
		verificationProfile: asRecord(summary["verificationProfile"]),
		reviewerVerdict: asString(summary["reviewerVerdict"]) || null,
		changedFiles: asStringArray(summary["changedFiles"]),
		createdFiles: asStringArray(summary["createdFiles"]),
		git: {
			baseRef: asString(git?.["baseRef"], "HEAD"),
			branches: gitBranches,
		},
		mergeOrder,
		review: review
			? {
					decision: (asString(review["decision"], "pending") as ReviewDecision) ?? "pending",
					primaryBranch: asString(review["primaryBranch"]) || selectPrimaryBranch(reviewBranchNames.length > 0 ? reviewBranchNames : gitBranches),
					branchNames: reviewBranchNames.length > 0 ? reviewBranchNames : gitBranches,
					ownedWorktreeDir: asString(review["ownedWorktreeDir"]) || null,
					mainWorkspaceTouched: review["mainWorkspaceTouched"] === true,
			  }
			: null,
		recovery: asRecord(summary["recovery"]),
		incident: incident
			? {
					cleanup: cleanup
						? {
								action:
									(asString(cleanup["action"], "inspect_only") as IncidentCleanupRecord["action"]) ?? "inspect_only",
								status:
									(asString(cleanup["status"], "pending") as IncidentCleanupStatus) ?? "pending",
								message: asString(cleanup["message"]),
								performedAt: asString(cleanup["performedAt"]) || null,
								deletedBranches: asStringArray(cleanup["deletedBranches"]),
								removedWorktrees: asStringArray(cleanup["removedWorktrees"]),
								removedTmpEntries: asStringArray(cleanup["removedTmpEntries"]),
								ambiguousOwnershipReasons: asStringArray(cleanup["ambiguousOwnershipReasons"]),
						  }
						: null,
			  }
			: null,
	}
}

function getRecoveryInventory(summary: IncidentSummary): IncidentPack["cleanupOwnership"]["recoveryInventory"] {
	const recovery = summary.recovery
	return {
		orphanedWorktrees: asStringArray(recovery?.["orphanedWorktrees"]),
		orphanedSwarmBranches: asStringArray(recovery?.["orphanedSwarmBranches"]),
		staleTmpEntries: asStringArray(recovery?.["staleTmpEntries"]),
		incompleteRunArtifacts: asStringArray(recovery?.["incompleteRunArtifacts"]),
	}
}

function buildCleanupOwnership(summary: IncidentSummary): IncidentPack["cleanupOwnership"] {
	const ownedBranchNames = summary.review?.branchNames.length ? summary.review.branchNames : summary.git.branches
	const primaryBranch = summary.review?.primaryBranch ?? selectPrimaryBranch(ownedBranchNames)
	const ownedWorktreeDir = summary.review?.ownedWorktreeDir ?? null
	const ambiguousOwnershipReasons: string[] = []
	const ownedWorktreeBase = resolveOwnedWorktreeBase(summary.workspace)
	const tmpDir = path.join(summary.workspace, ".swarm", "tmp")
	const recoveryInventory = getRecoveryInventory(summary)

	if (summary.review?.mainWorkspaceTouched === true) {
		ambiguousOwnershipReasons.push("Main workspace was already touched by this incident.")
	}

	for (const branch of ownedBranchNames) {
		if (!branch.startsWith("swarm/")) {
			ambiguousOwnershipReasons.push(`Recorded branch is not V2-owned: ${branch}`)
		}
	}

	if (ownedWorktreeDir) {
		const resolvedWorktreeDir = path.resolve(ownedWorktreeDir)
		if (!resolvedWorktreeDir.startsWith(path.resolve(ownedWorktreeBase))) {
			ambiguousOwnershipReasons.push(`Recorded worktree is outside the V2-owned base: ${ownedWorktreeDir}`)
		}
	}

	for (const tmpEntry of recoveryInventory.staleTmpEntries) {
		if (!path.resolve(tmpEntry).startsWith(path.resolve(tmpDir))) {
			ambiguousOwnershipReasons.push(`Recorded tmp entry is outside workspace .swarm/tmp: ${tmpEntry}`)
		}
	}

	return {
		ownedBranchNames,
		primaryBranch,
		ownedWorktreeDir,
		mainWorkspaceTouched: summary.review?.mainWorkspaceTouched === true,
		recoveryInventory,
		ambiguousOwnership: ambiguousOwnershipReasons.length > 0,
		ambiguousOwnershipReasons,
	}
}

function summarizeMergeNegotiation(summary: IncidentSummary): IncidentMergeNegotiation | null {
	if (!summary.mergeOrder) return null
	return {
		status: summary.mergeOrder.status,
		mode: summary.mergeOrder.negotiation.mode,
		approvalBranch: summary.mergeOrder.negotiation.approvalBranch,
		sourceBranches: [...summary.mergeOrder.negotiation.sourceBranches],
		conflictReview: [...summary.mergeOrder.negotiation.conflictReview],
		blockers: [...summary.mergeOrder.blockers],
		summary: summary.mergeOrder.negotiation.summary,
	}
}

async function runGitCapture(
	repoPath: string,
	args: string[],
	options: { timeoutMs?: number; maxOutputChars?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
	const timeoutMs = options.timeoutMs ?? 30_000
	const maxOutputChars = options.maxOutputChars ?? 160_000
	const swarmTmpDir = path.join(repoPath, ".swarm", "tmp")
	fs.mkdirSync(swarmTmpDir, { recursive: true })
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(swarmTmpDir, `incident-${stamp}.stdout.log`)
	const stderrPath = path.join(swarmTmpDir, `incident-${stamp}.stderr.log`)
	const stdoutFd = fs.openSync(stdoutPath, "w")
	const stderrFd = fs.openSync(stderrPath, "w")

	const readTail = (filePath: string): string => {
		try {
			const raw = fs.readFileSync(filePath, "utf8")
			return raw.length <= maxOutputChars ? raw : raw.slice(-maxOutputChars)
		} catch {
			return ""
		}
	}

	try {
		const code = await new Promise<number | null>((resolve, reject) => {
			const child = spawn("git", ["-c", `safe.directory=${repoPath}`, ...args], {
				cwd: repoPath,
				windowsHide: true,
				stdio: ["ignore", stdoutFd, stderrFd],
			})

			const timeout = setTimeout(() => {
				if (process.platform === "win32" && child.pid) {
					try {
						spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
					} catch {
						// ignore timeout cleanup failures
					}
					return
				}
				try {
					child.kill("SIGTERM")
				} catch {
					// ignore timeout cleanup failures
				}
			}, timeoutMs)
			timeout.unref?.()

			child.once("error", (err) => {
				clearTimeout(timeout)
				reject(err)
			})
			child.once("close", (exitCode) => {
				clearTimeout(timeout)
				resolve(typeof exitCode === "number" ? exitCode : null)
			})
		})

		const stdout = readTail(stdoutPath)
		const stderr = readTail(stderrPath)
		if (code !== 0) {
			throw new Error(`git ${args.join(" ")} failed (exit ${code ?? "null"})\n${stderr || stdout}`.trim())
		}
		return { stdout, stderr }
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
	}
}

async function runGit(repoPath: string, args: string[]): Promise<void> {
	await runGitCapture(repoPath, args)
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
	try {
		await runGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
		return true
	} catch {
		return false
	}
}

function truncateDiffPreview(value: string): string {
	if (!value.trim()) return ""
	const lines = value.trim().split(/\r?\n/g).slice(0, 120)
	const preview = lines.join("\n")
	return preview.length <= 12_000 ? preview : `${preview.slice(0, 12_000)}\n...`
}

async function buildDiffEvidence(
	summary: IncidentSummary,
	cleanupOwnership: IncidentPack["cleanupOwnership"],
	reviewPack: ReviewPack | null,
): Promise<{ diffStat: string; diffPreviewExcerpt: string }> {
	if (reviewPack) {
		return {
			diffStat: reviewPack.diffStat,
			diffPreviewExcerpt: truncateDiffPreview(reviewPack.diffPreview),
		}
	}

	const primaryBranch = cleanupOwnership.primaryBranch
	if (!primaryBranch) {
		return {
			diffStat: "(diff stat unavailable)",
			diffPreviewExcerpt: "(diff preview unavailable)",
		}
	}
	if (!(await branchExists(summary.workspace, primaryBranch))) {
		return {
			diffStat: "(diff stat unavailable)",
			diffPreviewExcerpt: "(primary incident branch is no longer present)",
		}
	}

	try {
		const diffStat = (
			await runGitCapture(summary.workspace, ["diff", "--stat", `${summary.git.baseRef}..${primaryBranch}`], {
				timeoutMs: 20_000,
				maxOutputChars: 60_000,
			})
		).stdout.trim()
		const diffPreview = (
			await runGitCapture(summary.workspace, ["diff", `${summary.git.baseRef}..${primaryBranch}`], {
				timeoutMs: 20_000,
				maxOutputChars: 120_000,
			})
		).stdout.trim()
		return {
			diffStat: diffStat || "(diff stat unavailable)",
			diffPreviewExcerpt: truncateDiffPreview(diffPreview) || "(diff preview unavailable)",
		}
	} catch (err) {
		return {
			diffStat: "(diff stat unavailable)",
			diffPreviewExcerpt: `(diff preview unavailable) ${err instanceof Error ? err.message : String(err)}`,
		}
	}
}

function formatCliCommand(command: string, workspace: string, runId?: string): string {
	const parts = [command]
	if (runId) parts.push(runId)
	return formatQueenshiftWorkspaceCommand(parts, workspace)
}

function buildRecoveryAction(
	summary: IncidentSummary,
	cleanupOwnership: IncidentPack["cleanupOwnership"],
	reviewPack: ReviewPack | null,
): IncidentPack["recoveryAction"] {
	const runId = summary.taskId
	if (cleanupOwnership.ambiguousOwnership) {
		return {
			kind: "inspect_only",
			label: "Rollback refused: ownership is ambiguous",
			command: formatCliCommand("incident:show", summary.workspace, runId),
			rationale: "V2 could not prove it owns every cleanup target recorded for this incident.",
		}
	}

	if (summary.status === "review_required" && summary.review?.decision === "pending") {
		const label = reviewPack?.review.canApprove
			? "Inspect or discard the isolated review candidate"
			: "Discard the isolated review candidate"
		return {
			kind: "discard_review",
			label,
			command: formatCliCommand("incident:rollback", summary.workspace, runId),
			rationale: "This run preserved an isolated review candidate; rollback will discard only that V2-owned state.",
		}
	}

	const hasOwnedCleanupTargets =
		cleanupOwnership.ownedBranchNames.length > 0 ||
		Boolean(cleanupOwnership.ownedWorktreeDir) ||
		cleanupOwnership.recoveryInventory.staleTmpEntries.length > 0
	if (hasOwnedCleanupTargets) {
		return {
			kind: "rollback_owned_state",
			label: "Rollback V2-owned leftover state",
			command: formatCliCommand("incident:rollback", summary.workspace, runId),
			rationale: "This incident still references V2-owned branches, worktrees, or temp entries that can be cleaned safely.",
		}
	}

	return {
		kind: "inspect_only",
		label: "No rollback needed",
		command: formatCliCommand("incident:show", summary.workspace, runId),
		rationale: "No V2-owned cleanup target is still recorded for this incident.",
	}
}

function buildRedLaneHint(
	summary: IncidentSummary,
	cleanupOwnership: IncidentPack["cleanupOwnership"],
	reviewPack: ReviewPack | null,
): Pick<IncidentPack["redLaneHint"], "recommended" | "rationale"> {
	if (cleanupOwnership.ambiguousOwnership) {
		return {
			recommended: true,
			rationale: "Rollback could not prove ownership, so the next coding session should be a FixRedLane session instead of new roadmap work.",
		}
	}

	if (summary.status === "failed") {
		return {
			recommended: true,
			rationale: "A failed run is a red lane. Restore the lane before continuing to the next numbered roadmap session.",
		}
	}

	if (summary.status === "review_required") {
		if (reviewPack?.review.canApprove === true) {
			return {
				recommended: false,
				rationale: "Resolve this pending review item first. Do not continue the roadmap until the owner approves or discards it.",
			}
		}
		return {
			recommended: true,
			rationale: "This review-required incident is not safely approvable, so the next coding session should use FixRedLane instead of advancing the roadmap.",
		}
	}

	return {
		recommended: false,
		rationale: "No red-lane fix is currently indicated.",
	}
}

function buildNextAction(
	summary: IncidentSummary,
	recoveryAction: IncidentPack["recoveryAction"],
	redLaneHint: Pick<IncidentPack["redLaneHint"], "recommended" | "rationale">,
	reviewPack: ReviewPack | null,
	failureBucket: string,
	mergeNegotiation: IncidentMergeNegotiation | null,
): IncidentPack["nextAction"] {
	if (summary.status === "review_required" && reviewPack?.review.canApprove === true) {
		return {
			label: "approve now",
			rationale: "The run stopped for human review, and the review pack still says approval is safe.",
		}
	}

	if (mergeNegotiation?.status === "blocked") {
		return {
			label: "stop and fix red lane",
			rationale: mergeNegotiation.summary,
		}
	}

	if (failureBucket === "provider/config failure") {
		return {
			label: "investigate provider/auth setup",
			rationale: "The first useful step is to fix provider configuration before retrying the same task.",
		}
	}

	if (redLaneHint.recommended) {
		return {
			label: "stop and fix red lane",
			rationale: redLaneHint.rationale,
		}
	}

	if (recoveryAction.kind === "discard_review") {
		return {
			label: "discard and retry with narrower scope",
			rationale: recoveryAction.rationale,
		}
	}

	if (recoveryAction.kind === "rollback_owned_state") {
		return {
			label: "rollback owned state before retrying",
			rationale: recoveryAction.rationale,
		}
	}

	return {
		label: "inspect the incident pack before retrying",
		rationale: recoveryAction.rationale,
	}
}

async function loadSummary(workspace: string, runId: string): Promise<{ runDir: string; summary: IncidentSummary }> {
	const runDir = resolveRunDir(workspace, runId)
	const normalized = normalizeSummary(readRunSummary(runDir), runDir)
	if (!normalized) throw new Error(`No summary.json found for run ${runId}`)
	return { runDir, summary: normalized }
}

export function findLatestIncidentRunId(workspace: string): string | null {
	const candidates = listRunDirs(workspace)
		.map((runDir) => {
			const summaryPath = resolveRunSummaryPath(runDir)
			const summary = normalizeSummary(readRunSummary(runDir), runDir)
			if (!summary || summary.status === "done" || !fs.existsSync(summaryPath)) return null
			return {
				runId: summary.taskId,
				mtimeMs: fs.statSync(summaryPath).mtimeMs,
			}
		})
		.filter((entry): entry is { runId: string; mtimeMs: number } => entry !== null)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)

	return candidates[0]?.runId ?? null
}

function buildMissingIncidentExport(
	runId: string | null,
	incidentPackPath: string | null,
	error: string,
): IncidentExportResult {
	return {
		found: false,
		runId,
		incidentPackPath,
		incident: null,
		error,
	}
}

export async function resolveIncidentExport(
	workspace: string,
	requestedRunId: string | "latest" = "latest",
): Promise<IncidentExportResult> {
	const normalizedRunId = requestedRunId === "latest" ? "latest" : requestedRunId.trim()
	if (!normalizedRunId) {
		return buildMissingIncidentExport(null, null, "Incident run id is required.")
	}

	const runId = normalizedRunId === "latest" ? findLatestIncidentRunId(workspace) : normalizedRunId
	if (!runId) {
		return buildMissingIncidentExport(null, null, "No non-success incident run was found for this workspace.")
	}

	const runDir = resolveRunDir(workspace, runId)
	const summaryPath = resolveRunSummaryPath(runDir)
	const incidentPackPath = resolveIncidentPackPath(runDir)
	if (!fs.existsSync(summaryPath)) {
		return buildMissingIncidentExport(runId, incidentPackPath, `No summary.json was found for run ${runId}.`)
	}

	const summary = normalizeSummary(readRunSummary(runDir), runDir)
	if (!summary) {
		return buildMissingIncidentExport(runId, incidentPackPath, `No summary.json was found for run ${runId}.`)
	}
	if (summary.status === "done") {
		return buildMissingIncidentExport(runId, incidentPackPath, `Run ${runId} completed successfully; no incident pack is needed.`)
	}

	try {
		const incident = await ensureIncidentPack(workspace, runId)
		return {
			found: true,
			runId,
			incidentPackPath: incident.artifacts.incidentPackPath,
			incident,
			error: null,
		}
	} catch (err) {
		return buildMissingIncidentExport(runId, incidentPackPath, err instanceof Error ? err.message : String(err))
	}
}

export async function ensureIncidentPack(workspace: string, runIdOrLatest?: string): Promise<IncidentPack> {
	const runId = !runIdOrLatest || runIdOrLatest === "latest" ? findLatestIncidentRunId(workspace) : runIdOrLatest
	if (!runId) throw new Error("No non-success incident run was found for this workspace.")

	const { runDir, summary } = await loadSummary(workspace, runId)
	if (summary.status === "done") {
		throw new Error(`Run ${runId} completed successfully; no incident pack is needed.`)
	}

	const cleanupOwnership = buildCleanupOwnership(summary)
	const mergeNegotiation = summarizeMergeNegotiation(summary)
	const reviewPack =
		summary.status === "review_required" && summary.review?.branchNames.length
			? await ensureReviewPack(workspace, runId)
			: null
	const diffEvidence = await buildDiffEvidence(summary, cleanupOwnership, reviewPack)
	const diagnosis = classifyStopReason(summary.stopReason)
	const taxonomy = classifyFailureTaxonomy({
		status: summary.status,
		stopReason: summary.stopReason,
		failureBucket: diagnosis.bucket,
		hasReviewPack: Boolean(reviewPack),
	})
	const recoveryAction = buildRecoveryAction(summary, cleanupOwnership, reviewPack)
	const redLaneDecision = buildRedLaneHint(summary, cleanupOwnership, reviewPack)
	const nextAction = buildNextAction(summary, recoveryAction, redLaneDecision, reviewPack, diagnosis.bucket, mergeNegotiation)
	const incidentPackPath = resolveIncidentPackPath(runDir)
	const redLaneSuggestion = buildFixRedLaneSuggestion({
		runId,
		taxonomy,
		summaryPath: resolveRunSummaryPath(runDir),
		incidentPackPath,
		reviewPackPath: reviewPack?.reviewPackPath ?? null,
		stopReason: summary.stopReason,
		failureBucket: diagnosis.bucket,
		rationale: redLaneDecision.rationale,
		nextActionLabel: nextAction.label,
	})
	const redLaneHint: IncidentPack["redLaneHint"] = {
		recommended: redLaneDecision.recommended,
		rationale: redLaneDecision.rationale,
		templatePath: redLaneSuggestion.templatePath,
		suggestedFileName: redLaneSuggestion.suggestedFileName,
		firstInvariantAtRisk: redLaneSuggestion.firstInvariantAtRisk,
		nearbyProofCommands: redLaneSuggestion.nearbyProofCommands,
		stageCommand: redLaneSuggestion.stageCommand,
		scaffold: redLaneSuggestion.scaffold,
	}
	const supportIssueIntake = buildSupportIssueIntake({
		runId,
		task: summary.task,
		workspace: summary.workspace,
		status: summary.status,
		failureBucket: diagnosis.bucket,
		stopReason: summary.stopReason,
		pathChosen: summary.pathChosen,
		reviewerVerdict: summary.reviewerVerdict,
		summaryPath: resolveRunSummaryPath(runDir),
		incidentPackPath,
		reviewPackPath: reviewPack?.reviewPackPath ?? null,
	})
	const safestNextStep =
		nextAction.label === "approve now"
			? `${nextAction.label} -> ${formatCliCommand("review:approve", summary.workspace, runId)}`
			: nextAction.label === "stop and fix red lane"
				? `${nextAction.label} -> ${redLaneSuggestion.stageCommand}`
				: nextAction.label === recoveryAction.label && recoveryAction.command
					? `${nextAction.label} -> ${recoveryAction.command}`
					: nextAction.label
	const failureNarrative = createFailureNarrative({
		whatFailed: `${taxonomy.label} (${summary.stopReason})`,
		whyItStopped: mergeNegotiation?.summary ?? taxonomy.defaultRationale,
		safestNextStep,
		recoveryFooting: recoveryAction.rationale,
		authoritativeArtifacts: [resolveRunSummaryPath(runDir), reviewPack?.reviewPackPath ?? null, incidentPackPath],
	})
	const pack: IncidentPack = {
		runId,
		task: summary.task,
		workspace: summary.workspace,
		status: summary.status,
		stopReason: summary.stopReason,
		failureBucket: diagnosis.bucket,
		nextPlaceToLook: diagnosis.nextPlaceToLook,
		message: summary.message,
		pathChosen: summary.pathChosen,
		taskContract: summary.taskContract,
		reviewerVerdict: summary.reviewerVerdict,
		acceptanceGate: summary.acceptanceGate,
		verificationProfile: summary.verificationProfile,
		changedFiles: summary.changedFiles,
		createdFiles: summary.createdFiles,
		diffStat: diffEvidence.diffStat,
		diffPreviewExcerpt: diffEvidence.diffPreviewExcerpt,
		cleanupOwnership,
		mergeNegotiation,
		failureNarrative,
		operatorAudit: reviewPack
			? {
					requiredApprovals: reviewPack.review.requiredApprovals,
					approvedBy: [...reviewPack.review.approvedBy],
					pendingReviewers: [...reviewPack.audit.pendingReviewers],
					history: reviewPack.audit.history.map((entry) => ({
						action: entry.action,
						recordedAt: entry.recordedAt,
						actor: entry.actor,
						approvedBy: [...entry.approvedBy],
					})),
					finalDecisionBy: reviewPack.review.decisionBy,
			  }
			: null,
		latestCleanup: summary.incident?.cleanup ?? null,
		recoveryAction,
		redLaneHint,
		nextAction,
		supportIssueIntake,
		artifacts: {
			summaryPath: resolveRunSummaryPath(runDir),
			reviewPackPath: reviewPack?.reviewPackPath ?? null,
			incidentPackPath,
		},
	}
	writeIncidentPack(runDir, pack)
	return pack
}

export function formatIncidentExport(result: IncidentExportResult): string {
	if (result.found && result.incident) return formatIncidentPack(result.incident)
	return [
		"Incident export: NONE",
		`Run: ${result.runId ?? "(none)"}`,
		`Incident pack: ${result.incidentPackPath ?? "(missing)"}`,
		`Error: ${result.error ?? "No incident pack is currently recorded."}`,
		"Exit code 2 means no incident artifact is currently recorded or the run still needs a different owner action first.",
	].join("\n")
}

function formatAcceptanceGate(pack: IncidentPack): string {
	if (!pack.acceptanceGate) return "not recorded"
	const passed = pack.acceptanceGate["passed"] === true
	const failedChecks = asStringArray(pack.acceptanceGate["failedChecks"])
	if (passed) return "PASS"
	return failedChecks.length > 0 ? `FAIL (${failedChecks.join(", ")})` : "FAIL"
}

function formatVerificationProfile(pack: IncidentPack): string {
	if (!pack.verificationProfile) return "not recorded"
	const status = asString(pack.verificationProfile["status"], "unknown")
	const profileName = asString(pack.verificationProfile["profileName"])
	const message = asString(pack.verificationProfile["message"])
	return `${profileName ? `${profileName} -> ` : ""}${status}${message ? ` (${message})` : ""}`
}

function formatTaskContractScope(pack: IncidentPack): string {
	const scope = asRecord(pack.taskContract?.["scope"])
	const allowedFiles = asStringArray(scope?.["allowedFiles"])
	const requiredTargetFiles = asStringArray(scope?.["requiredTargetFiles"])
	const derivation = asRecord(pack.taskContract?.["derivation"])
	const derivationSummary = asString(derivation?.["summary"])
	const pieces = []
	if (pack.pathChosen) pieces.push(`path=${pack.pathChosen}`)
	if (allowedFiles.length > 0) pieces.push(`allowed=${allowedFiles.join(", ")}`)
	if (requiredTargetFiles.length > 0) pieces.push(`required=${requiredTargetFiles.join(", ")}`)
	if (derivationSummary) pieces.push(`derived=${derivationSummary}`)
	return pieces.join(" | ") || "not recorded"
}

function resolveSupportIssueIntake(pack: IncidentPack): SupportIssueIntake {
	if (pack.supportIssueIntake) return pack.supportIssueIntake
	return buildSupportIssueIntake({
		runId: pack.runId,
		task: pack.task,
		workspace: pack.workspace,
		status: pack.status,
		failureBucket: pack.failureBucket,
		stopReason: pack.stopReason,
		pathChosen: pack.pathChosen,
		reviewerVerdict: pack.reviewerVerdict,
		summaryPath: pack.artifacts.summaryPath,
		incidentPackPath: pack.artifacts.incidentPackPath,
		reviewPackPath: pack.artifacts.reviewPackPath,
	})
}

function resolveFailureNarrative(pack: IncidentPack): FailureNarrative {
	if (pack.failureNarrative) return pack.failureNarrative

	const safestNextStep =
		pack.nextAction.label === "approve now"
			? `${pack.nextAction.label} -> ${formatCliCommand("review:approve", pack.workspace, pack.runId)}`
			: pack.nextAction.label === "stop and fix red lane"
				? `${pack.nextAction.label} -> ${pack.redLaneHint.stageCommand}`
				: pack.nextAction.label === pack.recoveryAction.label && pack.recoveryAction.command
					? `${pack.nextAction.label} -> ${pack.recoveryAction.command}`
					: pack.nextAction.label

	return createFailureNarrative({
		whatFailed: `${pack.failureBucket} (${pack.stopReason})`,
		whyItStopped: pack.nextAction.rationale,
		safestNextStep,
		recoveryFooting: pack.recoveryAction.rationale,
		authoritativeArtifacts: [pack.artifacts.summaryPath, pack.artifacts.reviewPackPath, pack.artifacts.incidentPackPath],
	})
}

export function formatIncidentPack(pack: IncidentPack): string {
	const supportIssueIntake = resolveSupportIssueIntake(pack)
	const failureNarrative = resolveFailureNarrative(pack)
	const cleanup = pack.latestCleanup
	const cleanupStatus = cleanup ? `${cleanup.action} -> ${cleanup.status}` : "none recorded"
	const suggestedFileName = pack.redLaneHint.suggestedFileName || "FixRedLane_SessionXX_Incident.md"
	const firstInvariantAtRisk = pack.redLaneHint.firstInvariantAtRisk || "incident evidence classification"
	const nearbyProofCommands =
		Array.isArray(pack.redLaneHint.nearbyProofCommands) && pack.redLaneHint.nearbyProofCommands.length > 0
			? pack.redLaneHint.nearbyProofCommands
			: ["npm.cmd test", "npm.cmd run verify:incident"]
	const stageCommand = pack.redLaneHint.stageCommand || `Use ${pack.redLaneHint.templatePath} to stage ${suggestedFileName}`
	return [
		`Run ID: ${pack.runId}`,
		`Task: ${pack.task}`,
		`Status: ${pack.status}`,
		`Stop reason: ${pack.stopReason}`,
		`Failure bucket: ${pack.failureBucket}`,
		`Next place to inspect: ${pack.nextPlaceToLook}`,
		`Next action: ${pack.nextAction.label}`,
		`Next action rationale: ${pack.nextAction.rationale}`,
		formatFailureNarrative(failureNarrative),
		`Message: ${pack.message || "(none)"}`,
		`Task scope: ${formatTaskContractScope(pack)}`,
		`Reviewer verdict: ${pack.reviewerVerdict ?? "not recorded"}`,
		`Acceptance: ${formatAcceptanceGate(pack)}`,
		`Verification: ${formatVerificationProfile(pack)}`,
		`Changed files: ${pack.changedFiles.join(", ") || "(none recorded)"}`,
		`Created files: ${pack.createdFiles.join(", ") || "(none recorded)"}`,
		`Merge negotiation: ${pack.mergeNegotiation ? `${pack.mergeNegotiation.status} / ${pack.mergeNegotiation.mode}` : "not recorded"}`,
		`Merge summary: ${pack.mergeNegotiation?.summary ?? "not recorded"}`,
		`Recovery action: ${pack.recoveryAction.label}${pack.recoveryAction.command ? ` -> ${pack.recoveryAction.command}` : ""}`,
		`Recovery rationale: ${pack.recoveryAction.rationale}`,
		`Operator audit: ${
			pack.operatorAudit
				? `approvals=${pack.operatorAudit.approvedBy.length}/${pack.operatorAudit.requiredApprovals} pending=${pack.operatorAudit.pendingReviewers.join(", ") || "(none)"} finalActor=${pack.operatorAudit.finalDecisionBy ?? "(none)"}`
				: "not recorded"
		}`,
		`Red-lane hint: ${pack.redLaneHint.recommended ? "USE FIX RED LANE" : "RESOLVE INCIDENT FIRST"}`,
		`Red-lane rationale: ${pack.redLaneHint.rationale}`,
		`Red-lane file suggestion: ${suggestedFileName}`,
		`First invariant at risk: ${firstInvariantAtRisk}`,
		`Nearby proofs to rerun: ${nearbyProofCommands.join(" | ")}`,
		`Red-lane staging: ${stageCommand}`,
		"",
		"Support issue intake:",
		`Issue guide: ${supportIssueIntake.guidePath}`,
		`Issue template: ${supportIssueIntake.templatePath}`,
		`Suggested issue title: ${supportIssueIntake.suggestedTitle}`,
		`Issue summary to paste: ${supportIssueIntake.summary}`,
		`Proof commands to paste: ${supportIssueIntake.proofCommands.join(" | ")}`,
		`Artifact paths to paste: ${supportIssueIntake.artifactPaths.join(" | ")}`,
		`Intake note: ${supportIssueIntake.note}`,
		`Cleanup ownership: branches=${pack.cleanupOwnership.ownedBranchNames.join(", ") || "(none)"} | primary=${pack.cleanupOwnership.primaryBranch ?? "(none)"} | worktree=${pack.cleanupOwnership.ownedWorktreeDir ?? "(none)"} | mainWorkspaceTouched=${pack.cleanupOwnership.mainWorkspaceTouched ? "yes" : "no"}`,
		`Ownership ambiguous: ${pack.cleanupOwnership.ambiguousOwnership ? "yes" : "no"}`,
		...(pack.mergeNegotiation
			? [
					"Merge conflict review:",
					...(pack.mergeNegotiation.conflictReview.length > 0
						? pack.mergeNegotiation.conflictReview.map((line) => `- ${line}`)
						: ["- none recorded"]),
			  ]
			: []),
		...(pack.cleanupOwnership.ambiguousOwnershipReasons.length > 0
			? ["Ownership issues:", ...pack.cleanupOwnership.ambiguousOwnershipReasons.map((line) => `- ${line}`)]
			: []),
		...(pack.operatorAudit
			? [
					"Operator audit trail:",
					...(pack.operatorAudit.history.length > 0
						? pack.operatorAudit.history.map(
								(entry) =>
									`- ${entry.recordedAt} | ${entry.action} | actor=${entry.actor ?? "(unknown)"} | approvals=${entry.approvedBy.join(", ") || "(none)"}`,
						  )
						: ["- none recorded"]),
			  ]
			: []),
		`Latest cleanup: ${cleanupStatus}`,
		...(cleanup?.message ? [`Cleanup detail: ${cleanup.message}`] : []),
		"",
		"Diff stat:",
		pack.diffStat || "(diff stat unavailable)",
		"",
		"Diff preview excerpt:",
		pack.diffPreviewExcerpt || "(diff preview unavailable)",
		"",
		"Artifacts:",
		`- Summary: ${pack.artifacts.summaryPath}`,
		`- Review pack: ${pack.artifacts.reviewPackPath ?? "(none)"}`,
		`- Incident pack: ${pack.artifacts.incidentPackPath}`,
	].join("\n")
}

function persistIncidentCleanup(workspace: string, runId: string, cleanup: IncidentCleanupRecord): string {
	const runDir = resolveRunDir(workspace, runId)
	return (
		updateRunSummary(runDir, (current) => {
			const incident = asRecord(current["incident"])
			return {
				...current,
				incident: {
					...incident,
					cleanup,
				},
			}
		}) ?? resolveRunSummaryPath(runDir)
	)
}

async function deleteOwnedBranches(workspace: string, branches: string[]): Promise<{ deleted: string[]; leftover: string[] }> {
	const deleted: string[] = []
	const leftover: string[] = []
	for (const branch of branches) {
		if (!(await branchExists(workspace, branch))) continue
		try {
			await runGit(workspace, ["branch", "-D", branch])
			deleted.push(branch)
		} catch {
			leftover.push(branch)
		}
	}
	return { deleted, leftover }
}

async function removeOwnedWorktree(workspace: string, worktreeDir: string | null): Promise<string[]> {
	if (!worktreeDir || !fs.existsSync(worktreeDir)) return []
	try {
		await runGit(workspace, ["worktree", "remove", "--force", worktreeDir])
		return [worktreeDir]
	} catch {
		try {
			fs.rmSync(worktreeDir, { recursive: true, force: true })
			return [worktreeDir]
		} catch {
			return []
		}
	}
}

function removeOwnedTmpEntries(workspace: string, entries: string[]): string[] {
	const tmpRoot = path.join(workspace, ".swarm", "tmp")
	const removed: string[] = []
	for (const entry of entries) {
		if (!path.resolve(entry).startsWith(path.resolve(tmpRoot))) continue
		if (!fs.existsSync(entry)) continue
		try {
			fs.rmSync(entry, { recursive: true, force: true })
			removed.push(entry)
		} catch {
			// ignore best-effort cleanup failures
		}
	}
	return removed
}

export async function rollbackIncidentRun(workspace: string, runIdOrLatest?: string): Promise<IncidentRollbackResult> {
	const pack = await ensureIncidentPack(workspace, runIdOrLatest)
	const runId = pack.runId

	if (pack.cleanupOwnership.ambiguousOwnership) {
		const cleanup: IncidentCleanupRecord = {
			action: "inspect_only",
			status: "refused",
			message: "Rollback refused because ownership is ambiguous.",
			performedAt: new Date().toISOString(),
			deletedBranches: [],
			removedWorktrees: [],
			removedTmpEntries: [],
			ambiguousOwnershipReasons: [...pack.cleanupOwnership.ambiguousOwnershipReasons],
		}
		const summaryPath = persistIncidentCleanup(workspace, runId, cleanup)
		const refreshedPack = await ensureIncidentPack(workspace, runId)
		return {
			runId,
			decision: "refused",
			message: cleanup.message,
			summaryPath,
			incidentPackPath: refreshedPack.artifacts.incidentPackPath,
			deletedBranches: [],
			removedWorktrees: [],
			removedTmpEntries: [],
		}
	}

	if (pack.status === "review_required") {
		const reviewResult: ReviewActionResult = await discardReviewRun(workspace, runId)
		const cleanup: IncidentCleanupRecord = {
			action: "discard_review",
			status: "applied",
			message: reviewResult.message,
			performedAt: new Date().toISOString(),
			deletedBranches: reviewResult.deletedBranches,
			removedWorktrees: [],
			removedTmpEntries: [],
			ambiguousOwnershipReasons: [],
		}
		const summaryPath = persistIncidentCleanup(workspace, runId, cleanup)
		const refreshedPack = await ensureIncidentPack(workspace, runId)
		return {
			runId,
			decision: "discarded_review",
			message: reviewResult.message,
			summaryPath,
			incidentPackPath: refreshedPack.artifacts.incidentPackPath,
			deletedBranches: reviewResult.deletedBranches,
			removedWorktrees: [],
			removedTmpEntries: [],
		}
	}

	const removedWorktrees = await removeOwnedWorktree(workspace, pack.cleanupOwnership.ownedWorktreeDir)
	const { deleted, leftover } = await deleteOwnedBranches(workspace, pack.cleanupOwnership.ownedBranchNames)
	const removedTmpEntries = removeOwnedTmpEntries(workspace, pack.cleanupOwnership.recoveryInventory.staleTmpEntries)
	const removedWorktreesAll = [...removedWorktrees]
	const needsCleanup = deleted.length > 0 || removedWorktreesAll.length > 0 || removedTmpEntries.length > 0
	const cleanup: IncidentCleanupRecord = {
		action: needsCleanup ? "rollback_owned_state" : "inspect_only",
		status: needsCleanup ? "applied" : "not_needed",
		message: needsCleanup
			? "Removed V2-owned leftover incident state."
			: "No V2-owned incident state still needed rollback.",
		performedAt: new Date().toISOString(),
		deletedBranches: deleted,
		removedWorktrees: removedWorktreesAll,
		removedTmpEntries,
		ambiguousOwnershipReasons: leftover.map((branch) => `Failed to delete recorded V2-owned branch: ${branch}`),
	}
	const summaryPath = persistIncidentCleanup(workspace, runId, cleanup)
	const refreshedPack = await ensureIncidentPack(workspace, runId)
	return {
		runId,
		decision: needsCleanup ? "rolled_back" : "not_needed",
		message: cleanup.message,
		summaryPath,
		incidentPackPath: refreshedPack.artifacts.incidentPackPath,
		deletedBranches: deleted,
		removedWorktrees: removedWorktreesAll,
		removedTmpEntries,
	}
}
