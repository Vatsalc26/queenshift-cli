import fs from "node:fs"
import path from "node:path"

import { ensureCanonicalOwnerGuidedDemoManifest } from "../src/owner/OwnerProfileManifest"
import {
	buildCheckpointArtifact,
	formatCheckpointArtifact,
	type CheckpointArtifact,
	type RecordedCheckpointBoundary,
} from "../src/planning/Checkpoints"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"
import { planRetryWithSnapshot, readRetrySnapshot } from "../src/planning/RetryPlanner"
import {
	readCheckpointArtifact,
	resolveCheckpointArtifactPath,
	writeCheckpointArtifact,
	writeRunSummary,
} from "../src/run/RunArtifacts"

export type CheckpointHarnessResult = {
	checkpointArtifactPersisted: boolean
	partialProgressVisible: boolean
	retrySnapshotLinked: boolean
	continuationHistoryVisible: boolean
	manifestHashPreserved: boolean
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
			},
		],
	}
}

function readSummary(summaryPath: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
}

export async function runCheckpointHarness(rootDir = resolveRootDir()): Promise<CheckpointHarnessResult> {
	const details: string[] = []
	const scratch = createScratchDir(rootDir, "checkpoints")
	const manifest = ensureCanonicalOwnerGuidedDemoManifest(scratch.dir)

	try {
		const assignments = fixtureAssignments()
		const summaryPath = path.join(scratch.dir, "summary.json")
		const checkpointArtifactPath = resolveCheckpointArtifactPath(scratch.dir)
		const retry = planRetryWithSnapshot(scratch.dir, {
			runId: "task-checkpoints",
			task: "update hello.ts and utils.ts together",
			finalStatus: "review_required",
			stopReason: "review_blocked",
			reviewerVerdict: "NEEDS_WORK",
			assignments,
			taskContract: { scope: { allowedFiles: ["hello.ts", "utils.ts"] } },
			checkpointRefs: {
				summaryPath,
				reviewPackPath: path.join(scratch.dir, "review-pack.json"),
				incidentPackPath: null,
				checkpointArtifactPath,
			},
			profileManifestHash: manifest.manifest.manifestHash,
		})

		const boundaries: RecordedCheckpointBoundary[] = [
			{
				kind: "assignment_commit",
				recordedAt: "2026-03-22T10:00:00.000Z",
				workItemId: "subtask-1",
				assignmentId: "assign-subtask-1",
				branchName: "swarm/task-checkpoints/subtask-1",
				reason: "Committed isolated builder branch for subtask-1 before later review blocked completion.",
			},
		]
		if (retry.snapshotPath) {
			boundaries.push({
				kind: "retry_snapshot",
				recordedAt: "2026-03-22T10:01:00.000Z",
				retrySnapshotPath: retry.snapshotPath,
				reason: "Saved an exact bounded retry snapshot after the partial stop.",
			})
		}

		const checkpoints = buildCheckpointArtifact({
			runId: "task-checkpoints",
			runStatus: "review_required",
			assignments,
			recordedBoundaries: boundaries,
			profileManifestHash: manifest.manifest.manifestHash,
			continuationState: retry.snapshot?.continuation ?? null,
		})
		if (!checkpoints) throw new Error("Expected checkpoint artifact to be created for complex assignments.")

		writeCheckpointArtifact(scratch.dir, checkpoints as unknown as Record<string, unknown>)
		writeRunSummary(scratch.dir, {
			taskId: "task-checkpoints",
			status: "review_required",
			checkpointArtifactPath,
			checkpoints,
			profileManifestHash: manifest.manifest.manifestHash,
		})

		const persisted = readCheckpointArtifact<CheckpointArtifact>(scratch.dir)
		const summary = readSummary(summaryPath)
		const snapshot = retry.snapshotPath ? readRetrySnapshot(retry.snapshotPath) : null

		const checkpointArtifactPersisted =
			Boolean(persisted && fs.existsSync(checkpointArtifactPath) && persisted.checkpoints.length === 2)
		const partialProgressVisible =
			persisted?.status === "partial" &&
			persisted.completedWorkItems.join(",") === "subtask-1" &&
			persisted.remainingWorkItems.join(",") === "subtask-2" &&
			(summary["checkpointArtifactPath"] as string | null) === checkpointArtifactPath
		const retrySnapshotLinked =
			Boolean(
				retry.snapshotPath &&
					persisted?.latestRetrySnapshotPath === retry.snapshotPath &&
					snapshot?.checkpointRefs.checkpointArtifactPath === checkpointArtifactPath,
			)
		const continuationHistoryVisible =
			persisted !== null &&
			persisted.continuation?.attemptNumber === 1 &&
			persisted.continuation.nextAttemptNumber === 2 &&
			snapshot?.continuation.campaignId === persisted.continuation.campaignId &&
			formatCheckpointArtifact(persisted ?? null).includes("Campaign:")
		const manifestHashPreserved =
			persisted?.profileManifestHash === manifest.manifest.manifestHash &&
			snapshot?.profileManifestHash === manifest.manifest.manifestHash

		details.push(`artifact=${checkpointArtifactPath}`)
		details.push(`summary=${summaryPath}`)
		details.push(formatCheckpointArtifact(persisted ?? null).split(/\r?\n/g)[0] ?? "checkpoint format unavailable")

		return {
			checkpointArtifactPersisted,
			partialProgressVisible,
			retrySnapshotLinked,
			continuationHistoryVisible,
			manifestHashPreserved,
			details,
		}
	} finally {
		scratch.cleanup()
	}
}

export function formatCheckpointHarnessResult(result: CheckpointHarnessResult): string {
	return [
		`Checkpoint artifact persisted: ${result.checkpointArtifactPersisted ? "PASS" : "FAIL"}`,
		`Partial progress visible: ${result.partialProgressVisible ? "PASS" : "FAIL"}`,
		`Retry snapshot linked: ${result.retrySnapshotLinked ? "PASS" : "FAIL"}`,
		`Continuation history visible: ${result.continuationHistoryVisible ? "PASS" : "FAIL"}`,
		`Manifest hash preserved: ${result.manifestHashPreserved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runCheckpointHarness()
	console.log(formatCheckpointHarnessResult(result))
	process.exit(
		result.checkpointArtifactPersisted &&
			result.partialProgressVisible &&
			result.retrySnapshotLinked &&
			result.continuationHistoryVisible &&
			result.manifestHashPreserved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:checkpoints] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
