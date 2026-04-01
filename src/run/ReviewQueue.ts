import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { normalizeMergeOrderArtifact, type MergeOrderArtifact } from "../planning/MergeOrder"
import { buildWorkQueueSummary } from "./WorkQueue"
import {
	appendRunEvent,
	listRunDirs,
	readReviewPack,
	readRunEvents,
	readRunSummary,
	resolveReviewPackPath,
	resolveRunDir,
	updateRunSummary,
	writeReviewPack,
} from "./RunArtifacts"

type ReviewDecision = "pending" | "approved" | "discarded"
type ReviewActionDecision = "approval_recorded" | Exclude<ReviewDecision, "pending">
type ReviewPolicy = {
	requiredApprovals: number
	allowedReviewers: string[]
}
type ReviewAuditAction = "approval_recorded" | "approved" | "discarded"
type ReviewAuditEntry = {
	action: ReviewAuditAction
	recordedAt: string
	actor: string | null
	approvedBy: string[]
	decision: ReviewActionDecision
}

type ReviewMergeNegotiation = {
	status: MergeOrderArtifact["status"]
	mode: MergeOrderArtifact["negotiation"]["mode"]
	readiness: MergeOrderArtifact["negotiation"]["readiness"]
	approvalBranch: string | null
	sourceBranches: string[]
	reviewStages: MergeOrderArtifact["negotiation"]["reviewStages"]
	reviewChecklist: string[]
	conflictReview: string[]
	handoffSummary: string
	blockers: string[]
	summary: string
}

type ReviewPostMergeQuality = {
	status: string
	approvalRisk: string | null
	targetedEvaluatorStatus: string
	targetedConcernCount: number
	targetedEvaluatorIds: string[]
	followUpChecks: string[]
	blockers: string[]
	summary: string
}

type ReviewApprovalPackage = {
	readiness: "ready" | "needs_attention" | "blocked"
	focusAreas: string[]
	requiredChecks: string[]
	summary: string
}

type ReviewQueuedFollowUp = {
	pendingCount: number
	readyCount: number
	awaitingApprovalCount: number
	scheduledCount: number
	state: "empty" | "ready" | "awaiting_owner" | "scheduled"
	summary: string
	nextCommandHint: string | null
	nextTask: string | null
}

type ReviewSummary = {
	taskId: string
	task: string
	workspace: string
	dryRun: boolean
	status: string
	stopReason: string
	message: string
	reviewerVerdict: string | null
	changedFiles: string[]
	createdFiles: string[]
	taskContract: Record<string, unknown> | null
	acceptanceGate: Record<string, unknown> | null
	verificationProfile: Record<string, unknown> | null
	git: {
		baseRef: string
		branches: string[]
	}
	mergeOrder: MergeOrderArtifact | null
	postMergeQuality: ReviewPostMergeQuality | null
	review: {
		decision: ReviewDecision
		primaryBranch: string | null
		branchNames: string[]
		ownedWorktreeDir: string | null
		mainWorkspaceTouched: boolean
		requiredApprovals: number
		approvedBy: string[]
		allowedReviewers: string[]
		decidedAt: string | null
		decisionBy: string | null
		approvalCommit: string | null
		deletedBranches: string[]
		leftoverBranches: string[]
	} | null
}

export type ReviewQueueItem = {
	runId: string
	task: string
	stopReason: string
	reviewerVerdict: string | null
	changedFiles: string[]
	primaryBranch: string | null
	mergeStatus: MergeOrderArtifact["status"] | null
	mergeMode: MergeOrderArtifact["negotiation"]["mode"] | null
	endedAt: string | null
}

export type ReviewPack = {
	runId: string
	task: string
	workspace: string
	status: string
	stopReason: string
	message: string
	reviewerVerdict: string | null
	taskContract: Record<string, unknown> | null
	acceptanceGate: Record<string, unknown> | null
	verificationProfile: Record<string, unknown> | null
	changedFiles: string[]
	createdFiles: string[]
	diffStat: string
	diffPreview: string
	summaryPath: string
	reviewPackPath: string
	cleanup: {
		ownedBranchNames: string[]
		primaryBranch: string | null
		ownedWorktreeDir: string | null
		mainWorkspaceTouched: boolean
		deletedBranches: string[]
		leftoverBranches: string[]
	}
	mergeNegotiation: ReviewMergeNegotiation | null
	postMergeQuality: ReviewPostMergeQuality | null
	approvalPackage: ReviewApprovalPackage
	queueFollowUp: ReviewQueuedFollowUp
	review: {
		decision: ReviewDecision
		canApprove: boolean
		eligibility: string[]
		requiredApprovals: number
		approvedBy: string[]
		allowedReviewers: string[]
		approvalsRemaining: number
		decidedAt: string | null
		decisionBy: string | null
		approvalCommit: string | null
	}
	audit: {
		history: ReviewAuditEntry[]
		pendingReviewers: string[]
	}
	nextAction: {
		label: string
		rationale: string
	}
}

export type ReviewActionResult = {
	runId: string
	decision: ReviewActionDecision
	message: string
	summaryPath: string
	reviewPackPath: string
	deletedBranches: string[]
	leftoverBranches: string[]
	approvalCommit: string | null
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
	return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)))
}

function clampRequiredApprovals(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 1
	return Math.max(1, Math.min(3, Math.floor(value)))
}

function loadReviewPolicy(workspace: string): ReviewPolicy {
	const configPath = path.join(workspace, ".swarmcoder.json")
	if (!fs.existsSync(configPath)) {
		return {
			requiredApprovals: 1,
			allowedReviewers: [],
		}
	}
	try {
		const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>
		const reviewPolicy = asRecord(raw["reviewPolicy"])
		return {
			requiredApprovals: clampRequiredApprovals(reviewPolicy?.["requiredApprovals"]),
			allowedReviewers: asStringArray(reviewPolicy?.["allowedReviewers"]),
		}
	} catch {
		return {
			requiredApprovals: 1,
			allowedReviewers: [],
		}
	}
}

function normalizeSummary(summary: Record<string, unknown> | null, runDir: string): ReviewSummary | null {
	if (!summary) return null
	const git = asRecord(summary["git"])
	const review = asRecord(summary["review"])
	const taskId = asString(summary["taskId"], path.basename(runDir))
	const branchNamesFromGit = asStringArray(git?.["branches"])
	const primaryBranch = asString(review?.["primaryBranch"], selectPrimaryBranch(branchNamesFromGit) ?? "")
	const mergeOrder = normalizeMergeOrderArtifact(taskId, summary["mergeOrder"])
	const postMergeQualityRecord = asRecord(summary["postMergeQuality"])

	return {
		taskId,
		task: asString(summary["task"]),
		workspace: asString(summary["workspace"]),
		dryRun: summary["dryRun"] === true,
		status: asString(summary["status"]),
		stopReason: asString(summary["stopReason"]),
		message: asString(summary["message"]),
		reviewerVerdict: typeof summary["reviewerVerdict"] === "string" ? String(summary["reviewerVerdict"]) : null,
		changedFiles: asStringArray(summary["changedFiles"]),
		createdFiles: asStringArray(summary["createdFiles"]),
		taskContract: asRecord(summary["taskContract"]),
		acceptanceGate: asRecord(summary["acceptanceGate"]),
		verificationProfile: asRecord(summary["verificationProfile"]),
		git: {
			baseRef: asString(git?.["baseRef"], "HEAD"),
			branches: branchNamesFromGit,
		},
		mergeOrder,
		postMergeQuality: postMergeQualityRecord
			? {
					status: asString(postMergeQualityRecord["status"], "not_recorded"),
					approvalRisk: asString(postMergeQualityRecord["approvalRisk"]) || null,
					targetedEvaluatorStatus: asString(postMergeQualityRecord["targetedEvaluatorStatus"], "not_applicable"),
					targetedConcernCount:
						typeof postMergeQualityRecord["targetedConcernCount"] === "number" &&
						Number.isFinite(postMergeQualityRecord["targetedConcernCount"])
							? Number(postMergeQualityRecord["targetedConcernCount"])
							: 0,
					targetedEvaluatorIds: asStringArray(postMergeQualityRecord["targetedEvaluatorIds"]),
					followUpChecks: asStringArray(postMergeQualityRecord["followUpChecks"]),
					blockers: asStringArray(postMergeQualityRecord["blockers"]),
					summary: asString(postMergeQualityRecord["summary"]),
			  }
			: null,
		review: review
			? {
					decision: (asString(review["decision"], "pending") as ReviewDecision) ?? "pending",
					primaryBranch: primaryBranch || null,
					branchNames: asStringArray(review["branchNames"]).length > 0 ? asStringArray(review["branchNames"]) : branchNamesFromGit,
					ownedWorktreeDir: asString(review["ownedWorktreeDir"]) || null,
					mainWorkspaceTouched: review["mainWorkspaceTouched"] === true,
					requiredApprovals: clampRequiredApprovals(review["requiredApprovals"]),
					approvedBy: asStringArray(review["approvedBy"]),
					allowedReviewers: asStringArray(review["allowedReviewers"]),
					decidedAt: asString(review["decidedAt"]) || null,
					decisionBy: asString(review["decisionBy"]) || null,
					approvalCommit: asString(review["approvalCommit"]) || null,
					deletedBranches: asStringArray(review["deletedBranches"]),
					leftoverBranches: asStringArray(review["leftoverBranches"]),
			  }
			: {
					decision: "pending",
					primaryBranch: primaryBranch || null,
					branchNames: branchNamesFromGit,
					ownedWorktreeDir: null,
					mainWorkspaceTouched: false,
					requiredApprovals: 1,
					approvedBy: [],
					allowedReviewers: [],
					decidedAt: null,
					decisionBy: null,
					approvalCommit: null,
					deletedBranches: [],
					leftoverBranches: [],
			  },
	}
}

function resolveReviewDecisionActor(env: Record<string, string | undefined> = process.env): string | null {
	return env["USERNAME"] ?? env["USER"] ?? null
}

async function runGitCapture(
	repoPath: string,
	args: string[],
	options: { timeoutMs?: number; maxOutputChars?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
	const timeoutMs = options.timeoutMs ?? 30_000
	const maxOutputChars = options.maxOutputChars ?? 200_000
	const swarmTmpDir = path.join(repoPath, ".swarm", "tmp")
	fs.mkdirSync(swarmTmpDir, { recursive: true })
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(swarmTmpDir, `review-${stamp}.stdout.log`)
	const stderrPath = path.join(swarmTmpDir, `review-${stamp}.stderr.log`)
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
		const child = spawn("git", ["-c", `safe.directory=${repoPath}`, ...args], {
			cwd: repoPath,
			windowsHide: true,
			stdio: ["ignore", stdoutFd, stderrFd],
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

		const timeout = setTimeout(() => killTree(), timeoutMs)
		timeout.unref?.()

		const code = await new Promise<number | null>((resolve, reject) => {
			child.once("error", reject)
			child.once("close", (exitCode) => resolve(typeof exitCode === "number" ? exitCode : null))
		}).finally(() => clearTimeout(timeout))

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

async function getRepoStatusEntries(repoPath: string): Promise<string[]> {
	const { stdout } = await runGitCapture(repoPath, ["status", "--porcelain", "--untracked-files=all"], {
		timeoutMs: 15_000,
		maxOutputChars: 50_000,
	})
	return stdout
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean)
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
	try {
		await runGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
		return true
	} catch {
		return false
	}
}

async function getHeadCommit(repoPath: string): Promise<string | null> {
	try {
		const { stdout } = await runGitCapture(repoPath, ["rev-parse", "HEAD"], { timeoutMs: 10_000, maxOutputChars: 4_000 })
		return stdout.trim() || null
	} catch {
		return null
	}
}

function selectPrimaryBranch(branches: string[]): string | null {
	if (branches.length === 0) return null
	return branches.find((branch) => /\/integration$/u.test(branch)) ?? branches[branches.length - 1] ?? null
}

function isPendingReview(summary: ReviewSummary | null): summary is ReviewSummary {
	return Boolean(summary && summary.status === "review_required" && summary.review?.decision === "pending")
}

export function buildInitialReviewRecord(
	workspace: string,
	taskId: string,
	status: string,
	dryRun: boolean,
	branchNames: string[],
): Record<string, unknown> | null {
	if (status !== "review_required") return null
	const policy = loadReviewPolicy(workspace)
	const primaryBranch = selectPrimaryBranch(branchNames)
	return {
		decision: "pending",
		primaryBranch,
		branchNames,
		ownedWorktreeDir: dryRun ? null : path.join(path.dirname(workspace), ".swarm-worktrees", taskId),
		mainWorkspaceTouched: false,
		requiredApprovals: policy.requiredApprovals,
		approvedBy: [],
		allowedReviewers: policy.allowedReviewers,
		decidedAt: null,
		decisionBy: null,
		approvalCommit: null,
		deletedBranches: [],
		leftoverBranches: [],
	}
}

function summarizeEligibility(summary: ReviewSummary, branchExistsMap: Record<string, boolean>): string[] {
	const reasons: string[] = []
	if (summary.status !== "review_required") reasons.push(`Run status is ${summary.status}, not review_required.`)
	if (summary.review?.decision !== "pending") reasons.push(`Review decision is ${summary.review?.decision ?? "unknown"}, not pending.`)
	if (summary.dryRun) reasons.push("Dry-run artifacts cannot be approved or discarded as live results.")
	if (summary.git.branches.length === 0) reasons.push("No orchestrator-owned review branches were recorded for this run.")
	const primaryBranch = summary.review?.primaryBranch ?? selectPrimaryBranch(summary.git.branches)
	if (!primaryBranch) reasons.push("No primary review branch is available.")
	if (summary.mergeOrder?.status === "blocked") {
		reasons.push(
			`Merge negotiation is blocked: ${
				summary.mergeOrder.blockers.join(" ") || summary.mergeOrder.negotiation.summary
			}`.trim(),
		)
	}
	const approvalBranch = summary.mergeOrder?.negotiation.approvalBranch ?? null
	if (primaryBranch && approvalBranch && primaryBranch !== approvalBranch) {
		reasons.push(`Primary review branch ${primaryBranch} does not match merge approval branch ${approvalBranch}.`)
	}
	for (const branch of summary.git.branches) {
		if (!branchExistsMap[branch]) reasons.push(`Recorded review branch is missing: ${branch}`)
	}
	return reasons
}

function cloneReviewDecision(summary: ReviewSummary): NonNullable<ReviewSummary["review"]> {
	return {
		decision: summary.review?.decision ?? "pending",
		primaryBranch: summary.review?.primaryBranch ?? selectPrimaryBranch(summary.git.branches),
		branchNames: [...(summary.review?.branchNames ?? summary.git.branches)],
		ownedWorktreeDir: summary.review?.ownedWorktreeDir ?? null,
		mainWorkspaceTouched: summary.review?.mainWorkspaceTouched === true,
		requiredApprovals: summary.review?.requiredApprovals ?? 1,
		approvedBy: [...(summary.review?.approvedBy ?? [])],
		allowedReviewers: [...(summary.review?.allowedReviewers ?? [])],
		decidedAt: summary.review?.decidedAt ?? null,
		decisionBy: summary.review?.decisionBy ?? null,
		approvalCommit: summary.review?.approvalCommit ?? null,
		deletedBranches: [...(summary.review?.deletedBranches ?? [])],
		leftoverBranches: [...(summary.review?.leftoverBranches ?? [])],
	}
}

function summarizeMergeNegotiation(summary: ReviewSummary): ReviewMergeNegotiation | null {
	if (!summary.mergeOrder) return null
	return {
		status: summary.mergeOrder.status,
		mode: summary.mergeOrder.negotiation.mode,
		readiness: summary.mergeOrder.negotiation.readiness,
		approvalBranch: summary.mergeOrder.negotiation.approvalBranch,
		sourceBranches: [...summary.mergeOrder.negotiation.sourceBranches],
		reviewStages: summary.mergeOrder.negotiation.reviewStages.map((stage) => ({ ...stage })),
		reviewChecklist: [...summary.mergeOrder.negotiation.reviewChecklist],
		conflictReview: [...summary.mergeOrder.negotiation.conflictReview],
		handoffSummary: summary.mergeOrder.negotiation.handoffSummary,
		blockers: [...summary.mergeOrder.blockers],
		summary: summary.mergeOrder.negotiation.summary,
	}
}

function buildApprovalPackage(summary: ReviewSummary, mergeNegotiation: ReviewMergeNegotiation | null): ReviewApprovalPackage {
	const focusAreas = uniqueStrings([
		...(mergeNegotiation?.reviewStages.flatMap((stage) => (stage.status === "ready" ? [stage.label] : [])) ?? []),
		...(summary.mergeOrder?.negotiation.steps.flatMap((step) => step.reviewFocus) ?? []),
		...summary.changedFiles,
	])
	const requiredChecks = uniqueStrings([
		...(mergeNegotiation?.reviewChecklist ?? []),
		...(summary.postMergeQuality?.followUpChecks ?? []),
		...(mergeNegotiation?.conflictReview ?? []),
	])

	if (mergeNegotiation?.status === "blocked" || mergeNegotiation?.readiness === "blocked") {
		return {
			readiness: "blocked",
			focusAreas,
			requiredChecks,
			summary: mergeNegotiation.summary,
		}
	}

	if (
		(summary.postMergeQuality?.approvalRisk === "targeted_concerns" && (summary.postMergeQuality.targetedConcernCount ?? 0) > 0) ||
		(summary.postMergeQuality?.targetedConcernCount ?? 0) > 0
	) {
		return {
			readiness: "needs_attention",
			focusAreas,
			requiredChecks,
			summary:
				summary.postMergeQuality?.targetedConcernCount && summary.postMergeQuality.targetedConcernCount > 0
					? `Approval is available, but the review should explicitly cover ${summary.postMergeQuality.targetedConcernCount} targeted concern(s) first.`
					: "Approval is available, but the recorded follow-up checks should be reviewed first.",
		}
	}

	return {
		readiness: "ready",
		focusAreas,
		requiredChecks,
		summary:
			mergeNegotiation?.handoffSummary ??
			"Approval package is ready; recorded branch order and review checks are aligned.",
	}
}

function buildQueuedFollowUpSummary(workspace: string): ReviewQueuedFollowUp {
	const queueSummary = buildWorkQueueSummary(workspace)
	return {
		pendingCount: queueSummary.pendingCount,
		readyCount: queueSummary.readyCount,
		awaitingApprovalCount: queueSummary.awaitingApprovalCount,
		scheduledCount: queueSummary.scheduledCount,
		state: queueSummary.state,
		summary: queueSummary.statusMessage,
		nextCommandHint: queueSummary.nextCommandHint,
		nextTask: queueSummary.nextReadyItem?.task ?? queueSummary.nextScheduledItem?.task ?? queueSummary.nextAwaitingApprovalItem?.task ?? null,
	}
}

function buildReviewNextAction(summary: ReviewSummary, eligibility: string[]): ReviewPack["nextAction"] {
	const requiredApprovals = summary.review?.requiredApprovals ?? 1
	const approvedBy = summary.review?.approvedBy ?? []
	const approvalsRemaining = Math.max(0, requiredApprovals - approvedBy.length)
	const approvalPackage = buildApprovalPackage(summary, summarizeMergeNegotiation(summary))
	if (summary.review?.decision === "approved") {
		return {
			label: "already approved",
			rationale: "This review item has already been approved and should not be re-opened as a pending decision.",
		}
	}

	if (summary.review?.decision === "discarded") {
		return {
			label: "already discarded",
			rationale: "This review item has already been discarded; start a fresh bounded run instead of revisiting this artifact.",
		}
	}

	if (approvalPackage.readiness === "blocked") {
		return {
			label: "stop and fix red lane",
			rationale: approvalPackage.summary,
		}
	}

	if (eligibility.length === 0) {
		if (approvalPackage.readiness === "needs_attention") {
			return {
				label: approvalsRemaining > 1 ? "record focused approval" : "review with focus before approval",
				rationale: approvalPackage.summary,
			}
		}
		if (approvalsRemaining > 1) {
			return {
				label: "record approval",
				rationale: `This review policy needs ${requiredApprovals} approvals; the next reviewer can record approval ${approvedBy.length + 1}/${requiredApprovals} without merging yet.`,
			}
		}
		return {
			label: "approve now",
			rationale: "The isolated review candidate still has its owned branch state and is safe to approve from the review pack.",
		}
	}

	if (
		eligibility.some(
			(reason) =>
				reason.includes("missing") ||
				reason.includes("not pending") ||
				reason.includes("Merge negotiation is blocked") ||
				reason.includes("merge approval branch"),
		)
	) {
		return {
			label: "stop and fix red lane",
			rationale: "The review artifact is no longer in a clean approval state, so the next step is to restore the lane instead of forcing approval.",
		}
	}

	return {
		label: "discard and retry with narrower scope",
		rationale: "The review candidate is not safely approvable, so discard it and rerun with a tighter bounded task.",
	}
}

function buildReviewAuditHistory(runDir: string, currentApprovedBy: string[]): ReviewAuditEntry[] {
	const history: ReviewAuditEntry[] = []
	for (const event of readRunEvents(runDir)) {
		const type = asString(event["type"])
		const timestamp = asString(event["timestamp"])
		if (!timestamp) continue
		if (type === "review_approval_recorded") {
			history.push({
				action: "approval_recorded",
				recordedAt: timestamp,
				actor: asString(event["reviewerId"]),
				approvedBy: asStringArray(event["approvedBy"]),
				decision: "approval_recorded",
			})
			continue
		}
		if (type === "review_decision") {
			const decision = asString(event["decision"])
			if (decision !== "approved" && decision !== "discarded") continue
			history.push({
				action: decision,
				recordedAt: timestamp,
				actor: asString(event["decisionBy"]),
				approvedBy: asStringArray(event["approvedBy"]),
				decision,
			})
		}
	}

	if (history.length > 0) return history
	if (currentApprovedBy.length === 0) return []
	return [
		{
			action: "approval_recorded",
			recordedAt: new Date().toISOString(),
			actor: currentApprovedBy.at(-1) ?? null,
			approvedBy: [...currentApprovedBy],
			decision: "approval_recorded",
		},
	]
}

function summaryToReviewPack(summary: ReviewSummary, diffStat: string, diffPreview: string, eligibility: string[]): ReviewPack {
	const runDir = resolveRunDir(summary.workspace, summary.taskId)
	const reviewPackPath = resolveReviewPackPath(runDir)
	const summaryPath = path.join(runDir, "summary.json")
	const decision = cloneReviewDecision(summary)
	const mergeNegotiation = summarizeMergeNegotiation(summary)
	const approvalPackage = buildApprovalPackage(summary, mergeNegotiation)
	const queueFollowUp = buildQueuedFollowUpSummary(summary.workspace)
	const nextAction = buildReviewNextAction(summary, eligibility)
	const approvalsRemaining = Math.max(0, decision.requiredApprovals - decision.approvedBy.length)
	const allowedReviewerSet = new Set(decision.allowedReviewers)
	const pendingReviewers =
		decision.allowedReviewers.length > 0
			? decision.allowedReviewers.filter((reviewerId) => !decision.approvedBy.includes(reviewerId))
			: approvalsRemaining > 0
				? [`${approvalsRemaining} more reviewer approval(s) required`]
				: []
	return {
		runId: summary.taskId,
		task: summary.task,
		workspace: summary.workspace,
		status: summary.status,
		stopReason: summary.stopReason,
		message: summary.message,
		reviewerVerdict: summary.reviewerVerdict,
		taskContract: summary.taskContract,
		acceptanceGate: summary.acceptanceGate,
		verificationProfile: summary.verificationProfile,
		changedFiles: summary.changedFiles,
		createdFiles: summary.createdFiles,
		diffStat,
		diffPreview,
		summaryPath,
		reviewPackPath,
		cleanup: {
			ownedBranchNames: [...summary.git.branches],
			primaryBranch: decision.primaryBranch,
			ownedWorktreeDir: decision.ownedWorktreeDir,
			mainWorkspaceTouched: decision.mainWorkspaceTouched,
			deletedBranches: [...decision.deletedBranches],
			leftoverBranches: [...decision.leftoverBranches],
		},
		mergeNegotiation,
		postMergeQuality: summary.postMergeQuality,
		approvalPackage,
		queueFollowUp,
		review: {
			decision: decision.decision,
			canApprove: eligibility.length === 0,
			eligibility,
			requiredApprovals: decision.requiredApprovals,
			approvedBy: [...decision.approvedBy],
			allowedReviewers: [...decision.allowedReviewers],
			approvalsRemaining,
			decidedAt: decision.decidedAt,
			decisionBy: decision.decisionBy,
			approvalCommit: decision.approvalCommit,
		},
		audit: {
			history: buildReviewAuditHistory(runDir, decision.approvedBy),
			pendingReviewers: pendingReviewers.filter((reviewerId) => reviewerId.trim().length > 0 && (allowedReviewerSet.size === 0 || allowedReviewerSet.has(reviewerId))),
		},
		nextAction,
	}
}

export async function ensureReviewPack(workspace: string, runId: string): Promise<ReviewPack> {
	const runDir = resolveRunDir(workspace, runId)
	const summary = normalizeSummary(readRunSummary(runDir), runDir)
	if (!summary) throw new Error(`No summary.json found for run ${runId}`)

	const existingPack = readReviewPack<ReviewPack>(runDir)
	if (summary.review?.decision !== "pending" && existingPack?.approvalPackage && existingPack?.queueFollowUp) return existingPack

	const branchExistsMap: Record<string, boolean> = {}
	for (const branch of summary.git.branches) {
		branchExistsMap[branch] = await branchExists(workspace, branch)
	}
	const eligibility = summarizeEligibility(summary, branchExistsMap)

	let diffStat = ""
	let diffPreview = ""
	const primaryBranch = summary.review?.primaryBranch ?? selectPrimaryBranch(summary.git.branches)
	if (primaryBranch && branchExistsMap[primaryBranch]) {
		try {
			diffStat = (
				await runGitCapture(workspace, ["diff", "--stat", `${summary.git.baseRef}..${primaryBranch}`], {
					timeoutMs: 20_000,
					maxOutputChars: 50_000,
				})
			).stdout.trim()
			diffPreview = (
				await runGitCapture(workspace, ["diff", `${summary.git.baseRef}..${primaryBranch}`], {
					timeoutMs: 20_000,
					maxOutputChars: 120_000,
				})
			).stdout.trim()
		} catch (err) {
			diffPreview = `(diff unavailable) ${err instanceof Error ? err.message : String(err)}`
		}
	}

	const pack = summaryToReviewPack(summary, diffStat, diffPreview, eligibility)
	writeReviewPack(runDir, pack)
	return pack
}

export function listPendingReviewItems(workspace: string): ReviewQueueItem[] {
	const items = listRunDirs(workspace)
		.map((runDir) => normalizeSummary(readRunSummary(runDir), runDir))
		.filter(isPendingReview)
		.filter((summary) => !summary.dryRun && summary.git.branches.length > 0)
		.map((summary) => ({
			runId: summary.taskId,
			task: summary.task,
			stopReason: summary.stopReason,
			reviewerVerdict: summary.reviewerVerdict,
			changedFiles: summary.changedFiles,
			primaryBranch: summary.review?.primaryBranch ?? selectPrimaryBranch(summary.git.branches),
			mergeStatus: summary.mergeOrder?.status ?? null,
			mergeMode: summary.mergeOrder?.negotiation.mode ?? null,
			endedAt: asString(asRecord(readRunSummary(resolveRunDir(workspace, summary.taskId)))?.["endedAt"]) || null,
		}))
		.sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? "") * -1)

	return items
}

export function listProtectedPendingReviewBranches(workspace: string): string[] {
	const protectedBranches = new Set<string>()
	for (const runDir of listRunDirs(workspace)) {
		const summary = normalizeSummary(readRunSummary(runDir), runDir)
		if (!isPendingReview(summary) || summary.dryRun) continue
		for (const branch of summary.git.branches) protectedBranches.add(branch)
	}
	return Array.from(protectedBranches)
}

function persistDecisionArtifacts(
	summary: ReviewSummary,
	pack: ReviewPack,
	decision: Exclude<ReviewDecision, "pending">,
	deletedBranches: string[],
	leftoverBranches: string[],
	approvalCommit: string | null,
	approvedBy: string[],
	decisionBy: string | null,
): { summaryPath: string; reviewPackPath: string } {
	const runDir = resolveRunDir(summary.workspace, summary.taskId)
	const decidedAt = new Date().toISOString()
	appendRunEvent(runDir, {
		type: "review_decision",
		taskId: summary.taskId,
		decision,
		deletedBranches,
		leftoverBranches,
		approvalCommit,
		decisionBy,
		approvedBy,
	})

	const summaryPath =
		updateRunSummary(runDir, (current) => {
			const next = { ...current }
			next["review"] = {
				...(asRecord(current["review"]) ?? {}),
				decision,
				requiredApprovals: pack.review.requiredApprovals,
				approvedBy,
				allowedReviewers: pack.review.allowedReviewers,
				decidedAt,
				decisionBy,
				approvalCommit,
				deletedBranches,
				leftoverBranches,
			}
			return next
		}) ?? path.join(runDir, "summary.json")

	const nextPack: ReviewPack = {
		...pack,
		review: {
			...pack.review,
			decision,
			canApprove: false,
			eligibility: decision === "approved" ? ["Run has already been approved."] : ["Run has been discarded."],
			requiredApprovals: pack.review.requiredApprovals,
			approvedBy,
			allowedReviewers: [...pack.review.allowedReviewers],
			approvalsRemaining: 0,
			decidedAt,
			decisionBy,
			approvalCommit,
		},
		audit: {
			history: [
				...pack.audit.history,
				{
					action: decision,
					recordedAt: decidedAt,
					actor: decisionBy,
					approvedBy,
					decision,
				},
			],
			pendingReviewers: [],
		},
		cleanup: {
			...pack.cleanup,
			deletedBranches,
			leftoverBranches,
		},
	}
	const reviewPackPath = writeReviewPack(runDir, nextPack)
	return { summaryPath, reviewPackPath }
}

function persistApprovalProgress(
	summary: ReviewSummary,
	pack: ReviewPack,
	approvedBy: string[],
	reviewerId: string | null,
): { summaryPath: string; reviewPackPath: string } {
	const runDir = resolveRunDir(summary.workspace, summary.taskId)
	const recordedAt = new Date().toISOString()
	appendRunEvent(runDir, {
		type: "review_approval_recorded",
		taskId: summary.taskId,
		approvedBy,
		requiredApprovals: pack.review.requiredApprovals,
		reviewerId,
	})
	const summaryPath =
		updateRunSummary(runDir, (current) => {
			const next = { ...current }
			next["review"] = {
				...(asRecord(current["review"]) ?? {}),
				decision: "pending",
				requiredApprovals: pack.review.requiredApprovals,
				approvedBy,
				allowedReviewers: pack.review.allowedReviewers,
			}
			return next
		}) ?? path.join(runDir, "summary.json")
	const approvalsRemaining = Math.max(0, pack.review.requiredApprovals - approvedBy.length)
	const nextPack: ReviewPack = {
		...pack,
		review: {
			...pack.review,
			decision: "pending",
			canApprove: true,
			eligibility: approvalsRemaining > 0 ? [`Awaiting ${approvalsRemaining} more approval(s) before merge.`] : [],
			requiredApprovals: pack.review.requiredApprovals,
			approvedBy,
			allowedReviewers: [...pack.review.allowedReviewers],
			approvalsRemaining,
			decidedAt: null,
			decisionBy: null,
			approvalCommit: null,
		},
		audit: {
			history: [
				...pack.audit.history,
				{
					action: "approval_recorded",
					recordedAt,
					actor: reviewerId,
					approvedBy,
					decision: "approval_recorded",
				},
			],
			pendingReviewers:
				pack.review.allowedReviewers.length > 0
					? pack.review.allowedReviewers.filter((candidate) => !approvedBy.includes(candidate))
					: approvalsRemaining > 0
						? [`${approvalsRemaining} more reviewer approval(s) required`]
						: [],
		},
		nextAction: {
			label: approvalsRemaining > 1 ? "record approval" : "approve now",
			rationale:
				approvalsRemaining > 1
					? `This review policy still needs ${approvalsRemaining} approvals before merge.`
					: "One more approval will allow the bounded merge to land.",
		},
	}
	const reviewPackPath = writeReviewPack(runDir, nextPack)
	return { summaryPath, reviewPackPath }
}

async function deleteReviewBranches(workspace: string, branches: string[]): Promise<{ deleted: string[]; leftover: string[] }> {
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

function assertSummaryCanMutate(summary: ReviewSummary, action: "approve" | "discard"): void {
	if (summary.status !== "review_required") {
		throw new Error(`Run ${summary.taskId} is ${summary.status}, not review_required.`)
	}
	if (summary.review?.decision !== "pending") {
		throw new Error(`Run ${summary.taskId} is already ${summary.review?.decision ?? "resolved"}.`)
	}
	if (summary.dryRun) {
		throw new Error(`Run ${summary.taskId} is dry-run only and cannot be ${action}d.`)
	}
	if (summary.git.branches.length === 0) {
		throw new Error(`Run ${summary.taskId} has no preserved orchestrator-owned review branches.`)
	}
}

export async function approveReviewRun(
	workspace: string,
	runId: string,
	options: { reviewerId?: string | null; env?: Record<string, string | undefined> } = {},
): Promise<ReviewActionResult> {
	const runDir = resolveRunDir(workspace, runId)
	const summary = normalizeSummary(readRunSummary(runDir), runDir)
	if (!summary) throw new Error(`No summary.json found for run ${runId}`)
	assertSummaryCanMutate(summary, "approve")

	const pack = await ensureReviewPack(workspace, runId)
	if (!pack.review.canApprove) {
		throw new Error(pack.review.eligibility.join(" "))
	}
	const reviewerIdRaw = options.reviewerId?.trim() || resolveReviewDecisionActor(options.env ?? process.env)
	const reviewerId = reviewerIdRaw?.trim() ? reviewerIdRaw.trim() : null
	if (pack.review.allowedReviewers.length > 0) {
		if (!reviewerId) {
			throw new Error(`This review requires an explicit reviewer identity from: ${pack.review.allowedReviewers.join(", ")}`)
		}
		if (!pack.review.allowedReviewers.includes(reviewerId)) {
			throw new Error(`Reviewer ${reviewerId} is not allowed by this review policy.`)
		}
	}
	if (pack.review.requiredApprovals > 1 && !reviewerId) {
		throw new Error("This review policy requires reviewer identity so approvals can be recorded transparently.")
	}
	const approvedBy = pack.review.approvedBy.includes(reviewerId ?? "")
		? [...pack.review.approvedBy]
		: reviewerId
			? [...pack.review.approvedBy, reviewerId]
			: [...pack.review.approvedBy]
	if (reviewerId && pack.review.approvedBy.includes(reviewerId)) {
		throw new Error(`Reviewer ${reviewerId} already approved this run.`)
	}
	if (approvedBy.length < pack.review.requiredApprovals) {
		const persisted = persistApprovalProgress(summary, pack, approvedBy, reviewerId)
		return {
			runId,
			decision: "approval_recorded",
			message: `Recorded approval ${approvedBy.length}/${pack.review.requiredApprovals}${reviewerId ? ` from ${reviewerId}` : ""}; merge is still waiting on more reviewers.`,
			summaryPath: persisted.summaryPath,
			reviewPackPath: persisted.reviewPackPath,
			deletedBranches: [],
			leftoverBranches: [],
			approvalCommit: null,
		}
	}

	const dirtyEntries = await getRepoStatusEntries(workspace)
	if (dirtyEntries.length > 0) {
		throw new Error("Workspace has uncommitted changes. Refusing review approval until the workspace is clean.")
	}

	const primaryBranch = pack.cleanup.primaryBranch
	if (!primaryBranch) throw new Error(`Run ${runId} has no primary branch to approve.`)

	try {
		await runGit(workspace, ["merge", "--no-ff", "-m", `swarm: approve review ${runId}`, primaryBranch])
	} catch (err) {
		try {
			await runGit(workspace, ["merge", "--abort"])
		} catch {
			// ignore
		}
		throw err
	}

	const approvalCommit = await getHeadCommit(workspace)
	const branchCleanup = await deleteReviewBranches(workspace, summary.git.branches)
	if (summary.review?.ownedWorktreeDir && fs.existsSync(summary.review.ownedWorktreeDir)) {
		try {
			fs.rmSync(summary.review.ownedWorktreeDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	}

	const decisionBy = reviewerId ?? resolveReviewDecisionActor(options.env ?? process.env)
	const persisted = persistDecisionArtifacts(
		summary,
		pack,
		"approved",
		branchCleanup.deleted,
		branchCleanup.leftover,
		approvalCommit,
		approvedBy,
		decisionBy,
	)
	return {
		runId,
		decision: "approved",
		message: `Approved ${runId} by merging ${primaryBranch} into the main workspace${reviewerId ? ` after final approval by ${reviewerId}` : ""}.`,
		summaryPath: persisted.summaryPath,
		reviewPackPath: persisted.reviewPackPath,
		deletedBranches: branchCleanup.deleted,
		leftoverBranches: branchCleanup.leftover,
		approvalCommit,
	}
}

export async function discardReviewRun(workspace: string, runId: string): Promise<ReviewActionResult> {
	const runDir = resolveRunDir(workspace, runId)
	const summary = normalizeSummary(readRunSummary(runDir), runDir)
	if (!summary) throw new Error(`No summary.json found for run ${runId}`)
	assertSummaryCanMutate(summary, "discard")

	const pack = await ensureReviewPack(workspace, runId)
	const branchCleanup = await deleteReviewBranches(workspace, summary.git.branches)
	if (summary.review?.ownedWorktreeDir && fs.existsSync(summary.review.ownedWorktreeDir)) {
		try {
			fs.rmSync(summary.review.ownedWorktreeDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	}

	const persisted = persistDecisionArtifacts(
		summary,
		pack,
		"discarded",
		branchCleanup.deleted,
		branchCleanup.leftover,
		null,
		pack.review.approvedBy,
		resolveReviewDecisionActor(),
	)
	return {
		runId,
		decision: "discarded",
		message: `Discarded ${runId}; main workspace was left untouched.`,
		summaryPath: persisted.summaryPath,
		reviewPackPath: persisted.reviewPackPath,
		deletedBranches: branchCleanup.deleted,
		leftoverBranches: branchCleanup.leftover,
		approvalCommit: null,
	}
}

export function formatReviewQueueList(items: ReviewQueueItem[]): string {
	if (items.length === 0) return "No pending review items found."
	return [
		"Run ID | Verdict | Stop reason | Merge | Changed files | Task",
		"--- | --- | --- | --- | --- | ---",
		...items.map((item) => {
			const changedFiles = item.changedFiles.length > 0 ? item.changedFiles.join(", ") : "(none recorded)"
			const merge = item.mergeStatus ? `${item.mergeStatus}${item.mergeMode ? `/${item.mergeMode}` : ""}` : "unknown"
			return `${item.runId} | ${item.reviewerVerdict ?? "unknown"} | ${item.stopReason} | ${merge} | ${changedFiles} | ${item.task}`
		}),
	].join("\n")
}

export function formatReviewPack(pack: ReviewPack): string {
	const verificationStatus =
		pack.verificationProfile && typeof pack.verificationProfile["status"] === "string"
			? String(pack.verificationProfile["status"])
			: null
	const verificationName =
		pack.verificationProfile && typeof pack.verificationProfile["profileName"] === "string"
			? String(pack.verificationProfile["profileName"])
			: null
	const verificationMessage =
		pack.verificationProfile && typeof pack.verificationProfile["message"] === "string"
			? String(pack.verificationProfile["message"])
			: null

	return [
		`Run ID: ${pack.runId}`,
		`Task: ${pack.task}`,
		`Status: ${pack.status}`,
		`Stop reason: ${pack.stopReason}`,
		`Next action: ${pack.nextAction.label}`,
		`Next action rationale: ${pack.nextAction.rationale}`,
		`Reviewer verdict: ${pack.reviewerVerdict ?? "unknown"}`,
		`Verification: ${verificationStatus ? `${verificationName ? `${verificationName} -> ` : ""}${verificationStatus}` : "not recorded"}`,
		`Decision: ${pack.review.decision}`,
		`Can approve: ${pack.review.canApprove ? "yes" : "no"}`,
		`Approvals: ${pack.review.approvedBy.length}/${pack.review.requiredApprovals}${pack.review.allowedReviewers.length > 0 ? ` reviewers=${pack.review.allowedReviewers.join(", ")}` : ""}`,
		`Pending reviewers: ${pack.audit?.pendingReviewers?.join(", ") || "(none)"}`,
		`Merge negotiation: ${pack.mergeNegotiation ? `${pack.mergeNegotiation.status} / ${pack.mergeNegotiation.mode}` : "not recorded"}`,
		`Approval package: ${pack.approvalPackage.readiness}`,
		`Approval summary: ${pack.approvalPackage.summary}`,
		`Queued follow-up: ${pack.queueFollowUp.state}`,
		`Merge summary: ${pack.mergeNegotiation?.summary ?? "not recorded"}`,
		`Changed files: ${pack.changedFiles.join(", ") || "(none recorded)"}`,
		`Primary branch: ${pack.cleanup.primaryBranch ?? "(none)"}`,
		`Branches: ${pack.cleanup.ownedBranchNames.join(", ") || "(none)"}`,
		...(verificationMessage ? ["Verification detail:", verificationMessage, ""] : []),
		"",
		"Eligibility:",
		...(pack.review.eligibility.length > 0 ? pack.review.eligibility.map((line) => `- ${line}`) : ["- eligible"]),
		...(pack.mergeNegotiation
			? [
					"",
					"Review stages:",
					...(pack.mergeNegotiation.reviewStages.length > 0
						? pack.mergeNegotiation.reviewStages.map((stage) => `- ${stage.label}: ${stage.status} | ${stage.summary}`)
						: ["- none recorded"]),
					"",
					"Merge checklist:",
					...(pack.mergeNegotiation.reviewChecklist.length > 0
						? pack.mergeNegotiation.reviewChecklist.map((line) => `- ${line}`)
						: ["- none recorded"]),
					"",
					"Conflict review:",
					...(pack.mergeNegotiation.conflictReview.length > 0
						? pack.mergeNegotiation.conflictReview.map((line) => `- ${line}`)
						: ["- none recorded"]),
			  ]
			: []),
		"",
		"Approval focus:",
		...(pack.approvalPackage.focusAreas.length > 0
			? pack.approvalPackage.focusAreas.map((area) => `- ${area}`)
			: ["- none recorded"]),
		"",
		"Approval checks:",
		...(pack.approvalPackage.requiredChecks.length > 0
			? pack.approvalPackage.requiredChecks.map((check) => `- ${check}`)
			: ["- none recorded"]),
		"",
		"Queued follow-up:",
		`- pending=${pack.queueFollowUp.pendingCount} ready=${pack.queueFollowUp.readyCount} awaiting_approval=${pack.queueFollowUp.awaitingApprovalCount} scheduled=${pack.queueFollowUp.scheduledCount} state=${pack.queueFollowUp.state}`,
		`- summary=${pack.queueFollowUp.summary}`,
		`- next task=${pack.queueFollowUp.nextTask ?? "(none)"}`,
		`- next command=${pack.queueFollowUp.nextCommandHint ?? "(none)"}`,
		...(pack.postMergeQuality
			? [
					"",
					"Post-merge quality:",
					`- status=${pack.postMergeQuality.status} risk=${pack.postMergeQuality.approvalRisk ?? "none"} targeted=${pack.postMergeQuality.targetedEvaluatorStatus}(${pack.postMergeQuality.targetedConcernCount})`,
					`- summary=${pack.postMergeQuality.summary}`,
					...(pack.postMergeQuality.followUpChecks.length > 0
						? pack.postMergeQuality.followUpChecks.map((check) => `- follow-up: ${check}`)
						: ["- follow-up: none recorded"]),
			  ]
			: []),
		"",
		"Operator audit:",
		...(pack.audit?.history && pack.audit.history.length > 0
			? pack.audit.history.map(
					(entry) =>
						`- ${entry.recordedAt} | ${entry.action} | actor=${entry.actor ?? "(unknown)"} | approvals=${entry.approvedBy.join(", ") || "(none)"}`,
			  )
			: ["- none recorded"]),
		"",
		"Diff stat:",
		pack.diffStat || "(diff stat unavailable)",
		"",
		"Diff preview:",
		pack.diffPreview || "(diff preview unavailable)",
	].join("\n")
}
