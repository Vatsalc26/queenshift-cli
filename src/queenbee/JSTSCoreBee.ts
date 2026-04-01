import fs from "node:fs"
import path from "node:path"
import * as ts from "typescript"

import { createLiveModelClient } from "../model/createLiveModelClient"
import type { QueenBeeBeeId, QueenBeeEnvelope } from "./QueenBeeProtocol"
import type { QueenBeeFileProposal, QueenBeeWorkResultPayload } from "./JSTSCoderBee"

export const SUPPORTED_JS_TS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"])

export type QueenBeeAssignmentPacketPayload = {
	task: string
	taskFamily: string
	languagePack: string
	allowedFiles: string[]
}

export type QueenBeeLiveWorkResult = {
	workResult: QueenBeeWorkResultPayload
	providerCallObserved: boolean
}

type QueenBeeLiveProviderFileResponse = {
	path: string
	afterContent: string
	changeSummary?: string
}

type QueenBeeProviderResponseError = Error & {
	rawResponse?: string
}

function expectedTargetCount(taskFamily: string): number | null {
	if (taskFamily === "bounded_two_file_update") return 2
	if (taskFamily === "update_file_and_test") return 2
	if (taskFamily === "comment_file" || taskFamily === "create_tiny_file" || taskFamily === "update_named_file") return 1
	return null
}

function hasExportModifier(node: ts.Node): boolean {
	const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
	return Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function scriptKindForFile(filePath: string): ts.ScriptKind {
	switch (path.extname(filePath).toLowerCase()) {
		case ".tsx":
			return ts.ScriptKind.TSX
		case ".jsx":
			return ts.ScriptKind.JSX
		case ".js":
		case ".mjs":
		case ".cjs":
			return ts.ScriptKind.JS
		default:
			return ts.ScriptKind.TS
	}
}

function extractRenameTargetName(task: string): string | null {
	const renameMatch = /\brename\b[^\r\n]+?\bto\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/iu.exec(task)
	return renameMatch?.[1] ?? null
}

export function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function normalizeLineEndings(input: string): string {
	return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function describeLiveRow(taskFamily: string): string {
	switch (taskFamily) {
		case "comment_file":
			return "bounded comment_file row"
		case "update_named_file":
			return "bounded update_named_file row"
		case "update_file_and_test":
			return "bounded source-and-test row"
		case "rename_export":
			return "bounded rename_export row"
		case "bounded_node_cli_task":
			return "bounded Node/CLI row"
		default:
			return "bounded live row"
	}
}

function describeDeterministicLiveResult(taskFamily: string, proposalCount: number): string {
	if (taskFamily === "comment_file" || taskFamily === "update_named_file") {
		return "one-file result"
	}
	if (taskFamily === "update_file_and_test") {
		return "source-and-test result"
	}
	if (taskFamily === "rename_export") {
		return "rename result"
	}
	if (taskFamily === "bounded_node_cli_task") {
		return "Node/CLI result"
	}
	return proposalCount === 1 ? "one-file result" : "proposal set"
}

export function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeRelPath(value)).filter((value) => value.length > 0)))
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === "string")) : []
}

function tryExtractFirstJsonObject(text: string): string | null {
	const start = text.indexOf("{")
	if (start === -1) return null

	let depth = 0
	let inString = false
	let escaped = false

	for (let index = start; index < text.length; index += 1) {
		const current = text[index] ?? ""
		if (inString) {
			if (escaped) {
				escaped = false
				continue
			}
			if (current === "\\") {
				escaped = true
				continue
			}
			if (current === '"') {
				inString = false
			}
			continue
		}
		if (current === '"') {
			inString = true
			continue
		}
		if (current === "{") depth += 1
		if (current === "}") {
			depth -= 1
			if (depth === 0) {
				return text.slice(start, index + 1)
			}
		}
	}

	return null
}

function tryExtractLastJsonObject(text: string): string | null {
	let start = -1
	let depth = 0
	let inString = false
	let escaped = false
	let lastObject: string | null = null

	for (let index = 0; index < text.length; index += 1) {
		const current = text[index] ?? ""
		if (inString) {
			if (escaped) {
				escaped = false
				continue
			}
			if (current === "\\") {
				escaped = true
				continue
			}
			if (current === '"') {
				inString = false
			}
			continue
		}
		if (current === '"') {
			inString = true
			continue
		}
		if (current === "{") {
			if (depth === 0) {
				start = index
			}
			depth += 1
			continue
		}
		if (current === "}") {
			depth -= 1
			if (depth === 0 && start !== -1) {
				lastObject = text.slice(start, index + 1)
				start = -1
			}
		}
	}

	return lastObject
}

function tryExtractJsonFence(text: string): string | null {
	const pattern = /```(?:json)?\s*([\s\S]*?)```/giu
	let match: RegExpExecArray | null
	let lastFence: string | null = null
	while ((match = pattern.exec(text)) !== null) {
		lastFence = match[1]?.trim() ?? null
	}
	return lastFence
}

function decodeLooseJsonString(rawValue: string): string {
	let decoded = ""

	for (let index = 0; index < rawValue.length; index += 1) {
		const current = rawValue[index] ?? ""
		if (current !== "\\") {
			decoded += current
			continue
		}

		const next = rawValue[index + 1] ?? ""
		index += 1
		switch (next) {
			case '"':
				decoded += '"'
				break
			case "\\":
				decoded += "\\"
				break
			case "/":
				decoded += "/"
				break
			case "b":
				decoded += "\b"
				break
			case "f":
				decoded += "\f"
				break
			case "n":
				decoded += "\n"
				break
			case "r":
				decoded += "\r"
				break
			case "t":
				decoded += "\t"
				break
			case "u": {
				const hex = rawValue.slice(index + 1, index + 5)
				if (/^[0-9a-fA-F]{4}$/u.test(hex)) {
					decoded += String.fromCharCode(Number.parseInt(hex, 16))
					index += 4
					break
				}
				decoded += "u"
				break
			}
			default:
				decoded += next
				break
		}
	}

	return decoded
}

function parseLooseLiveProviderResponse(candidate: string): QueenBeeLiveProviderFileResponse | null {
	const pathMatch = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/u.exec(candidate)
	const afterContentMatch = /"afterContent"\s*:\s*"((?:\\.|[\s\S])*?)"\s*,\s*"changeSummary"/u.exec(candidate)
	const changeSummaryMatch = /"changeSummary"\s*:\s*"((?:\\.|[\s\S])*?)"\s*(?:,|\})/u.exec(candidate)

	const filePath = pathMatch?.[1] ? normalizeRelPath(decodeLooseJsonString(pathMatch[1])) : ""
	const afterContent = afterContentMatch?.[1] ? decodeLooseJsonString(afterContentMatch[1]) : ""
	const changeSummary = changeSummaryMatch?.[1] ? decodeLooseJsonString(changeSummaryMatch[1]).trim() : undefined

	if (!filePath || !afterContent) return null
	return {
		path: filePath,
		afterContent,
		changeSummary,
	}
}

function createProviderResponseError(message: string, rawResponse: string): QueenBeeProviderResponseError {
	const error = new Error(message) as QueenBeeProviderResponseError
	error.rawResponse = rawResponse
	return error
}

function buildLiveProviderResponseCandidates(raw: string): string[] {
	const trimmed = raw.trim()
	if (!trimmed) return []
	return Array.from(
		new Set(
			[
				trimmed,
				tryExtractJsonFence(trimmed) ?? "",
				tryExtractLastJsonObject(trimmed) ?? "",
				tryExtractFirstJsonObject(trimmed) ?? "",
			]
				.map((candidate) => candidate.trim())
				.filter((candidate) => candidate.length > 0),
		),
	)
}

function parseLiveProviderResponse(raw: string): QueenBeeLiveProviderFileResponse | null {
	const parseCandidate = (candidate: string): QueenBeeLiveProviderFileResponse | null => {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>
			const filePath = typeof parsed["path"] === "string" ? normalizeRelPath(parsed["path"]) : ""
			const afterContent = typeof parsed["afterContent"] === "string" ? parsed["afterContent"] : ""
			const changeSummary = typeof parsed["changeSummary"] === "string" ? parsed["changeSummary"].trim() : undefined
			if (!filePath || !afterContent) return null
			return {
				path: filePath,
				afterContent,
				changeSummary,
			}
		} catch {
			return null
		}
	}

	for (const candidate of buildLiveProviderResponseCandidates(raw)) {
		const parsed = parseCandidate(candidate) ?? parseLooseLiveProviderResponse(candidate)
		if (parsed) return parsed
	}
	return null
}

function parseLiveProviderBatchResponse(raw: string): QueenBeeLiveProviderFileResponse[] | null {
	const parseCandidate = (candidate: string): QueenBeeLiveProviderFileResponse[] | null => {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown> | unknown[]
			const fileEntries = Array.isArray(parsed)
				? parsed
				: Array.isArray((parsed as Record<string, unknown>)["files"])
					? ((parsed as Record<string, unknown>)["files"] as unknown[])
					: null
			if (!fileEntries) return null
			const files = fileEntries.flatMap((entry) => {
				const record = asRecord(entry)
				const filePath = typeof record?.["path"] === "string" ? normalizeRelPath(record["path"]) : ""
				const afterContent = typeof record?.["afterContent"] === "string" ? record["afterContent"] : ""
				const changeSummary = typeof record?.["changeSummary"] === "string" ? record["changeSummary"].trim() : undefined
				return filePath && afterContent
					? [
							{
								path: filePath,
								afterContent,
								changeSummary,
							} satisfies QueenBeeLiveProviderFileResponse,
					  ]
					: []
			})
			return files.length > 0 ? files : null
		} catch {
			return null
		}
	}

	for (const candidate of buildLiveProviderResponseCandidates(raw)) {
		const parsed = parseCandidate(candidate)
		if (parsed) return parsed
	}
	return null
}

export function parseAssignmentPacketPayload(payload: unknown): QueenBeeAssignmentPacketPayload | null {
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

export function extractQuotedSnippet(task: string): string | null {
	const doubleQuoted = /"([^"\r\n]+)"/u.exec(task)
	if (doubleQuoted?.[1]) return doubleQuoted[1].trim()
	const singleQuoted = /'([^'\r\n]+)'/u.exec(task)
	return singleQuoted?.[1]?.trim() || null
}

export function isLikelyTestFile(filePath: string): boolean {
	const normalized = normalizeRelPath(filePath).toLowerCase()
	return /(^|\/)__tests__(\/|$)|(?:\.|_)test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/u.test(normalized)
}

function buildSnippet(task: string, taskFamily: string, targetFile: string): string {
	const exactSnippet = extractQuotedSnippet(task)
	if (exactSnippet) return exactSnippet
	const fileLabel = path.basename(targetFile, path.extname(targetFile))
	if (taskFamily === "comment_file") return `// queenbee: comment for ${fileLabel}`
	if (taskFamily === "create_tiny_file") return `// queenbee: create ${fileLabel}`
	return `// queenbee: update for ${fileLabel}`
}

export function insertSnippet(beforeContent: string, snippet: string): string {
	if (beforeContent.includes(snippet)) return beforeContent
	if (beforeContent.startsWith("#!")) {
		const newlineIndex = beforeContent.indexOf("\n")
		if (newlineIndex !== -1) {
			return `${beforeContent.slice(0, newlineIndex + 1)}${snippet}\n${beforeContent.slice(newlineIndex + 1)}`
		}
	}
	return `${snippet}\n${beforeContent}`
}

export function refusal(reason: string, summary: string): QueenBeeWorkResultPayload {
	return {
		accepted: false,
		reason,
		changedFiles: [],
		proposalCount: 0,
		proposals: [],
		coderSummary: summary,
	}
}

export class JSTSCoreBee {
	protected readonly workspaceRoot: string
	protected readonly coderBeeId: QueenBeeBeeId

	constructor(workspaceRoot: string, coderBeeId: QueenBeeBeeId = "queenbee.jsts_coder.001") {
		this.workspaceRoot = workspaceRoot
		this.coderBeeId = coderBeeId
	}

	getBeeId(): QueenBeeBeeId {
		return this.coderBeeId
	}

	listSupportedTaskFamilies(): string[] {
		return ["comment_file", "create_tiny_file", "update_named_file", "bounded_two_file_update", "update_file_and_test", "rename_export"]
	}

	private collectRenameExportSourceNames(filePath: string, sourceText: string): string[] {
		const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKindForFile(filePath))
		const exportedNames = new Set<string>()
		for (const statement of sourceFile.statements) {
			if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
				if (hasExportModifier(statement) && statement.name) {
					exportedNames.add(statement.name.text)
				}
				continue
			}
			if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
				for (const declaration of statement.declarationList.declarations) {
					if (ts.isIdentifier(declaration.name)) {
						exportedNames.add(declaration.name.text)
					}
				}
			}
		}
		return [...exportedNames]
	}

	private renameIdentifiersInContent(filePath: string, beforeContent: string, oldName: string, newName: string): { afterContent: string; replacementCount: number } {
		const sourceFile = ts.createSourceFile(filePath, beforeContent, ts.ScriptTarget.Latest, true, scriptKindForFile(filePath))
		const replacements: Array<{ start: number; end: number }> = []
		const visit = (node: ts.Node): void => {
			if (ts.isIdentifier(node) && node.text === oldName) {
				replacements.push({ start: node.getStart(sourceFile), end: node.getEnd() })
			}
			ts.forEachChild(node, visit)
		}
		visit(sourceFile)
		if (replacements.length === 0) {
			return {
				afterContent: beforeContent,
				replacementCount: 0,
			}
		}
		let afterContent = beforeContent
		for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
			afterContent = `${afterContent.slice(0, replacement.start)}${newName}${afterContent.slice(replacement.end)}`
		}
		return {
			afterContent,
			replacementCount: replacements.length,
		}
	}

	private codeRenameExportAssignment(payload: QueenBeeAssignmentPacketPayload): QueenBeeWorkResultPayload {
		if (payload.allowedFiles.length < 2 || payload.allowedFiles.length > 3) {
			return refusal(
				"coder_target_count_out_of_bounds",
				"JSTSCoreBee keeps rename_export limited to one source file plus one or two direct call-site files.",
			)
		}
		const newName = extractRenameTargetName(payload.task)
		if (!newName) {
			return refusal("rename_export_target_missing", "JSTSCoreBee refused rename_export because the new export name was missing from the task.")
		}

		for (const targetFile of payload.allowedFiles) {
			if (!targetFile) {
				return refusal(
					"invalid_assignment_packet_payload",
					"JSTSCoreBee refused the assignment because a bounded target file was missing.",
				)
			}
			const extension = path.extname(targetFile).toLowerCase()
			if (!SUPPORTED_JS_TS_EXTENSIONS.has(extension)) {
				return refusal("unsupported_file_extension", `JSTSCoreBee only accepts JS/TS files, not ${targetFile}.`)
			}
		}

		const sourceFile = payload.allowedFiles[0]
		if (!sourceFile) {
			return refusal(
				"invalid_assignment_packet_payload",
				"JSTSCoreBee refused rename_export because the source file was missing from the bounded assignment.",
			)
		}
		const sourcePath = path.join(this.workspaceRoot, sourceFile)
		if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
			return refusal("target_file_missing", `JSTSCoreBee could not read ${sourceFile} inside the bounded workspace.`)
		}
		const sourceBeforeContent = fs.readFileSync(sourcePath, "utf8")
		const exportedNames = this.collectRenameExportSourceNames(sourceFile, sourceBeforeContent)
		if (exportedNames.length === 0) {
			return refusal(
				"rename_export_source_symbol_missing",
				`JSTSCoreBee could not find one supported exported symbol in ${sourceFile} for rename_export.`,
			)
		}
		if (exportedNames.length !== 1) {
			return refusal(
				"rename_export_source_symbol_ambiguous",
				`JSTSCoreBee keeps rename_export symbol-scoped, but ${sourceFile} exported ${exportedNames.length} supported symbols.`,
			)
		}
		const oldName = exportedNames[0]
		if (!oldName) {
			return refusal("rename_export_source_symbol_missing", `JSTSCoreBee could not find one supported exported symbol in ${sourceFile} for rename_export.`)
		}
		if (oldName === newName) {
			return refusal("rename_export_target_unchanged", `JSTSCoreBee found ${sourceFile} already exporting ${newName}.`)
		}

		const proposals: QueenBeeFileProposal[] = []
		for (const [index, targetFile] of payload.allowedFiles.entries()) {
			const targetPath = path.join(this.workspaceRoot, targetFile)
			if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
				return refusal("target_file_missing", `JSTSCoreBee could not read ${targetFile} inside the bounded workspace.`)
			}
			const beforeContent = fs.readFileSync(targetPath, "utf8")
			const { afterContent, replacementCount } = this.renameIdentifiersInContent(targetFile, beforeContent, oldName, newName)
			if (replacementCount === 0 || afterContent === beforeContent) {
				return refusal(
					index === 0 ? "rename_export_source_symbol_missing" : "rename_export_callsite_missing",
					index === 0
						? `JSTSCoreBee could not locate ${oldName} inside ${targetFile} for rename_export.`
						: `JSTSCoreBee could not find a direct call-site reference to ${oldName} inside ${targetFile}.`,
				)
			}
			proposals.push({
				path: targetFile,
				beforeContent,
				afterContent,
				changeSummary:
					index === 0
						? `JSTSCoreBee renamed the exported symbol ${oldName} to ${newName} in ${targetFile}.`
						: `JSTSCoreBee updated direct call-site references from ${oldName} to ${newName} in ${targetFile}.`,
			})
		}

		return {
			accepted: true,
			reason: null,
			changedFiles: [...payload.allowedFiles],
			proposalCount: proposals.length,
			proposals,
			coderSummary: `JSTSCoreBee prepared a bounded rename_export proposal for ${oldName} -> ${newName} across ${payload.allowedFiles.join(", ")} without merging it into the workspace.`,
		}
	}

	codeAssignment(envelope: QueenBeeEnvelope): QueenBeeWorkResultPayload {
		const payload = parseAssignmentPacketPayload(envelope.payload)
		if (!payload) {
			return refusal(
				"invalid_assignment_packet_payload",
				"JSTSCoreBee refused the assignment because the packet payload was incomplete.",
			)
		}
		if (payload.languagePack !== "js_ts") {
			return refusal("unsupported_language_pack", "JSTSCoreBee stays inside the JS/TS-first candidate boundary.")
		}
		if (payload.taskFamily === "rename_export") {
			return this.codeRenameExportAssignment(payload)
		}
		const targetCount = expectedTargetCount(payload.taskFamily)
		if (targetCount === null) {
			return refusal("unsupported_task_family", `JSTSCoreBee does not support ${payload.taskFamily} inside the current core specialist band.`)
		}
		if (payload.allowedFiles.length !== targetCount) {
			return refusal(
				"coder_target_count_out_of_bounds",
				targetCount === 1
					? "JSTSCoreBee keeps single-file task families bounded to one explicit JS/TS file."
					: payload.taskFamily === "update_file_and_test"
						? "JSTSCoreBee keeps update_file_and_test limited to one explicit source file and one explicit direct test file."
					: "JSTSCoreBee keeps bounded_two_file_update limited to exactly two explicit JS/TS files.",
			)
		}
		if (payload.taskFamily === "update_file_and_test") {
			const testFileCount = payload.allowedFiles.filter((targetFile) => isLikelyTestFile(targetFile)).length
			if (testFileCount !== 1) {
				return refusal(
					"update_file_and_test_requires_one_source_and_one_test",
					"JSTSCoreBee keeps update_file_and_test limited to one explicit source file and one explicit direct test file.",
				)
			}
		}

		const proposals: QueenBeeFileProposal[] = []
		for (const targetFile of payload.allowedFiles) {
			if (!targetFile) {
				return refusal(
					"invalid_assignment_packet_payload",
					"JSTSCoreBee refused the assignment because a bounded target file was missing.",
				)
			}
			const targetPath = path.join(this.workspaceRoot, targetFile)
			const extension = path.extname(targetFile).toLowerCase()
			if (!SUPPORTED_JS_TS_EXTENSIONS.has(extension)) {
				return refusal("unsupported_file_extension", `JSTSCoreBee only accepts JS/TS files, not ${targetFile}.`)
			}
			const fileExists = fs.existsSync(targetPath)
			const beforeContent =
				payload.taskFamily === "create_tiny_file"
					? (() => {
							if (fileExists) {
								return null
							}
							const parentPath = path.dirname(targetPath)
							return fs.existsSync(parentPath) && fs.statSync(parentPath).isDirectory() ? "" : undefined
					  })()
					: (() => {
							if (!fileExists || !fs.statSync(targetPath).isFile()) {
								return undefined
							}
							return fs.readFileSync(targetPath, "utf8")
					  })()
			if (beforeContent === null) {
				return refusal(
					"create_target_already_exists",
					`JSTSCoreBee refused create_tiny_file because ${targetFile} already exists inside the bounded workspace.`,
				)
			}
			if (beforeContent === undefined) {
				return refusal(
					payload.taskFamily === "create_tiny_file" ? "create_target_parent_missing" : "target_file_missing",
					payload.taskFamily === "create_tiny_file"
						? `JSTSCoreBee could not create ${targetFile} because its parent directory is missing inside the bounded workspace.`
						: `JSTSCoreBee could not read ${targetFile} inside the bounded workspace.`,
				)
			}
			const resolvedBeforeContent: string = beforeContent
			const snippet = buildSnippet(payload.task, payload.taskFamily, targetFile)
			const afterContent = insertSnippet(resolvedBeforeContent, snippet)
			if (afterContent === resolvedBeforeContent) {
				return refusal("snippet_already_present", `JSTSCoreBee found the requested snippet already present in ${targetFile}.`)
			}

			proposals.push({
				path: targetFile,
				beforeContent: resolvedBeforeContent,
				afterContent,
				changeSummary:
					payload.taskFamily === "create_tiny_file"
						? `JSTSCoreBee prepared one bounded JS/TS new-file proposal for ${targetFile}.`
						: targetCount === 1
						? `JSTSCoreBee inserted one bounded JS/TS proposal snippet into ${targetFile}.`
						: payload.taskFamily === "update_file_and_test"
							? `JSTSCoreBee inserted one bounded source-and-test proposal snippet into ${targetFile}.`
							: `JSTSCoreBee inserted one coordinated bounded JS/TS proposal snippet into ${targetFile}.`,
			})
		}

		return {
			accepted: true,
			reason: null,
			changedFiles: payload.allowedFiles,
			proposalCount: proposals.length,
			proposals,
			coderSummary:
				payload.taskFamily === "create_tiny_file"
					? `JSTSCoreBee prepared one bounded file_creation proposal for ${payload.allowedFiles[0]} without merging it into the workspace.`
					: targetCount === 1
					? `JSTSCoreBee prepared a one-file proposal for ${payload.allowedFiles[0]} without merging it into the workspace.`
					: payload.taskFamily === "update_file_and_test"
						? `JSTSCoreBee prepared a bounded source-and-test proposal set for ${payload.allowedFiles.join(", ")} without merging it into the workspace.`
						: `JSTSCoreBee prepared a bounded two-file proposal set for ${payload.allowedFiles.join(", ")} without merging it into the workspace.`,
		}
	}

	async codeAssignmentLive(
		envelope: QueenBeeEnvelope,
		env: Record<string, string | undefined>,
	): Promise<QueenBeeLiveWorkResult> {
		const payload = parseAssignmentPacketPayload(envelope.payload)
		if (!payload) {
			return {
				workResult: refusal(
					"invalid_assignment_packet_payload",
					"JSTSCoreBee refused the live assignment because the packet payload was incomplete.",
				),
				providerCallObserved: false,
			}
		}
		if (
			payload.taskFamily !== "comment_file" &&
			payload.taskFamily !== "update_named_file" &&
			payload.taskFamily !== "update_file_and_test" &&
			payload.taskFamily !== "rename_export" &&
			payload.taskFamily !== "bounded_node_cli_task"
		) {
			return {
				workResult: refusal(
					"live_task_family_not_enabled",
					"JSTSCoreBee only enables provider-backed live execution for the current bounded comment_file, update_named_file, update_file_and_test, rename_export, and bounded_node_cli_task live rows.",
				),
				providerCallObserved: false,
			}
		}

		const deterministicResult = this.codeAssignment(envelope)
		if (!deterministicResult.accepted) {
			return {
				workResult: deterministicResult,
				providerCallObserved: false,
			}
		}

		const liveClient = createLiveModelClient(env)
		if (deterministicResult.proposals.length === 1) {
			const proposal = deterministicResult.proposals[0]
			if (!proposal) {
				return {
					workResult: refusal(
						"live_proposal_missing",
						`JSTSCoreBee could not continue the live assignment because the ${describeLiveRow(payload.taskFamily)} proposal was missing.`,
					),
					providerCallObserved: false,
				}
			}
			const rowLabel = describeLiveRow(payload.taskFamily)

			const rawResponse = await liveClient.chat(
				[
					{
						role: "system",
						content:
							"You are operating inside a frozen bounded JS/TS live-execution lane. " +
							"You are not being asked to modify files or use tools. " +
							"Return the witness JSON object only. Do not add markdown. Do not widen scope.",
					},
					{
						role: "user",
						content: [
							"This is a response-format task, not a file-write task.",
							"Return one JSON object with exactly these keys: path, afterContent, changeSummary.",
							`Task: ${payload.task}`,
							`Bounded row label: ${rowLabel}`,
							`Bounded target path: ${proposal.path}`,
							`Required afterContent bytes: ${JSON.stringify(proposal.afterContent)}`,
							`Required changeSummary: ${JSON.stringify(proposal.changeSummary)}`,
							"Stop after the JSON object.",
						].join("\n"),
					},
				],
				{ temperature: 0, maxTokens: 1_200 },
			)

			const parsedResponse = parseLiveProviderResponse(rawResponse)
			if (!parsedResponse) {
				throw createProviderResponseError(
					`provider_malformed_response: live provider response was not valid JSON for the ${rowLabel}.`,
					rawResponse,
				)
			}
			if (normalizeRelPath(parsedResponse.path) !== proposal.path) {
				throw createProviderResponseError(
					`provider_malformed_response: live provider returned a path outside the ${rowLabel}.`,
					rawResponse,
				)
			}
			if (normalizeLineEndings(parsedResponse.afterContent) !== normalizeLineEndings(proposal.afterContent)) {
				throw createProviderResponseError(
					`provider_malformed_response: live provider output did not match the deterministic ${rowLabel} proposal.`,
					rawResponse,
				)
			}

			return {
				providerCallObserved: true,
				workResult: {
					...deterministicResult,
					proposals: [
						{
							...proposal,
							changeSummary: parsedResponse.changeSummary?.trim() || proposal.changeSummary,
						},
					],
					coderSummary:
						`JSTSCoreBee observed one provider-backed bounded ${payload.taskFamily} proposal for ${proposal.path} ` +
						`and verified it matched the deterministic ${describeDeterministicLiveResult(payload.taskFamily, 1)}.`,
				},
			}
		}

		if (deterministicResult.proposals.length < 2 || deterministicResult.proposals.length > 3) {
			return {
				workResult: refusal(
					"live_proposal_missing",
					`JSTSCoreBee could not continue the live assignment because the ${describeLiveRow(payload.taskFamily)} proposal set was incomplete.`,
				),
				providerCallObserved: false,
			}
		}
		const rowLabel = describeLiveRow(payload.taskFamily)

		const rawResponse = await liveClient.chat(
			[
				{
					role: "system",
					content:
						"You are operating inside a frozen bounded JS/TS live-execution lane. " +
						"You are not being asked to modify files or use tools. " +
						"Return the witness JSON object only. Do not add markdown. Do not widen scope.",
				},
				{
					role: "user",
					content: [
						"This is a response-format task, not a file-write task.",
						"Return one JSON object with exactly one key: files.",
						"files must be an array of JSON objects. Each file object must use exactly these keys: path, afterContent, changeSummary.",
						`Task: ${payload.task}`,
						`Bounded row label: ${rowLabel}`,
						`Required files JSON: ${JSON.stringify(
							deterministicResult.proposals.map((proposal) => ({
								path: proposal.path,
								afterContent: proposal.afterContent,
								changeSummary: proposal.changeSummary,
							})),
						)}`,
						"Stop after the JSON object.",
					].join("\n"),
				},
			],
			{ temperature: 0, maxTokens: 2_200 },
		)

		const parsedResponses = parseLiveProviderBatchResponse(rawResponse)
		if (!parsedResponses) {
			throw createProviderResponseError(
				`provider_malformed_response: live provider response was not valid JSON for the ${rowLabel}.`,
				rawResponse,
			)
		}

		const responseByPath = new Map<string, QueenBeeLiveProviderFileResponse>()
		for (const parsedResponse of parsedResponses) {
			if (responseByPath.has(parsedResponse.path)) {
				throw createProviderResponseError(
					`provider_malformed_response: live provider returned the same ${rowLabel} target path more than once.`,
					rawResponse,
				)
			}
			responseByPath.set(parsedResponse.path, parsedResponse)
		}
		if (responseByPath.size !== deterministicResult.proposals.length) {
			throw createProviderResponseError(
				`provider_malformed_response: live provider returned the wrong number of files for the ${rowLabel}.`,
				rawResponse,
			)
		}

		const updatedProposals = deterministicResult.proposals.map((proposal) => {
			const parsedResponse = responseByPath.get(proposal.path)
			if (!parsedResponse) {
				throw createProviderResponseError(
					`provider_malformed_response: live provider omitted one ${rowLabel} target.`,
					rawResponse,
				)
			}
			if (normalizeLineEndings(parsedResponse.afterContent) !== normalizeLineEndings(proposal.afterContent)) {
				throw createProviderResponseError(
					`provider_malformed_response: live provider output did not match the deterministic ${rowLabel} proposal.`,
					rawResponse,
				)
			}
			return {
				...proposal,
				changeSummary: parsedResponse.changeSummary?.trim() || proposal.changeSummary,
			}
		})

		return {
			providerCallObserved: true,
			workResult: {
				...deterministicResult,
				proposals: updatedProposals,
				coderSummary:
					`JSTSCoreBee observed one provider-backed bounded ${payload.taskFamily} proposal set for ` +
					`${updatedProposals.map((proposal) => proposal.path).join(", ")} and verified it matched the deterministic ` +
					`${describeDeterministicLiveResult(payload.taskFamily, updatedProposals.length)}.`,
			},
		}
	}
}
