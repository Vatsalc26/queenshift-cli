import fs from "node:fs"
import path from "node:path"

import {
	buildQueenBeeEnvelope,
	type QueenBeeBeeId,
	type QueenBeeEnvelope,
	type QueenBeeLanguagePack,
} from "./QueenBeeProtocol"
import { compileQueenBeeScoutScope } from "./QueenBeeNaturalLanguageScope"

const IGNORED_DIRS = new Set([".git", ".next", ".swarm", "build", "coverage", "dist", "node_modules", "out"])
const CONTEXT_FILE_PRIORITY = ["package.json", "tsconfig.json", "Readme.md", "README.md", "swarm.ts", "src/index.ts", "src/main.ts"]

export type QueenBeeScoutRequestPayload = {
	task: string
	workspace: string
	targetFiles?: string[]
	languagePack: QueenBeeLanguagePack
}

export type QueenBeeScoutResultPayload = {
	accepted: boolean
	reason: string | null
	workspaceName: string | null
	targetFiles: string[]
	contextFiles: string[]
	totalFiles: number
	readOnly: true
	scoutSummary: string
}

function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter((value) => value.length > 0)))
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === "string")) : []
}

function listWorkspaceFiles(workspace: string, maxDepth = 6): string[] {
	const results: string[] = []
	const walk = (dir: string, depth: number) => {
		if (depth > maxDepth) return
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (IGNORED_DIRS.has(entry.name)) continue
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				walk(fullPath, depth + 1)
				continue
			}
			results.push(normalizeRelPath(path.relative(workspace, fullPath)))
		}
	}
	walk(workspace, 0)
	return uniqueStrings(results)
}

function buildContextFiles(fileList: string[], targetFiles: string[], limit = 6): string[] {
	const fileSet = new Set(fileList)
	const selected: string[] = []
	for (const candidate of CONTEXT_FILE_PRIORITY) {
		if (fileSet.has(candidate) && !targetFiles.includes(candidate)) selected.push(candidate)
		if (selected.length >= limit) return selected
	}
	return selected
}

function parseScoutRequestPayload(payload: unknown): QueenBeeScoutRequestPayload | null {
	const record = asRecord(payload)
	if (!record) return null
	const task = typeof record["task"] === "string" ? record["task"].trim() : ""
	const workspace = typeof record["workspace"] === "string" ? record["workspace"].trim() : ""
	const targetFiles = readStringArray(record["targetFiles"])
	const languagePack = typeof record["languagePack"] === "string" ? record["languagePack"] : ""
	if (!task || !workspace) return null
	if (languagePack !== "js_ts") return null
	return {
		task,
		workspace,
		targetFiles,
		languagePack,
	}
}

export class ScoutBee {
	private readonly scoutBeeId: QueenBeeBeeId

	constructor(scoutBeeId: QueenBeeBeeId = "queenbee.scout.001") {
		this.scoutBeeId = scoutBeeId
	}

	scoutEnvelope(envelope: QueenBeeEnvelope): QueenBeeScoutResultPayload {
		const payload = parseScoutRequestPayload(envelope.payload)
		if (!payload) {
			return {
				accepted: false,
				reason: "invalid_scout_request_payload",
				workspaceName: null,
				targetFiles: [],
				contextFiles: [],
				totalFiles: 0,
				readOnly: true,
				scoutSummary: "ScoutBee refused the request because the frozen scout_request payload was incomplete.",
			}
		}
		if (!fs.existsSync(payload.workspace) || !fs.statSync(payload.workspace).isDirectory()) {
			return {
				accepted: false,
				reason: "workspace_missing",
				workspaceName: path.basename(payload.workspace),
				targetFiles: payload.targetFiles ?? [],
				contextFiles: [],
				totalFiles: 0,
				readOnly: true,
				scoutSummary: "ScoutBee could not read the requested workspace.",
			}
		}

		const compiledScope = compileQueenBeeScoutScope({
			task: payload.task,
			workspace: payload.workspace,
			explicitTargetFiles: payload.targetFiles,
		})
		const fileList = listWorkspaceFiles(payload.workspace)
		if (!compiledScope.accepted) {
			return {
				accepted: false,
				reason: compiledScope.reason,
				workspaceName: path.basename(payload.workspace),
				targetFiles: compiledScope.targetFiles,
				contextFiles: [],
				totalFiles: fileList.length,
				readOnly: true,
				scoutSummary: compiledScope.summary,
			}
		}
		const contextFiles = buildContextFiles(fileList, compiledScope.targetFiles)
		return {
			accepted: true,
			reason: null,
			workspaceName: path.basename(payload.workspace),
			targetFiles: compiledScope.targetFiles,
			contextFiles,
			totalFiles: fileList.length,
			readOnly: true,
			scoutSummary: `${compiledScope.summary} ScoutBee gathered read-only context in ${path.basename(payload.workspace)}.`,
		}
	}

	handleEnvelope(envelope: QueenBeeEnvelope): QueenBeeEnvelope | null {
		if (envelope.messageType !== "scout_request") return null
		const scoutResult = this.scoutEnvelope(envelope)
		return buildQueenBeeEnvelope({
			messageId: `${envelope.messageId}:scout_result`,
			missionId: envelope.missionId,
			assignmentId: envelope.assignmentId,
			senderBeeId: this.scoutBeeId,
			recipientBeeId: envelope.senderBeeId,
			messageType: "scout_result",
			timestamp: envelope.timestamp,
			scopeToken: envelope.scopeToken,
			toolGrantToken: envelope.toolGrantToken,
			payload: scoutResult as unknown as Record<string, unknown>,
		})
	}
}
