import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export type CapturedChildProcessOptions = {
	command: string
	args: string[]
	cwd: string
	timeoutMs: number
	env?: NodeJS.ProcessEnv
	captureRoot?: string
	label?: string
}

export type CapturedChildProcessResult = {
	code: number | null
	stdout: string
	stderr: string
}

function sanitizeLabel(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "-")
}

function readFile(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf8")
	} catch {
		return ""
	}
}

function removeFile(filePath: string): void {
	try {
		fs.unlinkSync(filePath)
	} catch {
		// ignore
	}
}

function closeHandle(fd: number): void {
	try {
		fs.closeSync(fd)
	} catch {
		// ignore
	}
}

function killChildTree(pid: number | undefined): void {
	if (!pid) return
	if (process.platform === "win32") {
		try {
			spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
		} catch {
			// ignore
		}
		return
	}
	try {
		process.kill(pid, "SIGTERM")
	} catch {
		// ignore
	}
}

export async function runCapturedChildProcess(options: CapturedChildProcessOptions): Promise<CapturedChildProcessResult> {
	const captureRoot = path.resolve(options.captureRoot ?? path.join(options.cwd, ".tmp-child-process-capture"))
	fs.mkdirSync(captureRoot, { recursive: true })

	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const label = sanitizeLabel(options.label?.trim() || path.basename(options.command) || "child-process")
	const stdoutPath = path.join(captureRoot, `${label}-${stamp}.stdout.log`)
	const stderrPath = path.join(captureRoot, `${label}-${stamp}.stderr.log`)
	const stdoutFd = fs.openSync(stdoutPath, "w")
	const stderrFd = fs.openSync(stderrPath, "w")

	const cleanup = () => {
		closeHandle(stdoutFd)
		closeHandle(stderrFd)
		removeFile(stdoutPath)
		removeFile(stderrPath)
	}

	return await new Promise((resolve, reject) => {
		let finished = false
		const child = spawn(options.command, options.args, {
			cwd: options.cwd,
			env: options.env,
			windowsHide: true,
			stdio: ["ignore", stdoutFd, stderrFd],
		})

		const timeout = setTimeout(() => killChildTree(child.pid), options.timeoutMs)
		timeout.unref?.()

		child.once("error", (err) => {
			if (finished) return
			finished = true
			clearTimeout(timeout)
			cleanup()
			reject(err)
		})

		child.once("close", (code) => {
			if (finished) return
			finished = true
			clearTimeout(timeout)
			const stdout = readFile(stdoutPath)
			const stderr = readFile(stderrPath)
			cleanup()
			resolve({
				code: typeof code === "number" ? code : null,
				stdout,
				stderr,
			})
		})
	})
}
