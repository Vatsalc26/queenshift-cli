import { setTimeout as delay } from "timers/promises"

import type { DatabaseService } from "../db/DatabaseService"
import type { IncomingMessage, MessageType, OutgoingMessage } from "./MessageTypes"
import { validateIncomingMessage, validateOutgoingMessage } from "./MessageTypes"

type MessageRow = {
	id: number
	type: string
	from_agent: string
	to_agent: string
	payload: string
	created_at: string
	read: number
}

export class MessageBus {
	private static readonly FAILURE_THRESHOLD = 5
	private static readonly CIRCUIT_RESET_TIMEOUT_MS = 10_000
	private static readonly RETRY_ATTEMPTS = 3
	private static readonly RETRY_DELAY_MS = 50

	private db: DatabaseService
	private consecutiveFailures = 0
	private circuitOpen = false
	private circuitOpenedAt = 0

	constructor(db: DatabaseService) {
		this.db = db
	}

	async send(message: OutgoingMessage): Promise<void> {
		const valid = validateOutgoingMessage(message)
		await this.retry(() => {
			this.db.run("INSERT INTO messages (from_agent, to_agent, type, payload) VALUES (?,?,?,?)", [
				valid.from,
				valid.to,
				valid.type,
				JSON.stringify(valid.payload),
			])
		})
	}

	async readMessages(agentId: string, includeRead = false): Promise<IncomingMessage[]> {
		const rows = await this.retry(() => {
			if (includeRead) {
				return this.db.all<MessageRow>(
					"SELECT id,type,from_agent,to_agent,payload,created_at,read FROM messages WHERE to_agent = ? ORDER BY id ASC",
					[agentId],
				)
			}
			return this.db.all<MessageRow>(
				"SELECT id,type,from_agent,to_agent,payload,created_at,read FROM messages WHERE to_agent = ? AND read = 0 ORDER BY id ASC",
				[agentId],
			)
		})

		const messages: IncomingMessage[] = []
		for (const row of rows) {
			const payload = this.safeJsonParse(row.payload)
			if (!payload) continue
			try {
				messages.push(
					validateIncomingMessage({
						id: row.id,
						type: row.type as MessageType,
						from: row.from_agent,
						to: row.to_agent,
						payload,
						createdAt: row.created_at,
						read: Boolean(row.read),
					}),
				)
			} catch {
				// Drop invalid messages (strictness prevents silent wiring bugs)
				continue
			}
		}
		return messages
	}

	async markAsRead(messageId: number): Promise<void> {
		await this.retry(() => {
			this.db.run("UPDATE messages SET read = 1 WHERE id = ?", [messageId])
		})
	}

	private safeJsonParse(raw: string): Record<string, unknown> | null {
		try {
			return JSON.parse(raw) as Record<string, unknown>
		} catch {
			return null
		}
	}

	private checkCircuitBreaker(): void {
		if (this.circuitOpen) {
			if (Date.now() - this.circuitOpenedAt > MessageBus.CIRCUIT_RESET_TIMEOUT_MS) {
				this.circuitOpen = false
				this.consecutiveFailures = 0
			} else {
				throw new Error("MessageBus: circuit open")
			}
		}
	}

	private async retry<T>(fn: () => T): Promise<T> {
		for (let attempt = 1; attempt <= MessageBus.RETRY_ATTEMPTS; attempt++) {
			try {
				this.checkCircuitBreaker()
				const result = fn()
				this.consecutiveFailures = 0
				return result
			} catch (err) {
				this.consecutiveFailures++
				if (this.consecutiveFailures >= MessageBus.FAILURE_THRESHOLD) {
					this.circuitOpen = true
					this.circuitOpenedAt = Date.now()
				}
				if (attempt === MessageBus.RETRY_ATTEMPTS) throw err
				await delay(MessageBus.RETRY_DELAY_MS)
			}
		}
		throw new Error("MessageBus: unreachable retry state")
	}
}
