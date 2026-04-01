import fs from "node:fs"
import path from "node:path"

import { buildOwnerLifeSignal, formatOwnerLifeSignal } from "../src/owner/OwnerFollowUp"
import { buildOwnerShellStatusText } from "../src/owner/OwnerStatus"
import { resolveOwnerProviderSelection } from "../src/owner/ProviderResolution"
import { appendRunEvent, ensureRunDir, writeReviewPack, writeRunSummary } from "../src/run/RunArtifacts"
import { enqueueWorkItem } from "../src/run/WorkQueue"

export type OwnerLifeSignalHarnessResult = {
	runningStateVisible: boolean
	activeAgentVisible: boolean
	blockedBucketVisible: boolean
	campaignVisible: boolean
	idleGuidanceVisible: boolean
	nextCommandVisible: boolean
	queueVisible: boolean
	queueReasonVisible: boolean
	focusHeadlineVisible: boolean
	progressSummaryVisible: boolean
	recoveryLoopVisible: boolean
	outcomeDashboardVisible: boolean
	outcomeBucketsVisible: boolean
	statusSurfaceVisible: boolean
	lowSteeringLoopVisible: boolean
	details: string[]
}

function createHarnessWorkspace(): { workspace: string; cleanup: () => void } {
	const workspace = path.join(__dirname, "..", "verification", `.tmp-owner-life-signal-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(workspace, { recursive: true })
	fs.mkdirSync(path.join(workspace, ".git"), { recursive: true })
	fs.writeFileSync(path.join(workspace, "hello.ts"), "export const hello = 'world'\n", "utf8")
	return {
		workspace,
		cleanup: () => {
			if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
		},
	}
}

function createHarnessRoot(): { rootDir: string; cleanup: () => void } {
	const rootDir = path.join(__dirname, "..", "verification", `.tmp-owner-life-signal-root-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(rootDir, { recursive: true })
	fs.writeFileSync(path.join(rootDir, "RC1_DAILY_DRIVER_LOG.json"), `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`, "utf8")
	return {
		rootDir,
		cleanup: () => {
			if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true })
		},
	}
}

function seedRunningRun(workspace: string): string {
	const runId = "task-running"
	const runDir = ensureRunDir(workspace, runId)
	appendRunEvent(runDir, {
		type: "run_start",
		taskId: runId,
		task: "add a brief comment to hello.ts",
	})
	appendRunEvent(runDir, {
		type: "agent_start",
		taskId: runId,
		agentId: "builder-1",
		role: "builder",
	})
	appendRunEvent(runDir, {
		type: "agent_iteration",
		taskId: runId,
		agentId: "builder-1",
		role: "builder",
		iteration: 1,
	})
	return runId
}

function seedBlockedRun(workspace: string): string {
	const runId = "task-blocked"
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "tighten hello.ts wording",
		workspace,
		engine: "swarmengine",
		status: "review_required",
		stopReason: "review_blocked",
		pathChosen: "small_task",
		fastLane: {
			laneId: "simple_task_fast_lane",
			predictability: "high",
			expectedWorkItems: 1,
			expectedBuilderCount: 1,
		},
		progressMap: {
			stageCount: 1,
			stageSummary: {
				activeStage: 1,
				nextStage: null,
				completedStages: [],
				remainingStages: [1],
				anchorWorkItems: ["comment-hello"],
			},
			readyAssignmentIds: ["assignment-1"],
			blockedAssignmentIds: [],
			releasedAssignmentIds: [],
			entries: [],
		},
		verificationProfile: {
			status: "passed",
		},
		taskContract: {
			scope: {
				allowedFiles: ["hello.ts"],
			},
		},
		campaign: {
			schemaVersion: 1,
			campaignId: "campaign-task-blocked",
			originRunId: runId,
			currentRunId: runId,
			previousRunId: null,
			attemptNumber: 1,
			nextAttemptNumber: 2,
			sourceRunIds: [runId],
		},
	})
	writeReviewPack(runDir, {
		runId,
		task: "tighten hello.ts wording",
		workspace,
		status: "review_required",
		stopReason: "review_blocked",
		message: "Human review required.",
		reviewerVerdict: "PASS",
		taskContract: null,
		acceptanceGate: { passed: true, failedChecks: [] },
		verificationProfile: { status: "passed" },
		changedFiles: ["hello.ts"],
		createdFiles: [],
		diffStat: " hello.ts | 2 +-",
		diffPreview: "diff --git a/hello.ts b/hello.ts",
		summaryPath: path.join(runDir, "summary.json"),
		reviewPackPath: path.join(runDir, "review-pack.json"),
		cleanup: {
			ownedBranchNames: ["swarm/task-blocked/simple"],
			primaryBranch: "swarm/task-blocked/simple",
			ownedWorktreeDir: null,
			mainWorkspaceTouched: false,
			deletedBranches: [],
			leftoverBranches: [],
		},
		queueFollowUp: {
			pendingCount: 0,
			readyCount: 0,
			awaitingApprovalCount: 0,
			scheduledCount: 0,
			state: "empty",
			summary: "No queued follow-up work is recorded.",
			nextCommandHint: null,
			nextTask: null,
		},
		review: {
			decision: "pending",
			canApprove: true,
			eligibility: [],
			requiredApprovals: 1,
			approvedBy: [],
			allowedReviewers: [],
			approvalsRemaining: 1,
			decidedAt: null,
			decisionBy: null,
			approvalCommit: null,
		},
		audit: {
			history: [],
			pendingReviewers: [],
		},
		nextAction: {
			label: "approve now",
			rationale: "The isolated review candidate still has its owned branch state and is safe to approve.",
		},
	})
	return runId
}

function seedDoneRun(workspace: string): string {
	const runId = "task-done"
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "add a brief comment to hello.ts",
		workspace,
		status: "done",
		stopReason: "completed",
		pathChosen: "small_task",
		taskContract: {
			scope: {
				allowedFiles: ["hello.ts"],
			},
		},
		reviewerVerdict: "PASS",
		acceptanceGate: {
			passed: true,
			failedChecks: [],
		},
	})
	return runId
}

function seedFailedRun(workspace: string): string {
	const runId = "task-failed"
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "update hello.ts wording",
		workspace,
		status: "failed",
		stopReason: "verification_failed",
		pathChosen: "small_task",
		taskContract: {
			scope: {
				allowedFiles: ["hello.ts"],
			},
		},
		reviewerVerdict: "PASS",
		acceptanceGate: {
			passed: false,
			failedChecks: ["verification_profile_failed"],
		},
	})
	return runId
}

export async function runOwnerLifeSignalHarness(): Promise<OwnerLifeSignalHarnessResult> {
	const details: string[] = []
	const oauthDir = path.join(__dirname, "..", "verification", `.tmp-owner-life-signal-oauth-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	const oauthPath = path.join(oauthDir, "oauth_creds.json")
	fs.mkdirSync(oauthDir, { recursive: true })
	fs.writeFileSync(oauthPath, `${JSON.stringify({ refresh_token: "fixture" }, null, 2)}\n`, "utf8")
	const workspaceHarness = createHarnessWorkspace()
	const idleWorkspaceHarness = createHarnessWorkspace()
	const rootHarness = createHarnessRoot()

	try {
		const runningRunId = seedRunningRun(workspaceHarness.workspace)
		const blockedRunId = seedBlockedRun(workspaceHarness.workspace)
		seedDoneRun(workspaceHarness.workspace)
		seedFailedRun(workspaceHarness.workspace)
		enqueueWorkItem(workspaceHarness.workspace, {
			task: "add a note to hello.ts later",
			scheduledAt: new Date(Date.now() + 60_000).toISOString(),
			campaignId: "campaign-task-blocked",
			originRunId: blockedRunId,
			executionMode: "background_candidate",
		})
		enqueueWorkItem(workspaceHarness.workspace, {
			task: "refresh utils.ts after the current review settles",
			scheduledAt: new Date(Date.now() + 120_000).toISOString(),
			campaignId: "campaign-task-blocked",
			originRunId: blockedRunId,
		})

		const runningSignal = buildOwnerLifeSignal(workspaceHarness.workspace, {
			preferredRunId: runningRunId,
			nowMs: Date.now(),
		})
		const blockedSignal = buildOwnerLifeSignal(workspaceHarness.workspace, {
			preferredRunId: blockedRunId,
			nowMs: Date.now(),
		})
		const idleSignal = buildOwnerLifeSignal(idleWorkspaceHarness.workspace, {
			nowMs: Date.now(),
		})
		const blockedSignalText = formatOwnerLifeSignal(blockedSignal)
		const selection = resolveOwnerProviderSelection({ GEMINI_CLI_OAUTH_PATH: oauthPath })
		const statusText = buildOwnerShellStatusText({
			rootDir: rootHarness.rootDir,
			workspace: workspaceHarness.workspace,
			surface: "thin_shell_guided",
			providerSelection: selection,
			admissionText: "Admission decision: ALLOW\nRepo readiness: ALLOW\nTask admission: ALLOW",
			latestRunId: blockedRunId,
		})

		const runningStateVisible = runningSignal.runState === "running" && runningSignal.liveness === "alive"
		const activeAgentVisible = runningSignal.activeAgents.includes("builder-1")
		const blockedBucketVisible = blockedSignal.blockerBucket === "review blocked" && blockedSignal.nextSuggestedAction === "approve now"
		const campaignVisible =
			blockedSignal.campaignId === "campaign-task-blocked" &&
			blockedSignal.campaignRunCount === 1 &&
			blockedSignal.campaignQueuedCount === 2 &&
			statusText.includes("Campaign: campaign-task-blocked attempt=1 runs=1 queued=2")
		const idleGuidanceVisible =
			idleSignal.runState === "idle" &&
			idleSignal.nextSuggestedAction.includes("Guided mode") &&
			idleSignal.nextSuggestedCommand === null
		const nextCommandVisible = (blockedSignal.nextSuggestedCommand ?? "").includes("review:approve")
		const queueVisible =
			blockedSignal.queuePendingCount === 2 &&
			blockedSignal.queueAwaitingApprovalCount === 1 &&
			blockedSignal.queueScheduledCount === 2 &&
			blockedSignal.queueState === "awaiting_owner" &&
			blockedSignal.nextQueuedApprovalTask === "add a note to hello.ts later" &&
			statusText.includes("Queue: pending=2 ready=0 awaiting_approval=1 scheduled=2 state=awaiting_owner")
		const queueReasonVisible =
			blockedSignal.queueSummary.includes("paused until the owner explicitly approves it") &&
			blockedSignal.queueSummary.includes("scheduled for") &&
			(blockedSignal.queueNextCommand ?? "").includes("queue:approve") &&
			statusText.includes("Queue note: Queued background candidate") &&
			statusText.includes("Queue command: queue:approve")
		const focusHeadlineVisible =
			blockedSignal.runtimeVisibilityHeadline.includes("small_task on simple_task_fast_lane") &&
			blockedSignal.runtimeVisibilityHeadline.includes("stage 1 of 1") &&
			blockedSignal.runtimeVisibilityHeadline.includes("verification passed") &&
			blockedSignalText.includes("Current focus: small_task on simple_task_fast_lane") &&
			statusText.includes("Current focus: small_task on simple_task_fast_lane")
		const progressSummaryVisible =
			blockedSignal.runtimeVisibilitySummary.includes("path=small_task") &&
			blockedSignal.runtimeVisibilitySummary.includes("lane=simple_task_fast_lane") &&
			blockedSignal.runtimeVisibilitySummary.includes("stages=1") &&
			blockedSignal.runtimeVisibilitySummary.includes("verify=passed") &&
			blockedSignalText.includes("Visible progress: path=small_task") &&
			statusText.includes("Visible progress: path=small_task")
		const recoveryLoopVisible =
			blockedSignal.recoveryLoop === "review:list -> owner:quick-actions -> replay:latest" &&
			blockedSignalText.includes("Recovery loop: review:list -> owner:quick-actions -> replay:latest") &&
			statusText.includes("Recovery loop: review:list -> owner:quick-actions -> replay:latest")
		const outcomeDashboardVisible =
			blockedSignal.outcomeWindowRuns === 3 &&
			blockedSignal.outcomeDoneRuns === 1 &&
			blockedSignal.outcomeReviewRequiredRuns === 1 &&
			blockedSignal.outcomeFailedRuns === 1 &&
			statusText.includes("Outcome dashboard: runs=3 done=1 review_required=1 failed=1 success=33.3%")
		const outcomeBucketsVisible =
			blockedSignal.outcomeFailureBuckets.includes("review blocked=1") &&
			blockedSignal.outcomeFailureBuckets.includes("verification profile=1") &&
			statusText.includes("Outcome buckets: review blocked=1 | verification profile=1")
		const statusSurfaceVisible =
			statusText.includes("Life signal: REVIEW_REQUIRED") &&
			statusText.includes("Quick actions:") &&
			statusText.includes("approve now") &&
			statusText.includes("Calm default: approve now")
		const lowSteeringLoopVisible =
			blockedSignalText.includes("Low-steering loop:") &&
			blockedSignalText.includes("owner:guided:demo") &&
			blockedSignalText.includes("owner:life-signal") &&
			blockedSignalText.includes("owner:quick-actions") &&
			statusText.includes("Low-steering loop:") &&
			statusText.includes("demo:run")

		details.push(
			`running=${runningSignal.runState}/${runningSignal.liveness}`,
			`blockedNext=${blockedSignal.nextSuggestedAction}`,
			`idleNext=${idleSignal.nextSuggestedAction}`,
			`outcomes=${blockedSignal.outcomeWindowRuns}/${blockedSignal.outcomeDoneRuns}/${blockedSignal.outcomeReviewRequiredRuns}/${blockedSignal.outcomeFailedRuns}`,
			`statusHasQuickActions=${statusText.includes("Quick actions:")}`,
		)

		return {
			runningStateVisible,
			activeAgentVisible,
			blockedBucketVisible,
			campaignVisible,
			idleGuidanceVisible,
			nextCommandVisible,
			queueVisible,
			queueReasonVisible,
			focusHeadlineVisible,
			progressSummaryVisible,
			recoveryLoopVisible,
			outcomeDashboardVisible,
			outcomeBucketsVisible,
			statusSurfaceVisible,
			lowSteeringLoopVisible,
			details,
		}
	} finally {
		rootHarness.cleanup()
		workspaceHarness.cleanup()
		idleWorkspaceHarness.cleanup()
		if (fs.existsSync(oauthDir)) fs.rmSync(oauthDir, { recursive: true, force: true })
	}
}

export function formatOwnerLifeSignalHarnessResult(result: OwnerLifeSignalHarnessResult): string {
	return [
		`Running state visible: ${result.runningStateVisible ? "PASS" : "FAIL"}`,
		`Active agent visible: ${result.activeAgentVisible ? "PASS" : "FAIL"}`,
		`Blocked bucket visible: ${result.blockedBucketVisible ? "PASS" : "FAIL"}`,
		`Campaign visible: ${result.campaignVisible ? "PASS" : "FAIL"}`,
		`Idle guidance visible: ${result.idleGuidanceVisible ? "PASS" : "FAIL"}`,
		`Next command visible: ${result.nextCommandVisible ? "PASS" : "FAIL"}`,
		`Queue visible: ${result.queueVisible ? "PASS" : "FAIL"}`,
		`Queue reason visible: ${result.queueReasonVisible ? "PASS" : "FAIL"}`,
		`Focus headline visible: ${result.focusHeadlineVisible ? "PASS" : "FAIL"}`,
		`Progress summary visible: ${result.progressSummaryVisible ? "PASS" : "FAIL"}`,
		`Recovery loop visible: ${result.recoveryLoopVisible ? "PASS" : "FAIL"}`,
		`Outcome dashboard visible: ${result.outcomeDashboardVisible ? "PASS" : "FAIL"}`,
		`Outcome buckets visible: ${result.outcomeBucketsVisible ? "PASS" : "FAIL"}`,
		`Status surface visible: ${result.statusSurfaceVisible ? "PASS" : "FAIL"}`,
		`Low-steering loop visible: ${result.lowSteeringLoopVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerLifeSignalHarness()
	console.log(formatOwnerLifeSignalHarnessResult(result))
	process.exit(
		result.runningStateVisible &&
			result.activeAgentVisible &&
			result.blockedBucketVisible &&
			result.campaignVisible &&
			result.idleGuidanceVisible &&
			result.nextCommandVisible &&
			result.queueVisible &&
			result.queueReasonVisible &&
			result.focusHeadlineVisible &&
			result.progressSummaryVisible &&
			result.recoveryLoopVisible &&
			result.outcomeDashboardVisible &&
			result.outcomeBucketsVisible &&
			result.statusSurfaceVisible &&
			result.lowSteeringLoopVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:life-signal] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
