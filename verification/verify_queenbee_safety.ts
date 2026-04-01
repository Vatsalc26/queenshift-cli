import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { evaluateAdmission } from "../src/run/AdmissionGate"
import { resolveRuntimeConfig } from "../src/run/RuntimeConfig"
import { CommandGate } from "../src/safety/CommandGate"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeSafetyHarnessResult = {
	safetyDocsPresent: boolean
	shellContainsSafetyBee: boolean
	admissionBridgeAligned: boolean
	commandPolicyBridgeAligned: boolean
	workspaceGuardBridgeAligned: boolean
	guardrailPolicyBridgeAligned: boolean
	packageScriptPresent: boolean
	details: string[]
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

export async function runQueenBeeSafetyHarness(rootDir = resolveRootDir()): Promise<QueenBeeSafetyHarnessResult> {
	const details: string[] = []
	const shell = createQueenBeeShell()
	const toolGrantsText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const safetyDocsPresent =
		includesAll(toolGrantsText, [
			"## Session 189 Safety Bridge",
			"`evaluateAdmission`",
			"`WorkspaceLock.validatePath`",
			"`CommandGate.validate`",
			"`resolveRuntimeConfig`",
			"`verify:queenbee:safety`",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee SafetyBee reuses shipped safety truth",
			"**Session:** 189",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:safety`", "admission, workspace, command-policy, and guardrail bridges stay fail-closed"])

	const shellContainsSafetyBee = shell.registeredBeeIds.includes("queenbee.safety.001") && typeof shell.safety === "object" && shell.safety !== null

	let admissionBridgeAligned = false
	let commandPolicyBridgeAligned = false
	let workspaceGuardBridgeAligned = false
	let guardrailPolicyBridgeAligned = false

	const repo = await createTempTestRepoCopy(rootDir, "queenbee-safety")
	try {
		const directAdmission = await evaluateAdmission({
			workspace: repo.repoPath,
			task: "add a brief comment to hello.ts",
		})
		const shellAdmission = await shell.safety.evaluateMissionAdmission({
			workspace: repo.repoPath,
			task: "add a brief comment to hello.ts",
		})
		admissionBridgeAligned =
			directAdmission.decision === shellAdmission.decision &&
			directAdmission.repo.decision === shellAdmission.repo.decision &&
			directAdmission.task.decision === shellAdmission.task.decision &&
			directAdmission.task.targetFiles.join(",") === shellAdmission.task.targetFiles.join(",")

		const directBlocked = CommandGate.validate("npm install")
		const directAllowed = CommandGate.validate("node scripts/verify.js")
		const shellBlocked = shell.safety.validateCommandPolicy("npm install")
		const shellAllowed = shell.safety.validateCommandPolicy("node scripts/verify.js")
		commandPolicyBridgeAligned =
			directBlocked.allowed === shellBlocked.allowed &&
			directAllowed.allowed === shellAllowed.allowed &&
			(shellBlocked.reason ?? "").includes("allowlist") &&
			shellAllowed.allowed === true

		const workspaceAllowed = shell.safety.validateWorkspacePath(repo.repoPath, path.join(repo.repoPath, "hello.ts"))
		const workspaceBlocked = shell.safety.validateWorkspacePath(repo.repoPath, "C:\\Windows\\System32\\evil.txt")
		workspaceGuardBridgeAligned =
			workspaceAllowed.allowed === true &&
			workspaceBlocked.allowed === false &&
			(workspaceBlocked.reason ?? "").includes("outside workspace")

		const shellGuardrails = shell.safety.readGuardrailPolicy(process.env)
		const directGuardrails = resolveRuntimeConfig(process.env)
		guardrailPolicyBridgeAligned =
			shellGuardrails.overallRunCeilingMs === directGuardrails.overallRunCeilingMs &&
			shellGuardrails.providerCallTimeoutMs === directGuardrails.providerCallTimeoutMs &&
			shellGuardrails.agentWaitTimeoutMs === directGuardrails.agentWaitTimeoutMs &&
			shellGuardrails.maxConcurrentLiveRunsPerWorkspace === directGuardrails.maxConcurrentLiveRunsPerWorkspace &&
			shellGuardrails.maxModelCallsPerRun === directGuardrails.maxModelCallsPerRun &&
			shellGuardrails.smallTaskMaxModelCalls === directGuardrails.smallTaskMaxModelCalls &&
			shellGuardrails.mediumTaskMaxModelCalls === directGuardrails.mediumTaskMaxModelCalls &&
			shellGuardrails.maxEstimatedTokensPerRun === directGuardrails.maxEstimatedTokensPerRun &&
			shellGuardrails.smallTaskMaxEstimatedTokens === directGuardrails.smallTaskMaxEstimatedTokens &&
			shellGuardrails.mediumTaskMaxEstimatedTokens === directGuardrails.mediumTaskMaxEstimatedTokens

		details.push(
			`admissionDecision=${shellAdmission.decision}`,
			`blockedCommandReason=${shellBlocked.reason ?? "missing"}`,
			`workspaceBlockedReason=${workspaceBlocked.reason ?? "missing"}`,
			`guardrailCeiling=${shellGuardrails.overallRunCeilingMs}`,
		)
	} finally {
		repo.cleanup()
	}

	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:safety"] === "npm run build && node dist/verification/verify_queenbee_safety.js"

	return {
		safetyDocsPresent,
		shellContainsSafetyBee,
		admissionBridgeAligned,
		commandPolicyBridgeAligned,
		workspaceGuardBridgeAligned,
		guardrailPolicyBridgeAligned,
		packageScriptPresent,
		details,
	}
}

export function formatQueenBeeSafetyHarnessResult(result: QueenBeeSafetyHarnessResult): string {
	return [
		`Safety docs present: ${result.safetyDocsPresent ? "PASS" : "FAIL"}`,
		`Shell contains SafetyBee: ${result.shellContainsSafetyBee ? "PASS" : "FAIL"}`,
		`Admission bridge aligned: ${result.admissionBridgeAligned ? "PASS" : "FAIL"}`,
		`Command-policy bridge aligned: ${result.commandPolicyBridgeAligned ? "PASS" : "FAIL"}`,
		`Workspace guard bridge aligned: ${result.workspaceGuardBridgeAligned ? "PASS" : "FAIL"}`,
		`Guardrail policy bridge aligned: ${result.guardrailPolicyBridgeAligned ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeSafetyHarness()
	console.log(formatQueenBeeSafetyHarnessResult(result))
	process.exit(
		result.safetyDocsPresent &&
			result.shellContainsSafetyBee &&
			result.admissionBridgeAligned &&
			result.commandPolicyBridgeAligned &&
			result.workspaceGuardBridgeAligned &&
			result.guardrailPolicyBridgeAligned &&
			result.packageScriptPresent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:safety] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
