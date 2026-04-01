import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { buildContinuationState, formatContinuationState, type CampaignContinuationState } from "../planning/CampaignContinuation"
import type { PlanningContinuationSurface, PlanningStageWindow } from "../planning/PlanningHorizon"
import type { CheckpointArtifact, CheckpointAssignmentRef } from "../planning/Checkpoints"
import { readRetrySnapshot, type RetryRecoveryMode, type RetrySnapshot } from "../planning/RetryPlanner"
import { resolveCampaignSummary } from "./CampaignOps"
import {
	findLatestRunSummary,
	listRunDirs,
	readCheckpointArtifact,
	readRunSummary,
	resolveRunDir,
	resolveRunSummaryPath,
} from "./RunArtifacts"

export type ResumeReasonCode =
	| "run_already_done"
	| "checkpoint_artifact_missing"
	| "checkpoint_artifact_invalid"
	| "retry_snapshot_missing"
	| "retry_snapshot_invalid"
	| "retry_snapshot_mismatch"
	| "no_remaining_work"
	| "remaining_assignment_missing"
	| "manifest_validation_missing"
	| "manifest_drift"
	| "completed_branch_missing"

export type ResumeCandidate = {
	runId: string
	task: string
	status: string
	resumable: boolean
	reasonCodes: ResumeReasonCode[]
	message: string
	summaryPath: string
	checkpointArtifactPath: string | null
	retrySnapshotPath: string | null
	lastCheckpointId: string | null
	profileManifestHash: string | null
	continuation: CampaignContinuationState | null
	recoveryMode: RetryRecoveryMode | null
	continuationSurface: PlanningContinuationSurface | null
	stageSummary: PlanningStageWindow | null
	completedWorkItems: string[]
	remainingWorkItems: string[]
	completedBranches: string[]
	remainingFiles: string[]
	resumeTask: string | null
	taskContract: Record<string, unknown> | null
	campaignRunCount: number
	campaignQueuedCount: number
	campaignNextQueuedTask: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

async function branchExists(workspace: string, branch: string): Promise<boolean> {
	try {
		const code = await new Promise<number | null>((resolve, reject) => {
			const child = spawn("git", ["-c", `safe.directory=${workspace}`, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
				cwd: workspace,
				windowsHide: true,
				stdio: "ignore",
			})
			child.once("error", reject)
			child.once("close", (exitCode) => resolve(typeof exitCode === "number" ? exitCode : null))
		})
		return code === 0
	} catch {
		return false
	}
}

function latestCompletedAssignments(checkpoints: CheckpointArtifact): CheckpointAssignmentRef[] {
	return checkpoints.checkpoints.at(-1)?.cumulativeCompletedAssignments ?? []
}

function deriveTaskContract(summary: Record<string, unknown>, remainingFiles: string[]): Record<string, unknown> | null {
	if (remainingFiles.length === 0) return null
	const taskContract = asRecord(summary["taskContract"])
	const scope = asRecord(taskContract?.["scope"])
	const allKnownFiles = uniqueStrings(
		remainingFiles.concat(asStringArray(scope?.["allowedFiles"])).concat(asStringArray(scope?.["readOnlyContextFiles"])),
	)
	return {
		...(taskContract ?? {}),
		scope: {
			...(scope ?? {}),
			allowedFiles: remainingFiles,
			requiredTargetFiles: remainingFiles,
			readOnlyContextFiles: allKnownFiles,
		},
	}
}

function buildResumeTask(
	task: string,
	runId: string,
	remainingWorkItems: string[],
	remainingFiles: string[],
	completedBranches: string[],
	continuation: CampaignContinuationState | null,
	recoveryState: RetrySnapshot["recoveryState"] | null,
): string {
	const lines = [
		task.trim(),
		"",
		`Resume source run: ${runId}`,
		`Resume only these remaining work items: ${remainingWorkItems.join(", ")}`,
		`Resume only these remaining files: ${remainingFiles.join(", ")}`,
	]
	if (completedBranches.length > 0) {
		lines.push(`Already-completed bounded branches preserved separately: ${completedBranches.join(", ")}`)
	}
	if (recoveryState) {
		lines.push(`Resume recovery mode: ${recoveryState.mode}`)
		lines.push(`Resume continuation surface: ${recoveryState.continuationSurface}`)
		lines.push(`Resume stage summary: active=${recoveryState.stageSummary?.activeStage ?? "(none)"} next=${recoveryState.stageSummary?.nextStage ?? "(none)"} completed=${recoveryState.stageSummary?.completedStages.join(", ") || "(none)"} remaining=${recoveryState.stageSummary?.remainingStages.join(", ") || "(none)"}`)
		if (recoveryState.completedWorkItems.length > 0) {
			lines.push(`Already recovered completed work items: ${recoveryState.completedWorkItems.join(", ")}`)
		}
	}
	if (continuation) {
		lines.push(`Resume campaign: ${continuation.campaignId}`)
		lines.push(`Resume next attempt number: ${continuation.nextAttemptNumber}`)
		lines.push(`Earlier attempts in this campaign: ${continuation.sourceRunIds.join(", ")}`)
	}
	lines.push("Do not widen scope beyond the remaining work items.")
	return lines.join("\n")
}

function buildSuccessCandidate(input: {
	runId: string
	task: string
	status: string
	summaryPath: string
	checkpointArtifactPath: string
	retrySnapshotPath: string
	checkpoints: CheckpointArtifact
	retrySnapshot: RetrySnapshot
	continuation: CampaignContinuationState | null
	recoveryMode: RetryRecoveryMode | null
	continuationSurface: PlanningContinuationSurface | null
	stageSummary: PlanningStageWindow | null
	resumeTask: string
	taskContract: Record<string, unknown> | null
	completedBranches: string[]
	remainingFiles: string[]
	campaignRunCount: number
	campaignQueuedCount: number
	campaignNextQueuedTask: string | null
}): ResumeCandidate {
	return {
		runId: input.runId,
		task: input.task,
		status: input.status,
		resumable: true,
		reasonCodes: [],
		message: `Resume is allowed from ${input.runId}; ${input.checkpoints.remainingWorkItems.length} work item(s) remain.`,
		summaryPath: input.summaryPath,
		checkpointArtifactPath: input.checkpointArtifactPath,
		retrySnapshotPath: input.retrySnapshotPath,
		lastCheckpointId: input.checkpoints.latestCheckpointId,
		profileManifestHash: input.retrySnapshot.profileManifestHash ?? input.checkpoints.profileManifestHash ?? null,
		continuation: input.continuation,
		recoveryMode: input.recoveryMode,
		continuationSurface: input.continuationSurface,
		stageSummary: input.stageSummary,
		completedWorkItems: [...input.checkpoints.completedWorkItems],
		remainingWorkItems: [...input.checkpoints.remainingWorkItems],
		completedBranches: [...input.completedBranches],
		remainingFiles: [...input.remainingFiles],
		resumeTask: input.resumeTask,
		taskContract: input.taskContract,
		campaignRunCount: input.campaignRunCount,
		campaignQueuedCount: input.campaignQueuedCount,
		campaignNextQueuedTask: input.campaignNextQueuedTask,
	}
}

function buildRefusalCandidate(input: {
	runId: string
	task: string
	status: string
	summaryPath: string
	checkpointArtifactPath?: string | null
	retrySnapshotPath?: string | null
	checkpoints?: CheckpointArtifact | null
	reasonCodes: ResumeReasonCode[]
	message: string
	continuation?: CampaignContinuationState | null
}): ResumeCandidate {
	return {
		runId: input.runId,
		task: input.task,
		status: input.status,
		resumable: false,
		reasonCodes: input.reasonCodes,
		message: input.message,
		summaryPath: input.summaryPath,
		checkpointArtifactPath: input.checkpointArtifactPath ?? null,
		retrySnapshotPath: input.retrySnapshotPath ?? null,
		lastCheckpointId: input.checkpoints?.latestCheckpointId ?? null,
		profileManifestHash: input.checkpoints?.profileManifestHash ?? null,
		continuation: input.continuation ?? null,
		recoveryMode: null,
		continuationSurface: null,
		stageSummary: null,
		completedWorkItems: input.checkpoints?.completedWorkItems ?? [],
		remainingWorkItems: input.checkpoints?.remainingWorkItems ?? [],
		completedBranches: [],
		remainingFiles: [],
		resumeTask: null,
		taskContract: null,
		campaignRunCount: 0,
		campaignQueuedCount: 0,
		campaignNextQueuedTask: null,
	}
}

function chooseLatestResumeSummaryPath(workspace: string): string | null {
	const latest = findLatestRunSummary(workspace)
	if (!latest) return null

	const latestSummary = asRecord(readRunSummary(path.dirname(latest)))
	const latestHasCheckpoint = Boolean(asString(latestSummary?.["checkpointArtifactPath"]))
	if (latestHasCheckpoint) return latest

	const candidates = listRunDirs(workspace)
		.map((runDir) => resolveRunSummaryPath(runDir))
		.filter((summaryPath) => fs.existsSync(summaryPath))
		.map((summaryPath) => {
			const summary = asRecord(readRunSummary(path.dirname(summaryPath)))
			const checkpointArtifactPath = asString(summary?.["checkpointArtifactPath"])
			if (!checkpointArtifactPath) return null
			const stat = fs.statSync(summaryPath)
			return { summaryPath, mtimeMs: stat.mtimeMs }
		})
		.filter((entry): entry is { summaryPath: string; mtimeMs: number } => entry !== null)
		.sort((left, right) => right.mtimeMs - left.mtimeMs)

	return candidates[0]?.summaryPath ?? latest
}

export async function resolveResumeCandidate(
	workspace: string,
	options: { runId?: string; allowManifestDrift?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<ResumeCandidate> {
	const env = options.env ?? process.env
	const runDir =
		options.runId && options.runId !== "latest"
			? resolveRunDir(workspace, options.runId)
			: (() => {
					const summaryPath = chooseLatestResumeSummaryPath(workspace)
					return summaryPath ? path.dirname(summaryPath) : ""
			  })()
	if (!runDir || !fs.existsSync(runDir)) {
		throw new Error("No resumable run artifacts were found for this workspace.")
	}

	const summaryPath = resolveRunSummaryPath(runDir)
	const summary = asRecord(readRunSummary(runDir))
	if (!summary) {
		throw new Error(`No summary.json found for run ${path.basename(runDir)}.`)
	}

	const runId = asString(summary["taskId"]) ?? path.basename(runDir)
	const task = asString(summary["task"]) ?? "(unknown task)"
	const status = asString(summary["status"]) ?? "unknown"
	if (status === "done") {
		return buildRefusalCandidate({
			runId,
			task,
			status,
			summaryPath,
			reasonCodes: ["run_already_done"],
			message: `Run ${runId} already completed successfully; resume is not needed.`,
			continuation: null,
		})
	}

	const checkpointArtifactPath = asString(summary["checkpointArtifactPath"]) ?? path.join(runDir, "checkpoints.json")
	if (!checkpointArtifactPath || !fs.existsSync(checkpointArtifactPath)) {
		return buildRefusalCandidate({
			runId,
			task,
			status,
			summaryPath,
			checkpointArtifactPath,
			reasonCodes: ["checkpoint_artifact_missing"],
			message: `Resume refused for ${runId}: checkpoint artifact is missing.`,
		})
	}

	const checkpoints = readCheckpointArtifact<CheckpointArtifact>(runDir)
	if (!checkpoints) {
		return buildRefusalCandidate({
			runId,
			task,
			status,
			summaryPath,
			checkpointArtifactPath,
			reasonCodes: ["checkpoint_artifact_invalid"],
			message: `Resume refused for ${runId}: checkpoint artifact could not be parsed.`,
		})
	}

	const retrySnapshotPath =
		checkpoints.latestRetrySnapshotPath ??
		asString(asRecord(summary["retryPlanner"])?.["snapshotPath"]) ??
		null
	if (!retrySnapshotPath || !fs.existsSync(retrySnapshotPath)) {
		return buildRefusalCandidate({
			runId,
			task,
			status,
			summaryPath,
			checkpointArtifactPath,
			retrySnapshotPath,
			checkpoints,
			reasonCodes: ["retry_snapshot_missing"],
			message: `Resume refused for ${runId}: exact retry snapshot is missing.`,
		})
	}

	const retrySnapshot = readRetrySnapshot(retrySnapshotPath)
	if (!retrySnapshot) {
		return buildRefusalCandidate({
			runId,
			task,
			status,
			summaryPath,
			checkpointArtifactPath,
			retrySnapshotPath,
			checkpoints,
			reasonCodes: ["retry_snapshot_invalid"],
			message: `Resume refused for ${runId}: retry snapshot could not be parsed.`,
		})
	}

	if (
		retrySnapshot.runId !== runId ||
		retrySnapshot.checkpointRefs.summaryPath !== summaryPath ||
		retrySnapshot.checkpointRefs.checkpointArtifactPath !== checkpointArtifactPath
	) {
		return buildRefusalCandidate({
			runId,
			task,
			status,
			summaryPath,
			checkpointArtifactPath,
			retrySnapshotPath,
			checkpoints,
			reasonCodes: ["retry_snapshot_mismatch"],
			message: `Resume refused for ${runId}: retry snapshot no longer matches the summary or checkpoint artifact.`,
		})
	}

	if (checkpoints.remainingWorkItems.length === 0) {
		return buildRefusalCandidate({
			runId,
			task,
			status,
			summaryPath,
			checkpointArtifactPath,
			retrySnapshotPath,
			checkpoints,
			reasonCodes: ["no_remaining_work"],
			message: `Resume refused for ${runId}: no remaining work items were recorded.`,
		})
	}

	const remainingAssignments = retrySnapshot.assignments.filter((assignment) =>
		checkpoints.remainingWorkItems.includes(assignment.workItemId),
	)
	if (remainingAssignments.length !== checkpoints.remainingWorkItems.length) {
		return buildRefusalCandidate({
			runId,
			task,
			status,
			summaryPath,
			checkpointArtifactPath,
			retrySnapshotPath,
			checkpoints,
			reasonCodes: ["remaining_assignment_missing"],
			message: `Resume refused for ${runId}: remaining work items no longer match the exact retry snapshot.`,
		})
	}

	const manifestHash = retrySnapshot.profileManifestHash ?? checkpoints.profileManifestHash ?? asString(summary["profileManifestHash"])
	const currentManifestHash = (env["SWARM_OWNER_PROFILE_MANIFEST_HASH"] ?? "").trim() || null
	if (manifestHash && !options.allowManifestDrift) {
		if (!currentManifestHash) {
			return buildRefusalCandidate({
				runId,
				task,
				status,
				summaryPath,
				checkpointArtifactPath,
				retrySnapshotPath,
				checkpoints,
				reasonCodes: ["manifest_validation_missing"],
				message: `Resume refused for ${runId}: manifest validation is required but SWARM_OWNER_PROFILE_MANIFEST_HASH is missing.`,
			})
		}
		if (currentManifestHash !== manifestHash) {
			return buildRefusalCandidate({
				runId,
				task,
				status,
				summaryPath,
				checkpointArtifactPath,
				retrySnapshotPath,
				checkpoints,
				reasonCodes: ["manifest_drift"],
				message: `Resume refused for ${runId}: frozen profile manifest hash drifted from the recorded checkpoint.`,
			})
		}
	}

	const completedBranches = uniqueStrings(
		latestCompletedAssignments(checkpoints)
			.map((assignment) => assignment.branchName)
			.filter((branch): branch is string => typeof branch === "string" && branch.trim().length > 0),
	)
	for (const branch of completedBranches) {
		if (!(await branchExists(workspace, branch))) {
			return buildRefusalCandidate({
				runId,
				task,
				status,
				summaryPath,
				checkpointArtifactPath,
				retrySnapshotPath,
				checkpoints,
				reasonCodes: ["completed_branch_missing"],
				message: `Resume refused for ${runId}: completed checkpoint branch is missing (${branch}).`,
			})
		}
	}

	const remainingFiles = uniqueStrings(remainingAssignments.flatMap((assignment) => assignment.ownedFiles))
	const continuation = retrySnapshot.continuation ?? buildContinuationState(runId)
	const campaignSummary = resolveCampaignSummary(workspace, runId)
	const taskContract = deriveTaskContract(summary, remainingFiles)
	const resumeTask = buildResumeTask(task, runId, checkpoints.remainingWorkItems, remainingFiles, completedBranches, continuation, retrySnapshot.recoveryState ?? null)

	return buildSuccessCandidate({
		runId,
		task,
		status,
		summaryPath,
		checkpointArtifactPath,
		retrySnapshotPath,
		checkpoints,
		retrySnapshot,
		continuation,
		recoveryMode: retrySnapshot.recoveryState?.mode ?? null,
		continuationSurface: retrySnapshot.recoveryState?.continuationSurface ?? null,
		stageSummary: retrySnapshot.recoveryState?.stageSummary ?? null,
		resumeTask,
		taskContract,
		completedBranches,
		remainingFiles,
		campaignRunCount: campaignSummary?.runCount ?? 0,
		campaignQueuedCount: campaignSummary?.queuedCount ?? 0,
		campaignNextQueuedTask: campaignSummary?.nextQueuedTask ?? null,
	})
}

export function formatResumeCandidate(candidate: ResumeCandidate): string {
	return [
		`Resume status: ${candidate.resumable ? "PASS" : "FAIL"}`,
		`Run ID: ${candidate.runId}`,
		`Task: ${candidate.task}`,
		`Current status: ${candidate.status}`,
		`Last checkpoint: ${candidate.lastCheckpointId ?? "(none)"}`,
		`Completed work items: ${candidate.completedWorkItems.join(", ") || "(none)"}`,
		`Remaining work items: ${candidate.remainingWorkItems.join(", ") || "(none)"}`,
		`Remaining files: ${candidate.remainingFiles.join(", ") || "(none)"}`,
		`Completed branches: ${candidate.completedBranches.join(", ") || "(none)"}`,
		`Manifest hash: ${candidate.profileManifestHash ?? "(none)"}`,
		formatContinuationState(candidate.continuation),
		`Recovery mode: ${candidate.recoveryMode ?? "(none)"}`,
		`Continuation surface: ${candidate.continuationSurface ?? "(none)"}`,
		`Stage summary: active=${candidate.stageSummary?.activeStage ?? "(none)"} next=${candidate.stageSummary?.nextStage ?? "(none)"} completed=${candidate.stageSummary?.completedStages.join(", ") || "(none)"} remaining=${candidate.stageSummary?.remainingStages.join(", ") || "(none)"}`,
		`Campaign runs: ${candidate.campaignRunCount}`,
		`Campaign queued follow-ups: ${candidate.campaignQueuedCount}`,
		`Campaign next queued task: ${candidate.campaignNextQueuedTask ?? "(none)"}`,
		`Summary: ${candidate.message}`,
		...(candidate.reasonCodes.length > 0 ? ["Reason codes:", ...candidate.reasonCodes.map((reason) => `- ${reason}`)] : []),
		...(candidate.resumeTask ? ["", "Resume task:", candidate.resumeTask] : []),
		...(candidate.summaryPath ? ["", `Summary path: ${candidate.summaryPath}`] : []),
		...(candidate.checkpointArtifactPath ? [`Checkpoint artifact: ${candidate.checkpointArtifactPath}`] : []),
		...(candidate.retrySnapshotPath ? [`Retry snapshot: ${candidate.retrySnapshotPath}`] : []),
	].join("\n")
}
