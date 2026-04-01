import fs from "node:fs"
import path from "node:path"

import { DatabaseService } from "../src/db/DatabaseService"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"
import {
	buildCheckpointArtifact,
	type CheckpointArtifact,
	type RecordedCheckpointBoundary,
} from "../src/planning/Checkpoints"
import type { CompletionLedger } from "../src/planning/CompletionLedger"
import { planRetryWithSnapshot } from "../src/planning/RetryPlanner"
import { reconcileOwnedState, resolveOwnedWorktreeBase } from "../src/run/RecoveryManager"
import { resolveCheckpointArtifactPath, writeCheckpointArtifact } from "../src/run/RunArtifacts"
import { WorktreeManager } from "../src/worktree/WorktreeManager"

export type RecoveryHarnessResult = {
	leftoverInventoryRecovered: boolean
	crashSimulation: boolean
	abortArtifactRecovered: boolean
	recoveryHintVisible: boolean
	failureNarrativeVisible: boolean
	rerunAfterCleanup: boolean
	idempotentCleanup: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function createTempRepoCopy(rootDir: string): { repoPath: string; cleanup: () => void } {
	const repoPath = path.join(rootDir, "verification", `.tmp-recovery-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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

function readRecoveredSummary(runDir: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(path.join(runDir, "summary.json"), "utf8")) as Record<string, unknown>
}

export async function runRecoveryHarness(rootDir = resolveRootDir()): Promise<RecoveryHarnessResult> {
	const { repoPath, cleanup } = createTempRepoCopy(rootDir)
	DatabaseService.reset()
	const dbPath = path.join(repoPath, ".swarm", "recovery.db")
	const db = DatabaseService.getInstance(dbPath)
	const details: string[] = []

	try {
		const wm = new WorktreeManager(repoPath)
		const ownedBase = resolveOwnedWorktreeBase(repoPath)
		const orphanTaskId = `task-recovery-orphan-${Date.now()}`
		const orphanWorktreePath = path.join(ownedBase, orphanTaskId, "wt-builder-1")
		if (fs.existsSync(orphanWorktreePath)) {
			fs.rmSync(orphanWorktreePath, { recursive: true, force: true })
		}
		await wm.create("swarm/recovery/orphan", orphanWorktreePath, "HEAD")
		details.push(`created orphan worktree ${orphanWorktreePath}`)

		const tmpDir = path.join(repoPath, ".swarm", "tmp")
		fs.mkdirSync(tmpDir, { recursive: true })
		const tmpFile = path.join(tmpDir, "leftover.log")
		fs.writeFileSync(tmpFile, "stale\n", "utf8")

		const runDir = path.join(repoPath, ".swarm", "runs", "task-recovery-incomplete")
		fs.mkdirSync(runDir, { recursive: true })
		fs.writeFileSync(path.join(runDir, "events.ndjson"), '{"type":"run_start"}\n', "utf8")
		const checkpointArtifactPath = resolveCheckpointArtifactPath(runDir)
		const retry = planRetryWithSnapshot(runDir, {
			runId: "task-recovery-incomplete",
			task: "update hello.ts and utils.ts together",
			finalStatus: "review_required",
			stopReason: "review_blocked",
			reviewerVerdict: "NEEDS_WORK",
			assignments: fixtureAssignments(),
			completionLedger: fixtureCompletionLedger("task-recovery-incomplete"),
			taskContract: {
				scope: {
					allowedFiles: ["hello.ts", "utils.ts"],
				},
			},
			checkpointRefs: {
				summaryPath: path.join(runDir, "summary.json"),
				reviewPackPath: null,
				incidentPackPath: null,
				checkpointArtifactPath,
			},
		})
		const boundaries: RecordedCheckpointBoundary[] = [
			{
				kind: "assignment_commit",
				recordedAt: "2026-03-25T00:00:00.000Z",
				workItemId: "subtask-1",
				assignmentId: "assign-subtask-1",
				branchName: "swarm/recovery/complete-subtask-1",
				reason: "Completed stage-1 work before the run stopped.",
			},
			{
				kind: "retry_snapshot",
				recordedAt: "2026-03-25T00:01:00.000Z",
				retrySnapshotPath: retry.snapshotPath ?? path.join(runDir, "retry-snapshot.json"),
				reason: "Saved exact retry snapshot for remaining work.",
			},
		]
		const checkpoints = buildCheckpointArtifact({
			runId: "task-recovery-incomplete",
			runStatus: "review_required",
			assignments: fixtureAssignments(),
			recordedBoundaries: boundaries,
			continuationState: retry.snapshot?.continuation ?? null,
		})
		if (!checkpoints) throw new Error("Expected checkpoint artifact for recovery fixture.")
		writeCheckpointArtifact(runDir, checkpoints as unknown as Record<string, unknown>)

		db.run("INSERT INTO tasks (id, description, status) VALUES (?,?,?)", [
			"task-recovery-running",
			"stale task",
			"in_progress",
		])

		const firstReport = await reconcileOwnedState(repoPath, db)
		const secondReport = await reconcileOwnedState(repoPath, db)

		const crashSimulation =
			firstReport.removedWorktrees.length >= 1 &&
			firstReport.removedBranches.includes("swarm/recovery/orphan") &&
			!fs.existsSync(orphanWorktreePath)

		const abortArtifactRecovered = fs.existsSync(path.join(runDir, "summary.json"))
		const recoveredSummary = abortArtifactRecovered ? readRecoveredSummary(runDir) : {}
		const recoveredRecovery = (recoveredSummary["recovery"] as Record<string, unknown> | undefined) ?? undefined
		const recoveredFailureNarrative = (recoveredRecovery?.["failureNarrative"] as Record<string, unknown> | undefined) ?? undefined
		const leftoverInventoryRecovered =
			firstReport.removedTmpEntries.includes(tmpFile) &&
			firstReport.reconciledTaskIds.includes("task-recovery-running")
		const recoveryHintVisible =
			recoveredRecovery?.["recoveryMode"] === "resume_remaining_work" &&
			Array.isArray(recoveredRecovery?.["remainingWorkItems"]) &&
			(recoveredRecovery?.["remainingWorkItems"] as string[]).join(",") === "subtask-2"
		const failureNarrativeVisible =
			typeof recoveredFailureNarrative?.["whatFailed"] === "string" &&
			(recoveredFailureNarrative["whatFailed"] as string).includes("Recovered incomplete run artifact") &&
			typeof recoveredFailureNarrative?.["safestNextStep"] === "string" &&
			(recoveredFailureNarrative["safestNextStep"] as string).includes("resume:show") &&
			typeof recoveredFailureNarrative?.["recoveryFooting"] === "string" &&
			(recoveredFailureNarrative["recoveryFooting"] as string).includes("remaining work items") &&
			Array.isArray(recoveredFailureNarrative?.["authoritativeArtifacts"]) &&
			(recoveredFailureNarrative["authoritativeArtifacts"] as unknown[]).length >= 2

		const freshTaskId = `task-recovery-fresh-${Date.now()}`
		const freshWorktreePath = path.join(ownedBase, freshTaskId, "wt-builder-1")
		await wm.create("swarm/recovery/fresh", freshWorktreePath, "HEAD")
		await wm.remove(freshWorktreePath, true)
		const rerunAfterCleanup = !fs.existsSync(freshWorktreePath)

		const idempotentCleanup =
			secondReport.removedWorktrees.length === 0 &&
			secondReport.removedBranches.length === 0 &&
			secondReport.removedTmpEntries.length === 0

		return {
			leftoverInventoryRecovered,
			crashSimulation,
			abortArtifactRecovered,
			recoveryHintVisible,
			failureNarrativeVisible,
			rerunAfterCleanup,
			idempotentCleanup,
			details,
		}
	} finally {
		db.close()
		DatabaseService.reset()
		cleanup()
	}
}

export function formatRecoveryHarnessResult(result: RecoveryHarnessResult): string {
	return [
		`Crash simulation: ${result.crashSimulation ? "PASS" : "FAIL"}`,
		`Leftover inventory recovered: ${result.leftoverInventoryRecovered ? "PASS" : "FAIL"}`,
		`Incomplete artifact recovered: ${result.abortArtifactRecovered ? "PASS" : "FAIL"}`,
		`Recovery hint visible: ${result.recoveryHintVisible ? "PASS" : "FAIL"}`,
		`Failure narrative visible: ${result.failureNarrativeVisible ? "PASS" : "FAIL"}`,
		`Rerun after cleanup: ${result.rerunAfterCleanup ? "PASS" : "FAIL"}`,
		`Idempotent cleanup: ${result.idempotentCleanup ? "PASS" : "FAIL"}`,
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runRecoveryHarness()
	console.log(formatRecoveryHarnessResult(result))
	process.exit(
		result.leftoverInventoryRecovered &&
			result.crashSimulation &&
			result.abortArtifactRecovered &&
			result.recoveryHintVisible &&
			result.failureNarrativeVisible &&
			result.rerunAfterCleanup &&
			result.idempotentCleanup
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:recovery] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
