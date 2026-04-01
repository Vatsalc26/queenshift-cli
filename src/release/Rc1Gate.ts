import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import {
	DEFAULT_DAILY_DRIVER_RULES,
	RC1_DAILY_DRIVER_LOG_PATH,
	defaultDailyDriverLog,
	evaluateDailyDriverLog,
	formatDailyDriverStatus,
	readDailyDriverLog,
	resolveRc1RootDir,
	summarizeDailyDriverProgress,
	type DailyDriverEvaluation,
	type Rc1DailyDriverStatus,
} from "./Rc1Ops"

export type Rc1GateStatus = "PASS" | "FAIL" | "NOT_RUN"
export type Rc1GateMode = "command" | "recorded_proof" | "daily_driver"

export type Rc1GateReport = {
	key: string
	label: string
	mode: Rc1GateMode
	required: boolean
	status: Rc1GateStatus
	source: string
	details: string[]
	recordedDate?: string | null
}

export type Rc1VerificationResult = {
	shipDecision: "SHIP" | "NO_SHIP"
	automationPassed: boolean
	recordedProofsPassed: boolean
	dailyDriverPassed: boolean
	gates: Rc1GateReport[]
	dailyDriver: DailyDriverEvaluation
	dailyDriverStatus: Rc1DailyDriverStatus
	blockedOnlyByRealStreak: boolean
	blockers: string[]
}

export type Rc1StatusResult = {
	gate: Rc1GateReport
	dailyDriver: DailyDriverEvaluation
	dailyDriverStatus: Rc1DailyDriverStatus
}

type CommandGateDefinition = {
	key: string
	label: string
	npmScript: string
	hardStop?: boolean
}

export type RecordedProofGateDefinition = {
	key: string
	label: string
	proofLabel: string
	maxAgeDays: number
}

type CapturedCommandResult = {
	code: number | null
	stdout: string
	stderr: string
}

type CommandRunner = (
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number },
) => Promise<CapturedCommandResult>

const RC1_README_PATH = "Readme.md"
const COMMAND_TIMEOUT_MS = 20 * 60 * 1000

export {
	DEFAULT_DAILY_DRIVER_RULES,
	evaluateDailyDriverLog,
	RC1_DAILY_DRIVER_LOG_PATH,
	type DailyDriverEvaluation,
	type DailyDriverEntry,
	type DailyDriverLog,
	type DailyDriverRules,
	type Rc1DailyDriverStatus,
} from "./Rc1Ops"

const COMMAND_GATES: CommandGateDefinition[] = [
	{ key: "level1", label: "Level 1 tests", npmScript: "test", hardStop: true },
	{ key: "acceptance", label: "Acceptance gates", npmScript: "verify:acceptance:gates" },
	{ key: "recovery", label: "Recovery harness", npmScript: "verify:recovery" },
	{ key: "provider", label: "Provider resilience", npmScript: "verify:provider:resilience" },
	{ key: "review_queue", label: "Review queue", npmScript: "verify:review:queue" },
	{ key: "admission", label: "Admission gate", npmScript: "verify:admission" },
	{ key: "profiles", label: "Verification profiles", npmScript: "verify:profiles" },
	{ key: "guardrails", label: "Runtime guardrails", npmScript: "verify:guardrails" },
	{ key: "task_templates", label: "Task templates", npmScript: "verify:task:templates" },
	{ key: "incident", label: "Incident flow", npmScript: "verify:incident" },
	{ key: "package_rc1", label: "RC1 packaging smoke", npmScript: "verify:package:rc1" },
]

const RECORDED_PROOF_GATES: RecordedProofGateDefinition[] = [
	{
		key: "semiopen_live",
		label: "Semi-open live proof",
		proofLabel: "Current semi-open verification",
		maxAgeDays: 7,
	},
	{
		key: "vscode_shell",
		label: "VS Code thin-shell smoke",
		proofLabel: "Current VS Code thin-shell smoke",
		maxAgeDays: 7,
	},
	{
		key: "matrix_live",
		label: "Live matrix proof",
		proofLabel: "Current matrix verification",
		maxAgeDays: 7,
	},
	{
		key: "beta_live",
		label: "Beta matrix proof",
		proofLabel: "Current beta verification",
		maxAgeDays: 7,
	},
	{
		key: "owner_manual_shell",
		label: "Manual owner shell confirmation",
		proofLabel: "Manual owner confirmation",
		maxAgeDays: 7,
	},
]

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number },
): Promise<CapturedCommandResult> {
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(options.cwd, `.tmp-rc1-${stamp}.stdout.log`)
	const stderrPath = path.join(options.cwd, `.tmp-rc1-${stamp}.stderr.log`)
	const stdoutFd = fs.openSync(stdoutPath, "w")
	const stderrFd = fs.openSync(stderrPath, "w")

	const readFile = (filePath: string): string => {
		try {
			return fs.readFileSync(filePath, "utf8")
		} catch {
			return ""
		}
	}

	try {
		return await new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: options.cwd,
				windowsHide: true,
				stdio: ["ignore", stdoutFd, stderrFd],
			})

			const killTree = () => {
				if (!child.pid) return
				if (process.platform === "win32") {
					try {
						spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
					} catch {
						// ignore
					}
					return
				}
				try {
					child.kill("SIGTERM")
				} catch {
					// ignore
				}
			}

			const timeout = setTimeout(() => killTree(), options.timeoutMs)
			timeout.unref?.()

			child.once("error", reject)
			child.once("close", (code) => {
				clearTimeout(timeout)
				resolve({
					code: typeof code === "number" ? code : null,
					stdout: readFile(stdoutPath),
					stderr: readFile(stderrPath),
				})
			})
		})
	} finally {
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
}

function npmInvocation(scriptName: string): { command: string; args: string[] } {
	if (process.platform === "win32") {
		const npmArgs = scriptName === "test" ? ["test"] : ["run", scriptName]
		return {
			command: "cmd.exe",
			args: ["/d", "/s", "/c", "npm.cmd", ...npmArgs],
		}
	}
	const command = "npm"
	if (scriptName === "test") {
		return { command, args: ["test"] }
	}
	return { command, args: ["run", scriptName] }
}

function lastUsefulLine(text: string): string | null {
	return text
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean)
		.pop() ?? null
}

async function executeCommandGate(
	rootDir: string,
	definition: CommandGateDefinition,
	commandRunner: CommandRunner,
): Promise<Rc1GateReport> {
	const { command, args } = npmInvocation(definition.npmScript)
	try {
		const result = await commandRunner(command, args, { cwd: rootDir, timeoutMs: COMMAND_TIMEOUT_MS })
		const summaryLine = lastUsefulLine(result.stderr) ?? lastUsefulLine(result.stdout)
		return {
			key: definition.key,
			label: definition.label,
			mode: "command",
			required: true,
			status: result.code === 0 ? "PASS" : "FAIL",
			source: definition.npmScript === "test" ? "npm test" : `npm run ${definition.npmScript}`,
			details: [summaryLine ? `exit=${String(result.code)} | ${summaryLine}` : `exit=${String(result.code)}`],
		}
	} catch (err) {
		return {
			key: definition.key,
			label: definition.label,
			mode: "command",
			required: true,
			status: "FAIL",
			source: definition.npmScript === "test" ? "npm test" : `npm run ${definition.npmScript}`,
			details: [err instanceof Error ? err.message : String(err)],
		}
	}
}

function notRunGate(definition: CommandGateDefinition, reason: string): Rc1GateReport {
	return {
		key: definition.key,
		label: definition.label,
		mode: "command",
		required: true,
		status: "NOT_RUN",
		source: definition.npmScript === "test" ? "npm test" : `npm run ${definition.npmScript}`,
		details: [reason],
	}
}

function findRecordedProofLine(readmeText: string, proofLabel: string): string | null {
	for (const line of readmeText.split(/\r?\n/g)) {
		const trimmed = line.trim()
		if (trimmed.startsWith(`- ${proofLabel}:`)) {
			return trimmed
		}
	}
	return null
}

function parseIsoDate(dateText: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null
	const parsed = new Date(`${dateText}T00:00:00Z`)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

function diffWholeDays(now: Date, recordedAt: Date): number {
	const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
	const recordedUtc = Date.UTC(recordedAt.getUTCFullYear(), recordedAt.getUTCMonth(), recordedAt.getUTCDate())
	return Math.max(0, Math.floor((nowUtc - recordedUtc) / (24 * 60 * 60 * 1000)))
}

export function evaluateRecordedProofGate(
	readmeText: string,
	definition: RecordedProofGateDefinition,
	now = new Date(),
): Rc1GateReport {
	const line = findRecordedProofLine(readmeText, definition.proofLabel)
	if (!line) {
		return {
			key: definition.key,
			label: definition.label,
			mode: "recorded_proof",
			required: true,
			status: "FAIL",
			source: RC1_README_PATH,
			details: [`Missing recorded proof line for "${definition.proofLabel}".`],
		}
	}

	const statusMatch = line.match(/:\s*(PASS|FAIL)\b/)
	if (!statusMatch || statusMatch[1] !== "PASS") {
		return {
			key: definition.key,
			label: definition.label,
			mode: "recorded_proof",
			required: true,
			status: "FAIL",
			source: RC1_README_PATH,
			details: [`Recorded proof is not PASS: ${line}`],
		}
	}

	const dateMatch = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
	if (!dateMatch) {
		return {
			key: definition.key,
			label: definition.label,
			mode: "recorded_proof",
			required: true,
			status: "FAIL",
			source: RC1_README_PATH,
			details: [`Recorded proof is missing an explicit YYYY-MM-DD date: ${line}`],
		}
	}

	const recordedDate = dateMatch[1] ?? ""
	const recordedAt = parseIsoDate(recordedDate)
	if (!recordedAt) {
		return {
			key: definition.key,
			label: definition.label,
			mode: "recorded_proof",
			required: true,
			status: "FAIL",
			source: RC1_README_PATH,
			recordedDate,
			details: [`Recorded proof date is invalid: ${recordedDate}`],
		}
	}

	const ageDays = diffWholeDays(now, recordedAt)
	if (ageDays > definition.maxAgeDays) {
		return {
			key: definition.key,
			label: definition.label,
			mode: "recorded_proof",
			required: true,
			status: "FAIL",
			source: RC1_README_PATH,
			recordedDate,
			details: [`Recorded proof is stale: ${ageDays} day(s) old, max allowed is ${definition.maxAgeDays}.`],
		}
	}

	return {
		key: definition.key,
		label: definition.label,
		mode: "recorded_proof",
		required: true,
		status: "PASS",
		source: RC1_README_PATH,
		recordedDate,
		details: [`Recorded PASS on ${recordedDate} (${ageDays} day(s) old).`],
	}
}

function evaluateDailyDriverEvidence(
	rootDir: string,
	now = new Date(),
): { gate: Rc1GateReport; dailyDriver: DailyDriverEvaluation; dailyDriverStatus: Rc1DailyDriverStatus } {
	const readResult = readDailyDriverLog(rootDir)
	if (readResult.parseError) {
		const dailyDriver: DailyDriverEvaluation = {
			passed: false,
			creditedCount: 0,
			requiredCreditedRuns: DEFAULT_DAILY_DRIVER_RULES.requiredCreditedRuns,
			distinctDateCount: 0,
			requiredDistinctDates: DEFAULT_DAILY_DRIVER_RULES.requiredDistinctDates,
			maxCreditedRunsPerDay: DEFAULT_DAILY_DRIVER_RULES.maxCreditedRunsPerDay,
			maxObservedPerDay: 0,
			overfilledDates: [],
			invalidCreditedEntries: [],
			details: [readResult.parseError],
		}
		const dailyDriverStatus = summarizeDailyDriverProgress(defaultDailyDriverLog(), now)
		return {
			gate: {
				key: "daily_driver",
				label: "Daily-driver streak log",
				mode: "daily_driver",
				required: true,
				status: "FAIL",
				source: RC1_DAILY_DRIVER_LOG_PATH,
				details: dailyDriver.details,
			},
			dailyDriver,
			dailyDriverStatus,
		}
	}

	if (!readResult.log) {
		const dailyDriver: DailyDriverEvaluation = {
			passed: false,
			creditedCount: 0,
			requiredCreditedRuns: DEFAULT_DAILY_DRIVER_RULES.requiredCreditedRuns,
			distinctDateCount: 0,
			requiredDistinctDates: DEFAULT_DAILY_DRIVER_RULES.requiredDistinctDates,
			maxCreditedRunsPerDay: DEFAULT_DAILY_DRIVER_RULES.maxCreditedRunsPerDay,
			maxObservedPerDay: 0,
			overfilledDates: [],
			invalidCreditedEntries: [],
			details: [`Missing ${RC1_DAILY_DRIVER_LOG_PATH}.`],
		}
		const dailyDriverStatus = summarizeDailyDriverProgress(defaultDailyDriverLog(), now)
		return {
			gate: {
				key: "daily_driver",
				label: "Daily-driver streak log",
				mode: "daily_driver",
				required: true,
				status: dailyDriver.passed ? "PASS" : "FAIL",
				source: RC1_DAILY_DRIVER_LOG_PATH,
				details: dailyDriver.details,
			},
			dailyDriver,
			dailyDriverStatus,
		}
	}

	const dailyDriver = evaluateDailyDriverLog(readResult.log)
	const dailyDriverStatus = summarizeDailyDriverProgress(readResult.log, now)
	return {
		gate: {
			key: "daily_driver",
			label: "Daily-driver streak log",
			mode: "daily_driver",
			required: true,
			status: dailyDriver.passed ? "PASS" : "FAIL",
			source: RC1_DAILY_DRIVER_LOG_PATH,
			details: dailyDriver.details,
		},
		dailyDriver,
		dailyDriverStatus,
	}
}

export async function runRc1Verification(
	rootDir = resolveRc1RootDir(),
	now = new Date(),
	commandRunner: CommandRunner = runCommandCapture,
): Promise<Rc1VerificationResult> {
	const gates: Rc1GateReport[] = []
	let hardStopped = false

	for (const definition of COMMAND_GATES) {
		if (hardStopped) {
			gates.push(notRunGate(definition, "Skipped because an earlier hard-stop command gate failed."))
			continue
		}
		const report = await executeCommandGate(rootDir, definition, commandRunner)
		gates.push(report)
		if (definition.hardStop && report.status === "FAIL") {
			hardStopped = true
		}
	}

	const readmePath = path.join(rootDir, RC1_README_PATH)
	const readmeText = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : ""
	for (const definition of RECORDED_PROOF_GATES) {
		gates.push(evaluateRecordedProofGate(readmeText, definition, now))
	}

	const dailyDriverEvidence = evaluateDailyDriverEvidence(rootDir, now)
	gates.push(dailyDriverEvidence.gate)

	const automationPassed = gates
		.filter((gate) => gate.mode === "command" && gate.required)
		.every((gate) => gate.status === "PASS")
	const recordedProofsPassed = gates
		.filter((gate) => gate.mode === "recorded_proof" && gate.required)
		.every((gate) => gate.status === "PASS")
	const dailyDriverPassed = dailyDriverEvidence.dailyDriver.passed
	const blockedOnlyByRealStreak = automationPassed && recordedProofsPassed && !dailyDriverPassed
	const blockers = gates
		.filter((gate) => gate.required && gate.status !== "PASS")
		.map((gate) => `${gate.label}: ${gate.details[0] ?? gate.status}`)

	return {
		shipDecision: automationPassed && recordedProofsPassed && dailyDriverPassed ? "SHIP" : "NO_SHIP",
		automationPassed,
		recordedProofsPassed,
		dailyDriverPassed,
		gates,
		dailyDriver: dailyDriverEvidence.dailyDriver,
		dailyDriverStatus: dailyDriverEvidence.dailyDriverStatus,
		blockedOnlyByRealStreak,
		blockers,
	}
}

export function runRc1Status(rootDir = resolveRc1RootDir(), now = new Date()): Rc1StatusResult {
	return evaluateDailyDriverEvidence(rootDir, now)
}

export function formatRc1VerificationResult(result: Rc1VerificationResult): string {
	const lines = [
		`RC1 decision: ${result.shipDecision.replaceAll("_", "-")}`,
		`Automation gates: ${result.automationPassed ? "PASS" : "FAIL"}`,
		`Recorded proofs: ${result.recordedProofsPassed ? "PASS" : "FAIL"}`,
		`Daily-driver streak: ${result.dailyDriverPassed ? "PASS" : "FAIL"} (${result.dailyDriver.creditedCount}/${result.dailyDriver.requiredCreditedRuns} runs, ${result.dailyDriver.distinctDateCount}/${result.dailyDriver.requiredDistinctDates} dates)`,
		"",
		formatDailyDriverStatus(result.dailyDriverStatus, { blockedOnlyByRealStreak: result.blockedOnlyByRealStreak }),
		"",
		"Gate | Mode | Result | Source",
		"--- | --- | --- | ---",
	]

	for (const gate of result.gates) {
		lines.push(`${gate.label} | ${gate.mode} | ${gate.status} | ${gate.source}`)
	}

	if (result.blockers.length === 0) {
		lines.push("")
		lines.push("Ship blockers: none")
	} else {
		lines.push("")
		lines.push("Ship blockers:")
		for (const blocker of result.blockers) {
			lines.push(`- ${blocker}`)
		}
	}

	return lines.join("\n")
}

export function formatRc1StatusResult(result: Rc1StatusResult): string {
	const lines = [
		`RC1 daily-driver gate: ${result.gate.status}`,
		formatDailyDriverStatus(result.dailyDriverStatus),
	]

	if (result.gate.details.length > 0) {
		lines.push("")
		lines.push("Notes:")
		for (const detail of result.gate.details) {
			lines.push(`- ${detail}`)
		}
	}

	return lines.join("\n")
}

async function main(): Promise<void> {
	const statusMode = process.argv.slice(2).includes("--status")
	if (statusMode) {
		const result = runRc1Status()
		console.log(formatRc1StatusResult(result))
		process.exit(0)
	}

	const result = await runRc1Verification()
	console.log(formatRc1VerificationResult(result))
	process.exit(result.shipDecision === "SHIP" ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:rc1] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
