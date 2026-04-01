import fs from "node:fs"
import path from "node:path"

import { ensureCanonicalOwnerGuidedDemoManifest } from "../src/owner/OwnerProfileManifest"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"
import type { CompletionLedger } from "../src/planning/CompletionLedger"
import { buildRetryPlannerArtifact, planRetryWithSnapshot, readRetrySnapshot } from "../src/planning/RetryPlanner"

export type RetrySnapshotHarnessResult = {
	snapshotPersisted: boolean
	assignmentStatePreserved: boolean
	partialRecoveryStatePreserved: boolean
	manifestHashPreserved: boolean
	missingSnapshotFailsClosed: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function createScratchDir(rootDir: string, name: string): { dir: string; cleanup: () => void } {
	const dir = path.join(rootDir, "verification", `.tmp-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(dir, { recursive: true })
	return {
		dir,
		cleanup: () => {
			if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
		},
	}
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

function fixtureCompletionLedger(): CompletionLedger {
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
				runId: "task-retry-snapshot",
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
				runId: "task-retry-snapshot",
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

export async function runRetrySnapshotHarness(rootDir = resolveRootDir()): Promise<RetrySnapshotHarnessResult> {
	const details: string[] = []
	const scratch = createScratchDir(rootDir, "retry-snapshots")
	const manifest = ensureCanonicalOwnerGuidedDemoManifest(scratch.dir)

	try {
		const materialized = planRetryWithSnapshot(scratch.dir, {
			runId: "task-retry-snapshot",
			task: "update hello.ts and utils.ts together",
			finalStatus: "review_required",
			stopReason: "review_blocked",
			reviewerVerdict: "NEEDS_WORK",
			assignments: fixtureAssignments(),
			completionLedger: fixtureCompletionLedger(),
			taskContract: { scope: { allowedFiles: ["hello.ts", "utils.ts"] } },
			checkpointRefs: {
				summaryPath: path.join(scratch.dir, "summary.json"),
				reviewPackPath: path.join(scratch.dir, "review-pack.json"),
				incidentPackPath: null,
				checkpointArtifactPath: path.join(scratch.dir, "checkpoints.json"),
			},
			profileManifestHash: manifest.manifest.manifestHash,
		})
		const snapshot = materialized.snapshotPath ? readRetrySnapshot(materialized.snapshotPath) : null
		const strictRefusal = buildRetryPlannerArtifact({
			reasons: [{ category: "critic_concern", detail: "Need exact bounded retry snapshot." }],
			maxRetryCount: 2,
			retryCountUsed: 0,
			retriesRemaining: 2,
			strictSnapshotRequired: true,
			snapshotPath: null,
			proposals: [
				{
					attemptNumber: 1,
					label: "retry bounded plan",
					rationale: "Would retry if a snapshot existed.",
					taskOverride: null,
					requiredSnapshotPath: path.join(scratch.dir, "missing-retry-snapshot.json"),
				},
			],
		})

		const snapshotPersisted = Boolean(materialized.snapshotPath && snapshot && fs.existsSync(materialized.snapshotPath))
		const assignmentStatePreserved =
			snapshot?.assignments.length === 2 &&
			snapshot.assignments[0]?.assignmentToken === "builder-1:subtask-1:1" &&
			snapshot.assignments[1]?.ownedFiles.includes("utils.ts") === true
		const partialRecoveryStatePreserved =
			snapshot?.recoveryState?.mode === "resume_remaining_work" &&
			snapshot.recoveryState.completedWorkItems.join(",") === "subtask-1" &&
			snapshot.recoveryState.remainingWorkItems.join(",") === "subtask-2" &&
			snapshot.recoveryState.stageSummary?.activeStage === 2
		const manifestHashPreserved = snapshot?.profileManifestHash === manifest.manifest.manifestHash
		const missingSnapshotFailsClosed = strictRefusal.decision === "refuse" && strictRefusal.summary.includes("missing")

		details.push(`snapshot=${materialized.snapshotPath ?? "(none)"}`)
		details.push(`manifestHash=${manifest.manifest.manifestHash}`)

		return {
			snapshotPersisted,
			assignmentStatePreserved,
			partialRecoveryStatePreserved,
			manifestHashPreserved,
			missingSnapshotFailsClosed,
			details,
		}
	} finally {
		scratch.cleanup()
	}
}

export function formatRetrySnapshotHarnessResult(result: RetrySnapshotHarnessResult): string {
	return [
		`Snapshot persisted: ${result.snapshotPersisted ? "PASS" : "FAIL"}`,
		`Assignment state preserved: ${result.assignmentStatePreserved ? "PASS" : "FAIL"}`,
		`Partial recovery state preserved: ${result.partialRecoveryStatePreserved ? "PASS" : "FAIL"}`,
		`Manifest hash preserved: ${result.manifestHashPreserved ? "PASS" : "FAIL"}`,
		`Missing snapshot fails closed: ${result.missingSnapshotFailsClosed ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runRetrySnapshotHarness()
	console.log(formatRetrySnapshotHarnessResult(result))
	process.exit(
		result.snapshotPersisted &&
			result.assignmentStatePreserved &&
			result.partialRecoveryStatePreserved &&
			result.manifestHashPreserved &&
			result.missingSnapshotFailsClosed
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:retry-snapshots] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
