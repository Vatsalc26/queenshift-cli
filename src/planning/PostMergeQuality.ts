import type { VerificationProfileResult } from "../run/VerificationProfile"
import type { MergeOrderArtifact } from "./MergeOrder"
import type { TargetedEvaluatorsArtifact } from "./TargetedEvaluators"

export type PostMergeQualityStatus = "not_applicable" | "passed" | "blocked"
export type PostMergeApprovalRisk = "none" | "merge_blocked" | "run_not_clean" | "verification_failed" | "targeted_concerns"

export type PostMergeQualityArtifact = {
	schemaVersion: 1
	status: PostMergeQualityStatus
	gate: "post_merge_semantic_verification"
	approvalRisk: PostMergeApprovalRisk
	verificationSource: "repo_profile" | "none"
	targetedEvaluatorStatus: "not_applicable" | "passed" | "concern"
	targetedConcernCount: number
	targetedEvaluatorIds: string[]
	targetedSummary: string
	changedFileCount: number
	omissionCount: number
	followUpChecks: string[]
	blockers: string[]
	summary: string
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
	return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)))
}

function buildFollowUpChecks(input: {
	mergeOrder: MergeOrderArtifact | null
	targetedEvaluatorIds: string[]
	targetedConcernCount: number
	verificationMessage: string | null
	finalStatus: "done" | "review_required" | "failed"
	omittedFiles: string[]
}): string[] {
	const checks: string[] = []
	if (input.mergeOrder?.negotiation.reviewChecklist.length) {
		checks.push(...input.mergeOrder.negotiation.reviewChecklist)
	}
	if (input.targetedConcernCount > 0) {
		checks.push(
			`Inspect targeted evaluator concern(s): ${input.targetedEvaluatorIds.join(", ") || `${input.targetedConcernCount} concern(s)`}.`,
		)
	}
	if (input.verificationMessage) {
		checks.push(`Recheck repository verification: ${input.verificationMessage}`)
	}
	if (input.finalStatus !== "done") {
		checks.push("Do not treat this coordinated change as clean until review and approval finish.")
	}
	if (input.omittedFiles.length > 0) {
		checks.push(`Confirm the omitted files really stay out of scope: ${input.omittedFiles.join(", ")}.`)
	}
	return uniqueStrings(checks)
}

export function buildPostMergeQualityArtifact(input: {
	mergeOrder: MergeOrderArtifact | null
	finalStatus: "done" | "review_required" | "failed"
	verificationProfile?: VerificationProfileResult | null
	changedFiles?: string[]
	omittedFiles?: string[]
	targetedEvaluators?: TargetedEvaluatorsArtifact | null
}): PostMergeQualityArtifact {
	const targetedEvaluators = input.targetedEvaluators
	const targetedEvaluatorStatus = targetedEvaluators?.status ?? "not_applicable"
	const targetedConcernCount = targetedEvaluators?.concernCount ?? 0
	const targetedEvaluatorIds = targetedEvaluators?.evaluators.filter((evaluator) => evaluator.applicable).map((evaluator) => evaluator.evaluatorId) ?? []
	const targetedSummary = targetedEvaluators?.summary ?? "No targeted evaluators were recorded."
	const omittedFiles = input.omittedFiles ?? []
	const followUpChecks = buildFollowUpChecks({
		mergeOrder: input.mergeOrder,
		targetedEvaluatorIds,
		targetedConcernCount,
		verificationMessage: input.verificationProfile?.message ?? null,
		finalStatus: input.finalStatus,
		omittedFiles,
	})

	if (!input.mergeOrder || input.mergeOrder.status === "not_applicable") {
		return {
			schemaVersion: 1,
			status: "not_applicable",
			gate: "post_merge_semantic_verification",
			approvalRisk: "none",
			verificationSource: "none",
			targetedEvaluatorStatus,
			targetedConcernCount,
			targetedEvaluatorIds,
			targetedSummary,
			changedFileCount: input.changedFiles?.length ?? 0,
			omissionCount: omittedFiles.length,
			followUpChecks: [],
			blockers: [],
			summary: "Post-merge semantic quality gate is not applicable for this run.",
		}
	}

	if (input.mergeOrder.status === "blocked") {
		return {
			schemaVersion: 1,
			status: "blocked",
			gate: "post_merge_semantic_verification",
			approvalRisk: "merge_blocked",
			verificationSource: "none",
			targetedEvaluatorStatus,
			targetedConcernCount,
			targetedEvaluatorIds,
			targetedSummary,
			changedFileCount: input.changedFiles?.length ?? 0,
			omissionCount: omittedFiles.length,
			followUpChecks,
			blockers: [...input.mergeOrder.blockers],
			summary: "Post-merge semantic quality gate blocked because merge sequencing never became safe.",
		}
	}

	if (input.finalStatus !== "done") {
		return {
			schemaVersion: 1,
			status: "blocked",
			gate: "post_merge_semantic_verification",
			approvalRisk: "run_not_clean",
			verificationSource: "none",
			targetedEvaluatorStatus,
			targetedConcernCount,
			targetedEvaluatorIds,
			targetedSummary,
			changedFileCount: input.changedFiles?.length ?? 0,
			omissionCount: omittedFiles.length,
			followUpChecks,
			blockers: ["Run ended before the post-merge semantic verification gate completed."],
			summary: "Post-merge semantic quality gate stayed blocked because the run did not finish cleanly.",
		}
	}

	const verificationProfile = input.verificationProfile
	if (
		verificationProfile &&
		verificationProfile.status !== "passed" &&
		verificationProfile.status !== "not_applicable"
	) {
		return {
			schemaVersion: 1,
			status: "blocked",
			gate: "post_merge_semantic_verification",
			approvalRisk: "verification_failed",
			verificationSource: "repo_profile",
			targetedEvaluatorStatus,
			targetedConcernCount,
			targetedEvaluatorIds,
			targetedSummary,
			changedFileCount: input.changedFiles?.length ?? 0,
			omissionCount: omittedFiles.length,
			followUpChecks,
			blockers: [verificationProfile.message || `Verification status: ${verificationProfile.status}`],
			summary: "Post-merge semantic quality gate blocked on repository verification.",
		}
	}

	return {
		schemaVersion: 1,
		status: "passed",
		gate: "post_merge_semantic_verification",
		approvalRisk: targetedConcernCount > 0 ? "targeted_concerns" : "none",
		verificationSource: verificationProfile ? "repo_profile" : "none",
		targetedEvaluatorStatus,
		targetedConcernCount,
		targetedEvaluatorIds,
		targetedSummary,
		changedFileCount: input.changedFiles?.length ?? 0,
		omissionCount: omittedFiles.length,
		followUpChecks,
		blockers: [],
		summary: verificationProfile
			? "Post-merge semantic quality gate passed with recorded repository verification."
			: "Post-merge semantic quality gate passed with no additional repository verification required.",
	}
}

export function formatPostMergeQualityArtifact(artifact: PostMergeQualityArtifact): string {
	return [
		`Status: ${artifact.status}`,
		`Approval risk: ${artifact.approvalRisk}`,
		`Verification source: ${artifact.verificationSource}`,
		`Targeted evaluators: ${artifact.targetedEvaluatorStatus} (${artifact.targetedConcernCount})`,
		`Targeted evaluator ids: ${artifact.targetedEvaluatorIds.join(", ") || "(none)"}`,
		`Changed files: ${artifact.changedFileCount}`,
		`Omissions: ${artifact.omissionCount}`,
		`Targeted summary: ${artifact.targetedSummary}`,
		...(artifact.followUpChecks.length > 0 ? ["Follow-up checks:", ...artifact.followUpChecks.map((check) => `- ${check}`)] : []),
		`Summary: ${artifact.summary}`,
		...(artifact.blockers.length > 0 ? ["Blockers:", ...artifact.blockers.map((blocker) => `- ${blocker}`)] : []),
	].join("\n")
}
