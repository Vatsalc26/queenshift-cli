export interface ChatMessage {
	role: "system" | "user" | "assistant"
	content: string
}

export interface ModelCallOptions {
	maxTokens?: number
	temperature?: number
}

export interface IModelClient {
	chat(messages: ChatMessage[], options?: ModelCallOptions): Promise<string>
}

