import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { formatQueenshiftHelp } from "../src/cli/ProductSurface"
import { QUEENSHIFT_COMMAND } from "../src/cli/CommandSurface"
import {
	QUEENSHIFT_EXIT_ACTION_REQUIRED,
	QUEENSHIFT_EXIT_FAILURE,
	QUEENSHIFT_EXIT_SUCCESS,
} from "../src/cli/ExitCodes"
import { ensureRunDir, resolveRunSummaryPath, writeRunSummary } from "../src/run/RunArtifacts"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

type CliCaptureResult = {
	code: number | null
	stdout: string
	stderr: string
}

type ReplayCliResult = {
	found: boolean
	summaryPath: string | null
	replayPath: string | null
	error: string | null
}

type IncidentCliResult = {
	found: boolean
	runId: string | null
	incidentPackPath: string | null
	incident: {
		artifacts: {
			incidentPackPath: string
		}
	} | null
	error: string | null
}

type AdmissionCliResult = {
	decision?: string
	task?: {
		decision?: string
		reasonCodes?: string[]
	}
}

type OwnerQuickActionsCliResult = {
	recommendedAction: {
		label: string
		command: string | null
	} | null
	actions: Array<{
		label: string
		command: string | null
	}>
}

export type QueenshiftAutomationHarnessResult = {
	packageScriptPresent: boolean
	helpMentionsAutomationContract: boolean
	admissionRefusalUsesActionRequiredExit: boolean
	replayLatestUsesArtifactJson: boolean
	incidentLatestMissingUsesActionRequiredExit: boolean
	incidentLatestFoundUsesArtifactJson: boolean
	successQuickActionsUseQueenshift: boolean
	incidentQuickActionsUseQueenshift: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

async function runCli(rootDir: string, args: string[], cwd = rootDir): Promise<CliCaptureResult> {
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(rootDir, "verification", `.tmp-queenshift-automation-${stamp}.stdout.log`)
	const stderrPath = path.join(rootDir, "verification", `.tmp-queenshift-automation-${stamp}.stderr.log`)
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
			const child = spawn(process.execPath, [path.join(rootDir, "dist", "swarm.js"), ...args], {
				cwd,
				windowsHide: true,
				stdio: ["ignore", stdoutFd, stderrFd],
			})
			child.once("error", reject)
			child.once("close", (code) =>
				resolve({
					code: typeof code === "number" ? code : null,
					stdout: readFile(stdoutPath),
					stderr: readFile(stderrPath),
				}),
			)
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

function parseJson<T>(text: string): T | null {
	try {
		return JSON.parse(text) as T
	} catch {
		return null
	}
}

function seedFailedRun(workspace: string, runId: string): string {
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "fix provider setup in hello.ts",
		workspace,
		status: "failed",
		stopReason: "provider_auth_failure",
		message: "Provider credentials were missing.",
		pathChosen: "small_task",
		taskContract: {
			scope: {
				allowedFiles: ["hello.ts"],
			},
		},
		changedFiles: [],
		createdFiles: [],
		git: {
			baseRef: "HEAD",
			branches: [],
		},
	})
	return resolveRunSummaryPath(runDir)
}

function seedSuccessfulRun(workspace: string, runId: string): string {
	const runDir = ensureRunDir(workspace, runId)
	writeRunSummary(runDir, {
		taskId: runId,
		task: "add a brief comment to hello.ts",
		workspace,
		status: "done",
		stopReason: "success",
		message: "Change accepted.",
		pathChosen: "small_task",
		taskContract: {
			scope: {
				allowedFiles: ["hello.ts"],
			},
		},
		changedFiles: ["hello.ts"],
		createdFiles: [],
		git: {
			baseRef: "HEAD",
			branches: [],
		},
	})
	return resolveRunSummaryPath(runDir)
}

export async function runQueenshiftAutomationHarness(rootDir = resolveRootDir()): Promise<QueenshiftAutomationHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}
	const helpText = formatQueenshiftHelp(rootDir)
	const { repoPath, cleanup } = await createTempTestRepoCopy(rootDir, "queenshift-automation")

	try {
		const packageScriptPresent =
			packageJson.scripts?.["verify:queenshift:automation"] ===
			"npm run build && node dist/verification/verify_queenshift_automation.js"
		const helpMentionsAutomationContract =
			helpText.includes("--json") &&
			helpText.includes(`exit ${QUEENSHIFT_EXIT_SUCCESS}`) &&
			helpText.includes(`exit ${QUEENSHIFT_EXIT_ACTION_REQUIRED}`) &&
			helpText.includes(`exit ${QUEENSHIFT_EXIT_FAILURE}`) &&
			helpText.includes("replay:latest") &&
			helpText.includes("incident:latest")

		const refusalResult = await runCli(rootDir, [
			"--task",
			"install dependencies and migrate the database",
			"--workspace",
			repoPath,
			"--json",
		])
		const refusalParsed = parseJson<AdmissionCliResult>(refusalResult.stdout)
		const admissionRefusalUsesActionRequiredExit =
			refusalResult.code === QUEENSHIFT_EXIT_ACTION_REQUIRED &&
			refusalParsed?.decision === "refuse" &&
			refusalParsed?.task?.decision === "refuse" &&
			(refusalParsed?.task?.reasonCodes ?? []).includes("unsupported_task_verb")

		const missingIncidentResult = await runCli(rootDir, ["incident:latest", "--workspace", repoPath, "--json"])
		const missingIncidentParsed = parseJson<IncidentCliResult>(missingIncidentResult.stdout)
		const incidentLatestMissingUsesActionRequiredExit =
			missingIncidentResult.code === QUEENSHIFT_EXIT_ACTION_REQUIRED &&
			missingIncidentParsed?.found === false &&
			typeof missingIncidentParsed?.error === "string" &&
			missingIncidentParsed.error.includes("No non-success incident run")

		const dryRunResult = await runCli(rootDir, ["--task", "add a brief comment to hello.ts", "--workspace", repoPath, "--dryRun"])
		const replayResult = await runCli(rootDir, ["replay:latest", "--workspace", repoPath, "--json"])
		const replayParsed = parseJson<ReplayCliResult>(replayResult.stdout)
		const replayLatestUsesArtifactJson =
			(dryRunResult.code === QUEENSHIFT_EXIT_SUCCESS || dryRunResult.code === QUEENSHIFT_EXIT_ACTION_REQUIRED) &&
			replayResult.code === QUEENSHIFT_EXIT_SUCCESS &&
			replayParsed?.found === true &&
			typeof replayParsed.summaryPath === "string" &&
			typeof replayParsed.replayPath === "string" &&
			fs.existsSync(replayParsed.summaryPath) &&
			fs.existsSync(replayParsed.replayPath)

		const successfulRunId = "task-automation-success"
		const successfulSummaryPath = seedSuccessfulRun(repoPath, successfulRunId)
		const successQuickActionsResult = await runCli(rootDir, [
			"owner:quick-actions",
			successfulRunId,
			"--workspace",
			repoPath,
			"--json",
		])
		const successQuickActionsParsed = parseJson<OwnerQuickActionsCliResult>(successQuickActionsResult.stdout)
		const successQuickActionsUseQueenshift =
			successQuickActionsResult.code === QUEENSHIFT_EXIT_SUCCESS &&
			successQuickActionsParsed?.recommendedAction?.label === "rerun the same bounded task" &&
			typeof successQuickActionsParsed?.recommendedAction?.command === "string" &&
			successQuickActionsParsed.recommendedAction.command.startsWith(`${QUEENSHIFT_COMMAND} --task `)

		const failedRunId = "task-automation-incident"
		const failedSummaryPath = seedFailedRun(repoPath, failedRunId)
		const incidentResult = await runCli(rootDir, ["incident:latest", "--workspace", repoPath, "--json"])
		const incidentParsed = parseJson<IncidentCliResult>(incidentResult.stdout)
		const incidentLatestFoundUsesArtifactJson =
			incidentResult.code === QUEENSHIFT_EXIT_SUCCESS &&
			incidentParsed?.found === true &&
			incidentParsed?.runId === failedRunId &&
			typeof incidentParsed?.incidentPackPath === "string" &&
			fs.existsSync(incidentParsed.incidentPackPath) &&
			incidentParsed?.incident?.artifacts.incidentPackPath === incidentParsed.incidentPackPath

		const incidentQuickActionsResult = await runCli(rootDir, [
			"owner:quick-actions",
			failedRunId,
			"--workspace",
			repoPath,
			"--json",
		])
		const incidentQuickActionsParsed = parseJson<OwnerQuickActionsCliResult>(incidentQuickActionsResult.stdout)
		const incidentQuickActionsUseQueenshift =
			incidentQuickActionsResult.code === QUEENSHIFT_EXIT_SUCCESS &&
			typeof incidentQuickActionsParsed?.recommendedAction?.command === "string" &&
			incidentQuickActionsParsed.recommendedAction.command.startsWith(`${QUEENSHIFT_COMMAND} incident:`)

		details.push(
			`refusalExit=${refusalResult.code ?? "null"}`,
			`missingIncidentExit=${missingIncidentResult.code ?? "null"}`,
			`dryRunExit=${dryRunResult.code ?? "null"}`,
			`successfulSummary=${successfulSummaryPath}`,
			`successQuickAction=${successQuickActionsParsed?.recommendedAction?.command ?? "none"}`,
			`failedSummary=${failedSummaryPath}`,
			`incidentQuickAction=${incidentQuickActionsParsed?.recommendedAction?.command ?? "none"}`,
		)

		return {
			packageScriptPresent,
			helpMentionsAutomationContract,
			admissionRefusalUsesActionRequiredExit,
			replayLatestUsesArtifactJson,
			incidentLatestMissingUsesActionRequiredExit,
			incidentLatestFoundUsesArtifactJson,
			successQuickActionsUseQueenshift,
			incidentQuickActionsUseQueenshift,
			details,
		}
	} finally {
		cleanup()
	}
}

export function formatQueenshiftAutomationHarnessResult(result: QueenshiftAutomationHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Help mentions automation contract: ${result.helpMentionsAutomationContract ? "PASS" : "FAIL"}`,
		`Admission refusal uses action-required exit: ${result.admissionRefusalUsesActionRequiredExit ? "PASS" : "FAIL"}`,
		`Replay latest uses artifact JSON: ${result.replayLatestUsesArtifactJson ? "PASS" : "FAIL"}`,
		`Incident latest missing uses action-required exit: ${result.incidentLatestMissingUsesActionRequiredExit ? "PASS" : "FAIL"}`,
		`Incident latest found uses artifact JSON: ${result.incidentLatestFoundUsesArtifactJson ? "PASS" : "FAIL"}`,
		`Success quick actions use Queenshift: ${result.successQuickActionsUseQueenshift ? "PASS" : "FAIL"}`,
		`Incident quick actions use Queenshift: ${result.incidentQuickActionsUseQueenshift ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenshiftAutomationHarness()
	console.log(formatQueenshiftAutomationHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.helpMentionsAutomationContract &&
			result.admissionRefusalUsesActionRequiredExit &&
			result.replayLatestUsesArtifactJson &&
			result.incidentLatestMissingUsesActionRequiredExit &&
			result.incidentLatestFoundUsesArtifactJson &&
			result.successQuickActionsUseQueenshift &&
			result.incidentQuickActionsUseQueenshift
			? QUEENSHIFT_EXIT_SUCCESS
			: QUEENSHIFT_EXIT_FAILURE,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenshift:automation] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(QUEENSHIFT_EXIT_FAILURE)
	})
}
