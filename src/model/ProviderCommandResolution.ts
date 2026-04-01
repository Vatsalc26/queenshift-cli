import fs from "node:fs"
import path from "node:path"

export function resolveExecutable(command: string, env: Record<string, string | undefined>): string | null {
	const trimmed = command.trim()
	if (!trimmed) return null

	const hasPath = /[\\/]/.test(trimmed)
	if (hasPath) return fs.existsSync(trimmed) ? trimmed : null

	const pathVar = env["PATH"] ?? ""
	const dirs = pathVar.split(path.delimiter).filter(Boolean)

	const candidates = (() => {
		if (process.platform !== "win32") return [trimmed]

		if (path.extname(trimmed)) return [trimmed]

		const pathext = env["PATHEXT"] || ".COM;.EXE;.BAT;.CMD"
		const exts = pathext
			.split(";")
			.map((entry) => entry.trim())
			.filter(Boolean)
			.map((entry) => (entry.startsWith(".") ? entry : `.${entry}`))

		return exts.map((ext) => `${trimmed}${ext}`)
	})()

	for (const dir of dirs) {
		for (const name of candidates) {
			const full = path.join(dir, name)
			try {
				if (fs.existsSync(full)) return full
			} catch {
				// ignore unreadable directories while scanning PATH
			}
		}
	}

	return null
}

export function resolveGeminiCliCommand(
	env: Record<string, string | undefined>,
): { requested: string; resolved: string | null } {
	const requested = (env["GEMINI_CLI_COMMAND"] ?? "gemini").trim() || "gemini"
	return {
		requested,
		resolved: resolveExecutable(requested, env),
	}
}
