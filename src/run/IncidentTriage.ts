import type { IncidentPack } from "./IncidentPack"
import type { ReviewPack } from "./ReviewQueue"
import {
	buildFixRedLaneSuggestion,
	classifyFailureTaxonomy,
	type FailureTaxonomyCode,
	type IncidentTriageCategory,
} from "./FailureTaxonomy"

type SummaryLike = Record<string, unknown>

export type IncidentTriage = {
	category: IncidentTriageCategory
	code: FailureTaxonomyCode
	label: string
	recommendedLabel: string
	rationale: string
	firstInvariantAtRisk: string
	nearbyProofCommands: string[]
	evidence: string[]
	advisoryOnly: true
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export function buildIncidentTriage(input: {
	summary: SummaryLike | null
	incidentPack?: IncidentPack | null
	reviewPack?: ReviewPack | null
}): IncidentTriage | null {
	const summary = input.summary
	const stopReason = asString(summary?.["stopReason"])
	const status = asString(summary?.["status"])
	const failureBucket = input.incidentPack?.failureBucket ?? null

	if (!stopReason && !failureBucket && !input.reviewPack) return null

	const taxonomy = classifyFailureTaxonomy({
		status,
		stopReason,
		failureBucket,
		hasReviewPack: Boolean(input.reviewPack),
	})
	const evidence = [stopReason ? `stopReason=${stopReason}` : null, failureBucket ? `failureBucket=${failureBucket}` : null]
		.filter((value): value is string => Boolean(value))
	const rationale =
		input.reviewPack?.nextAction.rationale ??
		input.incidentPack?.redLaneHint.rationale ??
		input.incidentPack?.nextAction.rationale ??
		taxonomy.defaultRationale
	const recommendedLabel =
		input.reviewPack?.nextAction.label ??
		(taxonomy.category === "unsupported_task_scope"
			? input.incidentPack?.nextAction.label ?? taxonomy.recommendedLabel
			: input.incidentPack?.nextAction.label ?? taxonomy.recommendedLabel)

	return {
		category: taxonomy.category,
		code: taxonomy.code,
		label: taxonomy.label,
		recommendedLabel,
		rationale,
		firstInvariantAtRisk: taxonomy.firstInvariantAtRisk,
		nearbyProofCommands: taxonomy.nearbyProofCommands,
		evidence,
		advisoryOnly: true,
	}
}

export function formatIncidentTriage(triage: IncidentTriage | null): string {
	if (!triage) return "Incident triage: no advisory classification available."
	const fixRedLane = buildFixRedLaneSuggestion({
		runId: null,
		taxonomy: classifyFailureTaxonomy({
			status: null,
			stopReason: triage.evidence.find((entry) => entry.startsWith("stopReason="))?.slice("stopReason=".length) ?? null,
			failureBucket: triage.evidence.find((entry) => entry.startsWith("failureBucket="))?.slice("failureBucket=".length) ?? null,
		}),
		rationale: triage.rationale,
		nextActionLabel: triage.recommendedLabel,
	})
	return [
		`Incident triage: ${triage.label}`,
		`Detailed code: ${triage.code}`,
		`Suggested next step: ${triage.recommendedLabel}`,
		`Invariant at risk: ${triage.firstInvariantAtRisk}`,
		`Why: ${triage.rationale}`,
		`Nearby proofs: ${triage.nearbyProofCommands.join(" | ")}`,
		`Suggested FixRedLane file: ${fixRedLane.suggestedFileName}`,
		...(triage.evidence.length > 0 ? [`Evidence: ${triage.evidence.join(" | ")}`] : []),
	].join("\n")
}
