export type CampaignContinuationState = {
	schemaVersion: 1
	campaignId: string
	originRunId: string
	currentRunId: string
	previousRunId: string | null
	attemptNumber: number
	nextAttemptNumber: number
	sourceRunIds: string[]
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

export function buildContinuationState(
	currentRunId: string,
	previous: CampaignContinuationState | null = null,
): CampaignContinuationState {
	if (!previous) {
		return {
			schemaVersion: 1,
			campaignId: `campaign-${currentRunId}`,
			originRunId: currentRunId,
			currentRunId,
			previousRunId: null,
			attemptNumber: 1,
			nextAttemptNumber: 2,
			sourceRunIds: [currentRunId],
		}
	}

	const attemptNumber = Math.max(1, previous.nextAttemptNumber)
	return {
		schemaVersion: 1,
		campaignId: previous.campaignId,
		originRunId: previous.originRunId,
		currentRunId,
		previousRunId: previous.currentRunId,
		attemptNumber,
		nextAttemptNumber: attemptNumber + 1,
		sourceRunIds: uniqueStrings([...previous.sourceRunIds, currentRunId]),
	}
}

export function formatContinuationState(state: CampaignContinuationState | null): string {
	if (!state) return "Campaign: (none)"
	return `Campaign: ${state.campaignId} attempt=${state.attemptNumber} next=${state.nextAttemptNumber} runs=${state.sourceRunIds.join(", ")}`
}
