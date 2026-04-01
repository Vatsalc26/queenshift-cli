import fs from "node:fs"
import path from "node:path"

import { buildOwnerQuickActions, formatOwnerQuickActions } from "../src/owner/OwnerFollowUp"
import { buildIncidentTriage, formatIncidentTriage } from "../src/run/IncidentTriage"
import { ensureRunDir, writeIncidentPack, writeReviewPack, writeRunSummary } from "../src/run/RunArtifacts"

export type IncidentTriageHarnessResult = {
	providerIssueClassified: boolean
	scopeIssueClassified: boolean
	reviewIssueClassified: boolean
	detailedTaxonomyVisible: boolean
	ownerQuickActionsShowTriage: boolean
	ownerQuickActionsShowFixRedLane: boolean
	details: string[]
}

function createWorkspace(): { workspace: string; cleanup: () => void } {
	const workspace = path.join(__dirname, "..", "verification", `.tmp-incident-triage-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(workspace, { recursive: true })
	fs.mkdirSync(path.join(workspace, ".git"), { recursive: true })
	return {
		workspace,
		cleanup: () => {
			if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
		},
	}
}

function seedProviderIncident(workspace: string): string {
	const runId = "triage-provider"
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "fix provider setup in hello.ts",
		workspace,
		status: "failed",
		stopReason: "provider_auth_failure",
		pathChosen: "small_task",
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
		acceptanceGate: null,
		verificationProfile: null,
		changedFiles: [],
		createdFiles: [],
		diffStat: "(diff stat unavailable)",
		diffPreviewExcerpt: "(diff preview unavailable)",
		cleanupOwnership: {
			ownedBranchNames: [],
			primaryBranch: null,
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
			kind: "inspect_only",
			label: "inspect provider setup",
			command: `queenshift incident:show ${runId} --workspace "${workspace}"`,
			rationale: "Provider configuration should be fixed before retrying.",
		},
		nextAction: {
			label: "investigate provider/auth setup",
			rationale: "Provider configuration should be fixed before retrying.",
		},
		redLaneHint: {
			recommended: true,
			rationale: "A failed run is a red lane.",
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

function seedScopeIncident(workspace: string): string {
	const runId = "triage-scope"
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "edit too many files",
		workspace,
		status: "failed",
		stopReason: "too_many_changed_files",
		pathChosen: "medium",
	})
	writeIncidentPack(runDir, {
		runId,
		task: "edit too many files",
		workspace,
		status: "failed",
		stopReason: "too_many_changed_files",
		failureBucket: "scope drift",
		nextPlaceToLook: "Inspect changed-file scope.",
		message: "The run drifted beyond the bounded file limit.",
		pathChosen: "medium",
		taskContract: null,
		reviewerVerdict: "PASS",
		acceptanceGate: { passed: false, failedChecks: ["too_many_changed_files"] },
		verificationProfile: null,
		changedFiles: ["a.ts", "b.ts", "c.ts"],
		createdFiles: [],
		diffStat: "(diff stat unavailable)",
		diffPreviewExcerpt: "(diff preview unavailable)",
		cleanupOwnership: {
			ownedBranchNames: [],
			primaryBranch: null,
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
			kind: "inspect_only",
			label: "inspect scope drift",
			command: `queenshift incident:show ${runId} --workspace "${workspace}"`,
			rationale: "The change should be narrowed back to the supported lane.",
		},
		nextAction: {
			label: "stop and fix red lane",
			rationale: "The bounded lane was exceeded.",
		},
		redLaneHint: {
			recommended: true,
			rationale: "The bounded lane was exceeded.",
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

function seedReviewIncident(workspace: string): string {
	const runId = "triage-review"
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "review blocked change",
		workspace,
		status: "review_required",
		stopReason: "review_blocked",
		pathChosen: "small_task",
	})
		writeReviewPack(runDir, {
		runId,
		task: "review blocked change",
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
			ownedBranchNames: ["swarm/triage-review/simple"],
			primaryBranch: "swarm/triage-review/simple",
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
			eligibility: ["Recorded review branch is missing: swarm/triage-review/simple"],
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
				rationale: "The review evidence is not safely approvable.",
		},
	})
	return runId
}

function readSummary(runDir: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(path.join(runDir, "summary.json"), "utf8")) as Record<string, unknown>
}

function readPack(runDir: string, fileName: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(path.join(runDir, fileName), "utf8")) as Record<string, unknown>
}

export async function runIncidentTriageHarness(): Promise<IncidentTriageHarnessResult> {
	const details: string[] = []
	const harness = createWorkspace()
	try {
		const providerRunId = seedProviderIncident(harness.workspace)
		const scopeRunId = seedScopeIncident(harness.workspace)
		const reviewRunId = seedReviewIncident(harness.workspace)

		const providerRunDir = path.join(harness.workspace, ".swarm", "runs", providerRunId)
		const scopeRunDir = path.join(harness.workspace, ".swarm", "runs", scopeRunId)
		const reviewRunDir = path.join(harness.workspace, ".swarm", "runs", reviewRunId)

		const providerTriage = buildIncidentTriage({
			summary: readSummary(providerRunDir),
			incidentPack: readPack(providerRunDir, "incident-pack.json") as never,
		})
		const scopeTriage = buildIncidentTriage({
			summary: readSummary(scopeRunDir),
			incidentPack: readPack(scopeRunDir, "incident-pack.json") as never,
		})
		const reviewTriage = buildIncidentTriage({
			summary: readSummary(reviewRunDir),
			reviewPack: readPack(reviewRunDir, "review-pack.json") as never,
		})

		const providerIssueClassified =
			providerTriage?.category === "provider_setup_issue" &&
			providerTriage.code === "provider_setup_auth" &&
			formatIncidentTriage(providerTriage).includes("Provider setup/auth issue")
		const scopeIssueClassified =
			scopeTriage?.category === "unsupported_task_scope" &&
			scopeTriage.code === "unsupported_scope_change" &&
			scopeTriage.recommendedLabel === "stop and fix red lane"
		const reviewIssueClassified =
			reviewTriage?.category === "merge_or_review_failure" &&
			reviewTriage.code === "review_blocked" &&
			reviewTriage.recommendedLabel === "stop and fix red lane"
		const detailedTaxonomyVisible =
			formatIncidentTriage(providerTriage).includes("Detailed code: provider_setup_auth") &&
			formatIncidentTriage(providerTriage).includes("Invariant at risk: supported provider setup and launch path") &&
			formatIncidentTriage(providerTriage).includes("Suggested FixRedLane file: FixRedLane_SessionXX_ProviderSetup.md")

		const quickActions = buildOwnerQuickActions(harness.workspace, { preferredRunId: providerRunId })
		const quickActionsText = formatOwnerQuickActions(quickActions)
		const ownerQuickActionsShowTriage =
			quickActions.triage?.category === "provider_setup_issue" &&
			quickActions.triage?.code === "provider_setup_auth" &&
			quickActionsText.includes("Incident triage: Provider setup/auth issue") &&
			quickActionsText.includes("Detailed code: provider_setup_auth") &&
			quickActions.actions.some(
				(action) =>
					action.label === "investigate provider/auth setup" &&
					(action.command ?? "").startsWith("queenshift incident:show "),
			)
		const reviewQuickActions = buildOwnerQuickActions(harness.workspace, { preferredRunId: reviewRunId })
		const reviewQuickActionsText = formatOwnerQuickActions(reviewQuickActions)
		const ownerQuickActionsShowFixRedLane =
			reviewQuickActions.redLaneRecommended === true &&
			reviewQuickActionsText.includes("FixRedLane_SessionXX_ReviewBlocked.md") &&
			reviewQuickActions.actions.some((action) => (action.command ?? "").includes("npm.cmd run verify:review:queue"))

		details.push(`provider=${providerTriage?.category ?? "none"}`)
		details.push(`providerCode=${providerTriage?.code ?? "none"}`)
		details.push(`scopeCode=${scopeTriage?.code ?? "none"}`)
		details.push(`reviewCode=${reviewTriage?.code ?? "none"}`)

		return {
			providerIssueClassified,
			scopeIssueClassified,
			reviewIssueClassified,
			detailedTaxonomyVisible,
			ownerQuickActionsShowTriage,
			ownerQuickActionsShowFixRedLane,
			details,
		}
	} finally {
		harness.cleanup()
	}
}

export function formatIncidentTriageHarnessResult(result: IncidentTriageHarnessResult): string {
	return [
		`Provider issue classified: ${result.providerIssueClassified ? "PASS" : "FAIL"}`,
		`Scope issue classified: ${result.scopeIssueClassified ? "PASS" : "FAIL"}`,
		`Review issue classified: ${result.reviewIssueClassified ? "PASS" : "FAIL"}`,
		`Detailed taxonomy visible: ${result.detailedTaxonomyVisible ? "PASS" : "FAIL"}`,
		`Owner quick actions show triage: ${result.ownerQuickActionsShowTriage ? "PASS" : "FAIL"}`,
		`Owner quick actions show FixRedLane: ${result.ownerQuickActionsShowFixRedLane ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runIncidentTriageHarness()
	console.log(formatIncidentTriageHarnessResult(result))
	process.exit(
		result.providerIssueClassified &&
			result.scopeIssueClassified &&
			result.reviewIssueClassified &&
			result.detailedTaxonomyVisible &&
			result.ownerQuickActionsShowTriage &&
			result.ownerQuickActionsShowFixRedLane
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:incident-triage] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
