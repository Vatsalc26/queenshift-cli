import type { ChatMessage, IModelClient } from "../model/IModelClient"
import { discoverSemiOpenTask } from "../run/SemiOpenDiscovery"
import { extractTaskFileRefs, matchesSafeTaskTemplate, normalizeRelPath, type TaskContract } from "../run/TaskContract"

export type Complexity = "SIMPLE" | "COMPLEX"
export type RoutingPath = "small_task" | "simple" | "complex" | "scoped" | "medium" | "semi_open"
export type RoutingSource =
	| "explicit_targets"
	| "named_workspace_files"
	| "semi_open_discovery"
	| "safe_single_file_template"
	| "named_single_file_template"
	| "model_simple"
	| "model_complex"
	| "model_fallback_simple"

export type RoutingDecision = {
	complexity: Complexity
	path: RoutingPath
	usedModel: boolean
	targetFiles: string[]
	selectorSource: RoutingSource
	reasonCodes: string[]
	taskContract?: TaskContract | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function tryExtractFirstJsonObject(text: string): string | null {
	const start = text.indexOf("{")
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

		if (ch === "{") depth++
		if (ch === "}") {
			depth--
			if (depth === 0) return text.slice(start, i + 1)
		}
	}

	return null
}

export class CoordinatorAgent {
	private modelClient: IModelClient

	constructor(modelClient: IModelClient) {
		this.modelClient = modelClient
	}

	async classify(task: string, fileList: string[], options: { workspaceRoot?: string } = {}): Promise<Complexity> {
		return (await this.classifyDetailed(task, fileList, options)).complexity
	}

	async classifyDetailed(task: string, fileList: string[], options: { workspaceRoot?: string } = {}): Promise<RoutingDecision> {
		const taskLower = task.toLowerCase()
		const explicitFiles = extractTaskFileRefs(task)
		const normalizedWorkspaceFiles = fileList.map((file) => normalizeRelPath(file))
		const basenames = normalizedWorkspaceFiles
			.map((f) => f.split(/[\\/]/g).filter(Boolean).pop() ?? "")
			.map((f) => f.toLowerCase())
			.filter(Boolean)
		const basenameToPath = new Map<string, string>()
		for (const file of normalizedWorkspaceFiles) {
			const basename = file.split("/").filter(Boolean).pop()?.toLowerCase() ?? ""
			if (basename && !basenameToPath.has(basename)) basenameToPath.set(basename, file)
		}

		const mentioned = new Set<string>()
		for (const name of basenames) {
			if (taskLower.includes(name)) mentioned.add(name)
		}
		if (explicitFiles.length >= 2) {
			const path: RoutingPath = explicitFiles.length <= 5 ? "scoped" : explicitFiles.length <= 10 ? "medium" : "complex"
			return {
				complexity: "COMPLEX",
				path,
				usedModel: false,
				targetFiles: explicitFiles,
				selectorSource: "explicit_targets",
				reasonCodes: [
					"explicit_file_targets",
					path === "scoped" ? "bounded_target_count" : path === "medium" ? "medium_target_count" : "wide_target_count",
					"prefer_deterministic_coordination",
				],
			}
		}
		if (mentioned.size >= 2) {
			const targetFiles = Array.from(mentioned)
				.map((name) => basenameToPath.get(name))
				.filter((value): value is string => Boolean(value))
			const path: RoutingPath = targetFiles.length <= 5 ? "scoped" : targetFiles.length <= 10 ? "medium" : "complex"
			return {
				complexity: "COMPLEX",
				path,
				usedModel: false,
				targetFiles,
				selectorSource: "named_workspace_files",
				reasonCodes: [
					"named_workspace_files",
					path === "scoped" ? "bounded_target_count" : path === "medium" ? "medium_target_count" : "wide_target_count",
					"prefer_deterministic_coordination",
				],
			}
		}
		if (options.workspaceRoot) {
			const semiOpen = discoverSemiOpenTask(task, options.workspaceRoot, normalizedWorkspaceFiles, { maxFiles: 4 })
			if (semiOpen.match) {
				return {
					complexity: "COMPLEX",
					path: "semi_open",
					usedModel: false,
					targetFiles: semiOpen.match.targetFiles,
					selectorSource: "semi_open_discovery",
					reasonCodes: ["semi_open_discovery", "bounded_anchor_match", "preserve_literal_requirements"],
					taskContract: semiOpen.match.taskContract,
				}
			}
		}
		if (explicitFiles.length === 1 && matchesSafeTaskTemplate(taskLower)) {
			return {
				complexity: "SIMPLE",
				path: "small_task",
				usedModel: false,
				targetFiles: explicitFiles,
				selectorSource: "safe_single_file_template",
				reasonCodes: ["explicit_single_file", "safe_template_match", "prefer_low_cost_small_lane"],
			}
		}
		if (mentioned.size === 1 && matchesSafeTaskTemplate(taskLower)) {
			return {
				complexity: "SIMPLE",
				path: "small_task",
				usedModel: false,
				targetFiles: Array.from(mentioned)
					.map((name) => basenameToPath.get(name))
					.filter((value): value is string => Boolean(value)),
				selectorSource: "named_single_file_template",
				reasonCodes: ["named_single_file", "safe_template_match", "prefer_low_cost_small_lane"],
			}
		}

		const messages: ChatMessage[] = [
			{
				role: "system",
				content:
					'You classify coding tasks. Respond with ONLY valid JSON: {"complexity":"SIMPLE"|"COMPLEX"}\n\n' +
					"SIMPLE: single-file change, comment, typo fix, small isolated function.\n" +
					"COMPLEX: multi-file refactor, new feature spanning files, changes that must coordinate across files.\n\n" +
					"No prose. No markdown. Only JSON.",
			},
			{
				role: "user",
				content: `Task: ${task}\nWorkspace files: ${fileList.slice(0, 30).join(", ")}`,
			},
		]

		try {
			const raw = await this.modelClient.chat(messages, { temperature: 0, maxTokens: 120 })
			const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
			const extracted = tryExtractFirstJsonObject(cleaned) ?? cleaned
			const parsed = JSON.parse(extracted) as unknown
			const obj = asRecord(parsed)
			const complexity = obj ? obj["complexity"] : null
			if (complexity === "SIMPLE" || complexity === "COMPLEX") {
				return {
					complexity,
					path: complexity === "COMPLEX" ? "complex" : "simple",
					usedModel: true,
					targetFiles: [],
					selectorSource: complexity === "COMPLEX" ? "model_complex" : "model_simple",
					reasonCodes:
						complexity === "COMPLEX"
							? ["ambiguous_task_needs_classifier", "model_selected_complex", "reserve_heavier_swarm"]
							: ["ambiguous_task_needs_classifier", "model_selected_simple", "avoid_heavier_swarm"],
					taskContract: null,
				}
			}
			throw new Error("Invalid complexity value")
		} catch (err) {
			console.warn(`[Coordinator] Classification failed, defaulting to SIMPLE: ${err instanceof Error ? err.message : String(err)}`)
			return {
				complexity: "SIMPLE",
				path: "simple",
				usedModel: true,
				targetFiles: [],
				selectorSource: "model_fallback_simple",
				reasonCodes: ["classifier_failed", "fail_closed_to_simple_lane"],
				taskContract: null,
			}
		}
	}
}
