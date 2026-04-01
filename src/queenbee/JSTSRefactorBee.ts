import type { QueenBeeEnvelope } from "./QueenBeeProtocol"
import type { QueenBeeWorkResultPayload } from "./JSTSCoderBee"
import { JSTSCoreBee, parseAssignmentPacketPayload, refusal } from "./JSTSCoreBee"

const REFACTOR_TASK_FAMILY = "bounded_two_file_update"

function retagRefactorSummary(summary: string): string {
	let tagged = summary.replace(/JSTSCoreBee/g, "JSTSRefactorBee")
	tagged = tagged.replace("bounded two-file proposal set", "bounded refactor coordination proposal set")
	return tagged.replace("proposal snippet", "refactor proposal snippet")
}

export class JSTSRefactorBee extends JSTSCoreBee {
	override codeAssignment(envelope: QueenBeeEnvelope): QueenBeeWorkResultPayload {
		const payload = parseAssignmentPacketPayload(envelope.payload)
		if (!payload) {
			return refusal("invalid_assignment_packet_payload", "JSTSRefactorBee refused the assignment because the packet payload was incomplete.")
		}
		if (payload.taskFamily !== REFACTOR_TASK_FAMILY) {
			return refusal(
				"unsupported_task_family",
				`JSTSRefactorBee only accepts ${REFACTOR_TASK_FAMILY} inside the current bounded refactor-specialist family.`,
			)
		}
		const result = super.codeAssignment(envelope)
		return {
			...result,
			proposals: result.proposals.map((proposal) => ({
				...proposal,
				changeSummary: retagRefactorSummary(proposal.changeSummary),
			})),
			coderSummary: retagRefactorSummary(result.coderSummary),
		}
	}
}
