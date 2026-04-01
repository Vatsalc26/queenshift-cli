import type { ModeSelectorDecision } from "../run/ModeSelector"
import type { VerificationProfileResult } from "../run/VerificationProfile"
import type { CriticArtifact } from "./CriticLane"
import type { SwarmPlanArtifact } from "./PlanSchema"
import type { RetryPlannerArtifact } from "./RetryPlanner"
import type { TargetedEvaluatorsArtifact } from "./TargetedEvaluators"

export type MediumLaneReliabilityStatus = "not_applicable" | "guarded" | "ready" | "at_risk"

export type MediumLaneReliabilityArtifact = {
	schemaVersion: 1
	laneId: "medium_lane_reliability_pack"
	applicable: boolean
	status: MediumLaneReliabilityStatus
	modeId: string | null
	selectorSource: string | null
	targetFileCount: number
	workItemCount: number
	deterministicRouting: boolean
	criticVisible: boolean
	targetedEvaluatorsVisible: boolean
	verificationState: "not_recorded" | "passed" | "not_applicable" | "failed_or_partial"
	checkpointReady: boolean
	retrySnapshotReady: boolean
	summary: string
	evidence: string[]
	nextFocus: string[]
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function resolveVerificationState(
	verificationProfile: VerificationProfileResult | null | undefined,
): MediumLaneReliabilityArtifact["verificationState"] {
	if (!verificationProfile) return "not_recorded"
	if (verificationProfile.status === "passed") return "passed"
	if (verificationProfile.status === "not_applicable") return "not_applicable"
	return "failed_or_partial"
}

export function buildMediumLaneReliabilityArtifact(input: {
	plan: SwarmPlanArtifact | null
	modeSelector: ModeSelectorDecision | null
	criticLane: CriticArtifact | null
	targetedEvaluators: TargetedEvaluatorsArtifact | null
	verificationProfile?: VerificationProfileResult | null
	checkpointArtifactPath?: string | null
	retryPlanner?: RetryPlannerArtifact | null
}): MediumLaneReliabilityArtifact {
	const plan = input.plan
	if (!plan || plan.pathChosen !== "medium") {
		return {
			schemaVersion: 1,
			laneId: "medium_lane_reliability_pack",
			applicable: false,
			status: "not_applicable",
			modeId: input.modeSelector?.modeId ?? null,
			selectorSource: input.modeSelector?.selectorSource ?? null,
			targetFileCount: 0,
			workItemCount: 0,
			deterministicRouting: false,
			criticVisible: false,
			targetedEvaluatorsVisible: false,
			verificationState: "not_recorded",
			checkpointReady: false,
			retrySnapshotReady: false,
			summary: "Medium-lane reliability pack is not applicable outside the explicit medium lane.",
			evidence: [],
			nextFocus: [],
		}
	}

	const verificationState = resolveVerificationState(input.verificationProfile ?? null)
	const deterministicRouting =
		input.modeSelector?.routingPath === "medium" &&
		(input.modeSelector.selectorSource === "explicit_targets" || plan.scoutCoverage.source === "explicit_targets")
	const criticVisible = Boolean(input.criticLane?.enabled)
	const targetedEvaluatorsVisible =
		Boolean(input.targetedEvaluators?.enabled) && (input.targetedEvaluators?.applicableEvaluatorCount ?? 0) > 0
	const checkpointReady = Boolean(input.checkpointArtifactPath)
	const retrySnapshotReady = Boolean(input.retryPlanner?.snapshotPath)
	let status: MediumLaneReliabilityStatus = "guarded"

	if (!deterministicRouting || !criticVisible || !targetedEvaluatorsVisible) {
		status = "at_risk"
	} else if (verificationState === "failed_or_partial") {
		status = "at_risk"
	} else if (
		verificationState === "passed" &&
		checkpointReady &&
		retrySnapshotReady &&
		(input.retryPlanner?.decision === "retryable" || input.retryPlanner?.decision === "not_needed")
	) {
		status = "ready"
	}

	const evidence = uniqueStrings([
		input.modeSelector
			? `Mode selector ${input.modeSelector.modeId} stayed explicit with source ${input.modeSelector.selectorSource}.`
			: "",
		criticVisible ? `Critic lane stayed visible with status ${input.criticLane?.status ?? "unknown"}.` : "",
		targetedEvaluatorsVisible
			? `${input.targetedEvaluators?.applicableEvaluatorCount ?? 0} targeted evaluator(s) stayed attached to the medium lane.`
			: "",
		verificationState === "passed"
			? `Repo-backed verification passed (${input.verificationProfile?.profileName ?? "recorded profile"}).`
			: verificationState === "not_applicable"
				? "Verification was intentionally not applicable for this bounded medium run."
				: verificationState === "not_recorded"
					? "Verification has not been recorded yet."
					: "Verification did not fully pass.",
		checkpointReady ? "Checkpoint artifacts are available for partial-progress recovery." : "",
		retrySnapshotReady ? "Retry snapshot is available for exact bounded reruns." : "",
	])

	const nextFocus =
		status === "ready"
			? []
			: uniqueStrings([
					deterministicRouting ? "" : "Keep medium routing explicit instead of falling back to opaque model-only escalation.",
					criticVisible ? "" : "Keep critic review attached to every medium lane summary.",
					targetedEvaluatorsVisible ? "" : "Keep targeted evaluators visible for medium multi-file work.",
					verificationState === "passed" || verificationState === "not_applicable"
						? ""
						: "Push medium runs through a repo-backed verification profile before treating them as deeply proven.",
					checkpointReady ? "" : "Write checkpoint artifacts so medium retries can restate remaining work exactly.",
					retrySnapshotReady ? "" : "Keep retry snapshots visible so medium reruns stay comparable.",
			  ])

	return {
		schemaVersion: 1,
		laneId: "medium_lane_reliability_pack",
		applicable: true,
		status,
		modeId: input.modeSelector?.modeId ?? null,
		selectorSource: input.modeSelector?.selectorSource ?? null,
		targetFileCount: plan.scoutCoverage.coveredFiles.length,
		workItemCount: plan.workItems.length,
		deterministicRouting,
		criticVisible,
		targetedEvaluatorsVisible,
		verificationState,
		checkpointReady,
		retrySnapshotReady,
		summary:
			status === "ready"
				? "Medium lane kept explicit routing, critic visibility, targeted evaluators, repo-backed verification, and replay-ready recovery evidence."
				: status === "guarded"
					? "Medium lane stayed bounded, but one or more deeper reliability signals are still pending."
					: "Medium lane is at risk because one or more required reliability signals are missing or red.",
		evidence,
		nextFocus,
	}
}

export function formatMediumLaneReliabilityArtifact(artifact: MediumLaneReliabilityArtifact): string {
	return [
		`Applicable: ${artifact.applicable ? "yes" : "no"}`,
		`Status: ${artifact.status}`,
		`Mode selector: ${artifact.modeId ?? "(none)"} source=${artifact.selectorSource ?? "(none)"}`,
		`Coverage: targetFiles=${artifact.targetFileCount} workItems=${artifact.workItemCount}`,
		`Signals: deterministicRouting=${artifact.deterministicRouting ? "yes" : "no"} critic=${artifact.criticVisible ? "yes" : "no"} evaluators=${artifact.targetedEvaluatorsVisible ? "yes" : "no"} verification=${artifact.verificationState} checkpoints=${artifact.checkpointReady ? "yes" : "no"} retrySnapshot=${artifact.retrySnapshotReady ? "yes" : "no"}`,
		`Summary: ${artifact.summary}`,
		...(artifact.evidence.length > 0 ? ["Evidence:", ...artifact.evidence.map((entry) => `- ${entry}`)] : []),
		...(artifact.nextFocus.length > 0 ? ["Next focus:", ...artifact.nextFocus.map((entry) => `- ${entry}`)] : []),
	].join("\n")
}
