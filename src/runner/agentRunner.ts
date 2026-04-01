import process from "process"

import { DatabaseService } from "../db/DatabaseService"
import { MessageBus } from "../mail/MessageBus"
import type { IModelClient } from "../model/IModelClient"
import { StubModelClient } from "../model/StubModelClient"
import { TelemetryModelClient } from "../model/TelemetryModelClient"
import { createLiveModelClient } from "../model/createLiveModelClient"
import { WorkspaceLock } from "../safety/WorkspaceLock"
import { BuilderAgent } from "../agents/BuilderAgent"
import { ReviewerAgent } from "../agents/ReviewerAgent"
import { MergerAgent } from "../agents/MergerAgent"
import { GuardrailError } from "../run/RunGuardrails"
import type { WorkerSpecializationId } from "../planning/RoleManuals"

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const getArg = (name: string): string => {
		const idx = args.indexOf(`--${name}`)
		if (idx === -1 || !args[idx + 1]) throw new Error(`Missing required arg: --${name}`)
		return args[idx + 1] as string
	}

	const role = getArg("role")
	const agentId = getArg("agentId")
	const taskId = getArg("taskId")
	const task = getArg("task")
	const workspace = getArg("workspace")
	const dbPath = getArg("dbPath")
	const dryRun = args.includes("--dryRun") || args.includes("--dry-run")

	WorkspaceLock.setRoot(workspace)

	const db = DatabaseService.getInstance(dbPath)
	const runDir = (process.env["SWARM_RUN_ARTIFACT_DIR"] ?? "").trim()
	const maxCallsRaw = (process.env["SWARM_MAX_MODEL_CALLS"] ?? "").trim()
	const maxCalls = maxCallsRaw ? Number.parseInt(maxCallsRaw, 10) : NaN

	const liveClient = () => createLiveModelClient(process.env as Record<string, string | undefined>)
	const wrapClient = (client: IModelClient): IModelClient =>
		runDir
			? new TelemetryModelClient(client, {
					runDir,
					actor: agentId,
					maxCalls: Number.isFinite(maxCalls) && maxCalls > 0 ? maxCalls : undefined,
					maxEstimatedTokens: (() => {
						const raw = (process.env["SWARM_MAX_ESTIMATED_TOKENS"] ?? "").trim()
						const parsed = raw ? Number.parseInt(raw, 10) : NaN
						return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
					})(),
					db,
					taskId,
			  })
			: client

	if (role === "builder") {
		const provider = (process.env["SWARM_PROVIDER"] ?? "").trim().toLowerCase()
		const geminiAuth = (process.env["SWARM_GEMINI_AUTH"] ?? "auto").trim().toLowerCase()

		// Gemini CLI runs an agent that may try to execute tool calls itself. For that path, we use a
		// tool-less JSON "direct file edits" protocol instead of the iterative tool-call loop.
		const mode =
			!dryRun && provider === "gemini" && geminiAuth === "cli" ? ("direct_files" as const) : ("tool_calls" as const)

		const noCommitRaw = (process.env["SWARM_BUILDER_NO_COMMIT"] ?? "").trim().toLowerCase()
		const commitEnabled = !(noCommitRaw === "1" || noCommitRaw === "true" || noCommitRaw === "yes")

		const allowedFilesJson = (process.env["SWARM_BUILDER_ALLOWED_FILES_JSON"] ?? "").trim()
		let allowedFiles: string[] | undefined = undefined
		if (allowedFilesJson) {
			try {
				const parsed = JSON.parse(allowedFilesJson) as unknown
				if (Array.isArray(parsed)) {
					allowedFiles = parsed.filter((f) => typeof f === "string" && f.trim()).map((f) => String(f))
				}
			} catch {
				// ignore malformed override
			}
		}

		const contextFilesJson = (process.env["SWARM_BUILDER_CONTEXT_FILES_JSON"] ?? "").trim()
		let contextFiles: string[] | undefined = undefined
		if (contextFilesJson) {
			try {
				const parsed = JSON.parse(contextFilesJson) as unknown
				if (Array.isArray(parsed)) {
					contextFiles = parsed.filter((f) => typeof f === "string" && f.trim()).map((f) => String(f))
				}
			} catch {
				// ignore malformed override
			}
		}
		const contextPackPath = (process.env["SWARM_BUILDER_CONTEXT_PACK_PATH"] ?? "").trim() || undefined
		const specializationRaw = (process.env["SWARM_BUILDER_SPECIALIZATION_ID"] ?? "").trim()
		const specializationId = specializationRaw ? (specializationRaw as WorkerSpecializationId) : null
		const teamShapeSummary = (process.env["SWARM_BUILDER_TEAM_SHAPE_SUMMARY"] ?? "").trim() || undefined

		const modelClient: IModelClient = wrapClient(dryRun ? new StubModelClient(["builder_simple", "builder_done"]) : liveClient())
		const agent = new BuilderAgent(agentId, taskId, task, workspace, db, modelClient, {
			dryRun,
			mode,
			commitEnabled,
			allowedFiles,
			contextFiles,
			contextPackPath,
			specializationId,
			teamShapeSummary,
		})
		await agent.runAutonomousLoop()
	} else if (role === "reviewer") {
		const modelClient: IModelClient = wrapClient(dryRun ? new StubModelClient(["reviewer_pass"]) : liveClient())
		const agent = new ReviewerAgent(agentId, taskId, task, workspace, db, modelClient)
		await agent.runAutonomousLoop()
	} else if (role === "merger") {
		const branchesJson = getArg("branchesJson")
		let branches: string[] = []
		try {
			const parsed = JSON.parse(branchesJson) as unknown
			if (!Array.isArray(parsed)) throw new Error("branchesJson must be a JSON array")
			branches = parsed.filter((b) => typeof b === "string" && b.trim()).map((b) => String(b))
		} catch (err) {
			throw new Error(`Invalid --branchesJson: ${err instanceof Error ? err.message : String(err)}`)
		}

		const modelClient: IModelClient = wrapClient(dryRun ? new StubModelClient(["reviewer_pass"]) : liveClient())
		const agent = new MergerAgent(agentId, taskId, task, workspace, branches, db, modelClient)
		await agent.runAutonomousLoop()
	} else {
		throw new Error(`Unknown role: ${role}`)
	}

	db.close()
}

main().catch(async (err) => {
	const message = err instanceof Error ? err.message : String(err)
	console.error(`[agentRunner] Fatal: ${message}`)

	const args = process.argv.slice(2)
	const readArg = (name: string): string | null => {
		const idx = args.indexOf(`--${name}`)
		return idx >= 0 && args[idx + 1] ? String(args[idx + 1]) : null
	}

	const dbPath = readArg("dbPath")
	const agentId = readArg("agentId")
	const taskId = readArg("taskId")

	if (dbPath && agentId && taskId) {
		try {
			DatabaseService.reset()
			const db = DatabaseService.getInstance(dbPath)
			const bus = new MessageBus(db)
			const reason =
				err instanceof GuardrailError ? `${err.code}: ${err.message}` : message
			await bus.send({
				from: agentId,
				to: "orchestrator",
				type: "error",
				payload: {
					agentId,
					taskId,
					reason,
				},
			})
			db.close()
			DatabaseService.reset()
		} catch {
			// ignore best-effort reporting failure
		}
	}

	process.exit(1)
})
