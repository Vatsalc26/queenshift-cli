import { DatabaseService } from "../db/DatabaseService"
import { MessageBus } from "../mail/MessageBus"
import type { IModelClient } from "../model/IModelClient"
import { appendRunEventFromEnv } from "../run/RunArtifacts"
import { resolveRuntimeConfig } from "../run/RuntimeConfig"

export abstract class BaseAgent {
	protected agentId: string
	protected taskId: string
	protected task: string
	protected workspace: string
	protected db: DatabaseService
	protected modelClient: IModelClient
	protected bus: MessageBus
	private aborted = false
	private lastErrorReason: string | null = null

	constructor(
		agentId: string,
		taskId: string,
		task: string,
		workspace: string,
		db: DatabaseService,
		modelClient: IModelClient,
	) {
		this.agentId = agentId
		this.taskId = taskId
		this.task = task
		this.workspace = workspace
		this.db = db
		this.modelClient = modelClient
		this.bus = new MessageBus(db)
	}

	abstract executeIteration(): Promise<"continue" | "done" | "error">

	protected setLastErrorReason(reason: string): void {
		this.lastErrorReason = reason.trim() || null
	}

	async runAutonomousLoop(): Promise<void> {
		this.updateStatus("running")
		console.log(`[${this.agentId}] Starting`)
		appendRunEventFromEnv({ type: "agent_start", agentId: this.agentId, taskId: this.taskId, role: this.detectRole() })
		const heartbeatIntervalMs = resolveRuntimeConfig(process.env).heartbeatIntervalMs
		const heartbeatTimer = setInterval(() => {
			try {
				this.sendHeartbeat()
			} catch {
				// ignore best-effort heartbeat failures
			}
		}, heartbeatIntervalMs)
		heartbeatTimer.unref?.()

		try {
			let iteration = 0
			const maxIterationsRaw =
				process.env["SWARM_AGENT_MAX_ITERATIONS"] ??
				(this.detectRole() === "builder" ? process.env["SWARM_BUILDER_MAX_ITERATIONS"] : undefined)
			const parsedMaxIterations = maxIterationsRaw ? Number.parseInt(maxIterationsRaw, 10) : NaN
			const MAX_ITERATIONS = Number.isFinite(parsedMaxIterations) && parsedMaxIterations > 0 ? parsedMaxIterations : 10

			while (!this.aborted && iteration < MAX_ITERATIONS) {
				iteration++
				console.log(`[${this.agentId}] Iteration ${iteration}`)
				appendRunEventFromEnv({
					type: "agent_iteration",
					agentId: this.agentId,
					taskId: this.taskId,
					role: this.detectRole(),
					iteration,
				})

				let result: "continue" | "done" | "error"
				try {
					result = await this.executeIteration()
				} catch (err) {
					const reason = err instanceof Error ? err.message : String(err)
					this.setLastErrorReason(reason)
					result = "error"
				}

				if (result === "done") {
					this.updateStatus("done")
					console.log(`[${this.agentId}] Done`)
					appendRunEventFromEnv({
						type: "agent_done",
						agentId: this.agentId,
						taskId: this.taskId,
						role: this.detectRole(),
						iteration,
					})
					return
				}

				if (result === "error") {
					this.updateStatus("failed")
					console.log(`[${this.agentId}] Failed`)
					const reason = this.lastErrorReason ?? "agent reported error"
					appendRunEventFromEnv({
						type: "agent_error",
						agentId: this.agentId,
						taskId: this.taskId,
						role: this.detectRole(),
						iteration,
						reason,
					})
					await this.bus.send({
						from: this.agentId,
						to: "orchestrator",
						type: "error",
						payload: { agentId: this.agentId, taskId: this.taskId, reason },
					})
					return
				}
			}

			this.updateStatus("failed")
			appendRunEventFromEnv({
				type: "agent_error",
				agentId: this.agentId,
				taskId: this.taskId,
				role: this.detectRole(),
				iteration: MAX_ITERATIONS,
				reason: "max_iterations_exceeded",
			})
			await this.bus.send({
				from: this.agentId,
				to: "orchestrator",
				type: "error",
				payload: { agentId: this.agentId, taskId: this.taskId, reason: "max_iterations_exceeded" },
			})
		} finally {
			clearInterval(heartbeatTimer)
		}
	}

	protected sendHeartbeat(): void {
		this.db.run("UPDATE agents SET last_heartbeat = ? WHERE id = ?", [new Date().toISOString(), this.agentId])
	}

	private updateStatus(status: string): void {
		this.db.run("UPDATE agents SET status = ?, last_heartbeat = ? WHERE id = ?", [
			status,
			new Date().toISOString(),
			this.agentId,
		])
	}

	private detectRole(): string {
		if (this.agentId.startsWith("builder")) return "builder"
		if (this.agentId.startsWith("reviewer")) return "reviewer"
		if (this.agentId.startsWith("merger")) return "merger"
		if (this.agentId.startsWith("watchdog")) return "watchdog"
		return "agent"
	}
}
