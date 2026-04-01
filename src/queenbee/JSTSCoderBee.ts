import fs from "node:fs"
import path from "node:path"

import { buildQueenBeeEnvelope, type QueenBeeBeeId, type QueenBeeEnvelope } from "./QueenBeeProtocol"
import { JSTSAsyncBee } from "./JSTSAsyncBee"
import { JSTSCoreBee, type QueenBeeLiveWorkResult } from "./JSTSCoreBee"
import { JSTSNodeBee } from "./JSTSNodeBee"
import { JSTSRefactorBee } from "./JSTSRefactorBee"
import { JSTSTestBee } from "./JSTSTestBee"

export type QueenBeeFileProposal = {
	path: string
	beforeContent: string
	afterContent: string
	changeSummary: string
}

export type QueenBeeWorkResultPayload = {
	accepted: boolean
	reason: string | null
	changedFiles: string[]
	proposalCount: number
	proposals: QueenBeeFileProposal[]
	coderSummary: string
}

export type QueenBeeCoderSpecialistName =
	| "JSTSCoreBee"
	| "JSTSAsyncBee"
	| "JSTSNodeBee"
	| "JSTSTestBee"
	| "JSTSRefactorBee"

type QueenBeeAssignmentSelectionPayload = {
	task: string
	taskFamily: string
	languagePack: string
	allowedFiles: string[]
}

const ASYNC_SIGNAL_PATTERN = /\b(async|await|promise|retry|timeout|interval|timer|backoff|poll|queue|abort)\b/iu
const NODE_SIGNAL_PATTERN =
	/(package\.json|process\.env|process\.argv|child_process|#!\/usr\/bin\/env node|npm run|\bcli\b|\bargv\b|\bstdin\b|\bstdout\b|\bstderr\b|commander|yargs|fs\/promises)/iu

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.replace(/[\\/]+/g, "/").trim()).filter((value) => value.length > 0)))
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === "string")) : []
}

function parseAssignmentSelectionPayload(payload: unknown): QueenBeeAssignmentSelectionPayload | null {
	const record = asRecord(payload)
	if (!record) return null
	const task = typeof record["task"] === "string" ? record["task"].trim() : ""
	const taskFamily = typeof record["taskFamily"] === "string" ? record["taskFamily"].trim() : ""
	const languagePack = typeof record["languagePack"] === "string" ? record["languagePack"].trim() : ""
	const allowedFiles = readStringArray(record["allowedFiles"])
	if (!task || !taskFamily || !languagePack || allowedFiles.length === 0) return null
	return {
		task,
		taskFamily,
		languagePack,
		allowedFiles,
	}
}

function readScopedEvidence(workspaceRoot: string, allowedFiles: string[]): string {
	return allowedFiles
		.map((relativePath) => path.join(workspaceRoot, relativePath))
		.filter((absolutePath) => fs.existsSync(absolutePath))
		.map((absolutePath) => fs.readFileSync(absolutePath, "utf8"))
		.join("\n")
}

function refusal(reason: string, summary: string): QueenBeeWorkResultPayload {
	return {
		accepted: false,
		reason,
		changedFiles: [],
		proposalCount: 0,
		proposals: [],
		coderSummary: summary,
	}
}

export class JSTSCoderBee {
	private readonly workspaceRoot: string
	private readonly coderBeeId: QueenBeeBeeId
	private readonly coreCoder: JSTSCoreBee
	private readonly asyncCoder: JSTSAsyncBee
	private readonly nodeCoder: JSTSNodeBee
	private readonly testCoder: JSTSTestBee
	private readonly refactorCoder: JSTSRefactorBee

	constructor(workspaceRoot: string, coderBeeId: QueenBeeBeeId = "queenbee.jsts_coder.001") {
		this.workspaceRoot = workspaceRoot
		this.coderBeeId = coderBeeId
		this.coreCoder = new JSTSCoreBee(workspaceRoot, coderBeeId)
		this.asyncCoder = new JSTSAsyncBee(workspaceRoot, coderBeeId)
		this.nodeCoder = new JSTSNodeBee(workspaceRoot, coderBeeId)
		this.testCoder = new JSTSTestBee(workspaceRoot, coderBeeId)
		this.refactorCoder = new JSTSRefactorBee(workspaceRoot, coderBeeId)
	}

	listAvailableSpecialists(): QueenBeeCoderSpecialistName[] {
		return ["JSTSCoreBee", "JSTSAsyncBee", "JSTSNodeBee", "JSTSTestBee", "JSTSRefactorBee"]
	}

	selectSpecialistForEnvelope(envelope: QueenBeeEnvelope): QueenBeeCoderSpecialistName {
		const payload = parseAssignmentSelectionPayload(envelope.payload)
		if (payload && payload.languagePack === "js_ts") {
			if (payload.taskFamily === "rename_export") {
				return "JSTSCoreBee"
			}
			const selectionEvidence = `${payload.task}\n${payload.allowedFiles.join("\n")}\n${readScopedEvidence(this.workspaceRoot, payload.allowedFiles)}`
			if (payload.taskFamily === "bounded_node_cli_task" || NODE_SIGNAL_PATTERN.test(selectionEvidence)) {
				return "JSTSNodeBee"
			}
			if (ASYNC_SIGNAL_PATTERN.test(selectionEvidence)) {
				return "JSTSAsyncBee"
			}
			if (payload.taskFamily === "update_file_and_test") {
				return "JSTSTestBee"
			}
			if (payload.taskFamily === "bounded_two_file_update") {
				return "JSTSRefactorBee"
			}
		}
		return "JSTSCoreBee"
	}

	codeAssignment(envelope: QueenBeeEnvelope): QueenBeeWorkResultPayload {
		const selectedSpecialist = this.selectSpecialistForEnvelope(envelope)
		if (selectedSpecialist === "JSTSCoreBee") {
			return this.coreCoder.codeAssignment(envelope)
		}
		if (selectedSpecialist === "JSTSAsyncBee") {
			return this.asyncCoder.codeAssignment(envelope)
		}
		if (selectedSpecialist === "JSTSNodeBee") {
			return this.nodeCoder.codeAssignment(envelope)
		}
		if (selectedSpecialist === "JSTSTestBee") {
			return this.testCoder.codeAssignment(envelope)
		}
		if (selectedSpecialist === "JSTSRefactorBee") {
			return this.refactorCoder.codeAssignment(envelope)
		}
		return refusal("no_specialist_selected", "JSTSCoderBee could not select a live specialist for this bounded JS/TS assignment.")
	}

	async codeAssignmentLive(
		envelope: QueenBeeEnvelope,
		env: Record<string, string | undefined>,
	): Promise<QueenBeeLiveWorkResult> {
		const selectedSpecialist = this.selectSpecialistForEnvelope(envelope)
		if (selectedSpecialist === "JSTSCoreBee") {
			return await this.coreCoder.codeAssignmentLive(envelope, env)
		}
		if (selectedSpecialist === "JSTSAsyncBee") {
			return await this.asyncCoder.codeAssignmentLive(envelope, env)
		}
		if (selectedSpecialist === "JSTSNodeBee") {
			return await this.nodeCoder.codeAssignmentLive(envelope, env)
		}
		if (selectedSpecialist === "JSTSTestBee") {
			return await this.testCoder.codeAssignmentLive(envelope, env)
		}
		return {
			providerCallObserved: false,
			workResult: refusal(
				"live_specialist_not_enabled",
				`JSTSCoderBee only enables provider-backed live execution for the currently proven JSTSCoreBee, JSTSAsyncBee, JSTSNodeBee, or JSTSTestBee rows, not ${selectedSpecialist}.`,
			),
		}
	}

	handleEnvelope(envelope: QueenBeeEnvelope): QueenBeeEnvelope | null {
		if (envelope.messageType !== "assignment_packet") return null
		const workResult = this.codeAssignment(envelope)
		return buildQueenBeeEnvelope({
			messageId: `${envelope.messageId}:work_result`,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			senderBeeId: this.coderBeeId,
			recipientBeeId: envelope.senderBeeId,
			messageType: "work_result",
			timestamp: envelope.timestamp,
			scopeToken: envelope.scopeToken,
			toolGrantToken: envelope.toolGrantToken,
			payload: workResult as unknown as Record<string, unknown>,
		})
	}
}
