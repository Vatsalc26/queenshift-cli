export type FailureNarrative = {
	whatFailed: string
	whyItStopped: string
	safestNextStep: string
	recoveryFooting: string
	authoritativeArtifacts: string[]
}

function normalizeLine(value: string | null | undefined, fallback: string): string {
	const trimmed = typeof value === "string" ? value.trim() : ""
	return trimmed.length > 0 ? trimmed : fallback
}

function uniqueArtifacts(values: Array<string | null | undefined>): string[] {
	const seen = new Set<string>()
	const artifacts: string[] = []
	for (const value of values) {
		const trimmed = typeof value === "string" ? value.trim() : ""
		if (!trimmed || seen.has(trimmed)) continue
		seen.add(trimmed)
		artifacts.push(trimmed)
	}
	return artifacts
}

export function createFailureNarrative(input: {
	whatFailed: string | null | undefined
	whyItStopped: string | null | undefined
	safestNextStep: string | null | undefined
	recoveryFooting: string | null | undefined
	authoritativeArtifacts: Array<string | null | undefined>
}): FailureNarrative {
	return {
		whatFailed: normalizeLine(input.whatFailed, "Failure details were not recorded."),
		whyItStopped: normalizeLine(input.whyItStopped, "The stop reason was not explained."),
		safestNextStep: normalizeLine(input.safestNextStep, "Inspect the latest artifact before retrying."),
		recoveryFooting: normalizeLine(input.recoveryFooting, "No recovery footing was recorded."),
		authoritativeArtifacts: uniqueArtifacts(input.authoritativeArtifacts),
	}
}

export function formatFailureNarrative(narrative: FailureNarrative | null | undefined): string {
	const resolved =
		narrative ??
		createFailureNarrative({
			whatFailed: null,
			whyItStopped: null,
			safestNextStep: null,
			recoveryFooting: null,
			authoritativeArtifacts: [],
		})
	return [
		"Failure narrative:",
		`- What failed: ${resolved.whatFailed}`,
		`- Why it stopped: ${resolved.whyItStopped}`,
		`- Safest next step: ${resolved.safestNextStep}`,
		"- Recovery loop: incident:latest -> owner:quick-actions -> replay:latest",
		`- Recovery footing: ${resolved.recoveryFooting}`,
		`- Keep these artifacts authoritative: ${resolved.authoritativeArtifacts.join(" | ") || "(none recorded)"}`,
	].join("\n")
}
