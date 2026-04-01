import type { AcceptanceGateResult } from "../run/AcceptanceGate"
import type { VerificationProfileResult } from "../run/VerificationProfile"
import type { AssignmentLedger } from "./AssignmentLedger"
import type { MergeOrderArtifact } from "./MergeOrder"
import type { SwarmPlanArtifact } from "./PlanSchema"
import { getRoleManual } from "./RoleManuals"
import {
	buildTargetedEvaluatorsArtifact,
	type TargetedEvaluatorsArtifact,
} from "./TargetedEvaluators"

export type CriticStatus = "not_applicable" | "approved" | "concern"

export type CriticConcernCategory =
	| "plan_risk"
	| "scope_gap"
	| "handoff_risk"
	| "review_blocked"
	| "verification"
	| "merge_risk"
	| "refactor_risk"
	| "specialist_check"

export type CriticConcern = {
	category: CriticConcernCategory
	evidence: string
	recommendedAction: string
}

export type CriticArtifact = {
	schemaVersion: 1
	enabled: boolean
	manualVersion: string
	triggerReasons: string[]
	status: CriticStatus
	concerns: CriticConcern[]
	summary: string
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

function summarizeAcceptanceFailure(acceptanceGate: AcceptanceGateResult): string {
	if (acceptanceGate.failedChecks.length > 0) {
		return acceptanceGate.failedChecks.map((failure) => failure.message).join(" ")
	}
	return "Acceptance gate failed."
}

function summarizeVerification(verificationProfile: VerificationProfileResult): string {
	if (verificationProfile.message?.trim()) return verificationProfile.message.trim()
	if (verificationProfile.profileName?.trim()) return `${verificationProfile.profileName} -> ${verificationProfile.status}`
	return verificationProfile.status
}

export function buildCriticArtifact(input: {
	plan: SwarmPlanArtifact | null
	assignments: AssignmentLedger | null
	mergeOrder?: MergeOrderArtifact | null
	finalStatus: "done" | "review_required" | "failed"
	stopReason: string
	reviewerVerdict?: "PASS" | "NEEDS_WORK" | null
	acceptanceGate?: AcceptanceGateResult | null
	verificationProfile?: VerificationProfileResult | null
	changedFiles?: string[]
	targetedEvaluators?: TargetedEvaluatorsArtifact | null
}): CriticArtifact {
	const criticManual = getRoleManual("critic")
	const targetedEvaluators =
		input.targetedEvaluators ??
		buildTargetedEvaluatorsArtifact({
			plan: input.plan,
			repoMap: input.plan?.repoMap ?? null,
			acceptanceGate: input.acceptanceGate ?? null,
			verificationProfile: input.verificationProfile ?? null,
			changedFiles: input.changedFiles ?? [],
		})
	const triggerReasons = uniqueStrings([
		input.plan?.pathChosen === "medium" ? "medium bounded lane" : "",
		(input.plan?.workItems.length ?? 0) > 1 ? "multiple work items" : "",
		(input.plan?.scoutCoverage.coveredFiles.length ?? 0) > 1 ? "multi-file bounded change" : "",
		input.plan && input.plan.arbitration.activeBuilderCount !== input.plan.arbitration.requestedBuilderCount ? "dynamic worker arbitration" : "",
		input.plan?.teamShape && input.plan.teamShape.builderProfiles.length > 1 ? `specialized team shape (${input.plan.teamShape.shapeId})` : "",
		input.plan?.workItems.some((item) => item.dependsOn.length > 0) ? "serialized dependencies" : "",
		targetedEvaluators.applicableEvaluatorCount > 0 ? "specialist evaluators" : "",
		...(input.plan?.expectedRisks ?? []),
	])

	if (!input.plan || triggerReasons.length === 0) {
		return {
			schemaVersion: 1,
			enabled: false,
			manualVersion: criticManual.version,
			triggerReasons: [],
			status: "not_applicable",
			concerns: [],
			summary: "Critic lane not required for this bounded run.",
		}
	}

	const concerns: CriticConcern[] = []

	if (input.plan.expectedRisks.length > 0) {
		concerns.push({
			category: "plan_risk",
			evidence: input.plan.expectedRisks.join(" "),
			recommendedAction: "Keep the bounded plan visible and feed any concern into retry planning instead of mutating execution truth.",
		})
	}

	if (input.assignments && !input.assignments.handoffValid) {
		concerns.push({
			category: "handoff_risk",
			evidence: input.assignments.handoffIssues.join(" "),
			recommendedAction: "Repair assignment ownership before another complex attempt.",
		})
	}

	if (
		input.plan.arbitration.activeBuilderCount !== input.plan.arbitration.requestedBuilderCount ||
		input.plan.workItems.some((item) => item.dependsOn.length > 0)
	) {
		const teamShapeEvidence = input.plan.teamShape
			? ` Team shape ${input.plan.teamShape.shapeId} uses ${input.plan.teamShape.builderProfiles
					.map((profile) => `${profile.assignedBuilder}:${profile.specializationId}`)
					.join(", ")}.`
			: ""
		concerns.push({
			category: "handoff_risk",
			evidence: `Arbitration strategy ${input.plan.arbitration.strategy} activated ${input.plan.arbitration.activeBuilderCount}/${input.plan.arbitration.requestedBuilderCount} builders with dependency mode ${input.plan.arbitration.dependencyMode}.${teamShapeEvidence}`,
			recommendedAction: "Keep worker count, ownership, and dependency reasons explicit in the assignment and progress artifacts before claiming bounded coordination is safe.",
		})
	}

	if (input.plan.teamShape && input.plan.teamShape.builderProfiles.length > 1) {
		concerns.push({
			category: "specialist_check",
			evidence: `Team shape ${input.plan.teamShape.shapeId}: ${input.plan.teamShape.summary}`,
			recommendedAction: input.plan.teamShape.criticFocus,
		})
	}

	if (input.acceptanceGate && !input.acceptanceGate.passed) {
		concerns.push({
			category: "scope_gap",
			evidence: summarizeAcceptanceFailure(input.acceptanceGate),
			recommendedAction: "Retry only with an exact bounded snapshot or refuse if scope cannot stay explicit.",
		})
	}

	if (
		input.verificationProfile &&
		input.verificationProfile.status !== "passed" &&
		input.verificationProfile.status !== "not_applicable"
	) {
		concerns.push({
			category: "verification",
			evidence: summarizeVerification(input.verificationProfile),
			recommendedAction: "Preserve the failing verification evidence and route the next attempt through the retry planner.",
		})
	}

	const reviewBlocked =
		input.finalStatus !== "done" &&
		(input.reviewerVerdict === "NEEDS_WORK" ||
			input.stopReason === "review_blocked" ||
			input.stopReason === "reviewer_invalid" ||
			input.stopReason === "reviewer_unavailable")
	if (reviewBlocked) {
		concerns.push({
			category: "review_blocked",
			evidence: `Run ended as ${input.finalStatus} with stop reason ${input.stopReason}.`,
			recommendedAction: "Do not claim success; keep reviewer output separate and let retry planning decide whether another bounded attempt is safe.",
		})
	}

	if (input.mergeOrder?.status === "blocked") {
		concerns.push({
			category: "merge_risk",
			evidence: input.mergeOrder.blockers.join(" "),
			recommendedAction: "Refuse merge application until dependency order is explicit.",
		})
	}

	if (input.plan.refactorIntent) {
		const refactorIntent = input.plan.refactorIntent
		const refactorEvidence = [
			`rename ${refactorIntent.sourceSymbol} -> ${refactorIntent.targetSymbol}`,
			refactorIntent.anchorFile ? `anchor=${refactorIntent.anchorFile}` : null,
			refactorIntent.relatedFiles.length > 0 ? `related=${refactorIntent.relatedFiles.join(", ")}` : null,
			refactorIntent.anchorSymbolPresent === false ? "anchor symbol not confirmed" : null,
		]
			.filter((value): value is string => Boolean(value))
			.join("; ")
		concerns.push({
			category: "refactor_risk",
			evidence: refactorEvidence,
			recommendedAction:
				refactorIntent.anchorSymbolPresent === false
					? "Pause before widening the rename lane; verify the anchor symbol and keep review bias high."
					: "Keep rename evidence explicit across the anchor file and bounded related call sites before accepting the run.",
		})
	}

	for (const evaluator of targetedEvaluators.evaluators) {
		if (evaluator.status !== "concern") continue
		for (const finding of evaluator.findings) {
			concerns.push({
				category: "specialist_check",
				evidence: `${evaluator.label}: ${finding.evidence}`,
				recommendedAction: finding.recommendedAction,
			})
		}
	}

	if (input.finalStatus !== "done" && !reviewBlocked) {
		concerns.push({
			category: "plan_risk",
			evidence: `Complex run stopped as ${input.finalStatus} with stop reason ${input.stopReason}.`,
			recommendedAction: "Preserve the failed artifact trail and let retry planning or a FixRedLane session decide the next bounded step.",
		})
	}

	const changedFiles = uniqueStrings(input.changedFiles ?? [])
	const coveredFiles = uniqueStrings(input.plan.scoutCoverage.coveredFiles)
	if (coveredFiles.length > 0 && changedFiles.length > coveredFiles.length) {
		concerns.push({
			category: "scope_gap",
			evidence: `Changed file count ${changedFiles.length} exceeded covered file count ${coveredFiles.length}.`,
			recommendedAction: "Use retry snapshots to preserve the bounded file set before another attempt.",
		})
	}

	if (concerns.length === 0) {
		return {
			schemaVersion: 1,
			enabled: true,
			manualVersion: criticManual.version,
			triggerReasons,
			status: "approved",
			concerns: [],
			summary: "Critic lane approved the bounded run with no structured concerns.",
		}
	}

	return {
		schemaVersion: 1,
		enabled: true,
		manualVersion: criticManual.version,
		triggerReasons,
		status: "concern",
		concerns,
		summary: `Critic lane recorded ${concerns.length} concern(s) for this bounded run.`,
	}
}

export function formatCriticArtifact(critic: CriticArtifact): string {
	return [
		`Enabled: ${critic.enabled ? "yes" : "no"}`,
		`Manual version: ${critic.manualVersion}`,
		`Status: ${critic.status}`,
		`Trigger reasons: ${critic.triggerReasons.join(", ") || "(none)"}`,
		`Summary: ${critic.summary}`,
		...(critic.concerns.length > 0
			? ["Concerns:", ...critic.concerns.map((concern) => `- ${concern.category}: ${concern.evidence}`)]
			: ["Concerns:", "- (none)"]),
	].join("\n")
}
