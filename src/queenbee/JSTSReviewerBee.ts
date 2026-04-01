import path from "node:path"

import type { QueenBeeFileProposal } from "./JSTSCoderBee"
import { buildQueenBeeEnvelope, type QueenBeeBeeId, type QueenBeeEnvelope } from "./QueenBeeProtocol"

const SUPPORTED_JS_TS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"])

export type QueenBeeReviewRequestPayload = {
	languagePack: string
	changedFiles: string[]
	proposalCount: number
	proposals: QueenBeeFileProposal[]
	coderSummary: string
}

export type QueenBeeReviewVerdictPayload = {
	accepted: boolean
	reason: string | null
	changedFiles: string[]
	reworkCount: number
	reworkRequests: QueenBeeEnvelope[]
	reviewSummary: string
}

type ReviewerVerdict = {
	messageType: "review_pass" | "review_rework" | "review_fail"
	payload: QueenBeeReviewVerdictPayload
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

function isLikelyTestFile(filePath: string): boolean {
	const normalized = normalizeRelPath(filePath).toLowerCase()
	return /(^|\/)__tests__(\/|$)|(?:\.|_)test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/u.test(normalized)
}

function describeReviewSurface(payload: QueenBeeReviewRequestPayload): string {
	const normalizedSummary = payload.coderSummary.toLowerCase()
	const normalizedFiles = payload.changedFiles.map((file) => normalizeRelPath(file))
	if (normalizedSummary.includes("rename_export")) return "current daily JS/TS matrix rename review surface"
	if (normalizedFiles.some((file) => file === "package.json" || file.endsWith("/package.json"))) {
		return "current daily JS/TS matrix Node/CLI review surface"
	}
	if (normalizedFiles.length === 2 && normalizedFiles.some((file) => isLikelyTestFile(file))) {
		return "current daily JS/TS matrix source-and-test review surface"
	}
	if (normalizedFiles.length === 1) return "current daily JS/TS matrix single-file review surface"
	return `current daily JS/TS matrix ${normalizedFiles.length}-file review surface`
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

function parseReviewRequestPayload(payload: unknown): QueenBeeReviewRequestPayload | null {
	const record = asRecord(payload)
	if (!record) return null
	const languagePack = typeof record["languagePack"] === "string" ? record["languagePack"].trim() : ""
	const changedFiles = readStringArray(record["changedFiles"])
	const proposalCount = typeof record["proposalCount"] === "number" && Number.isInteger(record["proposalCount"]) ? record["proposalCount"] : -1
	const proposals = Array.isArray(record["proposals"])
		? record["proposals"]
				.map((proposal) => parseFileProposal(proposal))
				.filter((proposal): proposal is QueenBeeFileProposal => Boolean(proposal))
		: []
	const coderSummary = typeof record["coderSummary"] === "string" ? record["coderSummary"].trim() : ""
	if (!languagePack || !coderSummary || proposalCount !== proposals.length) return null
	return {
		languagePack,
		changedFiles,
		proposalCount,
		proposals,
		coderSummary,
	}
}

function buildVerdict(
	messageType: "review_pass" | "review_rework" | "review_fail",
	payload: QueenBeeReviewVerdictPayload,
): ReviewerVerdict {
	return {
		messageType,
		payload,
	}
}

function buildReworkPayload(reason: string, changedFiles: string[], reviewSummary: string, reworkRequests: QueenBeeEnvelope[]): ReviewerVerdict {
	return buildVerdict("review_rework", {
		accepted: false,
		reason,
		changedFiles,
		reworkCount: reworkRequests.length,
		reworkRequests,
		reviewSummary,
	})
}

function buildFailPayload(reason: string, changedFiles: string[], reviewSummary: string): ReviewerVerdict {
	return buildVerdict("review_fail", {
		accepted: false,
		reason,
		changedFiles,
		reworkCount: 0,
		reworkRequests: [],
		reviewSummary,
	})
}

function reviewMarkerRequired(payload: QueenBeeReviewRequestPayload, targetFile: string): boolean {
	const normalizedTarget = normalizeRelPath(targetFile).toLowerCase()
	if (payload.coderSummary.includes("rename_export")) return false
	if (normalizedTarget === "package.json" || normalizedTarget.endsWith("/package.json")) return false
	return true
}

function isSupportedReviewTarget(targetFile: string): boolean {
	const normalizedTarget = normalizeRelPath(targetFile).toLowerCase()
	if (normalizedTarget === "package.json" || normalizedTarget.endsWith("/package.json")) return true
	return SUPPORTED_JS_TS_EXTENSIONS.has(path.extname(targetFile).toLowerCase())
}

export class JSTSReviewerBee {
	private readonly reviewerBeeId: QueenBeeBeeId
	private readonly coderBeeId: QueenBeeBeeId

	constructor(
		reviewerBeeId: QueenBeeBeeId = "queenbee.jsts_reviewer.001",
		coderBeeId: QueenBeeBeeId = "queenbee.jsts_coder.001",
	) {
		this.reviewerBeeId = reviewerBeeId
		this.coderBeeId = coderBeeId
	}

	reviewEnvelope(envelope: QueenBeeEnvelope): ReviewerVerdict {
		const payload = parseReviewRequestPayload(envelope.payload)
		if (!payload) {
			return buildFailPayload(
				"invalid_review_request_payload",
				[],
				"JSTSReviewerBee refused the review because the request payload was incomplete.",
			)
		}
		if (payload.languagePack !== "js_ts") {
			return buildFailPayload(
				"unsupported_language_pack",
				payload.changedFiles,
				"JSTSReviewerBee stays inside the JS/TS-first candidate boundary.",
			)
		}
		if (payload.changedFiles.length < 1 || payload.changedFiles.length > 3 || payload.proposals.length !== payload.changedFiles.length) {
			return buildFailPayload(
				"review_target_count_out_of_bounds",
				payload.changedFiles,
				"JSTSReviewerBee stays bounded to one, two, or three explicit JS/TS proposals in the current review slice.",
			)
		}
		const reviewSurface = describeReviewSurface(payload)
		const reworkRequests: QueenBeeEnvelope[] = []
		const reworkTargets: string[] = []
		for (let index = 0; index < payload.changedFiles.length; index += 1) {
			const targetFile = payload.changedFiles[index]
			const proposal = payload.proposals[index]
			if (!proposal || !targetFile) {
				return buildFailPayload(
					"review_scope_mismatch",
					payload.changedFiles,
					"JSTSReviewerBee could not reconcile the changed file list with the proposed JS/TS edit.",
				)
			}
			if (proposal.path !== targetFile) {
				return buildFailPayload(
					"review_scope_mismatch",
					payload.changedFiles,
					"JSTSReviewerBee found a mismatch between the changed file list and the proposal path.",
				)
			}

			if (!isSupportedReviewTarget(targetFile)) {
				return buildFailPayload(
					"unsupported_file_extension",
					payload.changedFiles,
					`JSTSReviewerBee only accepts package.json or JS/TS review targets, not ${targetFile}.`,
				)
			}
			if (proposal.beforeContent === proposal.afterContent) {
				return buildFailPayload(
					"proposal_missing_change",
					payload.changedFiles,
					`JSTSReviewerBee found no actual content delta for ${targetFile}.`,
				)
			}
			if (reviewMarkerRequired(payload, targetFile) && !proposal.afterContent.includes("// queenbee:")) {
				reworkTargets.push(targetFile)
				reworkRequests.push(
					buildQueenBeeEnvelope({
						messageId: `${envelope.messageId}:rework_request:${index + 1}`,
						missionId: envelope.missionId,
						assignmentId: envelope.assignmentId,
						senderBeeId: this.reviewerBeeId,
						recipientBeeId: this.coderBeeId,
						messageType: "rework_request",
						timestamp: envelope.timestamp,
						scopeToken: envelope.scopeToken,
						toolGrantToken: envelope.toolGrantToken,
						payload: {
							languagePack: "js_ts",
							allowedFiles: [targetFile],
							requestedChanges: [`Add one explicit // queenbee: review marker to ${targetFile} so the ${reviewSurface} stays inspectable.`],
							reviewerSummary: "",
						},
					}),
				)
			}
		}
		if (reworkRequests.length > 0) {
			const reviewerSummary =
				reworkTargets.length === 1
					? `JSTSReviewerBee requested one bounded rework on ${reworkTargets[0]} so the ${reviewSurface} stays inspectable before verification.`
					: `JSTSReviewerBee requested ${reworkTargets.length} bounded rework items on ${reworkTargets.join(", ")} so the ${reviewSurface} stays inspectable before verification.`
			for (const request of reworkRequests) {
				const requestPayload = asRecord(request.payload)
				if (requestPayload) requestPayload["reviewerSummary"] = reviewerSummary
			}
			return buildReworkPayload("review_marker_missing", payload.changedFiles, reviewerSummary, reworkRequests)
		}

		return buildVerdict("review_pass", {
			accepted: true,
			reason: null,
			changedFiles: payload.changedFiles,
			reworkCount: 0,
			reworkRequests: [],
			reviewSummary:
				payload.changedFiles.length === 1
					? `JSTSReviewerBee approved the bounded ${reviewSurface} for ${payload.changedFiles[0]}.`
					: `JSTSReviewerBee approved the bounded ${reviewSurface} for ${payload.changedFiles.join(", ")}.`,
		})
	}

	handleEnvelope(envelope: QueenBeeEnvelope): QueenBeeEnvelope | null {
		if (envelope.messageType !== "review_request") return null
		const verdict = this.reviewEnvelope(envelope)
		return buildQueenBeeEnvelope({
			messageId: `${envelope.messageId}:${verdict.messageType}`,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			senderBeeId: this.reviewerBeeId,
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
