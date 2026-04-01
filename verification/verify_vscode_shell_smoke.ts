import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

type VscodeShellSmokeResult = {
	passed: boolean
	ownerSafeDefaultWorkspace?: boolean
	session18TaskLaunch?: boolean
	session18SummarySurfaced?: boolean
	session18ForensicsSurfaced?: boolean
	session137CommandPreviewSurfaced?: boolean
	session249RuntimeSummarySurfaced?: boolean
	session19ReviewInboxSurfaced?: boolean
	session19DiscardAction?: boolean
	workspace?: string
	session18SummaryPath?: string | null
	reviewRunId?: string | null
	details?: string[]
	error?: string | null
}

type VscodeShellSmokeRequest = {
	resultPath: string
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function resolveCodeCommand(): string {
	return "code"
}

function resolveWindowsCodeLaunchPath(): string {
	const envExecutable = (process.env["VSCODE_EXECUTABLE"] ?? "").trim()
	if (envExecutable && fs.existsSync(envExecutable)) {
		return envExecutable
	}

	const pathEntries = (process.env["Path"] ?? process.env["PATH"] ?? "")
		.split(path.delimiter)
		.map((entry) => entry.trim())
		.filter(Boolean)

	for (const entry of pathEntries) {
		const candidateExe = path.join(entry, "Code.exe")
		if (fs.existsSync(candidateExe)) {
			return candidateExe
		}

		const launcherPath = path.join(entry, "code.cmd")
		if (fs.existsSync(launcherPath)) {
			const adjacentExe = path.resolve(path.dirname(launcherPath), "..", "Code.exe")
			if (fs.existsSync(adjacentExe)) {
				return adjacentExe
			}
		}
	}

	const knownRoots = [process.env["LocalAppData"], process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]]
		.map((root) => root?.trim())
		.filter((root): root is string => Boolean(root))

	for (const root of knownRoots) {
		const candidateExe = path.join(root, "Microsoft VS Code", "Code.exe")
		if (fs.existsSync(candidateExe)) {
			return candidateExe
		}
	}

	return "code.cmd"
}

async function waitForJsonFile<T>(filePath: string, timeoutMs: number): Promise<T> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (fs.existsSync(filePath)) {
			return JSON.parse(fs.readFileSync(filePath, "utf8")) as T
		}
		await delay(500)
	}
	throw new Error(`Timed out waiting for shell smoke result at ${filePath}`)
}

export function buildVscodeShellSmokeEnv(
	baseEnv: NodeJS.ProcessEnv,
	resultPath: string,
): NodeJS.ProcessEnv {
	const launchEnv: NodeJS.ProcessEnv = {}
	for (const [key, value] of Object.entries(baseEnv)) {
		if (key === "ELECTRON_RUN_AS_NODE") continue
		if (key.startsWith("VSCODE_")) continue
		launchEnv[key] = value
	}
	launchEnv["SWARM_VSCODE_SHELL_SMOKE"] = "1"
	launchEnv["SWARM_VSCODE_SHELL_SMOKE_RESULT"] = resultPath
	return launchEnv
}

export function writeVscodeShellSmokeRequest(requestPath: string, resultPath: string): void {
	const payload: VscodeShellSmokeRequest = {
		resultPath,
	}
	fs.writeFileSync(requestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

export function formatVscodeShellSmokeResult(result: VscodeShellSmokeResult): string {
	return [
		`VS Code thin shell smoke: ${result.passed ? "PASS" : "FAIL"}`,
		`Owner-safe default workspace: ${result.ownerSafeDefaultWorkspace ? "PASS" : "FAIL"}`,
		`Session 18 task launch: ${result.session18TaskLaunch ? "PASS" : "FAIL"}`,
		`Session 18 summary surfaced: ${result.session18SummarySurfaced ? "PASS" : "FAIL"}`,
		`Session 18 forensics surfaced: ${result.session18ForensicsSurfaced ? "PASS" : "FAIL"}`,
		`Session 137 command preview surfaced: ${result.session137CommandPreviewSurfaced ? "PASS" : "FAIL"}`,
		`Session 249 runtime summary surfaced: ${result.session249RuntimeSummarySurfaced ? "PASS" : "FAIL"}`,
		`Session 19 review inbox surfaced: ${result.session19ReviewInboxSurfaced ? "PASS" : "FAIL"}`,
		`Session 19 discard action: ${result.session19DiscardAction ? "PASS" : "FAIL"}`,
		`Workspace: ${result.workspace ?? "(unknown)"}`,
		`Summary artifact: ${result.session18SummaryPath ?? "(unknown)"}`,
		`Review run id: ${result.reviewRunId ?? "(unknown)"}`,
		...(Array.isArray(result.details) && result.details.length > 0 ? ["Details:", ...result.details.map((line) => `- ${line}`)] : []),
		...(result.error ? [`Error: ${result.error}`] : []),
	].join("\n")
}

export async function runVscodeShellSmoke(rootDir = resolveRootDir()): Promise<VscodeShellSmokeResult> {
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const userDataDir = path.join(rootDir, "verification", `.tmp-vscode-shell-userdata-${stamp}`)
	const extensionsDir = path.join(rootDir, "verification", `.tmp-vscode-shell-extensions-${stamp}`)
	const resultPath = path.join(rootDir, "verification", `.tmp-vscode-shell-result-${stamp}.json`)
	const requestPath = path.join(rootDir, "verification", ".vscode-shell-smoke-request.json")
	const debugPath = path.join(rootDir, "verification", ".tmp-vscode-shell-debug.json")
	const extensionDevelopmentPath = path.join(rootDir, "vscode_shell")
	const windowsCodePath = process.platform === "win32" ? resolveWindowsCodeLaunchPath() : null
	const launchArgs = [
		"--new-window",
		"--user-data-dir",
		userDataDir,
		"--extensions-dir",
		extensionsDir,
		"--extensionDevelopmentPath",
		extensionDevelopmentPath,
	]
	let passed = false

	fs.mkdirSync(userDataDir, { recursive: true })
	fs.mkdirSync(extensionsDir, { recursive: true })
	if (fs.existsSync(requestPath)) {
		try {
			fs.unlinkSync(requestPath)
		} catch {
			// ignore stale request cleanup failures
		}
	}
	writeVscodeShellSmokeRequest(requestPath, resultPath)
	const launchEnv = buildVscodeShellSmokeEnv(process.env, resultPath)
	fs.writeFileSync(
		debugPath,
		`${JSON.stringify(
			{
				userDataDir,
				extensionsDir,
				resultPath,
				requestPath,
				extensionDevelopmentPath,
				windowsCodePath,
				launchArgs,
				launchEnv: {
					SWARM_VSCODE_SHELL_SMOKE: launchEnv["SWARM_VSCODE_SHELL_SMOKE"] ?? null,
					SWARM_VSCODE_SHELL_SMOKE_RESULT: launchEnv["SWARM_VSCODE_SHELL_SMOKE_RESULT"] ?? null,
				},
			},
			null,
			2,
		)}\n`,
		"utf8",
	)

	try {
		await new Promise<void>((resolve, reject) => {
			const child =
				process.platform === "win32"
					? spawn(windowsCodePath ?? "code.cmd", launchArgs, {
							cwd: rootDir,
							env: launchEnv,
							windowsHide: false,
							stdio: "ignore",
					  })
					: spawn(
							resolveCodeCommand(),
							launchArgs,
							{
								cwd: rootDir,
								env: launchEnv,
								windowsHide: false,
								stdio: "ignore",
							},
					  )

			child.once("error", reject)
			child.once("spawn", () => resolve())
		})

		const result = await waitForJsonFile<VscodeShellSmokeResult>(resultPath, 120_000)
		passed = result.passed === true
		return result
	} finally {
		if (fs.existsSync(requestPath)) {
			try {
				fs.unlinkSync(requestPath)
			} catch {
				// ignore cleanup failures
			}
		}
		if (passed) {
			if (fs.existsSync(resultPath)) {
				try {
					fs.unlinkSync(resultPath)
				} catch {
					// ignore cleanup failures
				}
			}
			if (fs.existsSync(debugPath)) {
				try {
					fs.unlinkSync(debugPath)
				} catch {
					// ignore cleanup failures
				}
			}
			if (fs.existsSync(userDataDir)) {
				try {
					fs.rmSync(userDataDir, { recursive: true, force: true })
				} catch {
					// ignore cleanup failures
				}
			}
			if (fs.existsSync(extensionsDir)) {
				try {
					fs.rmSync(extensionsDir, { recursive: true, force: true })
				} catch {
					// ignore cleanup failures
				}
			}
		}
	}
}

async function main(): Promise<void> {
	const result = await runVscodeShellSmoke()
	console.log(formatVscodeShellSmokeResult(result))
	process.exit(result.passed ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:vscode:shell] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
