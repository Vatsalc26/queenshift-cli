import fs from "node:fs"
import path from "node:path"

import type { AcceptanceGateResult } from "../run/AcceptanceGate"
import type { VerificationProfileResult } from "../run/VerificationProfile"
import type { AssignmentLedger } from "./AssignmentLedger"
import { buildContinuationState, formatContinuationState, type CampaignContinuationState } from "./CampaignContinuation"
import type { CompletionLedger } from "./CompletionLedger"
import type { CriticArtifact } from "./CriticLane"
import type { PlanningContinuationSurface, PlanningStageWindow } from "./PlanningHorizon"

export type RetryDecision = "not_needed" | "retryable" | "refuse"

export type RetryReasonCategory =
	| "critic_concern"
	| "review_feedback"
	| "verification_recoverable"
	| "acceptance_scope_gap"
	| "provider_retryable"
	| "incident_red_lane"
	| "out_of_bounds"

export type RetryReason = {
	category: RetryReasonCategory
	detail: string
}

export type RetrySnapshot = {
	schemaVersion: 1
	runId: string
	task: string
	continuation: CampaignContinuationState
	taskContract: Record<string, unknown> | null
	recoveryState: RetryRecoveryState | null
	assignments: Array<{
		assignmentId: string
		assignmentToken: string
		workItemId: string
		ownedFiles: string[]
		dependsOn: string[]
	}>
	checkpointRefs: {
		summaryPath: string
		reviewPackPath: string | null
		incidentPackPath: string | null
		checkpointArtifactPath: string | null
	}
	profileManifestHash: string | null
	retryCountUsed: number
	maxRetryCount: number
}

export type RetryProposal = {
	attemptNumber: number
	label: string
	rationale: string
	taskOverride: string | null
	requiredSnapshotPath: string
}

export type RetryRecoveryMode = "not_needed" | "retry_same_snapshot" | "resume_remaining_work" | "replan_remaining_stage"

export type RetryRecoveryState = {
	mode: RetryRecoveryMode
	continuationSurface: PlanningContinuationSurface
	completedWorkItems: string[]
	remainingWorkItems: string[]
	completedFiles: string[]
	remainingFiles: string[]
	stageSummary: PlanningStageWindow | null
}

export type RetryPlannerArtifact = {
	schemaVersion: 1
	decision: RetryDecision
	continuation: CampaignContinuationState | null
	recoveryState: RetryRecoveryState | null
	reasons: RetryReason[]
	maxRetryCount: number
	retryCountUsed: number
	retriesRemaining: number
	strictSnapshotRequired: boolean
	snapshotPath: string | null
	proposals: RetryProposal[]
	summary: string
}

export type RetryIncidentSignal = {
	redLaneRecommended: boolean
	nextActionLabel: string | null
	failureBucket: string | null
}

const RETRYABLE_STOP_REASONS = new Set([
	"review_blocked",
	"reviewer_invalid",
	"reviewer_unavailable",
	"missing_expected_change",
	"no_diff_evidence",
	"verification_failed",
	"verification_timeout",
	"provider_timeout",
	"provider_transport_failure",
	"provider_empty_response",
])

const OUT_OF_BOUNDS_STOP_REASONS = new Set([
	"scope_drift",
	"too_many_changed_files",
	"merge_conflict",
	"command_blocked",
	"dirty_repo_refusal",
	"workspace_run_locked",
])

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

function formatStageSummary(stageSummary: PlanningStageWindow | null): string {
	if (!stageSummary) return "(none)"
	return `active=${stageSummary.activeStage ?? "(none)"} next=${stageSummary.nextStage ?? "(none)"} completed=${stageSummary.completedStages.join(", ") || "(none)"} remaining=${stageSummary.remainingStages.join(", ") || "(none)"}`
}

function buildRetryRecoveryState(input: {
	assignments: AssignmentLedger | null
	completionLedger?: CompletionLedger | null
}): RetryRecoveryState | null {
	if (!input.assignments) return null
	const completedWorkItems = uniqueStrings(
		(input.completionLedger?.entries ?? [])
			.filter((entry) => entry.state === "complete")
			.map((entry) => entry.workItemId),
	)
	const assignmentByWorkItemId = new Map(input.assignments.assignments.map((assignment) => [assignment.workItemId, assignment] as const))
	const remainingWorkItems = uniqueStrings(
		input.assignments.assignments
			.map((assignment) => assignment.workItemId)
			.filter((workItemId) => !completedWorkItems.includes(workItemId)),
	)
	const completedFiles = uniqueStrings(completedWorkItems.flatMap((workItemId) => assignmentByWorkItemId.get(workItemId)?.ownedFiles ?? []))
	const remainingFiles = uniqueStrings(remainingWorkItems.flatMap((workItemId) => assignmentByWorkItemId.get(workItemId)?.ownedFiles ?? []))
	const stageSummary = input.completionLedger?.stageSummary ?? null
	const continuationSurface =
		input.completionLedger?.continuationSurface ?? (stageSummary && stageSummary.totalStages > 1 ? "retry_planner_checkpoint_artifacts" : "not_needed")
	let mode: RetryRecoveryMode = "retry_same_snapshot"
	if (remainingWorkItems.length === 0) mode = "not_needed"
	else if (completedWorkItems.length > 0) mode = "resume_remaining_work"
	else if (continuationSurface === "retry_planner_checkpoint_artifacts") mode = "replan_remaining_stage"
	return {
		mode,
		continuationSurface,
		completedWorkItems,
		remainingWorkItems,
		completedFiles,
		remainingFiles,
		stageSummary,
	}
}

function summarizeAcceptanceFailure(acceptanceGate: AcceptanceGateResult): string {
	if (acceptanceGate.failedChecks.length > 0) {
		return acceptanceGate.failedChecks.map((failure) => failure.message).join(" ")
	}
	return "Acceptance gate failed."
}

function summarizeVerification(verificationProfile: VerificationProfileResult): string {
	if (verificationProfile.message?.trim()) return verificationProfile.message.trim()
	if (verificationProfile.profileName?.trim()) return `${verificationProfile.profileName} -> ${verificationProfile.status}`
	return verificationProfile.status
}

function buildReasons(input: {
	stopReason: string
	reviewerVerdict?: "PASS" | "NEEDS_WORK" | null
	acceptanceGate?: AcceptanceGateResult | null
	verificationProfile?: VerificationProfileResult | null
	criticLane?: CriticArtifact | null
	incidentSignal?: RetryIncidentSignal | null
}): RetryReason[] {
	const reasons: RetryReason[] = []

	if (input.incidentSignal?.redLaneRecommended) {
		reasons.push({
			category: "incident_red_lane",
			detail: input.incidentSignal.nextActionLabel
				? `Incident lane recommends ${input.incidentSignal.nextActionLabel}.`
				: "Incident lane recommends a FixRedLane response.",
		})
	}

	if (OUT_OF_BOUNDS_STOP_REASONS.has(input.stopReason)) {
		reasons.push({
			category: "out_of_bounds",
			detail: `Stop reason ${input.stopReason} is outside the bounded retry lane.`,
		})
	}

	if (input.reviewerVerdict === "NEEDS_WORK") {
		reasons.push({
			category: "review_feedback",
			detail: "Reviewer requested more work before acceptance.",
		})
	}

	if (input.acceptanceGate && !input.acceptanceGate.passed) {
		reasons.push({
			category: "acceptance_scope_gap",
			detail: summarizeAcceptanceFailure(input.acceptanceGate),
		})
	}

	if (
		input.verificationProfile &&
		input.verificationProfile.status !== "passed" &&
		input.verificationProfile.status !== "not_applicable"
	) {
		reasons.push({
			category: "verification_recoverable",
			detail: summarizeVerification(input.verificationProfile),
		})
	}

	if (input.criticLane?.status === "concern") {
		for (const concern of input.criticLane.concerns) {
			reasons.push({
				category: "critic_concern",
				detail: `${concern.category}: ${concern.evidence}`,
			})
		}
	}

	if (RETRYABLE_STOP_REASONS.has(input.stopReason)) {
		reasons.push({
			category: "provider_retryable",
			detail: `Stop reason ${input.stopReason} stays inside the bounded retry lane.`,
		})
	}

	return reasons
}

function buildRetrySnapshot(input: {
	runId: string
	task: string
	continuation: CampaignContinuationState
	taskContract: Record<string, unknown> | null
	assignments: AssignmentLedger
	checkpointRefs: RetrySnapshot["checkpointRefs"]
	recoveryState: RetryRecoveryState | null
	profileManifestHash: string | null
	retryCountUsed: number
	maxRetryCount: number
}): RetrySnapshot {
	return {
		schemaVersion: 1,
		runId: input.runId,
		task: input.task,
		continuation: input.continuation,
		taskContract: input.taskContract,
		recoveryState: input.recoveryState,
		assignments: input.assignments.assignments.map((assignment) => ({
			assignmentId: assignment.assignmentId,
			assignmentToken: assignment.assignmentToken,
			workItemId: assignment.workItemId,
			ownedFiles: [...assignment.ownedFiles],
			dependsOn: [...assignment.dependsOn],
		})),
		checkpointRefs: input.checkpointRefs,
		profileManifestHash: input.profileManifestHash,
		retryCountUsed: input.retryCountUsed,
		maxRetryCount: input.maxRetryCount,
	}
}

export function writeRetrySnapshot(runDir: string, snapshot: RetrySnapshot): string {
	const snapshotPath = path.join(runDir, "retry-snapshot.json")
	fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
	return snapshotPath
}

export function readRetrySnapshot(snapshotPath: string): RetrySnapshot | null {
	if (!fs.existsSync(snapshotPath)) return null
	try {
		return JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as RetrySnapshot
	} catch {
		return null
	}
}

export function planRetryWithSnapshot(
	runDir: string,
	input: {
		runId: string
		task: string
		finalStatus: "done" | "review_required" | "failed"
		stopReason: string
		reviewerVerdict?: "PASS" | "NEEDS_WORK" | null
		acceptanceGate?: AcceptanceGateResult | null
		verificationProfile?: VerificationProfileResult | null
		criticLane?: CriticArtifact | null
		incidentSignal?: RetryIncidentSignal | null
		assignments: AssignmentLedger | null
		completionLedger?: CompletionLedger | null
		taskContract: Record<string, unknown> | null
		checkpointRefs: RetrySnapshot["checkpointRefs"]
		profileManifestHash?: string | null
		retryCountUsed?: number
		maxRetryCount?: number
		continuationState?: CampaignContinuationState | null
	},
): { planner: RetryPlannerArtifact; snapshot: RetrySnapshot | null; snapshotPath: string | null } {
	const retryCountUsed = Math.max(0, input.retryCountUsed ?? 0)
	const maxRetryCount = Math.max(1, input.maxRetryCount ?? 2)
	const continuation = buildContinuationState(input.runId, input.continuationState ?? null)
	const recoveryState = buildRetryRecoveryState({
		assignments: input.assignments,
		completionLedger: input.completionLedger ?? null,
	})
	const reasons = buildReasons(input)
	const retriesRemaining = Math.max(0, maxRetryCount - retryCountUsed)

	if (input.finalStatus === "done") {
		return {
			planner: {
				schemaVersion: 1,
				decision: "not_needed",
				continuation,
				recoveryState,
				reasons: [],
				maxRetryCount,
				retryCountUsed,
				retriesRemaining,
				strictSnapshotRequired: false,
				snapshotPath: null,
				proposals: [],
				summary: "Retry planner not needed because the run already completed successfully.",
			},
			snapshot: null,
			snapshotPath: null,
		}
	}

	const refusesRetry = reasons.some((reason) => reason.category === "incident_red_lane" || reason.category === "out_of_bounds")
	const retryable =
		!refusesRetry &&
		retriesRemaining > 0 &&
		Boolean(input.assignments) &&
		reasons.some((reason) =>
			["critic_concern", "review_feedback", "verification_recoverable", "acceptance_scope_gap", "provider_retryable"].includes(
				reason.category,
			),
		)

	if (!retryable || !input.assignments) {
		return {
			planner: {
				schemaVersion: 1,
				decision: "refuse",
				continuation,
				recoveryState,
				reasons,
				maxRetryCount,
				retryCountUsed,
				retriesRemaining,
				strictSnapshotRequired: false,
				snapshotPath: null,
				proposals: [],
				summary: refusesRetry
					? "Retry planner refused another attempt because the lane is red or out of bounds."
					: "Retry planner refused another attempt because no exact bounded retry snapshot could be justified.",
			},
			snapshot: null,
			snapshotPath: null,
		}
	}

	const snapshot = buildRetrySnapshot({
		runId: input.runId,
		task: input.task,
		continuation,
		taskContract: input.taskContract,
		assignments: input.assignments,
		checkpointRefs: input.checkpointRefs,
		recoveryState,
		profileManifestHash: input.profileManifestHash ?? null,
		retryCountUsed,
		maxRetryCount,
	})
	const snapshotPath = writeRetrySnapshot(runDir, snapshot)
	const proposals: RetryProposal[] = []
	if (recoveryState?.mode === "resume_remaining_work") {
		proposals.push({
			attemptNumber: continuation.nextAttemptNumber,
			label: `resume remaining work (attempt ${continuation.nextAttemptNumber})`,
			rationale:
				recoveryState.completedWorkItems.length > 0
					? `Completed work items ${recoveryState.completedWorkItems.join(", ")} are already preserved, so the next attempt should continue only ${recoveryState.remainingWorkItems.join(", ")}.`
					: "Completed bounded work is already preserved, so the next attempt should continue only the remaining work items.",
			taskOverride: [
				input.task.trim(),
				"",
				"Recovery mode: resume_remaining_work",
				`Preserved completed work items: ${recoveryState.completedWorkItems.join(", ") || "(none)"}`,
				`Resume only these remaining work items: ${recoveryState.remainingWorkItems.join(", ") || "(none)"}`,
				`Resume only these remaining files: ${recoveryState.remainingFiles.join(", ") || "(none)"}`,
				`Continuation surface: ${recoveryState.continuationSurface}`,
				`Stage summary: ${formatStageSummary(recoveryState.stageSummary)}`,
				"Do not widen scope beyond the remaining bounded work.",
			].join("\n"),
			requiredSnapshotPath: snapshotPath,
		})
	} else if (recoveryState?.mode === "replan_remaining_stage") {
		proposals.push({
			attemptNumber: continuation.nextAttemptNumber,
			label: `replan remaining stage (attempt ${continuation.nextAttemptNumber})`,
			rationale: `Stage-gated recovery should restate only the remaining active stage before retrying (${formatStageSummary(recoveryState.stageSummary)}).`,
			taskOverride: [
				input.task.trim(),
				"",
				"Recovery mode: replan_remaining_stage",
				`Continue only these remaining work items: ${recoveryState.remainingWorkItems.join(", ") || "(none)"}`,
				`Continue only these remaining files: ${recoveryState.remainingFiles.join(", ") || "(none)"}`,
				`Continuation surface: ${recoveryState.continuationSurface}`,
				`Stage summary: ${formatStageSummary(recoveryState.stageSummary)}`,
				"Do not reopen already-completed or out-of-stage work.",
			].join("\n"),
			requiredSnapshotPath: snapshotPath,
		})
	} else {
		proposals.push({
			attemptNumber: continuation.nextAttemptNumber,
			label: `retry bounded plan (attempt ${continuation.nextAttemptNumber})`,
			rationale: reasons[0]?.detail ?? "Retry stays inside the same bounded assignment snapshot.",
			taskOverride: null,
			requiredSnapshotPath: snapshotPath,
		})
	}

	if (input.criticLane?.status === "concern" && input.assignments.assignments.length > 0) {
		const narrowFiles = recoveryState?.remainingFiles.length
			? recoveryState.remainingFiles
			: Array.from(new Set(input.assignments.assignments.flatMap((assignment) => assignment.ownedFiles)))
		proposals.push({
			attemptNumber: continuation.nextAttemptNumber,
			label: `retry with explicit file list (attempt ${continuation.nextAttemptNumber})`,
			rationale:
				recoveryState?.mode === "resume_remaining_work"
					? "Critic concerns suggest restating the exact remaining-file boundary for the next attempt."
					: "Critic concerns suggest restating the exact owned-file boundary for the next attempt.",
			taskOverride: `${input.task}\n\nRetry boundary: only touch ${narrowFiles.join(", ")}.`,
			requiredSnapshotPath: snapshotPath,
		})
	}

	return {
		planner: {
			schemaVersion: 1,
			decision: "retryable",
			continuation,
			recoveryState,
			reasons,
			maxRetryCount,
			retryCountUsed,
			retriesRemaining,
			strictSnapshotRequired: true,
			snapshotPath,
			proposals,
			summary: `Retry planner preserved an exact bounded snapshot for ${continuation.campaignId}; recovery mode=${recoveryState?.mode ?? "retry_same_snapshot"} completed=${recoveryState?.completedWorkItems.length ?? 0} remaining=${recoveryState?.remainingWorkItems.length ?? 0}; next attempt ${continuation.nextAttemptNumber} has ${retriesRemaining} retry slot(s) remaining.`,
		},
		snapshot,
		snapshotPath,
	}
}

export function buildRetryPlannerArtifact(input: {
	continuation?: CampaignContinuationState | null
	recoveryState?: RetryRecoveryState | null
	reasons: RetryReason[]
	maxRetryCount: number
	retryCountUsed: number
	retriesRemaining: number
	strictSnapshotRequired: boolean
	snapshotPath: string | null
	proposals: RetryProposal[]
}): RetryPlannerArtifact {
	if (input.strictSnapshotRequired && !input.snapshotPath) {
		return {
			schemaVersion: 1,
			decision: "refuse",
			continuation: input.continuation ?? null,
			recoveryState: input.recoveryState ?? null,
			reasons: input.reasons,
			maxRetryCount: input.maxRetryCount,
			retryCountUsed: input.retryCountUsed,
			retriesRemaining: input.retriesRemaining,
			strictSnapshotRequired: true,
			snapshotPath: null,
			proposals: [],
			summary: "Retry planner refused generic fallback because the exact retry snapshot is missing.",
		}
	}

	return {
		schemaVersion: 1,
		decision: input.snapshotPath ? "retryable" : "refuse",
		continuation: input.continuation ?? null,
		recoveryState: input.recoveryState ?? null,
		reasons: input.reasons,
		maxRetryCount: input.maxRetryCount,
		retryCountUsed: input.retryCountUsed,
		retriesRemaining: input.retriesRemaining,
		strictSnapshotRequired: input.strictSnapshotRequired,
		snapshotPath: input.snapshotPath,
		proposals: input.snapshotPath ? input.proposals : [],
		summary: input.snapshotPath
			? "Retry planner preserved an exact bounded snapshot."
			: "Retry planner refused generic fallback because the exact retry snapshot is missing.",
	}
}

export function formatRetryPlannerArtifact(planner: RetryPlannerArtifact): string {
	return [
		`Decision: ${planner.decision}`,
		formatContinuationState(planner.continuation),
		`Recovery mode: ${planner.recoveryState?.mode ?? "(none)"}`,
		`Continuation surface: ${planner.recoveryState?.continuationSurface ?? "(none)"}`,
		`Recovered work: completed=${planner.recoveryState?.completedWorkItems.join(", ") || "(none)"} remaining=${planner.recoveryState?.remainingWorkItems.join(", ") || "(none)"}`,
		`Recovered files: completed=${planner.recoveryState?.completedFiles.join(", ") || "(none)"} remaining=${planner.recoveryState?.remainingFiles.join(", ") || "(none)"}`,
		`Stage summary: ${formatStageSummary(planner.recoveryState?.stageSummary ?? null)}`,
		`Retries: used=${planner.retryCountUsed} remaining=${planner.retriesRemaining} max=${planner.maxRetryCount}`,
		`Strict snapshot required: ${planner.strictSnapshotRequired ? "yes" : "no"}`,
		`Snapshot: ${planner.snapshotPath ?? "(none)"}`,
		`Summary: ${planner.summary}`,
		...(planner.reasons.length > 0 ? ["Reasons:", ...planner.reasons.map((reason) => `- ${reason.category}: ${reason.detail}`)] : []),
		...(planner.proposals.length > 0 ? ["Proposals:", ...planner.proposals.map((proposal) => `- ${proposal.label}`)] : []),
	].join("\n")
}
