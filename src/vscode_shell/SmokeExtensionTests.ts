import fs from "node:fs"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import * as vscode from "vscode"

type SmokeResult = {
	passed: boolean
	error?: string | null
}

function writeFailure(resultPath: string, error: string): void {
	fs.mkdirSync(path.dirname(resultPath), { recursive: true })
	fs.writeFileSync(
		resultPath,
		`${JSON.stringify({ passed: false, error, finishedAt: new Date().toISOString() }, null, 2)}\n`,
		"utf8",
	)
}

async function waitForResultFile(resultPath: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (fs.existsSync(resultPath)) return
		await delay(500)
	}
	throw new Error(`Timed out waiting for shell smoke result at ${resultPath}`)
}

export async function run(): Promise<void> {
	const resultPath = (process.env["SWARM_VSCODE_SHELL_SMOKE_RESULT"] ?? "").trim()
	if (!resultPath) {
		throw new Error("SWARM_VSCODE_SHELL_SMOKE_RESULT is required for extension smoke tests.")
	}

	const extension = vscode.extensions.getExtension("local.swarmcoder-v2-thin-shell")
	if (!extension) {
		writeFailure(resultPath, "Extension local.swarmcoder-v2-thin-shell was not found in the development host.")
		return
	}

	try {
		await extension.activate()
		await vscode.commands.executeCommand("swarmCoderV2Shell.open", { smokeResultPath: resultPath })
		await waitForResultFile(resultPath, 120_000)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		writeFailure(resultPath, message)
		throw err
	}
}
