export const MESSAGE_TYPES = ["dispatch", "review_request", "verdict", "worker_done", "error", "status"] as const

export type MessageType = (typeof MESSAGE_TYPES)[number]

export function isMessageType(value: string): value is MessageType {
	return (MESSAGE_TYPES as readonly string[]).includes(value)
}

export type MessagePayload = Record<string, unknown>

export type IncomingMessage = {
	id: number
	type: MessageType
	from: string
	to: string
	payload: MessagePayload
	createdAt: string
	read: boolean
}

export type OutgoingMessage = {
	type: MessageType
	from: string
	to: string
	payload: MessagePayload
}

function requireNonEmptyString(value: unknown, name: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`MessageTypes: ${name} must be a non-empty string`)
	}
	return value
}

function requirePayloadObject(payload: unknown): MessagePayload {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error("MessageTypes: payload must be a JSON object")
	}
	return payload as MessagePayload
}

export function validateOutgoingMessage(message: OutgoingMessage): OutgoingMessage {
	if (!isMessageType(message.type)) {
		throw new Error(`MessageTypes: unknown message type: ${String(message.type)}`)
	}

	return {
		type: message.type,
		from: requireNonEmptyString(message.from, "from"),
		to: requireNonEmptyString(message.to, "to"),
		payload: requirePayloadObject(message.payload),
	}
}

export function validateIncomingMessage(message: IncomingMessage): IncomingMessage {
	if (!Number.isFinite(message.id)) {
		throw new Error("MessageTypes: incoming id must be a number")
	}
	if (!isMessageType(message.type)) {
		throw new Error(`MessageTypes: unknown message type: ${String(message.type)}`)
	}
	if (typeof message.createdAt !== "string" || message.createdAt.trim().length === 0) {
		throw new Error("MessageTypes: createdAt must be a non-empty string")
	}

	return {
		id: message.id,
		type: message.type,
		from: requireNonEmptyString(message.from, "from"),
		to: requireNonEmptyString(message.to, "to"),
		payload: requirePayloadObject(message.payload),
		createdAt: message.createdAt,
		read: Boolean(message.read),
	}
}
