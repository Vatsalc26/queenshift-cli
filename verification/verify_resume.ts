import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { ensureCanonicalOwnerGuidedDemoManifest } from "../src/owner/OwnerProfileManifest"
import {
	buildCheckpointArtifact,
	type CheckpointArtifact,
	type RecordedCheckpointBoundary,
} from "../src/planning/Checkpoints"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"
import type { CompletionLedger } from "../src/planning/CompletionLedger"
import { planRetryWithSnapshot } from "../src/planning/RetryPlanner"
import { formatResumeCandidate, resolveResumeCandidate } from "../src/run/Resume"
import { resolveCheckpointArtifactPath, writeCheckpointArtifact, writeRunSummary } from "../src/run/RunArtifacts"

export type ResumeHarnessResult = {
	resumeSuccessVisible: boolean
	remainingWorkReconstructed: boolean
	recoveryModeVisible: boolean
	continuationHistoryVisible: boolean
	campaignOpsVisible: boolean
	manifestValidationFailsClosed: boolean
	missingCompletedBranchFailsClosed: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function createTempRepoCopy(rootDir: string, name: string): { repoPath: string; cleanup: () => void } {
	const repoPath = path.join(rootDir, "verification", `.tmp-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.cpSync(path.join(rootDir, "verification", "test_workspace"), repoPath, { recursive: true, force: true })
	const swarmDir = path.join(repoPath, ".swarm")
	if (fs.existsSync(swarmDir)) fs.rmSync(swarmDir, { recursive: true, force: true })
	return {
		repoPath,
		cleanup: () => {
			if (fs.existsSync(repoPath)) fs.rmSync(repoPath, { recursive: true, force: true })
		},
	}
}

async function runGit(repoPath: string, args: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn("git", ["-c", `safe.directory=${repoPath}`, ...args], {
			cwd: repoPath,
			windowsHide: true,
			stdio: "ignore",
		})
		child.once("error", reject)
		child.once("close", (code) => {
			if (code === 0) resolve()
			else reject(new Error(`git ${args.join(" ")} failed (exit ${code ?? "null"})`))
		})
	})
}

function fixtureAssignments(): AssignmentLedger {
	return {
		schemaVersion: 1,
		handoffValid: true,
		handoffIssues: [],
		assignments: [
			{
				workItemId: "subtask-1",
				assignmentId: "assign-subtask-1",
				assignmentToken: "builder-1:subtask-1:1",
				assignedBuilder: "builder-1",
				ownedFiles: ["hello.ts"],
				dependsOn: [],
				status: "assigned",
				blockers: [],
				stage: 1,
			},
			{
				workItemId: "subtask-2",
				assignmentId: "assign-subtask-2",
				assignmentToken: "builder-2:subtask-2:2",
				assignedBuilder: "builder-2",
				ownedFiles: ["utils.ts"],
				dependsOn: ["subtask-1"],
				status: "assigned",
				blockers: [],
				stage: 2,
			},
		],
	}
}

function fixtureCompletionLedger(runId: string): CompletionLedger {
	return {
		schemaVersion: 1,
		proofBeforeDoneValid: true,
		dependencyGraphSafe: true,
		continuationSurface: "retry_planner_checkpoint_artifacts",
		stageSummary: {
			totalStages: 2,
			activeStage: 2,
			completedStages: [1],
			remainingStages: [2],
			nextStage: null,
			anchorWorkItems: ["subtask-2"],
			summary: "Stage 2 is active; next stage (none).",
		},
		entries: [
			{
				workItemId: "subtask-1",
				assignmentId: "assign-subtask-1",
				assignmentToken: "builder-1:subtask-1:1",
				runId,
				state: "complete",
				stage: 1,
				dependsOn: [],
				dependencyState: "released",
				releasedWorkItems: ["subtask-2"],
				proofArtifactPath: "summary.json",
				proofReason: "Checkpointed bounded work item.",
			},
			{
				workItemId: "subtask-2",
				assignmentId: "assign-subtask-2",
				assignmentToken: "builder-2:subtask-2:2",
				runId,
				state: "blocked",
				stage: 2,
				dependsOn: ["subtask-1"],
				dependencyState: "ready",
				releasedWorkItems: [],
				proofArtifactPath: null,
				proofReason: "Run ended before stage-2 completion proof.",
			},
		],
	}
}

async function stageResumableRun(repoPath: string, manifestHash: string, runId: string): Promise<string> {
	const runDir = path.join(repoPath, ".swarm", "runs", runId)
	fs.mkdirSync(runDir, { recursive: true })
	const checkpointArtifactPath = resolveCheckpointArtifactPath(runDir)
	const summaryPath = path.join(runDir, "summary.json")
	const branchName = `swarm/${runId}/subtask-1`

	await runGit(repoPath, ["branch", branchName, "HEAD"])

	const retry = planRetryWithSnapshot(runDir, {
		runId,
		task: "update hello.ts and utils.ts together",
			finalStatus: "review_required",
			stopReason: "review_blocked",
			reviewerVerdict: "NEEDS_WORK",
			assignments: fixtureAssignments(),
			completionLedger: fixtureCompletionLedger(runId),
			taskContract: {
			scope: {
				allowedFiles: ["hello.ts", "utils.ts"],
				readOnlyContextFiles: ["hello.ts", "utils.ts"],
			},
		},
		checkpointRefs: {
			summaryPath,
			reviewPackPath: null,
			incidentPackPath: null,
			checkpointArtifactPath,
		},
		profileManifestHash: manifestHash,
	})

	const boundaries: RecordedCheckpointBoundary[] = [
		{
			kind: "assignment_commit",
			recordedAt: "2026-03-22T12:00:00.000Z",
			workItemId: "subtask-1",
			assignmentId: "assign-subtask-1",
			branchName,
			reason: "Committed isolated builder branch for subtask-1 before the run stopped.",
		},
	]
	if (!retry.snapshotPath) throw new Error("Expected retry snapshot path while staging resumable run.")
	boundaries.push({
		kind: "retry_snapshot",
		recordedAt: "2026-03-22T12:01:00.000Z",
		retrySnapshotPath: retry.snapshotPath,
		reason: "Saved exact bounded retry snapshot for the remaining work.",
	})

	const checkpoints = buildCheckpointArtifact({
		runId,
		runStatus: "review_required",
		assignments: fixtureAssignments(),
		recordedBoundaries: boundaries,
		profileManifestHash: manifestHash,
	})
	if (!checkpoints) throw new Error("Expected checkpoint artifact while staging resumable run.")

	writeCheckpointArtifact(runDir, checkpoints as unknown as Record<string, unknown>)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "update hello.ts and utils.ts together",
		workspace: repoPath,
		status: "review_required",
		stopReason: "review_blocked",
		message: "Reviewer requested another bounded pass.",
		checkpointArtifactPath,
		checkpoints,
		retryPlanner: retry.planner,
		taskContract: {
			scope: {
				allowedFiles: ["hello.ts", "utils.ts"],
				readOnlyContextFiles: ["hello.ts", "utils.ts"],
			},
		},
		profileManifestHash: manifestHash,
	})

	return summaryPath
}

function readCheckpoints(summaryPath: string): CheckpointArtifact {
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
	return summary["checkpoints"] as CheckpointArtifact
}

export async function runResumeHarness(rootDir = resolveRootDir()): Promise<ResumeHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "resume")
	const manifest = ensureCanonicalOwnerGuidedDemoManifest(repoHarness.repoPath)

	try {
		const runId = "task-resume-fixture"
		const summaryPath = await stageResumableRun(repoHarness.repoPath, manifest.manifest.manifestHash, runId)
		const checkpoints = readCheckpoints(summaryPath)

		const success = await resolveResumeCandidate(repoHarness.repoPath, {
			runId,
			env: {
				SWARM_OWNER_PROFILE_MANIFEST_HASH: manifest.manifest.manifestHash,
			},
		})
		const manifestMissing = await resolveResumeCandidate(repoHarness.repoPath, {
			runId,
			env: {},
		})

		await runGit(repoHarness.repoPath, ["branch", "-D", `swarm/${runId}/subtask-1`])
		const missingBranch = await resolveResumeCandidate(repoHarness.repoPath, {
			runId,
			env: {
				SWARM_OWNER_PROFILE_MANIFEST_HASH: manifest.manifest.manifestHash,
			},
		})

		const resumeSuccessVisible =
			success.resumable &&
			success.lastCheckpointId === checkpoints.latestCheckpointId &&
			formatResumeCandidate(success).includes("Resume status: PASS")
		const resumeScope = (success.taskContract?.["scope"] as { allowedFiles?: string[] | unknown[] } | undefined) ?? undefined
		const remainingWorkReconstructed =
			success.remainingWorkItems.join(",") === "subtask-2" &&
			success.remainingFiles.join(",") === "utils.ts" &&
			Boolean(resumeScope) &&
			Array.isArray(resumeScope?.allowedFiles) &&
			(resumeScope.allowedFiles ?? []).join(",") === "utils.ts"
		const recoveryModeVisible =
			success.recoveryMode === "resume_remaining_work" &&
			success.continuationSurface === "retry_planner_checkpoint_artifacts" &&
			success.stageSummary?.activeStage === 2 &&
			formatResumeCandidate(success).includes("Recovery mode: resume_remaining_work")
		const continuationHistoryVisible =
			success.continuation !== null &&
			success.continuation.attemptNumber === 1 &&
			success.continuation.nextAttemptNumber === 2 &&
			success.continuation.sourceRunIds.join(",") === runId &&
			formatResumeCandidate(success).includes("Campaign:")
		const campaignOpsVisible =
			success.campaignRunCount === 1 &&
			success.campaignQueuedCount === 0 &&
			formatResumeCandidate(success).includes("Campaign runs: 1")
		const manifestValidationFailsClosed =
			!manifestMissing.resumable && manifestMissing.reasonCodes.includes("manifest_validation_missing")
		const missingCompletedBranchFailsClosed =
			!missingBranch.resumable && missingBranch.reasonCodes.includes("completed_branch_missing")

		details.push(`summary=${summaryPath}`)
		details.push(`checkpoint=${success.checkpointArtifactPath ?? "(none)"}`)
		details.push(`resume=${success.resumeTask?.split(/\r?\n/g)[2] ?? "(none)"}`)

		return {
			resumeSuccessVisible,
			remainingWorkReconstructed,
			recoveryModeVisible,
			continuationHistoryVisible,
			campaignOpsVisible,
			manifestValidationFailsClosed,
			missingCompletedBranchFailsClosed,
			details,
		}
	} finally {
		repoHarness.cleanup()
	}
}

export function formatResumeHarnessResult(result: ResumeHarnessResult): string {
	return [
		`Resume success visible: ${result.resumeSuccessVisible ? "PASS" : "FAIL"}`,
		`Remaining work reconstructed: ${result.remainingWorkReconstructed ? "PASS" : "FAIL"}`,
		`Recovery mode visible: ${result.recoveryModeVisible ? "PASS" : "FAIL"}`,
		`Continuation history visible: ${result.continuationHistoryVisible ? "PASS" : "FAIL"}`,
		`Campaign ops visible: ${result.campaignOpsVisible ? "PASS" : "FAIL"}`,
		`Manifest validation fails closed: ${result.manifestValidationFailsClosed ? "PASS" : "FAIL"}`,
		`Missing completed branch fails closed: ${result.missingCompletedBranchFailsClosed ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runResumeHarness()
	console.log(formatResumeHarnessResult(result))
	process.exit(
		result.resumeSuccessVisible &&
			result.remainingWorkReconstructed &&
			result.recoveryModeVisible &&
			result.continuationHistoryVisible &&
			result.campaignOpsVisible &&
			result.manifestValidationFailsClosed &&
			result.missingCompletedBranchFailsClosed
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:resume] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
