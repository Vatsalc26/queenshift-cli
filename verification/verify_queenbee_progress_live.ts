import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

import { readShellSnapshot } from "../src/shell/ThinShell"
import { createTempTestRepoCopy, runVerificationGit } from "./test_workspace_baseline"

export type QueenBeeProgressLiveHarnessResult = {
	packageScriptPresent: boolean
	progressContractAligned: boolean
	confidenceContractAligned: boolean
	publicUsabilityAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	cliPreviewVisible: boolean
	selectedSpecialistVisible: boolean
	progressArtifactWritten: boolean
	shellSnapshotAligned: boolean
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

async function runCli(rootDir: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return await new Promise((resolve, reject) => {
		const tmpDir = path.join(rootDir, ".swarm", "tmp")
		fs.mkdirSync(tmpDir, { recursive: true })
		const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
		const stdoutPath = path.join(tmpDir, `queenbee-progress-live-${stamp}.stdout.log`)
		const stderrPath = path.join(tmpDir, `queenbee-progress-live-${stamp}.stderr.log`)
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

		const child = spawn(process.execPath, ["dist/swarm.js", ...args], {
			cwd: rootDir,
			env: process.env,
			windowsHide: true,
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
			resolve({ code, stdout, stderr })
		})
	})
}

export async function runQueenBeeProgressLiveHarness(rootDir = resolveRootDir()): Promise<QueenBeeProgressLiveHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const progressText = readText(rootDir, "QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md")
	const confidenceText = readText(rootDir, "QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md")
	const publicUsabilityText = readText(rootDir, "QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:progress-live"] ===
		"npm run build && node dist/verification/verify_queenbee_progress_live.js"

	const progressContractAligned = includesAll(progressText, [
		"## Session 229 Candidate Preview Lane",
		"`.swarm/queenbee-candidate/latest-progress.json`",
		"`candidate_not_ready`",
		"`candidate_preview_only`",
		"`executionAttempted` should stay `false`",
		"no live coding, review, verification, or merge was executed",
	])

	const confidenceContractAligned = includesAll(confidenceText, [
		"`confidenceOutcome`",
		"`candidate_preview_only`",
		"`candidate_engine_not_ready`",
		"## Session 229 Candidate Preview Stop",
		"no live coding, review, verification, or merge was executed",
	])

	const publicUsabilityAligned = includesAll(publicUsabilityText, [
		"## Session 229 Progress Preview Alignment",
		"`QB-PUR-04`",
		"`QB-PUR-08`",
		"`QB-PUR-10`",
		"`.swarm/queenbee-candidate/latest-progress.json`",
		"`verify:queenbee:progress-live`",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 229 surfaces a calm QueenBee candidate progress preview before live execution exists",
		"**Session:** 229",
		"`.swarm/queenbee-candidate/latest-progress.json`",
		"`verify:queenbee:progress-live`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B35 |",
		"`QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md`",
		"`QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md`",
		"`npm.cmd run verify:queenbee:progress-live`",
		"candidate preview artifact",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"52. `npm.cmd run verify:queenbee:progress-live`",
		"54. the Session 229 candidate preview now surfaces timestamped stage, queue, specialist, timeout, and next-handoff truth through the CLI and thin-shell artifact view without pretending live QueenBee execution exists",
	])

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-progress-live")
	try {
		const cliPath = path.join(fixture.repoPath, "src", "cli.ts")
		fs.mkdirSync(path.dirname(cliPath), { recursive: true })
		fs.writeFileSync(cliPath, `export function currentArgs(): string[] {\n\treturn process.argv.slice(2)\n}\n`, "utf8")

		const oldSummaryDir = path.join(fixture.repoPath, ".swarm", "runs", "older-preview-baseline")
		const oldSummaryPath = path.join(oldSummaryDir, "summary.json")
		fs.mkdirSync(oldSummaryDir, { recursive: true })
		fs.writeFileSync(
			oldSummaryPath,
			`${JSON.stringify(
				{
					task: "older baseline",
					status: "review_required",
					stopReason: "review_blocked",
				},
				null,
				2,
			)}\n`,
			"utf8",
		)

		await runVerificationGit(fixture.repoPath, ["add", "-A"])
		await runVerificationGit(fixture.repoPath, ["commit", "-m", "verification queenbee progress preview baseline"])

		const task = "update src/cli.ts to keep cli argument handling bounded"
		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", task, "--workspace", fixture.repoPath, "--dryRun"])
		const artifactPath = path.join(fixture.repoPath, ".swarm", "queenbee-candidate", "latest-progress.json")
		const artifactExists = fs.existsSync(artifactPath)
		const artifactRaw = artifactExists ? fs.readFileSync(artifactPath, "utf8") : ""
		const artifact = artifactExists
			? (JSON.parse(artifactRaw) as {
					engine?: string
					status?: string
					stopReason?: string
					taskFamilyHint?: string | null
					activeQueue?: string
					currentStage?: string
					selectedSpecialist?: string | null
					allowedFiles?: string[]
					confidenceOutcome?: string
					executionAttempted?: boolean
					missionId?: string
					assignmentId?: string | null
					lastEventAt?: string
					nextTimeoutAt?: string | null
					nextExpectedHandoff?: string
			  })
			: null

		const cliPreviewVisible =
			cliResult.code === 1 &&
			cliResult.stdout.includes("[Swarm] Engine: queenbee (explicit)") &&
			cliResult.stdout.includes("[Swarm] Final status: candidate_not_ready") &&
			cliResult.stdout.includes("Timestamped progress preview:") &&
			cliResult.stdout.includes("Preview headline: proposal in specialist_queue; next proposal via JSTSNodeBee, but the candidate runtime stops before live execution.") &&
			cliResult.stdout.includes("Preview stage: proposal (specialist_queue).") &&
			cliResult.stdout.includes(`Progress artifact: ${artifactPath}.`) &&
			cliResult.stderr.includes("[Swarm] Engine not ready.")

		const selectedSpecialistVisible =
			cliResult.stdout.includes("Current bounded candidate hint: bounded_node_cli_task over src/cli.ts.") &&
			cliResult.stdout.includes("Selected specialist: JSTSNodeBee.")

		const progressArtifactWritten =
			Boolean(artifact) &&
			artifact?.engine === "queenbee" &&
			artifact?.status === "candidate_not_ready" &&
			artifact?.stopReason === "candidate_engine_not_ready" &&
			artifact?.taskFamilyHint === "bounded_node_cli_task" &&
			artifact?.activeQueue === "specialist_queue" &&
			artifact?.currentStage === "proposal" &&
			artifact?.selectedSpecialist === "JSTSNodeBee" &&
			Array.isArray(artifact?.allowedFiles) &&
			artifact?.allowedFiles?.includes("src/cli.ts") &&
			artifact?.confidenceOutcome === "candidate_preview_only" &&
			artifact?.executionAttempted === false &&
			typeof artifact?.missionId === "string" &&
			artifact.missionId.startsWith("qb-preview-mission-") &&
			artifact?.assignmentId === "qb-preview-bounded_node_cli_task" &&
			typeof artifact?.lastEventAt === "string" &&
			typeof artifact?.nextTimeoutAt === "string" &&
			artifact?.nextExpectedHandoff?.includes("JSTSNodeBee") === true

		const shellSnapshot = readShellSnapshot(fixture.repoPath)
		const shellSnapshotAligned =
			shellSnapshot.summaryPath === null &&
			shellSnapshot.summaryText.includes(`Artifact: ${artifactPath}`) &&
			shellSnapshot.summaryText.includes('"selectedSpecialist": "JSTSNodeBee"') &&
			shellSnapshot.summaryText.includes('"confidenceOutcome": "candidate_preview_only"') &&
			shellSnapshot.runtimeText.includes("Runtime summary:") &&
			shellSnapshot.runtimeText.includes("Engine: queenbee") &&
			shellSnapshot.runtimeText.includes("Path: bounded_node_cli_task") &&
			shellSnapshot.runtimeText.includes(
				"Visible progress: stage=proposal | queue=specialist_queue | specialist=JSTSNodeBee | confidence=candidate_preview_only",
			) &&
			shellSnapshot.runtimeText.includes("Next step: (preview only)") &&
			shellSnapshot.forensicsText.includes("QueenBee candidate progress preview") &&
			shellSnapshot.forensicsText.includes(
				"Headline: proposal in specialist_queue; next proposal via JSTSNodeBee, but the candidate runtime stops before live execution",
			) &&
			shellSnapshot.forensicsText.includes("Stage: proposal (specialist_queue)") &&
			shellSnapshot.forensicsText.includes("Selected specialist: JSTSNodeBee") &&
			shellSnapshot.forensicsText.includes("Confidence outcome: candidate_preview_only") &&
			shellSnapshot.forensicsText.includes("Stop reason: candidate_engine_not_ready")

		details.push(
			`cliCode=${String(cliResult.code)}`,
			`artifact=${artifactExists ? artifactPath : "(missing)"}`,
			`stdout=${cliResult.stdout.replace(/\r?\n/g, " | ")}`,
		)

		return {
			packageScriptPresent,
			progressContractAligned,
			confidenceContractAligned,
			publicUsabilityAligned,
			architectureDecisionRecorded,
			capabilityChecklistAligned,
			verificationCatalogAligned,
			cliPreviewVisible,
			selectedSpecialistVisible,
			progressArtifactWritten,
			shellSnapshotAligned,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeProgressLiveHarnessResult(result: QueenBeeProgressLiveHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Progress contract aligned: ${result.progressContractAligned ? "PASS" : "FAIL"}`,
		`Confidence contract aligned: ${result.confidenceContractAligned ? "PASS" : "FAIL"}`,
		`Public usability aligned: ${result.publicUsabilityAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`CLI preview visible: ${result.cliPreviewVisible ? "PASS" : "FAIL"}`,
		`Selected specialist visible: ${result.selectedSpecialistVisible ? "PASS" : "FAIL"}`,
		`Progress artifact written: ${result.progressArtifactWritten ? "PASS" : "FAIL"}`,
		`Shell snapshot aligned: ${result.shellSnapshotAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeProgressLiveHarness()
	console.log(formatQueenBeeProgressLiveHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.progressContractAligned &&
			result.confidenceContractAligned &&
			result.publicUsabilityAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned &&
			result.cliPreviewVisible &&
			result.selectedSpecialistVisible &&
			result.progressArtifactWritten &&
			result.shellSnapshotAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:progress-live] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
