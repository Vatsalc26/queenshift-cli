import fs from "node:fs"
import path from "node:path"

import type { QueenBeeFileProposal } from "./JSTSCoderBee"
import { buildQueenBeeEnvelope, type QueenBeeBeeId, type QueenBeeEnvelope } from "./QueenBeeProtocol"

export type QueenBeeMergeRequestPayload = {
	changedFiles: string[]
	proposals: QueenBeeFileProposal[]
	proofCommands: string[]
	verifierSummary: string
}

export type QueenBeeMergeResultPayload = {
	accepted: boolean
	reason: string | null
	changedFiles: string[]
	proofCommands: string[]
	verifierSummary: string
	mergeSummary: string
}

type MergeVerdict = {
	messageType: "merge_pass" | "merge_blocked"
	payload: QueenBeeMergeResultPayload
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter((value) => value.length > 0)))
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === "string")) : []
}

function parseFileProposal(value: unknown): QueenBeeFileProposal | null {
	const record = asRecord(value)
	if (!record) return null
	const pathValue = typeof record["path"] === "string" ? normalizeRelPath(record["path"]) : ""
	const beforeContent = typeof record["beforeContent"] === "string" ? record["beforeContent"] : ""
	const afterContent = typeof record["afterContent"] === "string" ? record["afterContent"] : ""
	const changeSummary = typeof record["changeSummary"] === "string" ? record["changeSummary"].trim() : ""
	if (!pathValue || !changeSummary || beforeContent === afterContent) return null
	return {
		path: pathValue,
		beforeContent,
		afterContent,
		changeSummary,
	}
}

function isCreateProposal(proposal: QueenBeeFileProposal): boolean {
	return proposal.beforeContent === "" && proposal.changeSummary.includes("new-file proposal")
}

function parseMergeRequestPayload(payload: unknown): QueenBeeMergeRequestPayload | null {
	const record = asRecord(payload)
	if (!record) return null
	const changedFiles = readStringArray(record["changedFiles"])
	const proofCommands = readStringArray(record["proofCommands"])
	const verifierSummary = typeof record["verifierSummary"] === "string" ? record["verifierSummary"].trim() : ""
	const proposals = Array.isArray(record["proposals"])
		? record["proposals"]
				.map((proposal) => parseFileProposal(proposal))
				.filter((proposal): proposal is QueenBeeFileProposal => Boolean(proposal))
		: []
	if (!verifierSummary || proofCommands.length === 0) return null
	return {
		changedFiles,
		proposals,
		proofCommands,
		verifierSummary,
	}
}

function buildBlockedPayload(
	reason: string,
	changedFiles: string[],
	proofCommands: string[],
	verifierSummary: string,
	mergeSummary: string,
): MergeVerdict {
	return {
		messageType: "merge_blocked",
		payload: {
			accepted: false,
			reason,
			changedFiles,
			proofCommands,
			verifierSummary,
			mergeSummary,
		},
	}
}

export class MergeBee {
	private readonly workspaceRoot: string
	private readonly mergeBeeId: QueenBeeBeeId

	constructor(workspaceRoot: string, mergeBeeId: QueenBeeBeeId = "queenbee.merge.001") {
		this.workspaceRoot = workspaceRoot
		this.mergeBeeId = mergeBeeId
	}

	mergeEnvelope(envelope: QueenBeeEnvelope): MergeVerdict {
		const payload = parseMergeRequestPayload(envelope.payload)
		if (!payload) {
			return buildBlockedPayload(
				"invalid_merge_request_payload",
				[],
				[],
				"",
				"MergeBee refused the request because the merge payload was incomplete.",
			)
		}
		if (
			payload.changedFiles.length < 1 ||
			payload.changedFiles.length > 3 ||
			payload.proposals.length !== payload.changedFiles.length
		) {
			return buildBlockedPayload(
				"merge_target_count_out_of_bounds",
				payload.changedFiles,
				payload.proofCommands,
				payload.verifierSummary,
				"MergeBee stays bounded to one, two, or three explicit JS/TS proposals in the current completion slice.",
			)
		}
		const proposalMap = new Map(payload.proposals.map((proposal) => [proposal.path, proposal] as const))
		if (proposalMap.size !== payload.proposals.length) {
			return buildBlockedPayload(
				"merge_scope_mismatch",
				payload.changedFiles,
				payload.proofCommands,
				payload.verifierSummary,
				"MergeBee found duplicate proposal paths inside the approved merge request.",
			)
		}

		const pendingWrites: Array<{ targetPath: string; afterContent: string }> = []
		const createdFiles: string[] = []
		for (const targetFile of payload.changedFiles) {
			const proposal = proposalMap.get(targetFile)
			if (!proposal) {
				return buildBlockedPayload(
					"merge_scope_mismatch",
					payload.changedFiles,
					payload.proofCommands,
					payload.verifierSummary,
					"MergeBee found a mismatch between the approved file list and the proposed merge targets.",
				)
			}

			const targetPath = path.join(this.workspaceRoot, targetFile)
			if (isCreateProposal(proposal)) {
				const parentPath = path.dirname(targetPath)
				if (!fs.existsSync(parentPath) || !fs.statSync(parentPath).isDirectory()) {
					return buildBlockedPayload(
						"workspace_drift_detected",
						payload.changedFiles,
						payload.proofCommands,
						payload.verifierSummary,
						`MergeBee blocked the create-safe merge because the parent directory for ${targetFile} drifted after review.`,
					)
				}
				if (fs.existsSync(targetPath)) {
					return buildBlockedPayload(
						"workspace_drift_detected",
						payload.changedFiles,
						payload.proofCommands,
						payload.verifierSummary,
						`MergeBee blocked the create-safe merge because ${targetFile} appeared after review.`,
					)
				}
				pendingWrites.push({ targetPath, afterContent: proposal.afterContent })
				createdFiles.push(targetFile)
				continue
			}

			if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
				return buildBlockedPayload(
					"merge_target_missing",
					payload.changedFiles,
					payload.proofCommands,
					payload.verifierSummary,
					`MergeBee could not find ${targetFile} inside the bounded workspace.`,
				)
			}

			const diskBefore = fs.readFileSync(targetPath, "utf8")
			if (diskBefore !== proposal.beforeContent) {
				return buildBlockedPayload(
					"workspace_drift_detected",
					payload.changedFiles,
					payload.proofCommands,
					payload.verifierSummary,
					`MergeBee blocked the merge because ${targetFile} drifted after review.`,
				)
			}

			pendingWrites.push({ targetPath, afterContent: proposal.afterContent })
		}

		for (const pendingWrite of pendingWrites) {
			fs.writeFileSync(pendingWrite.targetPath, pendingWrite.afterContent, "utf8")
		}
		const updatedFiles = payload.changedFiles.filter((targetFile) => !createdFiles.includes(targetFile))
		const mergeSummary =
			createdFiles.length === 1 && updatedFiles.length === 0
				? `MergeBee created the approved bounded file ${createdFiles[0]}.`
				: createdFiles.length > 0 && updatedFiles.length === 0
					? `MergeBee created the approved bounded files ${createdFiles.join(", ")}.`
					: createdFiles.length > 0
						? `MergeBee applied the approved bounded proposal set, creating ${createdFiles.join(", ")} and updating ${updatedFiles.join(", ")}.`
						: payload.changedFiles.length === 1
							? `MergeBee applied the approved one-file proposal to ${payload.changedFiles[0]}.`
							: `MergeBee applied the approved bounded proposal set to ${payload.changedFiles.join(", ")}.`
		return {
			messageType: "merge_pass",
			payload: {
				accepted: true,
				reason: null,
				changedFiles: payload.changedFiles,
				proofCommands: payload.proofCommands,
				verifierSummary: payload.verifierSummary,
				mergeSummary,
			},
		}
	}

	handleEnvelope(envelope: QueenBeeEnvelope): QueenBeeEnvelope | null {
		if (envelope.messageType !== "merge_request") return null
		const verdict = this.mergeEnvelope(envelope)
		return buildQueenBeeEnvelope({
			messageId: `${envelope.messageId}:${verdict.messageType}`,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			senderBeeId: this.mergeBeeId,
			recipientBeeId: envelope.senderBeeId,
			messageType: verdict.messageType,
			timestamp: envelope.timestamp,
			scopeToken: envelope.scopeToken,
			toolGrantToken: envelope.toolGrantToken,
			parentMessageId: envelope.messageId,
			payload: verdict.payload as unknown as Record<string, unknown>,
		})
	}
}
