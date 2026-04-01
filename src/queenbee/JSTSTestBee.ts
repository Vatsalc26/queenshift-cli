import type { QueenBeeEnvelope } from "./QueenBeeProtocol"
import type { QueenBeeWorkResultPayload } from "./JSTSCoderBee"
import { JSTSCoreBee, parseAssignmentPacketPayload, refusal } from "./JSTSCoreBee"

const TEST_TASK_FAMILY = "update_file_and_test"

function retagTestSummary(summary: string): string {
	let tagged = summary.replace(/JSTSCoreBee/g, "JSTSTestBee")
	tagged = tagged.replace("bounded source-and-test proposal set", "bounded test-aligned source-and-test proposal set")
	if (tagged.includes("source-and-test proposal snippet")) {
		return tagged.replace("source-and-test proposal snippet", "test-aligned source-and-test proposal snippet")
	}
	return tagged
}

export class JSTSTestBee extends JSTSCoreBee {
	override codeAssignment(envelope: QueenBeeEnvelope): QueenBeeWorkResultPayload {
		const payload = parseAssignmentPacketPayload(envelope.payload)
		if (!payload) {
			return refusal("invalid_assignment_packet_payload", "JSTSTestBee refused the assignment because the packet payload was incomplete.")
		}
		if (payload.taskFamily !== TEST_TASK_FAMILY) {
			return refusal(
				"unsupported_task_family",
				`JSTSTestBee only accepts ${TEST_TASK_FAMILY} inside the current bounded test-specialist family.`,
			)
		}
		const result = super.codeAssignment(envelope)
		return {
			...result,
			proposals: result.proposals.map((proposal) => ({
				...proposal,
				changeSummary: retagTestSummary(proposal.changeSummary),
			})),
			coderSummary: retagTestSummary(result.coderSummary),
		}
	}
}
