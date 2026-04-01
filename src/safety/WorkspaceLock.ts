import path from "path"

export class SecurityError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "SecurityError"
	}
}

export class WorkspaceLock {
	private static rootPath: string | null = null

	static setRoot(root: string): void {
		WorkspaceLock.rootPath = root
	}

	static validatePath(targetPath: string, rootOverride?: string): void {
		const root = rootOverride ?? WorkspaceLock.requireRoot()
		const normalizedRoot = path.normalize(root).toLowerCase()
		const normalizedTarget = path
			.normalize(path.isAbsolute(targetPath) ? targetPath : path.resolve(root, targetPath))
			.toLowerCase()

		if (!normalizedTarget.startsWith(normalizedRoot + path.sep) && normalizedTarget !== normalizedRoot) {
			console.warn(`[SECURITY] Path blocked - outside workspace: ${targetPath}`)
			throw new SecurityError(`[SECURITY] Path blocked - outside workspace: ${targetPath}`)
		}

		// Block protected directories by path segment (allow ".gitignore", "node_modules.txt", etc.)
		const rel = path.relative(normalizedRoot, normalizedTarget)
		const segments = rel
			.split(path.sep)
			.map((s) => s.trim())
			.filter(Boolean)

		if (segments.includes(".git") || segments.includes("node_modules")) {
			console.warn(`[SECURITY] Path blocked - protected directory: ${targetPath}`)
			throw new SecurityError(`[SECURITY] Path blocked - protected directory: ${targetPath}`)
		}
	}

	private static requireRoot(): string {
		if (!WorkspaceLock.rootPath) {
			throw new SecurityError("WorkspaceLock: root not set. Call WorkspaceLock.setRoot(workspace) first.")
		}
		return WorkspaceLock.rootPath
	}
}
