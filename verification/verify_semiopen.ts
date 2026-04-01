import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { evaluateAcceptanceGate } from "../src/run/AcceptanceGate"
import { evaluateTaskAdmission } from "../src/run/AdmissionGate"
import { findLatestRunSummary } from "../src/run/RunArtifacts"
import { discoverSemiOpenTask, listWorkspaceFilesForDiscovery } from "../src/run/SemiOpenDiscovery"
import { BETA_REPOS } from "./beta_matrix_tasks"

type SummaryLike = {
	status?: unknown
	stopReason?: unknown
	reviewerVerdict?: unknown
	changedFiles?: unknown
	pathChosen?: unknown
	taskContract?: unknown
	acceptanceGate?: unknown
	verificationProfile?: unknown
}

type HarnessCheck = {
	label: string
	passed: boolean
	details: string[]
}

type HarnessResult = {
	fixtureChecks: HarnessCheck[]
	liveChecks: HarnessCheck[]
}

const ADMISSION_TIMEOUT_MS = 60_000
const LIVE_TIMEOUT_MS = 12 * 60 * 1000

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

const ROOT = resolveRootDir()

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function uniqueSorted(files: string[]): string[] {
	return Array.from(new Set(files.filter(Boolean))).sort((left, right) => left.localeCompare(right))
}

function createFixtureRepo(
	label: string,
	files: Record<string, string>,
): { repoPath: string; cleanup: () => void } {
	const repoPath = path.join(ROOT, "verification", `.tmp-semiopen-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	for (const [relPath, content] of Object.entries(files)) {
		const filePath = path.join(repoPath, relPath)
		fs.mkdirSync(path.dirname(filePath), { recursive: true })
		fs.writeFileSync(filePath, content, "utf8")
	}
	return {
		repoPath,
		cleanup: () => {
			if (fs.existsSync(repoPath)) fs.rmSync(repoPath, { recursive: true, force: true })
		},
	}
}

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcoder-semiopen-"))
	const stdoutPath = path.join(tmpDir, "stdout.log")
	const stderrPath = path.join(tmpDir, "stderr.log")
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
				env: options.env ?? process.env,
				windowsHide: true,
				stdio: ["ignore", stdoutFd, stderrFd],
			})

			let timedOut = false
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

			const timeout = setTimeout(() => {
				timedOut = true
				killTree()
			}, options.timeoutMs)
			timeout.unref?.()

			child.once("error", reject)
			child.once("close", (code) => {
				clearTimeout(timeout)
				resolve({
					stdout: readFile(stdoutPath),
					stderr: readFile(stderrPath),
					code: typeof code === "number" ? code : null,
					timedOut,
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
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	}
}

async function runGit(workspace: string, args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; code: number | null }> {
	const result = await runCommandCapture("git", ["-c", `safe.directory=${workspace}`, ...args], {
		cwd: workspace,
		timeoutMs,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: process.env["GIT_AUTHOR_NAME"] ?? "SwarmCoder Verification",
			GIT_AUTHOR_EMAIL: process.env["GIT_AUTHOR_EMAIL"] ?? "verification@local",
			GIT_COMMITTER_NAME: process.env["GIT_COMMITTER_NAME"] ?? "SwarmCoder Verification",
			GIT_COMMITTER_EMAIL: process.env["GIT_COMMITTER_EMAIL"] ?? "verification@local",
		},
	})
	return { stdout: result.stdout, stderr: result.stderr, code: result.code }
}

async function stageTemplateWorkspace(templateDir: string, workspace: string, baselineLabel: string): Promise<void> {
	if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
	fs.mkdirSync(path.dirname(workspace), { recursive: true })
	fs.cpSync(templateDir, workspace, { recursive: true, force: true })
	await initializeGitRepo(workspace, baselineLabel)
}

async function initializeGitRepo(workspace: string, baselineLabel: string): Promise<void> {
	const steps: Array<{ args: string[]; label: string }> = [
		{ args: ["init"], label: "git init" },
		{ args: ["add", "-A"], label: "git add" },
		{ args: ["commit", "-m", baselineLabel], label: "git commit" },
	]

	for (const step of steps) {
		const result = await runGit(workspace, step.args)
		if (result.code !== 0) {
			throw new Error(`${step.label} failed: ${result.stderr || result.stdout}`)
		}
	}
}

async function repoIsClean(workspace: string): Promise<boolean> {
	const result = await runGit(workspace, ["status", "--porcelain", "--untracked-files=all"], 15_000)
	return result.code === 0 && result.stdout.trim().length === 0
}

function ensureLiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const next = { ...env }
	const oauthPath = path.join(os.homedir(), ".gemini", "oauth_creds.json")
	if (!next["SWARM_PROVIDER"] && !next["OPENAI_API_KEY"] && fs.existsSync(oauthPath)) {
		next["SWARM_PROVIDER"] = "gemini"
		next["SWARM_GEMINI_AUTH"] = next["SWARM_GEMINI_AUTH"] ?? "cli"
	}
	return next
}

function hasLiveProvider(env: NodeJS.ProcessEnv): boolean {
	if (env["OPENAI_API_KEY"]) return true
	if (env["SWARM_PROVIDER"] === "gemini") {
		if (env["GEMINI_API_KEY"]) return true
		if (env["SWARM_GEMINI_AUTH"] === "access_token" && env["GEMINI_ACCESS_TOKEN"]) return true
		if (env["SWARM_GEMINI_AUTH"] === "adc" && env["GEMINI_USER_PROJECT"]) return true
		if (env["SWARM_GEMINI_AUTH"] === "cli") {
			const oauthPath = env["GEMINI_CLI_OAUTH_PATH"] ?? path.join(os.homedir(), ".gemini", "oauth_creds.json")
			return fs.existsSync(oauthPath)
		}
	}
	return false
}

async function runAdmissionJson(workspace: string, task: string, env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
	const result = await runCommandCapture(
		process.execPath,
		["dist/swarm.js", "--task", task, "--admitOnly", "--json", "--workspace", workspace],
		{ cwd: ROOT, timeoutMs: ADMISSION_TIMEOUT_MS, env },
	)
	if (result.timedOut) throw new Error(`Admission timed out after ${ADMISSION_TIMEOUT_MS}ms for task "${task}"`)
	if (result.code !== 0 && result.code !== 2) {
		throw new Error(`Admission exited ${String(result.code)} for task "${task}": ${result.stderr || result.stdout}`)
	}
	const parsed = JSON.parse(result.stdout) as Record<string, unknown>
	return parsed
}

async function runLiveSwarm(workspace: string, task: string, env: NodeJS.ProcessEnv): Promise<{ summary: SummaryLike; summaryPath: string }> {
	const result = await runCommandCapture(process.execPath, ["dist/swarm.js", "--task", task, "--workspace", workspace], {
		cwd: ROOT,
		timeoutMs: LIVE_TIMEOUT_MS,
		env,
	})
	if (result.timedOut) throw new Error(`Live semi-open task timed out after ${LIVE_TIMEOUT_MS}ms`)
	if (![0, 2].includes(result.code ?? -1)) {
		throw new Error(`Live semi-open task exited ${String(result.code)}: ${result.stderr || result.stdout}`)
	}

	const summaryPath = findLatestRunSummary(workspace)
	if (!summaryPath || !fs.existsSync(summaryPath)) {
		throw new Error(`No summary.json found after live task: ${task}`)
	}
	const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as SummaryLike
	return { summary, summaryPath }
}

function readWorkspaceFile(workspace: string, relPath: string): string {
	return fs.readFileSync(path.join(workspace, relPath), "utf8")
}

function repoTemplate(id: string): { templateDir: string; workspace: string } {
	const manifest = BETA_REPOS.find((entry) => entry.id === id)
	if (!manifest) {
		throw new Error(`Unknown beta repo template: ${id}`)
	}
	return {
		templateDir: manifest.templateDir,
		workspace: path.join(ROOT, ".swarm", "semiopen_workspaces", `${id}-${Date.now()}-${Math.random().toString(16).slice(2)}`),
	}
}

function formatHarnessError(err: unknown): string[] {
	if (err instanceof Error) {
		return err.message
			.split(/\r?\n/g)
			.map((line) => line.trim())
			.filter(Boolean)
	}
	return [String(err)]
}

async function runFixtureChecks(): Promise<HarnessCheck[]> {
	const checks: HarnessCheck[] = []

	const helperRepo = createFixtureRepo("helper-fixture", {
		"src/format.ts": 'export function formatBanner(input: string): string {\n\treturn input\n}\n',
		"tests/format.test.ts": 'import { formatBanner } from "../src/format"\n\nexport const baseline = formatBanner("ok")\n',
	})
	try {
		const discovery = discoverSemiOpenTask(
			"update src/format.ts and keep its test aligned",
			helperRepo.repoPath,
			listWorkspaceFilesForDiscovery(helperRepo.repoPath),
			{ maxFiles: 4 },
		)
		checks.push({
			label: "Fixture helper-plus-test discovery",
			passed:
				Boolean(discovery.match) &&
				discovery.match?.taskClass === "helper_test" &&
				discovery.match.targetFiles.join(",") === "src/format.ts,tests/format.test.ts",
			details: discovery.match ? discovery.match.details : discovery.refusal ? discovery.refusal.details : ["No discovery result returned."],
		})
	} finally {
		helperRepo.cleanup()
	}

	const docsRepo = createFixtureRepo("docs-fixture", {
		"src/config.ts": 'export const DEFAULT_MODE = "safe"\n',
		"README.md": "# Config Repo\n",
	})
	try {
		const admission = evaluateTaskAdmission("sync the readme with src/config.ts", docsRepo.repoPath)
		checks.push({
			label: "Fixture docs-sync discovery",
			passed:
				admission.decision === "allow_with_review_bias" &&
				admission.reasonCodes.includes("semi_open_task") &&
				(admission.derivedTaskContract?.scope?.requiredTargetFiles ?? []).join(",") === "README.md",
			details: admission.details,
		})
	} finally {
		docsRepo.cleanup()
	}

	const configRepo = createFixtureRepo("config-fixture", {
		"src/config.ts": 'export const DEFAULT_MODE = "safe"\n',
		"config/defaults.json": '{\n  "mode": "safe"\n}\n',
	})
	try {
		const admission = evaluateTaskAdmission("sync the defaults json with src/config.ts", configRepo.repoPath)
		checks.push({
			label: "Fixture config-sync discovery",
			passed:
				admission.decision === "allow_with_review_bias" &&
				admission.reasonCodes.includes("semi_open_task") &&
				(admission.derivedTaskContract?.scope?.requiredTargetFiles ?? []).join(",") === "config/defaults.json",
			details: admission.details,
		})
	} finally {
		configRepo.cleanup()
	}

	const explicitConfigRepo = createFixtureRepo("explicit-config-target", {
		"config/defaults.json": '{\n  "mode": "safe"\n}\n',
	})
	try {
		const admission = evaluateTaskAdmission(
			'update config/defaults.json so it contains the exact entry "betaMode": "external-beta"',
			explicitConfigRepo.repoPath,
		)
		checks.push({
			label: "Fixture explicit config target stays scoped",
			passed:
				admission.decision !== "refuse" &&
				!admission.reasonCodes.includes("ambiguous_task_scope") &&
				(admission.derivedTaskContract?.scope?.requiredTargetFiles ?? []).join(",") === "config/defaults.json",
			details: admission.details,
		})
	} finally {
		explicitConfigRepo.cleanup()
	}

	const renameRepo = createFixtureRepo("rename-fixture", {
		"src/format.ts": 'export function formatBanner(input: string): string {\n\treturn input\n}\n',
		"src/index.ts": 'import { formatBanner } from "./format"\n\nexport const output = formatBanner("hi")\n',
		"src/format.test.ts": 'import { formatBanner } from "./format"\n\nexport const baseline = formatBanner("test")\n',
	})
	try {
		const discovery = discoverSemiOpenTask(
			"rename the export in src/format.ts and update its direct call sites",
			renameRepo.repoPath,
			listWorkspaceFilesForDiscovery(renameRepo.repoPath),
			{ maxFiles: 4 },
		)
		checks.push({
			label: "Fixture rename-export discovery",
			passed: Boolean(discovery.match) && discovery.match?.taskClass === "rename_export" && discovery.match.targetFiles.length === 3,
			details: discovery.match ? discovery.match.details : discovery.refusal ? discovery.refusal.details : ["No discovery result returned."],
		})
	} finally {
		renameRepo.cleanup()
	}

	const unsupportedBroad = evaluateTaskAdmission("refactor the entire repo to keep everything aligned", path.join(ROOT, "verification", "test_workspace"))
	checks.push({
		label: "Fixture unsupported broad task refused",
		passed: unsupportedBroad.decision === "refuse" && unsupportedBroad.reasonCodes.includes("unsupported_broad_refactor"),
		details: unsupportedBroad.details,
	})

	const ambiguousRepo = createFixtureRepo("ambiguous-fixture", {
		"src/config.ts": 'export const DEFAULT_MODE = "safe"\n',
		"README.md": "# Config Repo\n",
		"docs/guide.md": "# Guide\n",
	})
	try {
		const ambiguous = evaluateTaskAdmission("sync the docs with src/config.ts", ambiguousRepo.repoPath)
		checks.push({
			label: "Fixture ambiguous semi-open task refused",
			passed: ambiguous.decision === "refuse" && ambiguous.reasonCodes.includes("ambiguous_task_scope"),
			details: ambiguous.details,
		})
	} finally {
		ambiguousRepo.cleanup()
	}

	const ambiguousConfigRepo = createFixtureRepo("ambiguous-config-fixture", {
		"src/config.ts": 'export const DEFAULT_MODE = "safe"\n',
		"config/defaults.json": '{\n  "mode": "safe"\n}\n',
		"config/settings.json": '{\n  "mode": "safe"\n}\n',
	})
	try {
		const ambiguous = evaluateTaskAdmission("sync the config with src/config.ts", ambiguousConfigRepo.repoPath)
		checks.push({
			label: "Fixture ambiguous config-sync task refused",
			passed: ambiguous.decision === "refuse" && ambiguous.reasonCodes.includes("ambiguous_task_scope"),
			details: ambiguous.details,
		})
	} finally {
		ambiguousConfigRepo.cleanup()
	}

	const driftRepo = createFixtureRepo("scope-drift-fixture", {
		"src/config.ts": 'export const DEFAULT_MODE = "safe"\n',
		"README.md": "# Config Repo\n",
	})
	try {
		const admission = evaluateTaskAdmission("sync the readme with src/config.ts", driftRepo.repoPath)
		const gate = evaluateAcceptanceGate({
			reviewerVerdict: "PASS",
			reviewOutputValid: true,
			requireMeaningfulDiff: true,
			hasMeaningfulDiff: true,
			changedFiles: ["README.md", "notes.md"],
			createdFiles: [],
			postRunFileContents: {
				"README.md": "# Config Repo\nThe config defaults stay documented in one place.\n",
				"notes.md": "unexpected drift\n",
			},
			taskContract: admission.derivedTaskContract,
		})
		checks.push({
			label: "Fixture scope drift blocks semi-open pass",
			passed: !gate.passed && gate.failedChecks.some((failure) => failure.code === "scope_drift"),
			details: gate.failedChecks.map((failure) => failure.message),
		})
	} finally {
		driftRepo.cleanup()
	}

	return checks
}

async function runLiveChecks(): Promise<HarnessCheck[]> {
	const env = ensureLiveEnv(process.env)
	const checks: HarnessCheck[] = []

	const broadRepo = repoTemplate("ts-cli-tool")
	const docsAmbiguousRepoPath = path.join(ROOT, ".swarm", "semiopen_workspaces", `ambiguous-${Date.now()}-${Math.random().toString(16).slice(2)}`)

	try {
		await stageTemplateWorkspace(broadRepo.templateDir, broadRepo.workspace, "semi-open: broad refusal baseline")
		const broadAdmission = await runAdmissionJson(broadRepo.workspace, "refactor the entire repo to keep everything aligned", env)
		const broadReasonCodes = asStringArray(broadAdmission["reasonCodes"])
		checks.push({
			label: "Live unsupported broad task refused",
			passed: asString(broadAdmission["decision"]) === "refuse" && broadReasonCodes.includes("unsupported_broad_refactor"),
			details: broadReasonCodes,
		})
	} catch (err) {
		checks.push({
			label: "Live unsupported broad task refused",
			passed: false,
			details: formatHarnessError(err),
		})
	} finally {
		if (fs.existsSync(broadRepo.workspace)) fs.rmSync(broadRepo.workspace, { recursive: true, force: true })
	}

	try {
		fs.mkdirSync(path.join(docsAmbiguousRepoPath, "src"), { recursive: true })
		fs.mkdirSync(path.join(docsAmbiguousRepoPath, "docs"), { recursive: true })
		fs.writeFileSync(path.join(docsAmbiguousRepoPath, "src", "config.ts"), 'export const DEFAULT_MODE = "safe"\n', "utf8")
		fs.writeFileSync(path.join(docsAmbiguousRepoPath, "README.md"), "# Config Repo\n", "utf8")
		fs.writeFileSync(path.join(docsAmbiguousRepoPath, "docs", "guide.md"), "# Guide\n", "utf8")
		fs.writeFileSync(path.join(docsAmbiguousRepoPath, ".gitignore"), ".swarm/\n", "utf8")
		await initializeGitRepo(docsAmbiguousRepoPath, "semi-open: ambiguous docs baseline")
		const ambiguousAdmission = await runAdmissionJson(docsAmbiguousRepoPath, "sync the docs with src/config.ts", env)
		const ambiguousReasonCodes = asStringArray(ambiguousAdmission["reasonCodes"])
		checks.push({
			label: "Live ambiguous semi-open task refused",
			passed: asString(ambiguousAdmission["decision"]) === "refuse" && ambiguousReasonCodes.includes("ambiguous_task_scope"),
			details: ambiguousReasonCodes,
		})
	} catch (err) {
		checks.push({
			label: "Live ambiguous semi-open task refused",
			passed: false,
			details: formatHarnessError(err),
		})
	} finally {
		if (fs.existsSync(docsAmbiguousRepoPath)) fs.rmSync(docsAmbiguousRepoPath, { recursive: true, force: true })
	}

	if (!hasLiveProvider(env)) {
		checks.push({
			label: "Live provider configured for semi-open mutation rows",
			passed: false,
			details: ["No OpenAI or Gemini provider credentials were available for live semi-open rows."],
		})
		return checks
	}

	const helperRepo = repoTemplate("ts-cli-tool")
	try {
		await stageTemplateWorkspace(helperRepo.templateDir, helperRepo.workspace, "semi-open: helper baseline")
		const task =
			'update src/format.ts and keep its test aligned so both files include the exact comment "// semi-open: helper sync".'
		const admission = await runAdmissionJson(helperRepo.workspace, task, env)
		const admissionTask = asRecord(admission["task"])
		const admissionAllowedFiles = asStringArray(asRecord(admissionTask?.["derivedTaskContract"])?.["scope"] && asRecord(asRecord(admissionTask?.["derivedTaskContract"])?.["scope"])?.["allowedFiles"])
		const { summary } = await runLiveSwarm(helperRepo.workspace, task, env)
		const summaryTaskContract = asRecord(summary.taskContract)
		const derivation = asRecord(summaryTaskContract?.["derivation"])
		const changedFiles = asStringArray(summary.changedFiles)
		const helperDetails: string[] = []
		if (asString(admission["decision"]) !== "allow_with_review_bias") helperDetails.push(`admission=${String(admission["decision"])}`)
		if (uniqueSorted(admissionAllowedFiles).join(",") !== "src/format.test.ts,src/format.ts") {
			helperDetails.push(`allowedFiles=${admissionAllowedFiles.join(",")}`)
		}
		if (asString(summary.status) !== "done") helperDetails.push(`status=${String(summary.status)}`)
		if (asString(summary.pathChosen) !== "semi_open") helperDetails.push(`path=${String(summary.pathChosen)}`)
		if (asString(summary.reviewerVerdict) !== "PASS") helperDetails.push(`reviewer=${String(summary.reviewerVerdict)}`)
		if (asString(derivation?.["taskClass"]) !== "helper_test") helperDetails.push(`taskClass=${String(derivation?.["taskClass"])}`)
		if (!asRecord(summary.acceptanceGate)?.["passed"]) helperDetails.push("acceptance gate did not pass")
		if (!changedFiles.includes("src/format.ts") || !changedFiles.includes("src/format.test.ts")) {
			helperDetails.push(`changedFiles=${changedFiles.join(",")}`)
		}
		const helperSource = readWorkspaceFile(helperRepo.workspace, "src/format.ts")
		const helperTest = readWorkspaceFile(helperRepo.workspace, "src/format.test.ts")
		if (!helperSource.includes("// semi-open: helper sync")) helperDetails.push("src/format.ts missing required helper snippet")
		if (!helperTest.includes("// semi-open: helper sync")) helperDetails.push("src/format.test.ts missing required helper snippet")
		const verification = asRecord(summary.verificationProfile)
		if (asString(verification?.["status"]) !== "passed") helperDetails.push(`verification=${String(verification?.["status"])}`)
		if (!(await repoIsClean(helperRepo.workspace))) helperDetails.push("workspace was dirty after helper row")
		checks.push({
			label: "Live helper-plus-test semi-open row",
			passed: helperDetails.length === 0,
			details: helperDetails.length > 0 ? helperDetails : ["helper-plus-test lane completed with bounded scope and verification PASS"],
		})
	} catch (err) {
		checks.push({
			label: "Live helper-plus-test semi-open row",
			passed: false,
			details: formatHarnessError(err),
		})
	} finally {
		if (fs.existsSync(helperRepo.workspace)) fs.rmSync(helperRepo.workspace, { recursive: true, force: true })
	}

	const docsRepo = repoTemplate("config-service")
	try {
		await stageTemplateWorkspace(docsRepo.templateDir, docsRepo.workspace, "semi-open: docs baseline")
		const task =
			'sync the repo-root readme with src/config.ts by updating the readme so it contains the exact sentence "The config defaults stay documented in one place." Keep the change bounded to the named source file and its readme.'
		const admission = await runAdmissionJson(docsRepo.workspace, task, env)
		const admissionTask = asRecord(admission["task"])
		const admissionAllowedFiles = asStringArray(asRecord(admissionTask?.["derivedTaskContract"])?.["scope"] && asRecord(asRecord(admissionTask?.["derivedTaskContract"])?.["scope"])?.["allowedFiles"])
		const { summary } = await runLiveSwarm(docsRepo.workspace, task, env)
		const summaryTaskContract = asRecord(summary.taskContract)
		const derivation = asRecord(summaryTaskContract?.["derivation"])
		const changedFiles = asStringArray(summary.changedFiles)
		const docsDetails: string[] = []
		if (asString(admission["decision"]) !== "allow_with_review_bias") docsDetails.push(`admission=${String(admission["decision"])}`)
		if (uniqueSorted(admissionAllowedFiles).join(",") !== "README.md,src/config.ts") {
			docsDetails.push(`allowedFiles=${admissionAllowedFiles.join(",")}`)
		}
		if (asString(summary.status) !== "done") docsDetails.push(`status=${String(summary.status)}`)
		if (asString(summary.pathChosen) !== "semi_open") docsDetails.push(`path=${String(summary.pathChosen)}`)
		if (asString(summary.reviewerVerdict) !== "PASS") docsDetails.push(`reviewer=${String(summary.reviewerVerdict)}`)
		if (asString(derivation?.["taskClass"]) !== "docs_sync") docsDetails.push(`taskClass=${String(derivation?.["taskClass"])}`)
		if (!asRecord(summary.acceptanceGate)?.["passed"]) docsDetails.push("acceptance gate did not pass")
		if (!changedFiles.includes("README.md")) docsDetails.push(`changedFiles=${changedFiles.join(",")}`)
		const readmeText = readWorkspaceFile(docsRepo.workspace, "README.md")
		if (!readmeText.includes("The config defaults stay documented in one place.")) {
			docsDetails.push("README.md missing required docs-sync snippet")
		}
		const verification = asRecord(summary.verificationProfile)
		const verificationStatus = asString(verification?.["status"])
		if (verificationStatus !== "passed" && verificationStatus !== "not_applicable") {
			docsDetails.push(`verification=${String(verificationStatus)}`)
		}
		if (!(await repoIsClean(docsRepo.workspace))) docsDetails.push("workspace was dirty after docs row")
		checks.push({
			label: "Live docs-sync semi-open row",
			passed: docsDetails.length === 0,
			details: docsDetails.length > 0 ? docsDetails : ["docs-sync lane completed with bounded scope and verification PASS"],
		})
	} catch (err) {
		checks.push({
			label: "Live docs-sync semi-open row",
			passed: false,
			details: formatHarnessError(err),
		})
	} finally {
		if (fs.existsSync(docsRepo.workspace)) fs.rmSync(docsRepo.workspace, { recursive: true, force: true })
	}

	const configRepo = repoTemplate("config-service")
	try {
		await stageTemplateWorkspace(configRepo.templateDir, configRepo.workspace, "semi-open: config baseline")
		const task =
			'sync the defaults json with src/config.ts so the config file contains the exact property "notes": "semi-open config sync". Keep the change bounded to the named source file and the derived config target.'
		const admission = await runAdmissionJson(configRepo.workspace, task, env)
		const admissionTask = asRecord(admission["task"])
		const admissionAllowedFiles = asStringArray(asRecord(admissionTask?.["derivedTaskContract"])?.["scope"] && asRecord(asRecord(admissionTask?.["derivedTaskContract"])?.["scope"])?.["allowedFiles"])
		const { summary } = await runLiveSwarm(configRepo.workspace, task, env)
		const summaryTaskContract = asRecord(summary.taskContract)
		const derivation = asRecord(summaryTaskContract?.["derivation"])
		const changedFiles = asStringArray(summary.changedFiles)
		const configDetails: string[] = []
		if (asString(admission["decision"]) !== "allow_with_review_bias") configDetails.push(`admission=${String(admission["decision"])}`)
		if (uniqueSorted(admissionAllowedFiles).join(",") !== "config/defaults.json,src/config.ts") {
			configDetails.push(`allowedFiles=${admissionAllowedFiles.join(",")}`)
		}
		if (asString(summary.status) !== "done") configDetails.push(`status=${String(summary.status)}`)
		if (asString(summary.pathChosen) !== "semi_open") configDetails.push(`path=${String(summary.pathChosen)}`)
		if (asString(summary.reviewerVerdict) !== "PASS") configDetails.push(`reviewer=${String(summary.reviewerVerdict)}`)
		if (asString(derivation?.["taskClass"]) !== "config_sync") configDetails.push(`taskClass=${String(derivation?.["taskClass"])}`)
		if (!asRecord(summary.acceptanceGate)?.["passed"]) configDetails.push("acceptance gate did not pass")
		if (!changedFiles.includes("config/defaults.json")) {
			configDetails.push(`changedFiles=${changedFiles.join(",")}`)
		}
		const defaultsText = readWorkspaceFile(configRepo.workspace, "config/defaults.json")
		if (!defaultsText.includes('"notes": "semi-open config sync"')) {
			configDetails.push("config/defaults.json missing required config-sync snippet")
		}
		try {
			JSON.parse(defaultsText)
		} catch {
			configDetails.push("config/defaults.json is not valid JSON after config-sync row")
		}
		const verification = asRecord(summary.verificationProfile)
		const verificationStatus = asString(verification?.["status"])
		if (verificationStatus !== "passed" && verificationStatus !== "not_applicable") {
			configDetails.push(`verification=${String(verificationStatus)}`)
		}
		if (!(await repoIsClean(configRepo.workspace))) configDetails.push("workspace was dirty after config row")
		checks.push({
			label: "Live config-sync semi-open row",
			passed: configDetails.length === 0,
			details: configDetails.length > 0 ? configDetails : ["config-sync lane completed with bounded scope and verification PASS"],
		})
	} catch (err) {
		checks.push({
			label: "Live config-sync semi-open row",
			passed: false,
			details: formatHarnessError(err),
		})
	} finally {
		if (fs.existsSync(configRepo.workspace)) fs.rmSync(configRepo.workspace, { recursive: true, force: true })
	}

	return checks
}

export async function runSemiOpenHarness(): Promise<HarnessResult> {
	return {
		fixtureChecks: await runFixtureChecks(),
		liveChecks: await runLiveChecks(),
	}
}

export function formatSemiOpenHarness(result: HarnessResult): string {
	const lines = ["Fixture checks:"]
	for (const check of result.fixtureChecks) {
		lines.push(`- ${check.label}: ${check.passed ? "PASS" : "FAIL"}`)
		if (!check.passed && check.details.length > 0) {
			lines.push(`  details: ${check.details.join(" | ")}`)
		}
	}
	lines.push("Live checks:")
	for (const check of result.liveChecks) {
		lines.push(`- ${check.label}: ${check.passed ? "PASS" : "FAIL"}`)
		if (!check.passed && check.details.length > 0) {
			lines.push(`  details: ${check.details.join(" | ")}`)
		}
	}
	return lines.join("\n")
}

async function main(): Promise<void> {
	const result = await runSemiOpenHarness()
	console.log(formatSemiOpenHarness(result))
	const allPassed = [...result.fixtureChecks, ...result.liveChecks].every((check) => check.passed)
	process.exit(allPassed ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:semiopen] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
