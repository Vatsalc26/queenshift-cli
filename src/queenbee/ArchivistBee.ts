import fs from "node:fs"
import path from "node:path"

import { buildQueenBeeEnvelope, type QueenBeeBeeId, type QueenBeeEnvelope } from "./QueenBeeProtocol"

export type QueenBeeArchiveRequestPayload = {
	changedFiles: string[]
	proofCommands: string[]
	verifierSummary: string
	mergeSummary: string
}

export type QueenBeeArchiveWrittenPayload = {
	archivePath: string
	changedFiles: string[]
	archiveSummary: string
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

function parseArchiveRequestPayload(payload: unknown): QueenBeeArchiveRequestPayload | null {
	const record = asRecord(payload)
	if (!record) return null
	const changedFiles = readStringArray(record["changedFiles"])
	const proofCommands = readStringArray(record["proofCommands"])
	const verifierSummary = typeof record["verifierSummary"] === "string" ? record["verifierSummary"].trim() : ""
	const mergeSummary = typeof record["mergeSummary"] === "string" ? record["mergeSummary"].trim() : ""
	if (!verifierSummary || !mergeSummary) return null
	return {
		changedFiles,
		proofCommands,
		verifierSummary,
		mergeSummary,
	}
}

export class ArchivistBee {
	private readonly workspaceRoot: string
	private readonly archivistBeeId: QueenBeeBeeId

	constructor(workspaceRoot: string, archivistBeeId: QueenBeeBeeId = "queenbee.archivist.001") {
		this.workspaceRoot = workspaceRoot
		this.archivistBeeId = archivistBeeId
	}

	writeArchive(envelope: QueenBeeEnvelope): QueenBeeArchiveWrittenPayload | null {
		const payload = parseArchiveRequestPayload(envelope.payload)
		if (!payload) return null
		const archiveDir = path.join(this.workspaceRoot, ".swarm", "queenbee_archive")
		fs.mkdirSync(archiveDir, { recursive: true })
		const archiveFile = path.join(archiveDir, `${envelope.assignmentId ?? envelope.missionId}.json`)
		fs.writeFileSync(
			archiveFile,
			JSON.stringify(
				{
					missionId: envelope.missionId,
					assignmentId: envelope.assignmentId,
					changedFiles: payload.changedFiles,
					proofCommands: payload.proofCommands,
					verifierSummary: payload.verifierSummary,
					mergeSummary: payload.mergeSummary,
				},
				null,
				2,
			),
			"utf8",
		)
		return {
			archivePath: path.relative(this.workspaceRoot, archiveFile).replace(/[\\/]+/g, "/"),
			changedFiles: payload.changedFiles,
			archiveSummary: payload.mergeSummary.includes("created")
				? `ArchivistBee wrote one bounded create-safe completion artifact for ${payload.changedFiles.join(", ") || "the mission"}.`
				: `ArchivistBee wrote one bounded completion artifact for ${payload.changedFiles.join(", ") || "the mission"}.`,
		}
	}

	handleEnvelope(envelope: QueenBeeEnvelope): QueenBeeEnvelope | null {
		if (envelope.messageType !== "archive_request") return null
		const archiveWritten = this.writeArchive(envelope)
		if (!archiveWritten) return null
		return buildQueenBeeEnvelope({
			messageId: `${envelope.messageId}:archive_written`,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			senderBeeId: this.archivistBeeId,
			recipientBeeId: envelope.senderBeeId,
			messageType: "archive_written",
			timestamp: envelope.timestamp,
			scopeToken: envelope.scopeToken,
			toolGrantToken: envelope.toolGrantToken,
			parentMessageId: envelope.messageId,
			payload: archiveWritten as unknown as Record<string, unknown>,
		})
	}
}
