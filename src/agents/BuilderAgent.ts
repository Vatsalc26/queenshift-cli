import fs from "fs"
import path from "path"
import { spawn } from "child_process"

import { BaseAgent } from "./BaseAgent"
import { WorkspaceLock } from "../safety/WorkspaceLock"
import { CommandGate } from "../safety/CommandGate"
import { DatabaseService } from "../db/DatabaseService"
import type { IModelClient, ChatMessage } from "../model/IModelClient"
import {
	formatContextPackPromptPreview,
	formatContextPackPromptSummary,
	listContextPackPreviewSelections,
	type ContextPackArtifact,
} from "../planning/ContextPacks"
import { formatRoleManualPrompt, type WorkerSpecializationId } from "../planning/RoleManuals"

interface ToolCall {
	tool: "write_file" | "read_file" | "run_command" | "done"
	input: Record<string, string>
}

type DirectFileEdit = {
	path: string
	content: string
}

type DirectEditPlan = {
	files: DirectFileEdit[]
	summary?: string
}

type ContextPackSelectedFileLike = {
	path: string
	reason: string
	preview: string
	previewBytes: number
	truncated: boolean
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

function normalizeRelPath(p: string): string {
	return p.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

export class BuilderAgent extends BaseAgent {
	private filesWritten: string[] = []
	private conversationHistory: ChatMessage[] = []
	private doneSignalReceived = false
	private dryRun: boolean
	private mode: "tool_calls" | "direct_files"
	private commitEnabled: boolean
	private allowedFiles: Set<string> | null
	private contextFiles: string[] | null
	private contextFilesProvided: boolean
	private contextPack: ContextPackArtifact | null
	private specializationId: WorkerSpecializationId | null
	private teamShapeSummary: string | null

	constructor(
		agentId: string,
		taskId: string,
		task: string,
		workspace: string,
		db: DatabaseService,
		modelClient: IModelClient,
		options: {
			dryRun?: boolean
			mode?: "tool_calls" | "direct_files"
			commitEnabled?: boolean
			allowedFiles?: string[]
			contextFiles?: string[]
			contextPackPath?: string
			specializationId?: WorkerSpecializationId | null
			teamShapeSummary?: string
		} = {},
	) {
		super(agentId, taskId, task, workspace, db, modelClient)
		this.dryRun = Boolean(options.dryRun)
		this.mode = this.dryRun ? "tool_calls" : (options.mode ?? "tool_calls")
		this.commitEnabled = options.commitEnabled !== false

		const allowed = Array.isArray(options.allowedFiles) ? options.allowedFiles.map((f) => normalizeRelPath(String(f))) : []
		this.allowedFiles = allowed.length > 0 ? new Set(allowed) : null

		const context = Array.isArray(options.contextFiles) ? options.contextFiles.map((f) => normalizeRelPath(String(f))) : []
		this.contextFiles = context.length > 0 ? context : null
		this.contextFilesProvided = Array.isArray(options.contextFiles)
		this.contextPack = null
		if (typeof options.contextPackPath === "string" && options.contextPackPath.trim()) {
			try {
				const raw = JSON.parse(fs.readFileSync(options.contextPackPath, "utf8")) as unknown
				const pack = asRecord(raw)
				const selectedFiles = Array.isArray(pack?.["selectedFiles"]) ? pack["selectedFiles"] : null
				if (pack?.["schemaVersion"] === 1 && selectedFiles) {
					this.contextPack = pack as unknown as ContextPackArtifact
				}
			} catch {
				this.contextPack = null
			}
		}
		this.specializationId = options.specializationId ?? null
		this.teamShapeSummary = typeof options.teamShapeSummary === "string" && options.teamShapeSummary.trim()
			? options.teamShapeSummary.trim()
			: null
	}

	private getContextPackSelections(allWorkspaceSet: Set<string>, role: "builder" | "planner" | "critic" | "reviewer" = "builder"): ContextPackSelectedFileLike[] {
		if (!this.contextPack) return []
		const selectedFiles = listContextPackPreviewSelections(this.contextPack, role, 4)
		return selectedFiles
			.filter((entry) => {
				return (
					typeof entry?.path === "string" &&
					entry.path.trim().length > 0 &&
					typeof entry?.reason === "string" &&
					typeof entry?.preview === "string" &&
					allWorkspaceSet.has(normalizeRelPath(entry.path))
				)
			})
			.map((entry) => ({
				path: normalizeRelPath(entry.path),
				reason: entry.reason,
				preview: entry.preview,
				previewBytes: entry.previewBytes,
				truncated: entry.truncated === true,
			}))
	}

	async executeIteration(): Promise<"continue" | "done" | "error"> {
		if (this.doneSignalReceived) return "done"

		this.sendHeartbeat()

		if (this.mode === "direct_files") {
			if (this.conversationHistory.length === 0) {
				this.conversationHistory = this.buildDirectEditMessages()
			}

			let plan: DirectEditPlan | null = null
			try {
				plan = await this.callModelForDirectEditsWithJsonRetry(this.conversationHistory)
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err)
				this.setLastErrorReason(reason)
				console.error(`[${this.agentId}] Model call failed: ${reason}`)
				return "error"
			}

			if (!plan || plan.files.length === 0) {
				const summary = plan?.summary?.trim() || ""
				console.log(
					`[${this.agentId}] No file edits returned${summary ? `: ${summary}` : ""} â€” treating as no-op`,
				)
				await this.finalize()
				this.doneSignalReceived = true
				return "done"
			}

			try {
				await this.applyDirectEdits(plan.files)
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err)
				this.setLastErrorReason(reason)
				console.error(`[${this.agentId}] Apply edits failed: ${reason}`)
				return "error"
			}

			await this.finalize()
			this.doneSignalReceived = true
			return "done"
		}

		if (this.conversationHistory.length === 0) {
			this.conversationHistory = this.buildInitialMessages()
		}

		let rawResponse: ToolCall | null = null
		try {
			rawResponse = await this.callModelWithJsonRetry(this.conversationHistory)
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err)
			this.setLastErrorReason(reason)
			console.error(`[${this.agentId}] Model call failed: ${reason}`)
			return "error"
		}
		if (!rawResponse) {
			this.setLastErrorReason("Model returned non-JSON after 3 retries")
			console.error(`[${this.agentId}] Model returned non-JSON after 3 retries`)
			return "error"
		}

		this.conversationHistory.push({ role: "assistant", content: JSON.stringify(rawResponse) })

		const toolCall = rawResponse as ToolCall
		console.log(`[${this.agentId}] Tool: ${toolCall.tool}`)

		if (toolCall.tool === "done") {
			await this.finalize()
			this.doneSignalReceived = true
			return "done"
		}

		let toolResult = ""
		try {
			toolResult = await this.executeTool(toolCall)
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err)
			this.setLastErrorReason(reason)
			console.error(`[${this.agentId}] Tool execution failed: ${reason}`)
			return "error"
		}
		this.conversationHistory.push({
			role: "user",
			content: `Tool result for ${toolCall.tool}: ${toolResult}`,
		})

		return "continue"
	}

	private buildDirectEditMessages(): ChatMessage[] {
		const allWorkspaceFiles = this.listWorkspaceFiles().map((f) => normalizeRelPath(f))
		const allWorkspaceSet = new Set(allWorkspaceFiles)
		const promptFiles = this.getPromptFileList().map((f) => normalizeRelPath(f))
		const contextPackSelections = this.getContextPackSelections(allWorkspaceSet, "builder")

		const editableFiles = this.allowedFiles && this.allowedFiles.size > 0 ? Array.from(this.allowedFiles) : allWorkspaceFiles

		const contextFiles = (() => {
			if (contextPackSelections.length > 0) {
				return contextPackSelections.map((entry) => entry.path)
			}
			if (this.contextFilesProvided) {
				return (this.contextFiles ?? []).filter((f) => allWorkspaceSet.has(f))
			}
			if (this.allowedFiles && this.allowedFiles.size > 0) {
				return Array.from(this.allowedFiles).filter((f) => allWorkspaceSet.has(f))
			}
			return allWorkspaceFiles
		})()

		const maxCharsPerFile = 20_000
		const filesText = contextPackSelections.length > 0
			? contextPackSelections
					.map((selection) => `--- ${selection.path} (${selection.reason}${selection.truncated ? ", truncated" : ""}) ---\n${selection.preview}`)
					.join("\n\n")
			: contextFiles
					.map((relativePath) => {
						const filePath = path.resolve(this.workspace, relativePath)
						WorkspaceLock.validatePath(filePath)
						let content = ""
						try {
							content = fs.readFileSync(filePath, "utf-8")
						} catch (err) {
							content = `(unreadable) ${err instanceof Error ? err.message : String(err)}`
						}
						if (content.length > maxCharsPerFile) content = content.slice(0, maxCharsPerFile) + "\n...(truncated)...\n"
						return `--- ${relativePath} ---\n${content}`
					})
					.join("\n\n")

		return [
			{
				role: "system",
				content:
					`${formatRoleManualPrompt("builder", {
						specializationId: this.specializationId,
						teamShapeSummary: this.teamShapeSummary,
					})}\n\n` +
					"You edit files by returning a single JSON object and nothing else.\n" +
					"Do not output a plan. Do not output markdown. Do not wrap in code fences.\n\n" +
					'Output schema:\n{"files":[{"path":"relative/path.ts","content":"FULL new file contents"}],"summary":"optional"}\n\n' +
					"Rules:\n" +
					"- Only include files that need changes.\n" +
					"- For each file you include, provide the FULL updated file contents.\n" +
					`- Only edit these files: ${editableFiles.join(", ") || "(any workspace file)"}\n` +
					"- If the task or bounded contract names an exact sentence, comment, or property, copy that literal text verbatim into the correct editable file.\n" +
					"- You may reference context files, but do NOT output edits for non-editable files.\n" +
					"- Paths must be relative.\n" +
					"- Keep changes minimal and focused on the task.\n",
			},
			{
				role: "user",
				content:
					`Task: ${this.task}\n\n` +
					`Editable files:\n${editableFiles.join(", ") || "(any)"}\n\n` +
					`Workspace files:\n${promptFiles.join(", ") || "(none)"}\n\n` +
					`Context files included:\n${contextFiles.join(", ") || "(none)"}\n\n` +
					(this.contextPack ? `Context pack summary:\n${formatContextPackPromptSummary(this.contextPack, "builder")}\n\n` : "") +
					`Current contents:\n${filesText}`,
			},
		]
	}

	private async callModelForDirectEditsWithJsonRetry(messages: ChatMessage[]): Promise<DirectEditPlan | null> {
		const correctionPrompt =
			"INVALID OUTPUT.\n" +
			"Respond with EXACTLY ONE JSON object matching the schema. No plan, no markdown, no code fences.\n" +
			'Schema: {"files":[{"path":"relative/path.ts","content":"FULL new file contents"}],"summary":"optional"}'

		for (let attempt = 1; attempt <= 3; attempt++) {
			const messagesToSend = attempt === 1 ? messages : [...messages, { role: "user" as const, content: correctionPrompt }]

			const raw = await this.modelClient.chat(messagesToSend)

			try {
				const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
				const extracted = tryExtractFirstJsonObject(cleaned) ?? cleaned
				const parsed = JSON.parse(extracted) as unknown
				const obj = asRecord(parsed)
				if (!obj) throw new Error("Expected JSON object")

				const filesRaw = obj["files"]
				if (!Array.isArray(filesRaw)) throw new Error("Missing/invalid `files` array")

				const files: DirectFileEdit[] = []
				for (const entry of filesRaw) {
					const fileObj = asRecord(entry)
					if (!fileObj) continue
					const pathRaw = fileObj["path"]
					const contentRaw = fileObj["content"]
					if (typeof pathRaw !== "string" || typeof contentRaw !== "string") continue
					files.push({ path: pathRaw, content: contentRaw })
				}

				if (filesRaw.length > 0 && files.length === 0) {
					throw new Error("Invalid file entries in `files` array (expected {path:string, content:string})")
				}

				const summaryRaw = obj["summary"]
				const summary = typeof summaryRaw === "string" ? summaryRaw : undefined

				return { files, summary }
			} catch {
				console.warn(`[${this.agentId}] Attempt ${attempt}: model returned non-JSON: ${raw.slice(0, 100)}`)
			}
		}

		return null
	}

	private async applyDirectEdits(files: DirectFileEdit[]): Promise<void> {
		for (const edit of files) {
			const relativePath = String(edit.path ?? "").trim()
			if (!relativePath || relativePath === "." || relativePath === "..") throw new Error("Invalid path in direct edit plan")
			if (path.isAbsolute(relativePath)) throw new Error(`Absolute paths are not allowed: ${relativePath}`)

			if (!this.isPathAllowed(relativePath)) {
				throw new Error(`Blocked path (not in allowed file list): ${relativePath}`)
			}

			const segments = relativePath.split(/[\\/]/g).filter(Boolean)
			if (segments.some((s) => s === "..")) throw new Error(`Parent segments are not allowed: ${relativePath}`)
			if (segments[0] === ".git" || segments[0] === ".swarm") throw new Error(`Blocked path: ${relativePath}`)

			const filePath = path.resolve(this.workspace, relativePath)
			WorkspaceLock.validatePath(filePath)

			if (this.dryRun) {
				console.log(`[${this.agentId}] DRY RUN: would write ${relativePath}`)
				continue
			}

			const dir = path.dirname(filePath)
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
			fs.writeFileSync(filePath, edit.content, "utf-8")
			this.filesWritten.push(normalizeRelPath(relativePath))
			console.log(`[${this.agentId}] Wrote: ${relativePath}`)
		}
	}

	private buildInitialMessages(): ChatMessage[] {
		const workspaceFiles = this.getPromptFileList()
		const contextPackSummary = this.contextPack ? formatContextPackPromptSummary(this.contextPack, "builder") : ""
		const contextPackPreview = this.contextPack ? formatContextPackPromptPreview(this.contextPack, "builder") : ""
		return [
			{
				role: "system",
				content:
					`${formatRoleManualPrompt("builder", {
						specializationId: this.specializationId,
						teamShapeSummary: this.teamShapeSummary,
					})}\n\n` +
					"You must respond with EXACTLY ONE JSON object and nothing else.\n" +
					"Do not output a plan. Do not output markdown. Do not wrap in code fences.\n" +
					"Do NOT call/invoke any tools directly (even if your environment supports tool calling). " +
					"Only emit the JSON; the host program will execute it.\n\n" +
					'Schema (choose one):\n' +
					'- {"tool":"read_file","input":{"path":"relative/path/to/file"}}\n' +
					'- {"tool":"write_file","input":{"path":"relative/path/to/file","content":"file content here"}}\n' +
					'- {"tool":"run_command","input":{"command":"npm test"}}\n' +
					'- {"tool":"done","input":{}}\n\n' +
					"Rules:\n" +
					"- Always read_file before write_file for any file you will modify.\n" +
					"- If the task or bounded contract names an exact sentence, comment, or property, copy that literal text verbatim into the correct editable file.\n" +
					'- When the task is complete, respond with {"tool":"done","input":{}}.\n\n' +
					`Workspace files: ${workspaceFiles.join(", ")}`,
			},
			{
				role: "user",
				content:
					`Task: ${this.task}\n\n` +
					(contextPackSummary ? `Context pack:\n${contextPackSummary}\n\n` : "") +
					(contextPackPreview ? `Context previews:\n${contextPackPreview}\n\n` : ""),
			},
		]
	}

	private getPromptFileList(): string[] {
		if (this.allowedFiles && this.allowedFiles.size > 0) return Array.from(this.allowedFiles)
		return this.listWorkspaceFiles()
	}

	private isPathAllowed(relativePath: string): boolean {
		if (!this.allowedFiles) return true
		return this.allowedFiles.has(normalizeRelPath(relativePath))
	}

	private async callModelWithJsonRetry(messages: ChatMessage[]): Promise<ToolCall | null> {
		const correctionPrompt =
			"INVALID OUTPUT.\n" +
			"Respond with EXACTLY ONE JSON object matching the schema. No plan, no markdown, no code fences.\n" +
			"Do NOT call any tools; only output the JSON object."

		for (let attempt = 1; attempt <= 3; attempt++) {
			const messagesToSend = attempt === 1 ? messages : [...messages, { role: "user" as const, content: correctionPrompt }]

			const raw = await this.modelClient.chat(messagesToSend)

			try {
				const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
				const extracted = tryExtractFirstJsonObject(cleaned) ?? cleaned
				const parsed = JSON.parse(extracted) as ToolCall
				if (!parsed.tool) throw new Error("Missing tool field")
				return parsed
			} catch {
				console.warn(`[${this.agentId}] Attempt ${attempt}: model returned non-JSON: ${raw.slice(0, 100)}`)
			}
		}

		return null
	}

	private async executeTool(toolCall: ToolCall): Promise<string> {
		const { tool, input } = toolCall

		if (tool === "read_file") {
			const relativePath = String(input["path"] ?? "").trim()
			if (!relativePath || relativePath === "." || relativePath === "..") {
				return "Invalid path: read_file requires a file path (not empty, '.', or '..')"
			}

			const filePath = path.resolve(this.workspace, relativePath)
			WorkspaceLock.validatePath(filePath)

			try {
				const stat = fs.statSync(filePath)
				if (!stat.isFile()) return `Not a file: ${relativePath}`
			} catch (err) {
				return `Read failed: ${err instanceof Error ? err.message : String(err)}`
			}

			try {
				return fs.readFileSync(filePath, "utf-8")
			} catch (err) {
				return `Read failed: ${err instanceof Error ? err.message : String(err)}`
			}
		}

		if (tool === "write_file") {
			const relativePath = String(input["path"] ?? "").trim()
			if (!relativePath || relativePath === "." || relativePath === "..") {
				return "Invalid path: write_file requires a file path (not empty, '.', or '..')"
			}

			if (!this.isPathAllowed(relativePath)) {
				return `Blocked path (not in allowed file list): ${relativePath}`
			}
			const filePath = path.resolve(this.workspace, relativePath)
			WorkspaceLock.validatePath(filePath)

			if (this.dryRun) {
				console.log(`[${this.agentId}] DRY RUN: would write ${relativePath}`)
				return `DRY RUN: would write ${relativePath}`
			}

			const dir = path.dirname(filePath)
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
			fs.writeFileSync(filePath, String(input["content"] ?? ""))
			this.filesWritten.push(normalizeRelPath(relativePath))
			console.log(`[${this.agentId}] Wrote: ${relativePath}`)
			return `File written: ${relativePath}`
		}

		if (tool === "run_command") {
			const cmd = String(input["command"] ?? "")
			const validation = CommandGate.validate(cmd)
			if (!validation.allowed) return `Command blocked: ${validation.reason ?? "unknown"}`

			if (this.dryRun) {
				console.log(`[${this.agentId}] DRY RUN: would run ${cmd}`)
				return `DRY RUN: would run ${cmd}`
			}

			try {
				const { stdout, stderr } = await CommandGate.run(cmd, this.workspace, { timeoutMs: 30_000, maxOutputChars: 2_000 })
				return `${stdout}${stderr ? `\n${stderr}` : ""}`.trim().slice(0, 2_000)
			} catch (err) {
				return `Command failed: ${err instanceof Error ? err.message : String(err)}`
			}
		}

		return `Unknown tool: ${tool}`
	}

	private async runGit(args: string[]): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const child = spawn("git", ["-c", `safe.directory=${this.workspace}`, ...args], {
				cwd: this.workspace,
				windowsHide: true,
				stdio: "ignore",
			})

			child.once("error", reject)
			child.once("close", (code) => {
				if (code === 0) resolve()
				else reject(new Error(`git ${args.join(" ")} failed (exit ${code ?? "null"})`))
			})
		})
	}

	private async finalize(): Promise<void> {
		if (this.commitEnabled && !this.dryRun && this.filesWritten.length > 0) {
			try {
				await this.runGit(["add", "-A"])
				await this.runGit(["commit", "-m", `swarm: ${this.task.slice(0, 72)}`])
				console.log(`[${this.agentId}] Committed ${this.filesWritten.length} file(s)`)
			} catch (err) {
				console.warn(`[${this.agentId}] Git commit warning: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		await this.bus.send({
			from: this.agentId,
			to: "orchestrator",
			type: "worker_done",
			payload: {
				agentId: this.agentId,
				taskId: this.taskId,
				filesWritten: this.filesWritten,
				summary: `Completed: ${this.task}`,
			},
		})
	}

	private listWorkspaceFiles(): string[] {
		const ignore = ["node_modules", ".git", "dist", ".swarm"]
		const results: string[] = []

		const walk = (dir: string, depth: number) => {
			if (depth > 3) return
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (ignore.includes(entry.name)) continue
				const full = path.join(dir, entry.name)
				if (entry.isDirectory()) walk(full, depth + 1)
				else results.push(path.relative(this.workspace, full))
			}
		}

		walk(this.workspace, 0)
		return results
	}
}
