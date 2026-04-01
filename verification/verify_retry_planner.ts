import fs from "node:fs"
import path from "node:path"

import { Orchestrator } from "../src/Orchestrator"
import { DatabaseService } from "../src/db/DatabaseService"
import type { AssignmentLedger } from "../src/planning/AssignmentLedger"
import type { CompletionLedger } from "../src/planning/CompletionLedger"
import type { CriticArtifact } from "../src/planning/CriticLane"
import { formatRetryPlannerArtifact, planRetryWithSnapshot, type RetryPlannerArtifact } from "../src/planning/RetryPlanner"

export type RetryPlannerHarnessResult = {
	retryableDecisionVisible: boolean
	redLaneRefusalWorks: boolean
	partialRecoveryModeVisible: boolean
	stageAwareProposalVisible: boolean
	continuationHistoryVisible: boolean
	proposalsHumanReadable: boolean
	summarySurfaceVisible: boolean
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

function fixtureCriticConcern(): CriticArtifact {
	return {
		schemaVersion: 1,
		enabled: true,
		manualVersion: "v1",
		triggerReasons: ["multi-file bounded change"],
		status: "concern",
		concerns: [
			{
				category: "plan_risk",
				evidence: "Complex run ended before acceptance proof.",
				recommendedAction: "Retry with the same bounded assignment snapshot.",
			},
		],
		summary: "Critic lane recorded one concern.",
	}
}

function readRetryPlanner(summaryPath: string): RetryPlannerArtifact {
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>
	const retryPlanner = summary["retryPlanner"]
	if (!retryPlanner || typeof retryPlanner !== "object" || Array.isArray(retryPlanner)) {
		throw new Error(`Expected retry planner artifact in ${summaryPath}`)
	}
	return retryPlanner as RetryPlannerArtifact
}

export async function runRetryPlannerHarness(rootDir = resolveRootDir()): Promise<RetryPlannerHarnessResult> {
	const details: string[] = []
	const repoHarness = createTempRepoCopy(rootDir, "retry-planner")
	const retryableScratch = createScratchDir(rootDir, "retry-planner-live")
	const continuationScratch = createScratchDir(rootDir, "retry-planner-followup")
	const refusalScratch = createScratchDir(rootDir, "retry-planner-redlane")
	DatabaseService.reset()
	const dbPath = path.join(rootDir, "verification", `.tmp-retry-planner-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
	const db = DatabaseService.getInstance(dbPath)

	try {
		const retryable = planRetryWithSnapshot(retryableScratch.dir, {
			runId: "task-retryable",
			task: "update hello.ts and utils.ts together",
			finalStatus: "review_required",
			stopReason: "review_blocked",
			reviewerVerdict: "NEEDS_WORK",
			criticLane: fixtureCriticConcern(),
			assignments: fixtureAssignments(),
			completionLedger: fixtureCompletionLedger("task-retryable"),
			taskContract: null,
			checkpointRefs: {
				summaryPath: path.join(retryableScratch.dir, "summary.json"),
				reviewPackPath: null,
				incidentPackPath: null,
				checkpointArtifactPath: path.join(retryableScratch.dir, "checkpoints.json"),
			},
		})
		const refusal = planRetryWithSnapshot(refusalScratch.dir, {
			runId: "task-red-lane",
			task: "wide refactor",
			finalStatus: "failed",
			stopReason: "scope_drift",
			reviewerVerdict: null,
			criticLane: fixtureCriticConcern(),
			incidentSignal: {
				redLaneRecommended: true,
				nextActionLabel: "stop and fix red lane",
				failureBucket: "scope drift",
			},
			assignments: fixtureAssignments(),
			completionLedger: fixtureCompletionLedger("task-red-lane"),
			taskContract: null,
			checkpointRefs: {
				summaryPath: path.join(refusalScratch.dir, "summary.json"),
				reviewPackPath: null,
				incidentPackPath: null,
				checkpointArtifactPath: path.join(refusalScratch.dir, "checkpoints.json"),
			},
		})
		const continued = planRetryWithSnapshot(continuationScratch.dir, {
			runId: "task-retryable-2",
			task: "update hello.ts and utils.ts together",
			finalStatus: "review_required",
			stopReason: "review_blocked",
			reviewerVerdict: "NEEDS_WORK",
			criticLane: fixtureCriticConcern(),
			assignments: fixtureAssignments(),
			completionLedger: fixtureCompletionLedger("task-retryable-2"),
			taskContract: null,
			checkpointRefs: {
				summaryPath: path.join(continuationScratch.dir, "summary.json"),
				reviewPackPath: null,
				incidentPackPath: null,
				checkpointArtifactPath: path.join(continuationScratch.dir, "checkpoints.json"),
			},
			continuationState: retryable.snapshot?.continuation ?? null,
		})

		const orchestrator = new Orchestrator(repoHarness.repoPath, db, true)
		const runResult = await orchestrator.run("update hello.ts and utils.ts together")
		const summaryRetryPlanner = readRetryPlanner(runResult.summaryPath)

		const retryableDecisionVisible =
			retryable.planner.decision === "retryable" &&
			retryable.planner.reasons.some((reason) => reason.category === "review_feedback" || reason.category === "critic_concern")
		const redLaneRefusalWorks =
			refusal.planner.decision === "refuse" &&
			refusal.planner.reasons.some((reason) => reason.category === "incident_red_lane" || reason.category === "out_of_bounds")
		const partialRecoveryModeVisible =
			retryable.planner.recoveryState?.mode === "resume_remaining_work" &&
			retryable.planner.recoveryState.completedWorkItems.join(",") === "subtask-1" &&
			retryable.planner.recoveryState.remainingWorkItems.join(",") === "subtask-2" &&
			retryable.planner.summary.includes("recovery mode=resume_remaining_work")
		const stageAwareProposalVisible =
			retryable.planner.proposals.some((proposal) => proposal.label.includes("resume remaining work")) &&
			Boolean(retryable.planner.proposals[0]?.taskOverride?.includes("Stage summary: active=2"))
		const continuationHistoryVisible =
			continued.planner.continuation?.attemptNumber === 2 &&
			continued.planner.continuation.previousRunId === "task-retryable" &&
			continued.planner.continuation.sourceRunIds.join(",") === "task-retryable,task-retryable-2" &&
			continued.planner.recoveryState?.stageSummary?.activeStage === 2
		const proposalsHumanReadable =
			retryable.planner.proposals.length > 0 &&
			retryable.planner.proposals.every((proposal) => proposal.label.trim().length > 0 && proposal.rationale.trim().length > 0)
		const summarySurfaceVisible =
			typeof summaryRetryPlanner.summary === "string" &&
			["retryable", "refuse", "not_needed"].includes(summaryRetryPlanner.decision) &&
			formatRetryPlannerArtifact(summaryRetryPlanner).includes("Campaign:") &&
			formatRetryPlannerArtifact(summaryRetryPlanner).includes("Recovery mode:")

		details.push(`summary=${runResult.summaryPath}`)
		details.push(`planner=${formatRetryPlannerArtifact(summaryRetryPlanner).split(/\r?\n/g)[0]}`)

		return {
			retryableDecisionVisible,
			redLaneRefusalWorks,
			partialRecoveryModeVisible,
			stageAwareProposalVisible,
			continuationHistoryVisible,
			proposalsHumanReadable,
			summarySurfaceVisible,
			details,
		}
	} finally {
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		repoHarness.cleanup()
		retryableScratch.cleanup()
		continuationScratch.cleanup()
		refusalScratch.cleanup()
	}
}

export function formatRetryPlannerHarnessResult(result: RetryPlannerHarnessResult): string {
	return [
		`Retryable decision visible: ${result.retryableDecisionVisible ? "PASS" : "FAIL"}`,
		`Red-lane refusal works: ${result.redLaneRefusalWorks ? "PASS" : "FAIL"}`,
		`Partial recovery mode visible: ${result.partialRecoveryModeVisible ? "PASS" : "FAIL"}`,
		`Stage-aware proposal visible: ${result.stageAwareProposalVisible ? "PASS" : "FAIL"}`,
		`Continuation history visible: ${result.continuationHistoryVisible ? "PASS" : "FAIL"}`,
		`Proposals human-readable: ${result.proposalsHumanReadable ? "PASS" : "FAIL"}`,
		`Summary surface visible: ${result.summarySurfaceVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runRetryPlannerHarness()
	console.log(formatRetryPlannerHarnessResult(result))
	process.exit(
		result.retryableDecisionVisible &&
			result.redLaneRefusalWorks &&
			result.partialRecoveryModeVisible &&
			result.stageAwareProposalVisible &&
			result.continuationHistoryVisible &&
			result.proposalsHumanReadable &&
			result.summarySurfaceVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:retry-planner] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
