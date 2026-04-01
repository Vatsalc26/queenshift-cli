import type { AssignmentEntry, AssignmentLedger } from "./AssignmentLedger"
import { formatContinuationState, type CampaignContinuationState } from "./CampaignContinuation"

export type CheckpointStatus = "none" | "partial" | "complete"

export type AssignmentCheckpointBoundary = {
	kind: "assignment_commit"
	recordedAt: string
	workItemId: string
	assignmentId: string
	branchName: string | null
	reason: string
}

export type RetryCheckpointBoundary = {
	kind: "retry_snapshot"
	recordedAt: string
	retrySnapshotPath: string
	reason: string
}

export type RecordedCheckpointBoundary = AssignmentCheckpointBoundary | RetryCheckpointBoundary

export type CheckpointAssignmentRef = {
	workItemId: string
	assignmentId: string
	assignmentToken: string
	assignedBuilder: string
	ownedFiles: string[]
	dependsOn: string[]
	branchName: string | null
}

export type CheckpointEntry = {
	checkpointId: string
	kind: RecordedCheckpointBoundary["kind"]
	recordedAt: string
	label: string
	reason: string
	newlyCompletedAssignments: CheckpointAssignmentRef[]
	cumulativeCompletedAssignments: CheckpointAssignmentRef[]
	newlyCompletedWorkItems: string[]
	cumulativeCompletedWorkItems: string[]
	remainingWorkItems: string[]
	retrySnapshotPath: string | null
	profileManifestHash: string | null
}

export type CheckpointArtifact = {
	schemaVersion: 1
	runId: string
	runStatus: "done" | "review_required" | "failed"
	status: CheckpointStatus
	continuation: CampaignContinuationState | null
	profileManifestHash: string | null
	totalWorkItems: number
	completedWorkItems: string[]
	remainingWorkItems: string[]
	latestCheckpointId: string | null
	latestRetrySnapshotPath: string | null
	checkpoints: CheckpointEntry[]
	summary: string
	warnings: string[]
}

function makeAssignmentRef(entry: AssignmentEntry, branchName: string | null): CheckpointAssignmentRef {
	return {
		workItemId: entry.workItemId,
		assignmentId: entry.assignmentId,
		assignmentToken: entry.assignmentToken,
		assignedBuilder: entry.assignedBuilder,
		ownedFiles: [...entry.ownedFiles],
		dependsOn: [...entry.dependsOn],
		branchName,
	}
}

function sortBoundaries(boundaries: RecordedCheckpointBoundary[]): RecordedCheckpointBoundary[] {
	return boundaries
		.map((boundary, index) => ({ boundary, index }))
		.sort((left, right) => {
			const timeCompare = left.boundary.recordedAt.localeCompare(right.boundary.recordedAt)
			return timeCompare !== 0 ? timeCompare : left.index - right.index
		})
		.map((entry) => entry.boundary)
}

function summarizeArtifact(input: {
	completedWorkItems: string[]
	totalWorkItems: number
	remainingWorkItems: string[]
	latestRetrySnapshotPath: string | null
	checkpointCount: number
	continuation: CampaignContinuationState | null
}): string {
	if (input.totalWorkItems === 0) return "Checkpoint artifact is not applicable because no bounded assignments were created."
	if (input.checkpointCount === 0) {
		return "No truthful checkpoint boundaries were recorded before the run ended."
	}

	const base = `Checkpoint artifact preserved ${input.completedWorkItems.length}/${input.totalWorkItems} completed work item(s); ${input.remainingWorkItems.length} remain.`
	const campaign = input.continuation ? ` ${formatContinuationState(input.continuation)}.` : ""
	if (input.latestRetrySnapshotPath) {
		return `${base}${campaign} Exact retry snapshot saved at ${input.latestRetrySnapshotPath}.`
	}
	return `${base}${campaign}`.trim()
}

export function buildCheckpointArtifact(input: {
	runId: string
	runStatus: "done" | "review_required" | "failed"
	assignments: AssignmentLedger | null
	recordedBoundaries: RecordedCheckpointBoundary[]
	profileManifestHash?: string | null
	continuationState?: CampaignContinuationState | null
}): CheckpointArtifact | null {
	if (!input.assignments) return null

	const assignments = input.assignments.assignments
	const assignmentById = new Map(assignments.map((assignment) => [assignment.assignmentId, assignment]))
	const completedAssignmentIds = new Set<string>()
	const branchNamesByAssignmentId = new Map<string, string | null>()
	const warnings: string[] = []
	const checkpoints: CheckpointEntry[] = []
	let latestRetrySnapshotPath: string | null = null

	for (const boundary of sortBoundaries(input.recordedBoundaries)) {
		const newlyCompletedAssignments: CheckpointAssignmentRef[] = []
		const newlyCompletedWorkItems: string[] = []

		if (boundary.kind === "assignment_commit") {
			const assignment = assignmentById.get(boundary.assignmentId)
			if (!assignment) {
				warnings.push(`Checkpoint boundary referenced missing assignment ${boundary.assignmentId}.`)
				continue
			}
			if (!completedAssignmentIds.has(boundary.assignmentId)) {
				completedAssignmentIds.add(boundary.assignmentId)
				newlyCompletedWorkItems.push(assignment.workItemId)
			}
			branchNamesByAssignmentId.set(boundary.assignmentId, boundary.branchName)
			newlyCompletedAssignments.push(makeAssignmentRef(assignment, boundary.branchName))
		} else {
			latestRetrySnapshotPath = boundary.retrySnapshotPath
		}

		const cumulativeCompletedAssignments = assignments
			.filter((assignment) => completedAssignmentIds.has(assignment.assignmentId))
			.map((assignment) => makeAssignmentRef(assignment, branchNamesByAssignmentId.get(assignment.assignmentId) ?? null))
		const cumulativeCompletedWorkItems = cumulativeCompletedAssignments.map((assignment) => assignment.workItemId)
		const remainingWorkItems = assignments
			.filter((assignment) => !completedAssignmentIds.has(assignment.assignmentId))
			.map((assignment) => assignment.workItemId)

		checkpoints.push({
			checkpointId: `checkpoint-${checkpoints.length + 1}`,
			kind: boundary.kind,
			recordedAt: boundary.recordedAt,
			label:
				boundary.kind === "assignment_commit"
					? `Committed bounded work item ${boundary.workItemId}`
					: "Saved exact retry snapshot",
			reason: boundary.reason,
			newlyCompletedAssignments,
			cumulativeCompletedAssignments,
			newlyCompletedWorkItems,
			cumulativeCompletedWorkItems,
			remainingWorkItems,
			retrySnapshotPath: boundary.kind === "retry_snapshot" ? boundary.retrySnapshotPath : null,
			profileManifestHash: input.profileManifestHash ?? null,
		})
	}

	const completedWorkItems = assignments
		.filter((assignment) => completedAssignmentIds.has(assignment.assignmentId))
		.map((assignment) => assignment.workItemId)
	const remainingWorkItems = assignments
		.filter((assignment) => !completedAssignmentIds.has(assignment.assignmentId))
		.map((assignment) => assignment.workItemId)
	const status: CheckpointStatus =
		completedWorkItems.length === 0
			? "none"
			: completedWorkItems.length === assignments.length
				? "complete"
				: "partial"

	return {
		schemaVersion: 1,
		runId: input.runId,
		runStatus: input.runStatus,
		status,
		continuation: input.continuationState ?? null,
		profileManifestHash: input.profileManifestHash ?? null,
		totalWorkItems: assignments.length,
		completedWorkItems,
		remainingWorkItems,
		latestCheckpointId: checkpoints.at(-1)?.checkpointId ?? null,
		latestRetrySnapshotPath,
		checkpoints,
		summary: summarizeArtifact({
			completedWorkItems,
			totalWorkItems: assignments.length,
			remainingWorkItems,
			latestRetrySnapshotPath,
			checkpointCount: checkpoints.length,
			continuation: input.continuationState ?? null,
		}),
		warnings,
	}
}

export function formatCheckpointArtifact(artifact: CheckpointArtifact | null): string {
	if (!artifact) return "Checkpoint artifact: (not applicable)"
	return [
		`Status: ${artifact.status}`,
		`Run status: ${artifact.runStatus}`,
		formatContinuationState(artifact.continuation),
		`Work items: completed=${artifact.completedWorkItems.length}/${artifact.totalWorkItems}`,
		`Retry snapshot: ${artifact.latestRetrySnapshotPath ?? "(none)"}`,
		`Summary: ${artifact.summary}`,
		...(artifact.warnings.length > 0 ? ["Warnings:", ...artifact.warnings.map((warning) => `- ${warning}`)] : []),
		"Checkpoints:",
		...(artifact.checkpoints.length > 0
			? artifact.checkpoints.map(
					(checkpoint) =>
						`- ${checkpoint.checkpointId} ${checkpoint.kind} -> completed=${checkpoint.cumulativeCompletedWorkItems.join(", ") || "(none)"} remaining=${checkpoint.remainingWorkItems.join(", ") || "(none)"}`,
			  )
			: ["- (none)"]),
	].join("\n")
}
