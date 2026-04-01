import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type Env = Record<string, string | undefined>

type GeminiCliOauthCreds = {
	access_token?: unknown
	refresh_token?: unknown
	expiry_date?: unknown
	id_token?: unknown
	token_type?: unknown
	scope?: unknown
}

type TokenResponse = {
	access_token?: unknown
	expires_in?: unknown
	error?: unknown
	error_description?: unknown
}

function expandHomePath(rawPath: string): string {
	const trimmed = rawPath.trim()
	if (!trimmed) return ""
	if (trimmed === "~") return os.homedir()
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(os.homedir(), trimmed.slice(2))
	}
	return path.resolve(trimmed)
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function base64UrlDecodeToString(input: string): string {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/")
	const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
	return Buffer.from(padded, "base64").toString("utf8")
}

function tryExtractClientIdFromIdToken(idToken: string): string | null {
	const parts = idToken.split(".")
	if (parts.length < 2) return null

	try {
		const payloadJson = base64UrlDecodeToString(parts[1] ?? "")
		const payload = asRecord(JSON.parse(payloadJson) as unknown)
		if (!payload) return null

		const azp = payload["azp"]
		if (typeof azp === "string" && azp.trim()) return azp.trim()

		const aud = payload["aud"]
		if (typeof aud === "string" && aud.trim()) return aud.trim()
	} catch {
		// ignore
	}

	return null
}

function readCreds(filePath: string): GeminiCliOauthCreds {
	const text = fs.readFileSync(filePath, "utf8")
	const json = JSON.parse(text) as unknown
	const obj = asRecord(json)
	if (!obj) throw new Error("Gemini CLI OAuth creds JSON must be an object")
	return obj as GeminiCliOauthCreds
}

async function refreshAccessToken(options: {
	clientId: string
	clientSecret?: string
	refreshToken: string
}): Promise<{ token: string; expiresInSec: number }> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		client_id: options.clientId,
		refresh_token: options.refreshToken,
	})

	if (options.clientSecret) body.set("client_secret", options.clientSecret)

	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	})

	const rawText = await res.text().catch(() => "")
	let data: TokenResponse = {}
	try {
		data = JSON.parse(rawText) as TokenResponse
	} catch {
		// ignore
	}

	if (!res.ok) {
		const err = typeof data.error === "string" ? data.error : ""
		const desc = typeof data.error_description === "string" ? data.error_description : ""
		const details = [err, desc].filter(Boolean).join(": ") || rawText.slice(0, 400)
		throw new Error(`Gemini CLI OAuth refresh failed (HTTP ${res.status}): ${details || res.statusText}`)
	}

	const accessToken = typeof data.access_token === "string" ? data.access_token : ""
	const expiresIn = typeof data.expires_in === "number" ? data.expires_in : Number(data.expires_in)

	if (!accessToken) throw new Error("Gemini CLI OAuth refresh response missing access_token")
	if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("Gemini CLI OAuth refresh response missing expires_in")

	return { token: accessToken, expiresInSec: Math.floor(expiresIn) }
}

export type GeminiCliOauthAccessTokenProvider = {
	credsPath: string
	clientId: string
	getAccessToken: () => Promise<string>
}

export function tryCreateGeminiCliOauthAccessTokenProvider(
	env: Env,
	options: { required: true },
): GeminiCliOauthAccessTokenProvider
export function tryCreateGeminiCliOauthAccessTokenProvider(
	env: Env,
	options?: { required?: false | undefined },
): GeminiCliOauthAccessTokenProvider | null
export function tryCreateGeminiCliOauthAccessTokenProvider(
	env: Env,
	options: { required?: boolean } = {},
): GeminiCliOauthAccessTokenProvider | null {
	const required = Boolean(options.required)
	const resolvedPath = expandHomePath(env["GEMINI_CLI_OAUTH_PATH"] ?? "~/.gemini/oauth_creds.json")

	if (!resolvedPath || !fs.existsSync(resolvedPath)) {
		if (!required) return null
		throw new Error(
			`Gemini CLI OAuth credentials not found at ${resolvedPath}.\n` +
				`Ensure you have signed in once (Gemini CLI / Roo/Cline) or set GEMINI_CLI_OAUTH_PATH.`,
		)
	}

	const creds = readCreds(resolvedPath)
	const accessToken = typeof creds.access_token === "string" ? creds.access_token : ""
	const refreshToken = typeof creds.refresh_token === "string" ? creds.refresh_token : ""
	const expiryDate = typeof creds.expiry_date === "number" ? creds.expiry_date : Number(creds.expiry_date)
	const idToken = typeof creds.id_token === "string" ? creds.id_token : ""

	const envClientId = (env["GEMINI_CLI_CLIENT_ID"] ?? "").trim()
	const extractedClientId = idToken ? tryExtractClientIdFromIdToken(idToken) : null
	const clientId = envClientId || extractedClientId || ""

	if (!clientId) {
		throw new Error(
			"Gemini CLI OAuth is missing client id.\n" +
				"Set GEMINI_CLI_CLIENT_ID or re-login so oauth_creds.json contains an id_token.",
		)
	}

	if (!refreshToken) {
		throw new Error(
			"Gemini CLI OAuth is missing refresh_token.\n" +
				"Re-login so oauth_creds.json includes a refresh token (or use SWARM_GEMINI_AUTH=access_token).",
		)
	}

	let cachedToken = accessToken
	let cachedExpiresAtMs = Number.isFinite(expiryDate) ? expiryDate : 0
	let inFlight: Promise<string> | null = null

	const clientSecret = (env["GEMINI_CLI_CLIENT_SECRET"] ?? "").trim() || undefined

	const getAccessToken = async (): Promise<string> => {
		const now = Date.now()
		if (cachedToken && cachedExpiresAtMs && now < cachedExpiresAtMs - 60_000) return cachedToken
		if (inFlight) return inFlight

		inFlight = (async () => {
			const refreshed = await refreshAccessToken({ clientId, clientSecret, refreshToken })
			cachedToken = refreshed.token
			cachedExpiresAtMs = Date.now() + refreshed.expiresInSec * 1000
			return cachedToken
		})()

		try {
			return await inFlight
		} finally {
			inFlight = null
		}
	}

	return {
		credsPath: resolvedPath,
		clientId,
		getAccessToken,
	}
}
