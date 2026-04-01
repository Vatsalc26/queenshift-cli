import fs from "node:fs"
import path from "node:path"

import { ensureRunDir, writeIncidentPack, writeReviewPack, writeRunSummary } from "../src/run/RunArtifacts"
import { buildOwnerQuickActions, formatOwnerQuickActions } from "../src/owner/OwnerFollowUp"

export type OwnerQuickActionsHarnessResult = {
	reviewActionsVisible: boolean
	incidentActionsVisible: boolean
	rerunActionVisible: boolean
	redLaneSuggestionVisible: boolean
	triageVisible: boolean
	triageDetailsVisible: boolean
	details: string[]
}

function createWorkspace(): { workspace: string; cleanup: () => void } {
	const workspace = path.join(__dirname, "..", "verification", `.tmp-owner-quick-actions-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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

function seedReviewRun(workspace: string): string {
	const runId = "task-review"
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "tighten hello.ts wording",
		workspace,
		status: "review_required",
		stopReason: "review_blocked",
		pathChosen: "small_task",
		taskContract: {
			scope: {
				allowedFiles: ["hello.ts"],
			},
		},
	})
	writeReviewPack(runDir, {
		runId,
		task: "tighten hello.ts wording",
		workspace,
		status: "review_required",
		stopReason: "review_blocked",
		message: "Human review required.",
		reviewerVerdict: "NEEDS_WORK",
		taskContract: null,
		acceptanceGate: { passed: false, failedChecks: ["reviewer_not_passed"] },
		verificationProfile: { status: "not_applicable" },
		changedFiles: ["hello.ts"],
		createdFiles: [],
		diffStat: " hello.ts | 2 +-",
		diffPreview: "diff --git a/hello.ts b/hello.ts",
		summaryPath: path.join(runDir, "summary.json"),
		reviewPackPath: path.join(runDir, "review-pack.json"),
		cleanup: {
			ownedBranchNames: ["swarm/task-review/simple"],
			primaryBranch: "swarm/task-review/simple",
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
			canApprove: false,
			eligibility: ["Recorded review branch is missing: swarm/task-review/simple"],
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
			label: "stop and fix red lane",
			rationale: "The review artifact is no longer in a clean approval state.",
		},
	})
	return runId
}

function seedIncidentRun(workspace: string): string {
	const runId = "task-incident"
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "fix provider setup in hello.ts",
		workspace,
		status: "failed",
		stopReason: "provider_auth_failure",
		pathChosen: "small_task",
		taskContract: {
			scope: {
				allowedFiles: ["hello.ts"],
			},
		},
	})
	writeIncidentPack(runDir, {
		runId,
		task: "fix provider setup in hello.ts",
		workspace,
		status: "failed",
		stopReason: "provider_auth_failure",
		failureBucket: "provider/config failure",
		nextPlaceToLook: "Inspect provider config.",
		message: "Provider credentials were missing.",
		pathChosen: "small_task",
		taskContract: null,
		reviewerVerdict: null,
		acceptanceGate: { passed: false, failedChecks: ["reviewer_not_passed"] },
		verificationProfile: { status: "not_applicable" },
		changedFiles: [],
		createdFiles: [],
		diffStat: "(diff stat unavailable)",
		diffPreviewExcerpt: "(diff preview unavailable)",
		cleanupOwnership: {
			ownedBranchNames: ["swarm/task-incident/simple"],
			primaryBranch: "swarm/task-incident/simple",
			ownedWorktreeDir: null,
			mainWorkspaceTouched: false,
			recoveryInventory: {
				orphanedWorktrees: [],
				orphanedSwarmBranches: [],
				staleTmpEntries: [],
				incompleteRunArtifacts: [],
			},
			ambiguousOwnership: false,
			ambiguousOwnershipReasons: [],
		},
		latestCleanup: null,
		recoveryAction: {
			kind: "rollback_owned_state",
			label: "rollback owned state before retrying",
			command: `queenshift incident:rollback ${runId} --workspace "${workspace}"`,
			rationale: "Owned branch state can be cleaned safely before retrying.",
		},
		nextAction: {
			label: "rollback owned state before retrying",
			rationale: "Remove the leftover owned state first.",
		},
		redLaneHint: {
			recommended: false,
			rationale: "The incident is recoverable without staging a FixRedLane session.",
			templatePath: "Coding_sessions/FIX_RED_LANE_TEMPLATE.md",
		},
		artifacts: {
			summaryPath: path.join(runDir, "summary.json"),
			reviewPackPath: null,
			incidentPackPath: path.join(runDir, "incident-pack.json"),
		},
	})
	return runId
}

function seedSuccessRun(workspace: string): string {
	const runId = "task-success"
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "add a brief comment to hello.ts",
		workspace,
		status: "done",
		stopReason: "success",
		pathChosen: "small_task",
		taskContract: {
			scope: {
				allowedFiles: ["hello.ts"],
			},
		},
	})
	return runId
}

export async function runOwnerQuickActionsHarness(): Promise<OwnerQuickActionsHarnessResult> {
	const details: string[] = []
	const harness = createWorkspace()
	try {
		const reviewRunId = seedReviewRun(harness.workspace)
		const incidentRunId = seedIncidentRun(harness.workspace)
		const successRunId = seedSuccessRun(harness.workspace)

		const reviewActions = buildOwnerQuickActions(harness.workspace, { preferredRunId: reviewRunId })
		const incidentActions = buildOwnerQuickActions(harness.workspace, { preferredRunId: incidentRunId })
		const successActions = buildOwnerQuickActions(harness.workspace, { preferredRunId: successRunId })

		const reviewActionsVisible =
			reviewActions.actions.some(
				(action) => action.label === "open review pack" && (action.command ?? "").startsWith("queenshift review:show "),
			) &&
			reviewActions.actions.some((action) => action.label === "stage FixRedLane session")
		const incidentActionsVisible =
			incidentActions.actions.some(
				(action) => action.label === "open incident pack" && (action.command ?? "").startsWith("queenshift incident:show "),
			) &&
			incidentActions.actions.some(
				(action) =>
					action.label === "rollback owned state before retrying" &&
					(action.command ?? "").startsWith("queenshift incident:rollback "),
			)
		const rerunActionVisible =
			successActions.actions.some(
				(action) =>
					action.label === "rerun the same bounded task" && (action.command ?? "").startsWith('queenshift "add a brief comment to hello.ts"'),
			) &&
			successActions.actions.some((action) => (action.command ?? "").includes("--workspace"))
		const redLaneSuggestionVisible =
			reviewActions.redLaneRecommended === true &&
			reviewActions.actions.some((action) => (action.command ?? "").includes("FixRedLane_SessionXX_ReviewBlocked.md")) &&
			reviewActions.actions.some((action) => (action.command ?? "").includes("npm.cmd run verify:review:queue"))
		const triageVisible =
			incidentActions.triage?.category === "provider_setup_issue" &&
			incidentActions.triage?.code === "provider_setup_auth" &&
			formatOwnerQuickActions(incidentActions).includes("Incident triage: Provider setup/auth issue")
		const triageDetailsVisible =
			formatOwnerQuickActions(incidentActions).includes("Detailed code: provider_setup_auth") &&
			formatOwnerQuickActions(incidentActions).includes("Suggested FixRedLane file: FixRedLane_SessionXX_ProviderSetup.md")

		details.push(
			`reviewRecommended=${reviewActions.recommendedAction?.label ?? "none"}`,
			`incidentRecommended=${incidentActions.recommendedAction?.label ?? "none"}`,
			`successRecommended=${successActions.recommendedAction?.label ?? "none"}`,
		)

		return {
			reviewActionsVisible,
			incidentActionsVisible,
			rerunActionVisible,
			redLaneSuggestionVisible,
			triageVisible,
			triageDetailsVisible,
			details,
		}
	} finally {
		harness.cleanup()
	}
}

export function formatOwnerQuickActionsHarnessResult(result: OwnerQuickActionsHarnessResult): string {
	return [
		`Review actions visible: ${result.reviewActionsVisible ? "PASS" : "FAIL"}`,
		`Incident actions visible: ${result.incidentActionsVisible ? "PASS" : "FAIL"}`,
		`Rerun action visible: ${result.rerunActionVisible ? "PASS" : "FAIL"}`,
		`FixRedLane suggestion visible: ${result.redLaneSuggestionVisible ? "PASS" : "FAIL"}`,
		`Incident triage visible: ${result.triageVisible ? "PASS" : "FAIL"}`,
		`Incident triage details visible: ${result.triageDetailsVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerQuickActionsHarness()
	console.log(formatOwnerQuickActionsHarnessResult(result))
	process.exit(
		result.reviewActionsVisible &&
			result.incidentActionsVisible &&
			result.rerunActionVisible &&
			result.redLaneSuggestionVisible &&
			result.triageVisible &&
			result.triageDetailsVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:quick-actions] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
