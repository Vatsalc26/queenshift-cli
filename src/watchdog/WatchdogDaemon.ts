import type { DatabaseService } from "../db/DatabaseService"
import { resolveRuntimeConfig } from "../run/RuntimeConfig"

type StaleAgentRow = {
	id: string
	role: string
	last_heartbeat: string | null
}

export class WatchdogDaemon {
	private db: DatabaseService
	private intervalHandle: NodeJS.Timeout | null = null
	private readonly staleThresholdMs: number
	private readonly checkIntervalMs: number

	constructor(db: DatabaseService, options: { staleThresholdMs?: number; checkIntervalMs?: number } = {}) {
		const runtimeConfig = resolveRuntimeConfig(process.env)
		this.db = db
		this.staleThresholdMs = options.staleThresholdMs ?? runtimeConfig.agentStaleThresholdMs
		this.checkIntervalMs = options.checkIntervalMs ?? runtimeConfig.watchdogCheckIntervalMs
	}

	start(): void {
		if (this.intervalHandle) return

		this.intervalHandle = setInterval(() => {
			try {
				this.check()
			} catch (err) {
				console.error(`[Watchdog] Failed to check agents: ${err instanceof Error ? err.message : String(err)}`)
			}
		}, this.checkIntervalMs)

		this.intervalHandle.unref()
	}

	stop(): void {
		if (!this.intervalHandle) return
		clearInterval(this.intervalHandle)
		this.intervalHandle = null
	}

	checkNow(): void {
		this.check()
	}

	private check(): void {
		const staleThreshold = new Date(Date.now() - this.staleThresholdMs).toISOString()

		const staleAgents = this.db.all<StaleAgentRow>(
			`SELECT id, role, last_heartbeat FROM agents
       WHERE status = 'running'
         AND last_heartbeat IS NOT NULL
         AND last_heartbeat < ?`,
			[staleThreshold],
		)

		for (const agent of staleAgents) {
			console.error(
				`[Watchdog] STALE agent detected: ${agent.id} (${agent.role}), last heartbeat: ${agent.last_heartbeat ?? "(null)"}`,
			)

			this.db.run("UPDATE agents SET status = 'failed' WHERE id = ?", [agent.id])

			this.db.run("INSERT INTO messages (from_agent, to_agent, type, payload) VALUES (?,?,?,?)", [
				"watchdog",
				"orchestrator",
				"error",
				JSON.stringify({
					agentId: agent.id,
					reason: "watchdog_stale_heartbeat",
					lastHeartbeat: agent.last_heartbeat,
				}),
			])
		}
	}
}
