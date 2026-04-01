import type { QueenBeeEnvelope } from "./QueenBeeProtocol"
import type { QueenBeeWorkResultPayload } from "./JSTSCoderBee"
import { JSTSCoreBee, type QueenBeeLiveWorkResult } from "./JSTSCoreBee"

function retagSummary(summary: string): string {
	let tagged = summary.replace(/JSTSCoreBee/g, "JSTSAsyncBee")
	tagged = tagged.replace("bounded source-and-test proposal set", "async-aware bounded source-and-test proposal set")
	tagged = tagged.replace("bounded two-file proposal set", "async-aware bounded two-file proposal set")
	tagged = tagged.replace("one-file proposal", "async-aware one-file proposal")
	if (tagged.includes("source-and-test proposal snippet")) {
		return tagged.replace("source-and-test proposal snippet", "async-aware source-and-test proposal snippet")
	}
	return tagged.replace("proposal snippet", "async-aware proposal snippet")
}

export class JSTSAsyncBee extends JSTSCoreBee {
	override codeAssignment(envelope: QueenBeeEnvelope): QueenBeeWorkResultPayload {
		const result = super.codeAssignment(envelope)
		return {
			...result,
			proposals: result.proposals.map((proposal) => ({
				...proposal,
				changeSummary: retagSummary(proposal.changeSummary),
			})),
			coderSummary: retagSummary(result.coderSummary),
		}
	}

	override async codeAssignmentLive(
		envelope: QueenBeeEnvelope,
		env: Record<string, string | undefined>,
	): Promise<QueenBeeLiveWorkResult> {
		const result = await super.codeAssignmentLive(envelope, env)
		if (!result.workResult.accepted) return result
		return {
			...result,
			workResult: {
				...result.workResult,
				proposals: result.workResult.proposals.map((proposal) => ({
					...proposal,
					changeSummary: retagSummary(proposal.changeSummary),
				})),
				coderSummary: retagSummary(result.workResult.coderSummary),
			},
		}
	}
}
