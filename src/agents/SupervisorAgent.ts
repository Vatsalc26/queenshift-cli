import type { ChatMessage, IModelClient } from "../model/IModelClient"
import { formatRoleManualPrompt } from "../planning/RoleManuals"

export interface Subtask {
	id: string
	description: string
	files: string[]
	assignedBuilder: string
	dependsOn?: string[]
	stage?: number
	ownershipRule?: string | null
	dependencyReason?: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function tryExtractFirstJsonArray(text: string): string | null {
	const start = text.indexOf("[")
	if (start === -1) return null

	let depth = 0
	let inString = false
	let escaped = false

	for (let i = start; i < text.length; i++) {
		const ch = text[i] ?? ""

		if (inString) {
			if (escaped) {
				escaped = false
				continue
			}
			if (ch === "\\") {
				escaped = true
				continue
			}
			if (ch === '"') inString = false
			continue
		}

		if (ch === '"') {
			inString = true
			continue
		}

		if (ch === "[") depth++
		if (ch === "]") {
			depth--
			if (depth === 0) return text.slice(start, i + 1)
		}
	}

	return null
}

function normalizeRelPath(p: string): string {
	return p.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

export class SupervisorAgent {
	private modelClient: IModelClient

	constructor(modelClient: IModelClient) {
		this.modelClient = modelClient
	}

	async plan(
		task: string,
		fileList: string[],
		builderCount: number,
		options: {
			memorySummary?: string
			repoMapSummary?: string
			contextPackSummary?: string
			patternMemorySummary?: string
			delegationSummary?: string
		} = {},
	): Promise<Subtask[]> {
		const normalizedFileSet = new Set(fileList.map(normalizeRelPath))

		const messages: ChatMessage[] = [
			{
				role: "system",
				content:
					`${formatRoleManualPrompt("supervisor")}\n\n` +
					`You decompose coding tasks for a team of up to ${builderCount} developers.\n` +
					`Respond with ONLY valid JSON: an array of 1 to ${builderCount} subtasks.\n\n` +
					`Format:\n` +
					`[{"id":"subtask-1","description":"...","files":["file1.ts","file2.ts"],"dependsOn":["subtask-0"],"stage":1,"ownershipRule":"...","dependencyReason":"..."}]\n\n` +
					"RULES:\n" +
					`1. Use between 1 and ${builderCount} subtasks; never exceed the available developers.\n` +
					"2. Each subtask must list explicit file paths from the workspace.\n" +
					"3. No file appears in more than one subtask (no overlap).\n" +
					"4. Use dependsOn only when a later subtask truly waits on an earlier one.\n" +
					"5. No prose. No markdown. Only JSON array.\n",
			},
			{
				role: "user",
				content: [
					`Task: ${task}`,
					options.delegationSummary ? `Delegation rules:\n${options.delegationSummary}` : null,
					options.memorySummary ? `Workspace memory:\n${options.memorySummary}` : null,
					options.repoMapSummary ? `Repo map:\n${options.repoMapSummary}` : null,
					options.contextPackSummary ? `Context pack:\n${options.contextPackSummary}` : null,
					options.patternMemorySummary ? `Pattern memory:\n${options.patternMemorySummary}` : null,
					`Workspace files: ${fileList.join(", ")}`,
					`Builders available: ${builderCount}`,
				]
					.filter((value): value is string => Boolean(value))
					.join("\n"),
			},
		]

		const fallback = (): Subtask[] => {
			console.warn("[Supervisor] Plan failed, using fallback file split")
			const fallbackCount = Math.max(1, Math.min(builderCount, fileList.length <= 2 ? 1 : Math.ceil(fileList.length / 2)))
			const chunkSize = Math.ceil(fileList.length / fallbackCount)
			return Array.from({ length: fallbackCount }, (_, i) => ({
				id: `subtask-${i + 1}`,
				description: task,
				files: fileList.slice(i * chunkSize, (i + 1) * chunkSize),
				assignedBuilder: `builder-${i + 1}`,
				stage: 1,
				ownershipRule: "Fallback bounded file bucket.",
				dependencyReason: null,
			}))
		}

		try {
			const raw = await this.modelClient.chat(messages, { temperature: 0, maxTokens: 900 })
			const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
			const extracted = tryExtractFirstJsonArray(cleaned) ?? cleaned

			const parsed = JSON.parse(extracted) as unknown
			if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > builderCount) throw new Error("Invalid subtask array length")

			const seenFiles = new Set<string>()
			const subtasks: Subtask[] = []

			for (let i = 0; i < parsed.length; i++) {
				const entry = parsed[i] as unknown
				const obj = asRecord(entry)
				if (!obj) throw new Error("Subtask must be an object")

				const id = typeof obj["id"] === "string" && obj["id"].trim() ? obj["id"].trim() : `subtask-${i + 1}`
				const description = typeof obj["description"] === "string" ? obj["description"].trim() : ""
				if (!description) throw new Error("Subtask missing description")

				const filesRaw = obj["files"]
				if (!Array.isArray(filesRaw) || filesRaw.length === 0) throw new Error("Subtask missing files list")
				const files = filesRaw
					.filter((f) => typeof f === "string" && f.trim())
					.map((f) => normalizeRelPath(String(f)))
				if (files.length === 0) throw new Error("Subtask missing files list")

				const dependsOn = Array.isArray(obj["dependsOn"])
					? obj["dependsOn"].filter((value) => typeof value === "string" && value.trim()).map((value) => String(value).trim())
					: []
				const stage = typeof obj["stage"] === "number" && Number.isFinite(obj["stage"]) ? Math.max(1, Math.floor(obj["stage"])) : 1
				const ownershipRule =
					typeof obj["ownershipRule"] === "string" && obj["ownershipRule"].trim() ? obj["ownershipRule"].trim() : null
				const dependencyReason =
					typeof obj["dependencyReason"] === "string" && obj["dependencyReason"].trim() ? obj["dependencyReason"].trim() : null

				for (const f of files) {
					if (!normalizedFileSet.has(f)) throw new Error(`Subtask file not in workspace: ${f}`)
					if (seenFiles.has(f)) throw new Error(`File appears in more than one subtask: ${f}`)
					seenFiles.add(f)
				}

				subtasks.push({
					id,
					description,
					files,
					assignedBuilder: `builder-${i + 1}`,
					dependsOn,
					stage,
					ownershipRule,
					dependencyReason,
				})
			}

			return subtasks
		} catch {
			return fallback()
		}
	}
}
