import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

export const TEST_WORKSPACE_BASELINE: Record<string, string> = {
	".gitignore": `.swarm/
`,
	"hello.ts": `// updated by swarm
export function greet(name: string): string {
\treturn \`Hello, \${name}!\`
}
`,
	"utils.ts": `export function shout(input: string): string {
\treturn input.toUpperCase()
}
`,
	"package.json": `{
  "name": "swarmcoder-v2-test-workspace",
  "private": true,
  "type": "module",
  "devDependencies": {}
}
`,
}

function normalizeRelPath(p: string): string {
	return p.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function shouldSkipBuiltInWorkspaceRelativePath(relativePath: string): boolean {
	const normalized = normalizeRelPath(relativePath)
	if (!normalized) return false
	const topLevel = normalized.split("/")[0]
	return topLevel === ".git" || topLevel === ".swarm"
}

function buildVerificationGitEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		GIT_AUTHOR_NAME: process.env["GIT_AUTHOR_NAME"] ?? "SwarmCoder Verification",
		GIT_AUTHOR_EMAIL: process.env["GIT_AUTHOR_EMAIL"] ?? "verification@local",
		GIT_COMMITTER_NAME: process.env["GIT_COMMITTER_NAME"] ?? "SwarmCoder Verification",
		GIT_COMMITTER_EMAIL: process.env["GIT_COMMITTER_EMAIL"] ?? "verification@local",
	}
}

function removePathRobust(targetPath: string): void {
	if (!fs.existsSync(targetPath)) return
	try {
		fs.rmSync(targetPath, {
			recursive: true,
			force: true,
			maxRetries: 20,
			retryDelay: 100,
		})
	} catch {
		// Ignore best-effort cleanup failures on Windows temp dirs.
	}
}

function ensureVerificationTmpDir(cwd: string): string {
	const swarmDir = path.join(cwd, ".swarm")
	const tmpDir = path.join(swarmDir, "tmp")
	try {
		if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
	} catch {
		// ignore best-effort temp-dir creation failures
	}
	return tmpDir
}

function pruneWorkspaceToBaseline(workspace: string, allowedFiles: Set<string>, relativeDir = ""): void {
	const absoluteDir = path.join(workspace, relativeDir)
	if (!fs.existsSync(absoluteDir)) return

	for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
		if (!relativeDir && (entry.name === ".git" || entry.name === ".swarm")) continue

		const relativePath = normalizeRelPath(path.join(relativeDir, entry.name))
		const absolutePath = path.join(workspace, relativePath)

		if (entry.isDirectory()) {
			pruneWorkspaceToBaseline(workspace, allowedFiles, relativePath)
			try {
				if (fs.existsSync(absolutePath) && fs.readdirSync(absolutePath).length === 0) fs.rmdirSync(absolutePath)
			} catch {
				// ignore
			}
			continue
		}

		if (!allowedFiles.has(relativePath)) {
			try {
				fs.rmSync(absolutePath, { force: true })
			} catch {
				// ignore
			}
		}
	}
}

export function runVerificationGit(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const tmpDir = ensureVerificationTmpDir(cwd)
		const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
		const stdoutPath = path.join(tmpDir, `git-${stamp}.stdout.log`)
		const stderrPath = path.join(tmpDir, `git-${stamp}.stderr.log`)
		const stdoutFd = fs.openSync(stdoutPath, "w")
		const stderrFd = fs.openSync(stderrPath, "w")
		const readFile = (filePath: string): string => {
			try {
				return fs.readFileSync(filePath, "utf8")
			} catch {
				return ""
			}
		}
		const cleanup = () => {
			try {
				fs.closeSync(stdoutFd)
			} catch {
				// ignore
			}
			try {
				fs.closeSync(stderrFd)
			} catch {
				// ignore
			}
			try {
				fs.unlinkSync(stdoutPath)
			} catch {
				// ignore
			}
			try {
				fs.unlinkSync(stderrPath)
			} catch {
				// ignore
			}
		}

		const child = spawn("git", ["-c", `safe.directory=${cwd}`, ...args], {
			cwd,
			windowsHide: true,
			// Avoid stdio pipes because some sandboxed Windows runs reject them with EPERM.
			stdio: ["ignore", stdoutFd, stderrFd],
		})

		child.once("error", (err) => {
			cleanup()
			reject(err)
		})
		child.once("close", (code) => {
			const stdout = readFile(stdoutPath)
			const stderr = readFile(stderrPath)
			cleanup()
			if (code === 0) resolve(stdout)
			else reject(new Error(`git ${args.join(" ")} failed (exit ${code ?? "null"})\n${stderr || stdout}`.trim()))
		})
	})
}

export function copyBuiltInTestWorkspace(rootDir: string, destinationPath: string): void {
	const sourcePath = path.join(rootDir, "verification", "test_workspace")
	fs.cpSync(sourcePath, destinationPath, {
		recursive: true,
		force: true,
		filter: (currentSourcePath) => !shouldSkipBuiltInWorkspaceRelativePath(path.relative(sourcePath, currentSourcePath)),
	})
}

export async function createTempTestRepoCopy(
	rootDir: string,
	label: string,
	prefix = ".tmp",
): Promise<{ repoPath: string; cleanup: () => void }> {
	const repoPath = path.join(rootDir, "verification", `${prefix}-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	copyBuiltInTestWorkspace(rootDir, repoPath)
	removePathRobust(path.join(repoPath, ".swarm"))
	removePathRobust(path.join(repoPath, ".git"))

	try {
		await runVerificationGit(repoPath, ["init"])
		await runVerificationGit(repoPath, ["config", "user.name", buildVerificationGitEnv()["GIT_AUTHOR_NAME"] ?? "SwarmCoder Verification"])
		await runVerificationGit(repoPath, ["config", "user.email", buildVerificationGitEnv()["GIT_AUTHOR_EMAIL"] ?? "verification@local"])
		await runVerificationGit(repoPath, ["add", "-A"])
		await runVerificationGit(repoPath, ["commit", "-m", "verification baseline"])
	} catch (error) {
		removePathRobust(repoPath)
		throw error
	}

	return {
		repoPath,
		cleanup: () => {
			removePathRobust(repoPath)
		},
	}
}

export async function resetBuiltInTestWorkspace(rootDir: string): Promise<string> {
	const workspace = path.join(rootDir, "verification", "test_workspace")
	const verificationDir = path.join(rootDir, "verification")
	const swarmDir = path.join(workspace, ".swarm")
	const worktreeRoot = path.join(verificationDir, ".swarm-worktrees")
	const gitDir = path.join(workspace, ".git")
	const allowedFiles = new Set(Object.keys(TEST_WORKSPACE_BASELINE).map((relativePath) => normalizeRelPath(relativePath)))

	pruneWorkspaceToBaseline(workspace, allowedFiles)

	for (const [relativePath, content] of Object.entries(TEST_WORKSPACE_BASELINE)) {
		const absolutePath = path.join(workspace, relativePath)
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
		fs.writeFileSync(absolutePath, content, "utf8")
	}

	try {
		removePathRobust(swarmDir)
	} catch {
		// ignore
	}
	try {
		removePathRobust(worktreeRoot)
	} catch {
		// ignore
	}

	if (!fs.existsSync(gitDir)) {
		await runVerificationGit(workspace, ["init"])
		await runVerificationGit(workspace, ["config", "user.name", buildVerificationGitEnv()["GIT_AUTHOR_NAME"] ?? "SwarmCoder Verification"])
		await runVerificationGit(workspace, ["config", "user.email", buildVerificationGitEnv()["GIT_AUTHOR_EMAIL"] ?? "verification@local"])
	}

	try {
		await runVerificationGit(workspace, ["worktree", "prune"])
	} catch {
		// ignore
	}

	try {
		const branchesRaw = await runVerificationGit(workspace, ["branch", "--list", "swarm/*"])
		const branches = branchesRaw
			.split(/\r?\n/g)
			.map((line) => line.replace(/^\*/, "").trim())
			.filter(Boolean)
		for (const branch of branches) {
			try {
				await runVerificationGit(workspace, ["branch", "-D", branch])
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}

	try {
		const statusRaw = await runVerificationGit(workspace, ["status", "--porcelain", "--untracked-files=all"])
		if (statusRaw.trim()) {
			await runVerificationGit(workspace, ["add", "-A"])
			try {
				await runVerificationGit(workspace, ["commit", "-m", "verification: reset workspace"])
			} catch {
				// ignore allow-empty / duplicate baseline cases
			}
		}
	} catch {
		// ignore
	}

	return workspace
}
