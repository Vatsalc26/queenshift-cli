import fs from "node:fs"
import path from "node:path"

import { resolveOwnerProviderSelection } from "../src/owner/ProviderResolution"
import { findLatestRunSummary, readRunSummary } from "../src/run/RunArtifacts"
import { readShellSnapshot } from "../src/shell/ThinShell"
import { createTempTestRepoCopy, runVerificationGit } from "./test_workspace_baseline"
import {
	asRecord,
	commitFixtureChanges,
	hasSameFileSet,
	includesAll,
	readText,
	resolveRootDir,
	runCli,
} from "./queenbee_gateway_preview_helpers"

export type QueenBeeLiveGatewayHarnessResult = {
	packageScriptPresent: boolean
	liveGatewayPackPresent: boolean
	liveEvalMatrixAligned: boolean
	liveEvidencePackAligned: boolean
	gatewayTaskSetAligned: boolean
	reverseEngineeringAligned: boolean
	traceabilityAligned: boolean
	progressVisibilityAligned: boolean
	operatorConfidenceAligned: boolean
	reproAligned: boolean
	sideBySideAligned: boolean
	gapRegisterAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	providerConfigured: boolean
	firstGatewayRowObserved: boolean
	details: string[]
}

async function setupHelperTestFixture(repoPath: string): Promise<void> {
	const sourcePath = path.join(repoPath, "src", "format.ts")
	const testPath = path.join(repoPath, "src", "format.test.ts")
	fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
	fs.writeFileSync(sourcePath, `export function formatValue(input: string): string {\n\treturn input.trim()\n}\n`, "utf8")
	fs.writeFileSync(
		testPath,
		`import { formatValue } from "./format"\n\nexport function expectFormatValue(): string {\n\treturn formatValue(" hi ")\n}\n`,
		"utf8",
	)
	await commitFixtureChanges(repoPath, "verification live gateway helper-test baseline")
}

async function observeFirstGatewayRow(
	rootDir: string,
	env: NodeJS.ProcessEnv,
): Promise<{ passed: boolean; summaryPath: string | null; archivePath: string | null; details: string[] }> {
	const details: string[] = []
	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-live-gateway")
	try {
		await setupHelperTestFixture(fixture.repoPath)

		const task = 'update src/format.ts and keep its test aligned so both files include the exact comment "// queenbee: gateway helper"'
		const expectedFiles = ["src/format.ts", "src/format.test.ts"]
		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", task, "--workspace", fixture.repoPath], env)
		const summaryPath = findLatestRunSummary(fixture.repoPath)
		const summary = summaryPath ? readRunSummary<Record<string, unknown>>(path.dirname(summaryPath)) : null
		const shellSnapshot = readShellSnapshot(fixture.repoPath)
		const repoStatus = await runVerificationGit(fixture.repoPath, ["status", "--porcelain", "--untracked-files=all"])
		const repoCleanAfter = repoStatus.trim().length === 0
		const sourceText = fs.readFileSync(path.join(fixture.repoPath, "src", "format.ts"), "utf8")
		const testText = fs.readFileSync(path.join(fixture.repoPath, "src", "format.test.ts"), "utf8")
		const candidateProgressPath = path.join(fixture.repoPath, ".swarm", "queenbee-candidate", "latest-progress.json")

		const queenbeeLive = asRecord(summary?.["queenbeeLive"])
		const provider = asRecord(summary?.["provider"])
		const verificationProfile = asRecord(summary?.["verificationProfile"])
		const artifactRefs = asRecord(queenbeeLive?.["artifactRefs"])
		const scoutRelPath = typeof artifactRefs?.["scoutResult"] === "string" ? String(artifactRefs["scoutResult"]) : null
		const scoutAbsolutePath = scoutRelPath ? path.join(fixture.repoPath, scoutRelPath) : ""
		const scoutJson =
			scoutAbsolutePath && fs.existsSync(scoutAbsolutePath)
				? (JSON.parse(fs.readFileSync(scoutAbsolutePath, "utf8")) as Record<string, unknown>)
				: null
		const scoutPayload = asRecord(asRecord(scoutJson?.["responseEnvelope"])?.["payload"])
		const scoutTargets = Array.isArray(scoutPayload?.["targetFiles"]) ? (scoutPayload["targetFiles"] as string[]) : []
		const archiveRelPath = typeof queenbeeLive?.["archivePath"] === "string" ? String(queenbeeLive["archivePath"]) : null
		const archiveAbsolutePath = archiveRelPath ? path.join(fixture.repoPath, archiveRelPath) : ""
		const archiveJson =
			archiveAbsolutePath && fs.existsSync(archiveAbsolutePath)
				? (JSON.parse(fs.readFileSync(archiveAbsolutePath, "utf8")) as Record<string, unknown>)
				: null

		const cliAligned =
			cliResult.code === 0 &&
			cliResult.stdout.includes("[Swarm] Engine: queenbee (explicit)") &&
			cliResult.stdout.includes("[Swarm] Final status: done") &&
			cliResult.stdout.includes("[Swarm] QueenBee first live gateway row completed.") &&
			cliResult.stdout.includes("[Swarm] Live row: QB-LIVE-GW-01 (update_file_and_test) over src/format.ts, src/format.test.ts.") &&
			cliResult.stdout.includes("[Swarm] Gateway row: QB-GW-01.") &&
			cliResult.stdout.includes("[Swarm] Selected specialist: JSTSTestBee.") &&
			cliResult.stdout.includes("[Swarm] Provider call observed: yes.") &&
			cliResult.stdout.includes("[Swarm] Proof commands: npm.cmd test.") &&
			!cliResult.stderr.includes("[Swarm] Engine not ready.")

		const summaryAligned =
			Boolean(summaryPath) &&
			summary?.["engine"] === "queenbee" &&
			summary?.["status"] === "done" &&
			summary?.["stopReason"] === "success" &&
			provider?.["providerCallObserved"] === true &&
			provider?.["provider"] === "gemini" &&
			provider?.["model"] === "gemini-2.5-flash" &&
			verificationProfile?.["profileName"] === "queenbee_live_gateway" &&
			verificationProfile?.["status"] === "passed" &&
			queenbeeLive?.["rowId"] === "QB-LIVE-GW-01" &&
			queenbeeLive?.["canonicalRowId"] === "QB-CAN-05" &&
			queenbeeLive?.["gatewayRowId"] === "QB-GW-01" &&
			queenbeeLive?.["selectedSpecialist"] === "JSTSTestBee" &&
			queenbeeLive?.["taskFamily"] === "update_file_and_test" &&
			hasSameFileSet((queenbeeLive?.["changedFiles"] as string[]) ?? [], expectedFiles) &&
			Array.isArray(queenbeeLive?.["proofCommands"]) &&
			(queenbeeLive?.["proofCommands"] as string[]).join(",") === "npm.cmd test"

		const scoutAligned =
			Boolean(scoutJson) &&
			scoutJson?.["status"] === "delivered" &&
			scoutPayload?.["accepted"] === true &&
			hasSameFileSet(scoutTargets, expectedFiles) &&
			String(scoutPayload?.["scoutSummary"] ?? "").includes("helper/test scope")

		const shellSnapshotAligned =
			Boolean(summaryPath) &&
			shellSnapshot.summaryPath === summaryPath &&
			shellSnapshot.summaryText.includes(`Artifact: ${summaryPath}`) &&
			shellSnapshot.summaryText.includes('"rowId": "QB-LIVE-GW-01"') &&
			shellSnapshot.summaryText.includes('"gatewayRowId": "QB-GW-01"') &&
			shellSnapshot.summaryText.includes('"taskFamily": "update_file_and_test"') &&
			shellSnapshot.summaryText.includes('"providerCallObserved": true') &&
			shellSnapshot.forensicsText.includes("Terminal status: done") &&
			shellSnapshot.forensicsText.includes("Likely failure bucket: success")

		const archiveAligned =
			Boolean(archiveRelPath) &&
			Boolean(archiveJson) &&
			Boolean(archiveJson?.["assignmentId"]) &&
			Boolean(archiveJson?.["mergeSummary"]) &&
			Boolean(archiveJson?.["verifierSummary"])

		const passed =
			cliAligned &&
			summaryAligned &&
			scoutAligned &&
			shellSnapshotAligned &&
			archiveAligned &&
			repoCleanAfter &&
			sourceText.includes("// queenbee: gateway helper") &&
			testText.includes("// queenbee: gateway helper") &&
			!fs.existsSync(candidateProgressPath)

		details.push(
			`cliCode=${String(cliResult.code)}`,
			`summary=${summaryPath ?? "missing"}`,
			`archive=${archiveRelPath ?? "missing"}`,
			`scout=${scoutRelPath ?? "missing"}`,
			`repoCleanAfter=${repoCleanAfter ? "yes" : "no"}`,
			`stdout=${cliResult.stdout.replace(/\r?\n/g, " | ")}`,
		)

		return {
			passed,
			summaryPath,
			archivePath: archiveRelPath,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export async function runQueenBeeLiveGatewayHarness(rootDir = resolveRootDir()): Promise<QueenBeeLiveGatewayHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const liveGatewayPackText = readText(rootDir, "QUEENBEE_LIVE_GATEWAY_PACK.md")
	const liveEvalText = readText(rootDir, "QUEENBEE_LIVE_EVAL_MATRIX.md")
	const liveEvidenceText = readText(rootDir, "QUEENBEE_LIVE_EVIDENCE_PACK.md")
	const gatewayTaskSetText = readText(rootDir, "QUEENBEE_GATEWAY_TASK_SET.md")
	const reverseEngineeringText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const progressVisibilityText = readText(rootDir, "QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md")
	const confidenceText = readText(rootDir, "QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md")
	const reproText = readText(rootDir, "QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md")
	const sideBySideText = readText(rootDir, "QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:live:gateway"] === "npm run build && node dist/verification/verify_queenbee_live_gateway.js"

	const liveGatewayPackPresent = includesAll(liveGatewayPackText, [
		"`QB-LIVE-GW-01`",
		"`QB-GW-01`",
		"`QB-CAN-05`",
		"`currentStatus`: `live_pass`",
		"`bounded_live_pass`",
		"`true`",
		"`npm.cmd test`",
	])

	const liveEvalMatrixAligned = includesAll(liveEvalText, [
		"`QB-LIVE-GW-01`",
		"`QB-CAN-05`",
		"Session 241 first live gateway row for `QB-GW-01`",
		"`verify:queenbee:live:gateway`",
		"`live_pass`",
	])

	const liveEvidencePackAligned = includesAll(liveEvidenceText, [
		"## Session 241 First Gateway Live Pass",
		"`QB-LIVE-GW-01` now records `live_pass` with provider-backed scout compile, coding, review, repo-side verification, merge, and archive",
		"`QB-GW-02` through `QB-GW-04` remain proof-backed bounded gateway rows without provider-backed live execution",
		"`verify:queenbee:live:gateway`",
	])

	const gatewayTaskSetAligned = includesAll(gatewayTaskSetText, [
		"## Session 241 Live Gateway Answer",
		"`QB-GW-01` now records one provider-backed live gateway pass through `QB-LIVE-GW-01`",
		"`QB-GW-02` through `QB-GW-04` remain proof-backed bounded rows",
		"one `assignmentId`, one `specialist_queue` slot",
	])

	const reverseEngineeringAligned = includesAll(reverseEngineeringText, [
		"`QB-GW-01`",
		"provider-backed live on `QB-LIVE-GW-01` after Session 241",
		"`JSTSTestBee`",
		"## Session 241 Live Gateway Answer",
	])

	const traceabilityAligned = includesAll(traceabilityText, [
		"`QB-TR-14`",
		"`verify:queenbee:live:gateway`",
		"`QB-LIVE-GW-01`",
		"provider-backed live gateway pass",
	])

	const progressVisibilityAligned = includesAll(progressVisibilityText, [
		"## Session 241 Live Gateway Visibility",
		"`QB-GW-01`",
		"`registry_and_scout`",
		"`missionClosedAt`",
	])

	const operatorConfidenceAligned = includesAll(confidenceText, [
		"## Session 241 Live Gateway Confidence",
		"`QB-GW-01`",
		"`bounded_pass`",
		"`verify:queenbee:live:gateway`",
	])

	const reproAligned = includesAll(reproText, [
		"## Session 241 First Gateway Live Reading",
		"`QB-LIVE-GW-01`",
		"`providerCallObserved=true`",
		"`QB-GW-02` through `QB-GW-04`",
		"one semi-open helper/test gateway row",
	])

	const sideBySideAligned = includesAll(sideBySideText, [
		"## Session 241 Live Gateway Reading",
		"`QB-EX-08`",
		"`QB-LIVE-GW-01`",
		"`QB-EX-09` through `QB-EX-11` remain preview-hold evidence",
	])

	const gapRegisterAligned = includesAll(gapRegisterText, [
		"`QB-GAP-240-01`",
		"`CLOSED_SESSION_241`",
		"`QB-GW-01` now reuses the live lane",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 241 turns one proof-backed QueenBee gateway row into a real provider-backed live path",
		"**Session:** 241",
		"`QB-GW-01`",
		"`verify:queenbee:live:gateway`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B47 |",
		"Does QueenBee now have one provider-backed live gateway row while the remaining gateway rows stay bounded and explicit? | YES |",
		"`npm.cmd run verify:queenbee:live:gateway`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:live:gateway`",
		"the Session 241 live gateway pack now records `QB-LIVE-GW-01` as one provider-backed helper/test gateway row",
	])

	const providerSelection = resolveOwnerProviderSelection(process.env)
	const providerConfigured =
		providerSelection.provider === "gemini" &&
		providerSelection.ready &&
		providerSelection.model === "gemini-2.5-flash"

	details.push(
		`provider=${providerSelection.provider ?? "none"}`,
		`model=${providerSelection.model ?? "none"}`,
		`transport=${providerSelection.transport}`,
		`providerReady=${providerSelection.ready ? "yes" : "no"}`,
	)

	let firstGatewayRowObserved = false
	if (providerConfigured) {
		const observation = await observeFirstGatewayRow(rootDir, {
			...process.env,
			...providerSelection.envOverrides,
		})
		firstGatewayRowObserved = observation.passed
		details.push(
			`firstGatewayRow=${observation.passed ? "PASS" : "FAIL"}`,
			...observation.details.map((detail) => `QB-LIVE-GW-01:${detail}`),
		)
	} else {
		details.push(`providerReason=${providerSelection.reason}`)
	}

	return {
		packageScriptPresent,
		liveGatewayPackPresent,
		liveEvalMatrixAligned,
		liveEvidencePackAligned,
		gatewayTaskSetAligned,
		reverseEngineeringAligned,
		traceabilityAligned,
		progressVisibilityAligned,
		operatorConfidenceAligned,
		reproAligned,
		sideBySideAligned,
		gapRegisterAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		providerConfigured,
		firstGatewayRowObserved,
		details,
	}
}

export function formatQueenBeeLiveGatewayHarnessResult(result: QueenBeeLiveGatewayHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Live gateway pack present: ${result.liveGatewayPackPresent ? "PASS" : "FAIL"}`,
		`Live eval matrix aligned: ${result.liveEvalMatrixAligned ? "PASS" : "FAIL"}`,
		`Live evidence pack aligned: ${result.liveEvidencePackAligned ? "PASS" : "FAIL"}`,
		`Gateway task set aligned: ${result.gatewayTaskSetAligned ? "PASS" : "FAIL"}`,
		`Reverse-engineering aligned: ${result.reverseEngineeringAligned ? "PASS" : "FAIL"}`,
		`Traceability aligned: ${result.traceabilityAligned ? "PASS" : "FAIL"}`,
		`Progress visibility aligned: ${result.progressVisibilityAligned ? "PASS" : "FAIL"}`,
		`Operator confidence aligned: ${result.operatorConfidenceAligned ? "PASS" : "FAIL"}`,
		`Repro aligned: ${result.reproAligned ? "PASS" : "FAIL"}`,
		`Side-by-side aligned: ${result.sideBySideAligned ? "PASS" : "FAIL"}`,
		`Gap register aligned: ${result.gapRegisterAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Provider configured: ${result.providerConfigured ? "PASS" : "FAIL"}`,
		`First gateway row observed: ${result.firstGatewayRowObserved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeLiveGatewayHarness()
	console.log(formatQueenBeeLiveGatewayHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.liveGatewayPackPresent &&
			result.liveEvalMatrixAligned &&
			result.liveEvidencePackAligned &&
			result.gatewayTaskSetAligned &&
			result.reverseEngineeringAligned &&
			result.traceabilityAligned &&
			result.progressVisibilityAligned &&
			result.operatorConfidenceAligned &&
			result.reproAligned &&
			result.sideBySideAligned &&
			result.gapRegisterAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned &&
			result.providerConfigured &&
			result.firstGatewayRowObserved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:live:gateway] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
