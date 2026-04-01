import { setTimeout as delay } from "timers/promises"

import { BaseAgent } from "./BaseAgent"
import type { ChatMessage } from "../model/IModelClient"
import { formatRoleManualPrompt } from "../planning/RoleManuals"

type VerdictIssue = {
	severity: "low" | "medium" | "high"
	description: string
}

type Verdict = {
	verdict: "PASS" | "NEEDS_WORK"
	summary: string
	issues: VerdictIssue[]
	reviewOutputValid: boolean
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

function parseVerdict(raw: string): Verdict {
	const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
	const extracted = tryExtractFirstJsonObject(cleaned) ?? cleaned

	const parsed = JSON.parse(extracted) as unknown
	const obj = asRecord(parsed)
	if (!obj) throw new Error("Reviewer verdict must be a JSON object")

	const verdictRaw = obj["verdict"]
	const verdict = verdictRaw === "PASS" || verdictRaw === "NEEDS_WORK" ? verdictRaw : null
	if (!verdict) throw new Error("Reviewer verdict missing/invalid `verdict` (PASS | NEEDS_WORK)")

	const summaryRaw = obj["summary"]
	const summary = typeof summaryRaw === "string" ? summaryRaw : ""

	const issues: VerdictIssue[] = []
	const issuesRaw = obj["issues"]
	if (Array.isArray(issuesRaw)) {
		for (const issue of issuesRaw) {
			const issueObj = asRecord(issue)
			if (!issueObj) continue
			const severity = issueObj["severity"]
			const description = issueObj["description"]
			if ((severity === "low" || severity === "medium" || severity === "high") && typeof description === "string") {
				issues.push({ severity, description })
			}
		}
	}

	return { verdict, summary, issues, reviewOutputValid: true }
}

export class ReviewerAgent extends BaseAgent {
	private reviewed = false

	async executeIteration(): Promise<"continue" | "done" | "error"> {
		if (this.reviewed) return "done"

		this.sendHeartbeat()

		const inbox = await this.bus.readMessages(this.agentId, false)
		const request = inbox.find((m) => m.type === "review_request")
		if (!request) {
			await delay(250)
			return "continue"
		}

		await this.bus.markAsRead(request.id)

		const payload = request.payload
		const payloadTaskId = typeof payload["taskId"] === "string" ? payload["taskId"] : ""
		const taskId = payloadTaskId && payloadTaskId === this.taskId ? payloadTaskId : this.taskId

		const taskDescription = typeof payload["taskDescription"] === "string" ? payload["taskDescription"] : this.task
		const filesWritten = Array.isArray(payload["filesWritten"])
			? (payload["filesWritten"].filter((f) => typeof f === "string") as string[])
			: []
		const contextSummary = typeof payload["contextSummary"] === "string" ? payload["contextSummary"].trim() : ""

		const fileDiffs: Record<string, string> = {}
		const diffsObj = asRecord(payload["fileDiffs"]) ?? {}
		for (const [key, value] of Object.entries(diffsObj)) {
			if (typeof value === "string") fileDiffs[key] = value
		}

		const diffsText = Object.entries(fileDiffs)
			.map(([file, diff]) => `--- ${file} ---\n${diff}`)
			.join("\n\n")

		const messages: ChatMessage[] = [
			{
				role: "system",
				content:
					`${formatRoleManualPrompt("reviewer")}\n\n` +
					"You are a strict code reviewer.\n" +
					"Return ONLY valid JSON. No prose, no markdown.\n\n" +
					'Format: {"verdict":"PASS"|"NEEDS_WORK","summary":"...","issues":[{"severity":"low"|"medium"|"high","description":"..."}]}\n\n' +
					"Rules:\n" +
					"- PASS if changes satisfy the task and look correct overall, even if there are minor low-severity style issues.\n" +
					"- NEEDS_WORK only if there is a substantive correctness, completeness, safety, or medium/high-severity problem.\n" +
					"- Keep summary/issues short and specific.\n",
			},
			{
				role: "user",
				content:
					`Task: ${taskDescription}\n\n` +
					`Files changed: ${filesWritten.join(", ") || "(none)"}\n\n` +
					(contextSummary ? `Reviewer context:\n${contextSummary}\n\n` : "") +
					`Diffs:\n${diffsText || "(no diffs provided)"}`,
			},
		]

		const raw = await this.modelClient.chat(messages, { temperature: 0, maxTokens: 800 })

		let verdict: Verdict
		try {
			verdict = parseVerdict(raw)
		} catch {
			verdict = {
				verdict: "NEEDS_WORK",
				summary: "Review output was invalid or unreadable; blocking automatic completion.",
				issues: [{ severity: "high", description: "Reviewer model returned invalid JSON." }],
				reviewOutputValid: false,
			}
		}

		await this.bus.send({
			from: this.agentId,
			to: "orchestrator",
			type: "verdict",
			payload: {
				agentId: this.agentId,
				taskId,
				verdict: verdict.verdict,
				summary: verdict.summary,
				issues: verdict.issues,
				reviewOutputValid: verdict.reviewOutputValid,
			},
		})

		this.reviewed = true
		return "done"
	}
}
