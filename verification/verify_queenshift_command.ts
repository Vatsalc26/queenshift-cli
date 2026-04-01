import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { QUEENSHIFT_COMMAND } from "../src/cli/CommandSurface"
import { buildShellIncidentCommandSpec, buildShellLaunchSpec } from "../src/shell/ThinShell"

const QUEENSHIFT_PACKAGE_NAME = "queenshift-cli"

type CommandCapture = {
	code: number | null
	stdout: string
	stderr: string
}

type PackageJsonShape = {
	name?: string
	version?: string
	main?: string
	bin?: Record<string, string>
	scripts?: Record<string, string>
}

export type QueenshiftCommandHarnessResult = {
	packageNamePresent: boolean
	packageScriptPresent: boolean
	packageBinPresent: boolean
	packageMainPresent: boolean
	linkedBinaryInstallWorks: boolean
	linkedBinaryDirectTaskWorks: boolean
	shellPreviewUsesQueenshift: boolean
	shellStillLaunchesCompiledCli: boolean
	incidentPreviewUsesQueenshift: boolean
	installDocsAligned: boolean
	ideDocsAligned: boolean
	productReadinessAligned: boolean
	verificationCatalogAligned: boolean
	architectureDecisionRecorded: boolean
	details: string[]
}

type LinkedBinaryProofResult = {
	installWorks: boolean
	directTaskWorks: boolean
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function resolveNpmCommand(): string {
	return process.platform === "win32" ? "npm.cmd" : "npm"
}

function resolveLinkedCommandPath(prefixDir: string): string {
	return process.platform === "win32"
		? path.join(prefixDir, `${QUEENSHIFT_COMMAND}.cmd`)
		: path.join(prefixDir, "bin", QUEENSHIFT_COMMAND)
}

function quotePowerShellLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`
}

function resolveCommandSpec(command: string, args: string[]): { command: string; args: string[] } {
	if (process.platform !== "win32") {
		return { command, args }
	}

	return {
		command: "powershell.exe",
		args: ["-NoProfile", "-Command", ["&", quotePowerShellLiteral(command), ...args.map(quotePowerShellLiteral)].join(" ")],
	}
}

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<CommandCapture> {
	const timeoutMs = options.timeoutMs ?? 120_000
	const commandSpec = resolveCommandSpec(command, args)
	return await new Promise((resolve, reject) => {
		let child
		try {
			child = spawn(commandSpec.command, commandSpec.args, {
				cwd: options.cwd,
				env: options.env,
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			})
		} catch (err) {
			reject(
				new Error(
					`spawn ${commandSpec.command} ${commandSpec.args.join(" ")} failed before launch: ${
						err instanceof Error ? err.message : String(err)
					}`,
				),
			)
			return
		}

		let stdout = ""
		let stderr = ""

		child.stdout?.setEncoding("utf8")
		child.stderr?.setEncoding("utf8")
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk
		})
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk
		})

		const timeout = setTimeout(() => {
			try {
				child.kill()
			} catch {
				// ignore timeout kill failure
			}
		}, timeoutMs)
		timeout.unref?.()

		child.once("error", (err) => {
			clearTimeout(timeout)
			reject(
				new Error(
					`spawn ${commandSpec.command} ${commandSpec.args.join(" ")} failed: ${
						err instanceof Error ? err.message : String(err)
					}`,
				),
			)
		})
		child.once("close", (code) => {
			clearTimeout(timeout)
			resolve({
				code: typeof code === "number" ? code : null,
				stdout,
				stderr,
			})
		})
	})
}

async function runLinkedBinaryInstallProof(
	rootDir: string,
	packageVersion: string,
	workspace: string,
	details: string[],
): Promise<LinkedBinaryProofResult> {
	const linkPrefix = fs.mkdtempSync(path.join(os.tmpdir(), "queenshift-link-"))
	const env = {
		...process.env,
		npm_config_prefix: linkPrefix,
		npm_config_cache: path.join(rootDir, ".npm-cache"),
	}

	try {
		const npmCommand = resolveNpmCommand()
		const linkResult = await runCommandCapture(npmCommand, ["link"], {
			cwd: rootDir,
			env,
		})
		const linkedCommandPath = resolveLinkedCommandPath(linkPrefix)
		const commandExists = fs.existsSync(linkedCommandPath)
		const helpResult = commandExists
			? await runCommandCapture(linkedCommandPath, ["--help"], { cwd: rootDir, env })
			: { code: null, stdout: "", stderr: "missing linked command" }
		const versionResult = commandExists
			? await runCommandCapture(linkedCommandPath, ["--version"], { cwd: rootDir, env })
			: { code: null, stdout: "", stderr: "missing linked command" }
		const directTaskResult = commandExists
			? await runCommandCapture(
					linkedCommandPath,
					["add a brief comment to hello.ts", "--workspace", workspace, "--admitOnly"],
					{ cwd: rootDir, env },
			  )
			: { code: null, stdout: "", stderr: "missing linked command" }

		details.push(
			`link=${linkResult.code} help=${helpResult.code} version=${versionResult.code} directTask=${directTaskResult.code} linkedCommand=${linkedCommandPath}`,
		)

		return {
			installWorks:
				linkResult.code === 0 &&
				commandExists &&
				helpResult.code === 0 &&
				helpResult.stdout.includes("Queenshift CLI") &&
				helpResult.stdout.includes("Usage:") &&
				helpResult.stdout.includes("queenshift <task> --workspace <repo>") &&
				helpResult.stdout.includes("First coding task:") &&
				versionResult.code === 0 &&
				versionResult.stdout.includes(packageVersion),
			directTaskWorks:
				commandExists &&
				directTaskResult.code === 0 &&
				directTaskResult.stdout.includes("Admission decision:") &&
				directTaskResult.stdout.includes("Target files: hello.ts"),
		}
	} finally {
		if (fs.existsSync(linkPrefix)) fs.rmSync(linkPrefix, { recursive: true, force: true })
	}
}

export async function runQueenshiftCommandHarness(rootDir = resolveRootDir()): Promise<QueenshiftCommandHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as PackageJsonShape
	const installText = readText(rootDir, "SUPPORTED_INSTALL_SURFACES.md")
	const ideText = readText(rootDir, "IDE_SURFACES.md")
	const readinessText = readText(rootDir, "QUEENSHIFT_PRODUCT_READINESS_STACK.md")
	const verificationText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const workspace = path.join(rootDir, "verification", "test_workspace")
	const launchSpec = buildShellLaunchSpec(rootDir, "add a brief comment to hello.ts", workspace, { dryRun: true })
	const incidentSpec = buildShellIncidentCommandSpec(rootDir, "incident:rollback", workspace, "latest")

	const packageNamePresent = packageJson.name === QUEENSHIFT_PACKAGE_NAME
	const packageScriptPresent =
		packageJson.scripts?.["verify:queenshift:command"] ===
		"npm run build && node dist/verification/verify_queenshift_command.js"
	const packageBinPresent = packageJson.bin?.[QUEENSHIFT_COMMAND] === "./dist/swarm.js"
	const packageMainPresent = packageJson.main === "dist/swarm.js"
	const linkedBinaryProof = await runLinkedBinaryInstallProof(rootDir, packageJson.version ?? "", workspace, details)
	const linkedBinaryInstallWorks = linkedBinaryProof.installWorks
	const linkedBinaryDirectTaskWorks = linkedBinaryProof.directTaskWorks
	const shellPreviewUsesQueenshift =
		launchSpec.displayCommand.startsWith(`${QUEENSHIFT_COMMAND} `) &&
		launchSpec.displayCommand.includes('"add a brief comment to hello.ts"') &&
		!launchSpec.displayCommand.includes("--task") &&
		launchSpec.displayCommand.includes("--dryRun")
	const shellStillLaunchesCompiledCli =
		launchSpec.command === process.execPath &&
		path.resolve(launchSpec.cliEntry) === path.join(rootDir, "dist", "swarm.js") &&
		launchSpec.args.includes("--workspace") &&
		launchSpec.args.includes("add a brief comment to hello.ts") &&
		!launchSpec.args.includes("--task")
	const incidentPreviewUsesQueenshift =
		incidentSpec.displayCommand.startsWith(`${QUEENSHIFT_COMMAND} `) &&
		incidentSpec.displayCommand.includes("incident:rollback")
	const installDocsAligned = includesAll(installText, [
		"`queenshift-cli`",
		"`npm link`",
		"`queenshift`",
		"local Windows RC1 bundle",
	])
	const ideDocsAligned = includesAll(ideText, [
		"`queenshift` command preview",
		"`dist/swarm.js`",
		"summary.json",
	])
	const productReadinessAligned = includesAll(readinessText, [
		"## Session 266 Production Gate Answer",
		"production-ready normal-user CLI answer is still `NO`",
		"published normal-user install command",
		"local Windows bundle",
	])
	const verificationCatalogAligned = includesAll(verificationText, [
		"The current production-ready CLI gate answer relies on:",
		"`npm.cmd run verify:queenshift:command`",
		"`npm.cmd run verify:queenshift:doctor`",
		"`npm.cmd run verify:public-pack:readme`",
		"published normal-user install path",
	])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 266 records the final production-ready normal-user CLI gate as `NO`",
		"published normal-user install command",
		"experimental public release surface",
		"local Windows bundle",
	])

	details.push(
		`preview=${launchSpec.displayCommand}`,
		`incidentPreview=${incidentSpec.displayCommand}`,
		`cliEntry=${launchSpec.cliEntry}`,
	)

	return {
		packageNamePresent,
		packageScriptPresent,
		packageBinPresent,
		packageMainPresent,
		linkedBinaryInstallWorks,
		linkedBinaryDirectTaskWorks,
		shellPreviewUsesQueenshift,
		shellStillLaunchesCompiledCli,
		incidentPreviewUsesQueenshift,
		installDocsAligned,
		ideDocsAligned,
		productReadinessAligned,
		verificationCatalogAligned,
		architectureDecisionRecorded,
		details,
	}
}

export function formatQueenshiftCommandHarnessResult(result: QueenshiftCommandHarnessResult): string {
	return [
		`Package name present: ${result.packageNamePresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Package bin present: ${result.packageBinPresent ? "PASS" : "FAIL"}`,
		`Package main present: ${result.packageMainPresent ? "PASS" : "FAIL"}`,
		`Linked binary install works: ${result.linkedBinaryInstallWorks ? "PASS" : "FAIL"}`,
		`Linked binary direct task works: ${result.linkedBinaryDirectTaskWorks ? "PASS" : "FAIL"}`,
		`Shell preview uses Queenshift: ${result.shellPreviewUsesQueenshift ? "PASS" : "FAIL"}`,
		`Shell still launches compiled CLI: ${result.shellStillLaunchesCompiledCli ? "PASS" : "FAIL"}`,
		`Incident preview uses Queenshift: ${result.incidentPreviewUsesQueenshift ? "PASS" : "FAIL"}`,
		`Install docs aligned: ${result.installDocsAligned ? "PASS" : "FAIL"}`,
		`IDE docs aligned: ${result.ideDocsAligned ? "PASS" : "FAIL"}`,
		`Product readiness aligned: ${result.productReadinessAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenshiftCommandHarness()
	console.log(formatQueenshiftCommandHarnessResult(result))
	process.exit(
		result.packageNamePresent &&
			result.packageScriptPresent &&
			result.packageBinPresent &&
			result.packageMainPresent &&
			result.linkedBinaryInstallWorks &&
			result.linkedBinaryDirectTaskWorks &&
			result.shellPreviewUsesQueenshift &&
			result.shellStillLaunchesCompiledCli &&
			result.incidentPreviewUsesQueenshift &&
			result.installDocsAligned &&
			result.ideDocsAligned &&
			result.productReadinessAligned &&
			result.verificationCatalogAligned &&
			result.architectureDecisionRecorded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenshift:command] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
