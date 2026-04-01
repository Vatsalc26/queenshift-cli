import fs from "node:fs"
import path from "node:path"

import { buildOwnerShellStatusText } from "../src/owner/OwnerStatus"
import { resolveOwnerProviderSelection } from "../src/owner/ProviderResolution"
import { createFailureNarrative } from "../src/run/FailureNarrative"
import { formatReviewPack, type ReviewPack } from "../src/run/ReviewQueue"
import { formatIncidentPack, type IncidentPack } from "../src/run/IncidentPack"

export type OwnerClarityHarnessResult = {
	prelaunchStatusVisible: boolean
	rc1ReasonVisible: boolean
	reviewNextActionVisible: boolean
	incidentNextActionVisible: boolean
	calmDefaultVisible: boolean
	details: string[]
}

function createHarnessRoot(): { rootDir: string; cleanup: () => void } {
	const rootDir = path.join(__dirname, "..", "verification", `.tmp-owner-clarity-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(rootDir, { recursive: true })
	fs.writeFileSync(
		path.join(rootDir, "RC1_DAILY_DRIVER_LOG.json"),
		`${JSON.stringify(
			{
				version: 1,
				entries: [
					{
						date: "2026-03-21",
						workspace: "C:\\OwnerRepo",
						task: "owner run",
						runId: "run-rc1-rejected",
						surface: "thin_shell_guided",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "not_applicable",
						manualRepair: false,
						credited: false,
						notes: "Not credited: already has 4/4 credited runs for the current date.",
					},
				],
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
	return {
		rootDir,
		cleanup: () => {
			if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true })
		},
	}
}

export async function runOwnerClarityHarness(): Promise<OwnerClarityHarnessResult> {
	const details: string[] = []
	const oauthDir = path.join(__dirname, "..", "verification", `.tmp-owner-clarity-oauth-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	const oauthPath = path.join(oauthDir, "oauth_creds.json")
	fs.mkdirSync(oauthDir, { recursive: true })
	fs.writeFileSync(oauthPath, `${JSON.stringify({ refresh_token: "fixture" }, null, 2)}\n`, "utf8")
	const harnessRoot = createHarnessRoot()

	try {
		const selection = resolveOwnerProviderSelection({ GEMINI_CLI_OAUTH_PATH: oauthPath })
		const statusText = buildOwnerShellStatusText({
			rootDir: harnessRoot.rootDir,
			workspace: "C:\\OwnerRepo",
			surface: "thin_shell_guided",
			providerSelection: selection,
			admissionText: "Admission decision: ALLOW\nRepo readiness: ALLOW\nTask admission: ALLOW",
			latestRunId: "run-rc1-rejected",
		})
		const prelaunchStatusVisible =
			statusText.includes("Workspace: C:\\OwnerRepo") &&
			statusText.includes("Provider: gemini (cli)") &&
			statusText.includes("Admission decision: ALLOW")
		const rc1ReasonVisible = statusText.includes("Latest RC1 credit: rejected -> Not credited: already has 4/4 credited runs")
		const calmDefaultVisible =
			statusText.includes("Calm default:") && statusText.includes("pick a real small clean repo")

		const reviewPack: ReviewPack = {
			runId: "review-1",
			task: "tighten a bounded edit",
			workspace: "C:\\OwnerRepo",
			status: "review_required",
			stopReason: "review_blocked",
			message: "Human review required.",
			reviewerVerdict: "NEEDS_WORK",
			taskContract: null,
			acceptanceGate: { passed: false, failedChecks: ["too_many_changed_files"] },
			verificationProfile: { status: "not_applicable" },
			changedFiles: ["hello.ts"],
			createdFiles: [],
			diffStat: " hello.ts | 2 +-",
			diffPreview: "diff --git a/hello.ts b/hello.ts",
			summaryPath: "summary.json",
			reviewPackPath: "review-pack.json",
			cleanup: {
				ownedBranchNames: ["swarm/review-1/simple"],
				primaryBranch: "swarm/review-1/simple",
				ownedWorktreeDir: null,
				mainWorkspaceTouched: false,
				deletedBranches: [],
				leftoverBranches: [],
			},
			mergeNegotiation: {
				status: "blocked",
				mode: "manual_conflict_review",
				readiness: "blocked",
				approvalBranch: "swarm/review-1/integration",
				sourceBranches: ["swarm/review-1/simple"],
				reviewStages: [
					{
						id: "source_order",
						label: "Source order",
						status: "blocked",
						summary: "Dependency-safe source ordering is not yet safe enough for approval.",
					},
				],
				reviewChecklist: ["Do not approve this run until merge blockers are resolved."],
				conflictReview: ["Shared file review is still incomplete."],
				handoffSummary: "Ordered handoff: swarm/review-1/simple (hello.ts).",
				blockers: ["Recorded review branch is missing: swarm/review-1/simple"],
				summary: "Merge negotiation is blocked. Human review can inspect the evidence but should not approve this run.",
			},
			postMergeQuality: {
				status: "blocked",
				approvalRisk: "merge_blocked",
				targetedEvaluatorStatus: "not_applicable",
				targetedConcernCount: 0,
				targetedEvaluatorIds: [],
				followUpChecks: ["Do not treat this coordinated change as clean until review and approval finish."],
				blockers: ["Recorded review branch is missing: swarm/review-1/simple"],
				summary: "Post-merge semantic quality gate stayed blocked because the run did not finish cleanly.",
			},
			approvalPackage: {
				readiness: "blocked",
				focusAreas: ["hello.ts"],
				requiredChecks: ["Do not approve this run until merge blockers are resolved."],
				summary: "Merge negotiation is blocked. Human review can inspect the evidence but should not approve this run.",
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
				eligibility: ["Recorded review branch is missing: swarm/review-1/simple"],
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
				rationale: "The review artifact is no longer safely approvable.",
			},
		}
		const reviewText = formatReviewPack(reviewPack)
		const reviewNextActionVisible =
			reviewText.includes("Next action: stop and fix red lane") &&
			reviewText.includes("Changed files: hello.ts")

		const incidentPack: IncidentPack = {
			runId: "incident-1",
			task: "owner task failed",
			workspace: "C:\\OwnerRepo",
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
			mergeNegotiation: null,
			failureNarrative: createFailureNarrative({
				whatFailed: "Provider setup/auth issue (provider_auth_failure)",
				whyItStopped: "The incident points to provider credentials or launch setup rather than code-change scope.",
				safestNextStep: "investigate provider/auth setup",
				recoveryFooting: "No V2-owned cleanup target is still recorded for this incident.",
				authoritativeArtifacts: ["summary.json", "incident-pack.json"],
			}),
			operatorAudit: null,
			latestCleanup: null,
			recoveryAction: {
				kind: "inspect_only",
				label: "No rollback needed",
				command: null,
				rationale: "No V2-owned cleanup target is still recorded for this incident.",
			},
			nextAction: {
				label: "investigate provider/auth setup",
				rationale: "The first useful step is to fix provider configuration before retrying.",
			},
			redLaneHint: {
				recommended: true,
				rationale: "A failed run is a red lane.",
				templatePath: "Coding_sessions/FIX_RED_LANE_TEMPLATE.md",
				suggestedFileName: "FixRedLane_SessionXX_ProviderSetup.md",
				firstInvariantAtRisk: "supported provider setup and launch path",
				nearbyProofCommands: ["npm.cmd test", "npm.cmd run verify:incident", "npm.cmd run verify:provider:resilience"],
				stageCommand:
					"Create Coding_sessions/FixRedLane_SessionXX_ProviderSetup.md; rerun nearby proofs: npm.cmd test ; npm.cmd run verify:incident ; npm.cmd run verify:provider:resilience",
				scaffold:
					"Suggested file: FixRedLane_SessionXX_ProviderSetup.md\nFirst invariant at risk: supported provider setup and launch path",
			},
			supportIssueIntake: {
				guidePath: "SUPPORT_ISSUE_INTAKE.md",
				templatePath: ".github/ISSUE_TEMPLATE/bug_report.md",
				suggestedTitle: "[bug] provider config failure",
				summary:
					'Run task-clarity-provider failed with failure bucket "provider/config failure" and stop reason "provider_auth_failure".',
				proofCommands: ["npm.cmd test", 'node dist/swarm.js incident:show task-clarity-provider --workspace "C:\\OwnerRepo"'],
				artifactPaths: ["summary.json", "incident-pack.json"],
				note: "Paste the artifact-backed issue intake block instead of reconstructing the failure from memory.",
			},
			artifacts: {
				summaryPath: "summary.json",
				reviewPackPath: null,
				incidentPackPath: "incident-pack.json",
			},
		}
		const incidentText = formatIncidentPack(incidentPack)
		const incidentNextActionVisible =
			incidentText.includes("Next action: investigate provider/auth setup") &&
			incidentText.includes("Recovery action: No rollback needed")

		details.push(`provider=${selection.provider ?? "none"}`, `reviewNextAction=${reviewNextActionVisible}`, `incidentNextAction=${incidentNextActionVisible}`)

		return {
			prelaunchStatusVisible,
			rc1ReasonVisible,
			reviewNextActionVisible,
			incidentNextActionVisible,
			calmDefaultVisible,
			details,
		}
	} finally {
		harnessRoot.cleanup()
		if (fs.existsSync(oauthDir)) fs.rmSync(oauthDir, { recursive: true, force: true })
	}
}

export function formatOwnerClarityHarnessResult(result: OwnerClarityHarnessResult): string {
	return [
		`Prelaunch status visible: ${result.prelaunchStatusVisible ? "PASS" : "FAIL"}`,
		`RC1 reason visible: ${result.rc1ReasonVisible ? "PASS" : "FAIL"}`,
		`Review next action visible: ${result.reviewNextActionVisible ? "PASS" : "FAIL"}`,
		`Incident next action visible: ${result.incidentNextActionVisible ? "PASS" : "FAIL"}`,
		`Calm default visible: ${result.calmDefaultVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerClarityHarness()
	console.log(formatOwnerClarityHarnessResult(result))
	process.exit(
		result.prelaunchStatusVisible &&
			result.rc1ReasonVisible &&
			result.reviewNextActionVisible &&
			result.incidentNextActionVisible &&
			result.calmDefaultVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:clarity] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
