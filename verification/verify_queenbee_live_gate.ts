import fs from "node:fs"
import path from "node:path"

export type QueenBeeLiveGateHarnessResult = {
	packageScriptPresent: boolean
	proportionalGateAligned: boolean
	liveEvalMatrixAligned: boolean
	liveEvidencePackAligned: boolean
	timeoutMatrixAligned: boolean
	gatewayTaskSetAligned: boolean
	reverseEngineeringAligned: boolean
	gapRegisterAligned: boolean
	verificationCatalogAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	betaBoundaryPreserved: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	const absolutePath = path.join(rootDir, relativePath)
	return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : ""
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeLiveGateHarness(rootDir = resolveRootDir()): Promise<QueenBeeLiveGateHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const proportionalGateText = readText(rootDir, "QUEENBEE_PROPORTIONAL_EXPANSION_GATE.md")
	const liveEvalText = readText(rootDir, "QUEENBEE_LIVE_EVAL_MATRIX.md")
	const liveEvidenceText = readText(rootDir, "QUEENBEE_LIVE_EVIDENCE_PACK.md")
	const timeoutText = readText(rootDir, "QUEENBEE_TIMEOUT_AND_TTL_MATRIX.md")
	const gatewayTaskSetText = readText(rootDir, "QUEENBEE_GATEWAY_TASK_SET.md")
	const reverseEngineeringText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const betaGateText = readText(rootDir, "QUEENBEE_BETA_GATE.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:live-gate"] === "npm run build && node dist/verification/verify_queenbee_live_gate.js"

	const proportionalGateAligned = includesAll(proportionalGateText, [
		"Current gate answer: `SERIOUS_BOUNDED_DAILY_JSTS_SURFACE`",
		"On `2026-04-01`, QueenBee has five provider-backed canonical live rows, one provider-backed gateway live row, one fixed six-row daily JS/TS corpus with acceptance fixtures",
		"one row-aligned small-file quality lane",
		"one five-row natural-language hold pack",
		"Phase C may begin, but only inside the same bounded envelope",
		"`QB-LIVE-03`, `QB-LIVE-07`, `QB-LIVE-NL-01` through `QB-LIVE-NL-05`, and `QB-GW-02` through `QB-GW-04` explicit",
		"## Session 274 Daily JS/TS Capability Gate",
	])

	const liveEvalMatrixAligned = includesAll(liveEvalText, [
		"`QB-LIVE-01` | `QB-CAN-01`",
		"`QB-LIVE-06` | `QB-CAN-07`",
		"`QB-LIVE-07` | `QB-CAN-02`",
		"`QB-LIVE-NL-05` | `QB-CAN-06`",
		"`QB-LIVE-GW-01` | `QB-CAN-05`",
		"Session 270 now records provider-backed live canonical rows for `QB-LIVE-01`, `QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, and `QB-LIVE-06`",
		"Session 234 and Session 273 now record one supported-provider-configured natural-language hold pack for `QB-LIVE-NL-01` through `QB-LIVE-NL-05`",
		"`QB-LIVE-GW-01` now records one provider-backed live gateway row for `QB-GW-01`",
		"benchmark, capability, and gate surfaces should cite `QB-LIVE-01`, `QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, `QB-LIVE-06`, and `QB-LIVE-GW-01` as the current provider-backed live anchors for this band",
	])

	const liveEvidencePackAligned = includesAll(liveEvidenceText, [
		"## Session 242 Live Execution Gate",
		"the canonical pack is now a mixed live pack: `QB-LIVE-01`, `QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, and `QB-LIVE-06` are real `live_pass` rows",
		"the gateway pack now adds `QB-LIVE-GW-01` as one real `live_pass`",
		"the natural-language pack still remains a truthful hold pack",
		"## Session 273 Repo-Local UI Anchor Reading",
		"`QB-LIVE-NL-05` now joins the natural-language hold pack",
		"`missionClosedAt` for `QB-LIVE-01`, `QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, `QB-LIVE-06`, and `QB-LIVE-GW-01`",
	])

	const timeoutMatrixAligned = includesAll(timeoutText, [
		"## Session 274 Capability-Gate Timing Reading",
		"`missionClosedAt` is now observed for `QB-LIVE-01`, `QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, `QB-LIVE-06`, and `QB-LIVE-GW-01`",
		"`lastEventAt` and `nextTimeoutAt` for `QB-LIVE-03`, `QB-LIVE-07`, `QB-LIVE-NL-01` through `QB-LIVE-NL-05`, and `QB-GW-02` through `QB-GW-04`",
		"the bounded daily JS/TS capability gate should cite the six completed rows plus the remaining preview clocks explicitly",
	])

	const gatewayTaskSetAligned = includesAll(gatewayTaskSetText, [
		"## Session 274 Daily Capability Gate Reading",
		"one provider-backed live row on `QB-GW-01`, three proof-backed bounded rows on `QB-GW-02` through `QB-GW-04`, and one shared aggregate proof bundle `verify:queenbee:gateway`",
		"serious bounded daily JS/TS capability surface",
		"`QB-GW-02` through `QB-GW-04` remain proof-backed or hold-only and do not inherit live status from `QB-LIVE-GW-01`",
	])

	const reverseEngineeringAligned = includesAll(reverseEngineeringText, [
		"## Session 274 Daily Capability Answer",
		"five daily canonical rows now have provider-backed live anchors: `QB-CAN-01`, `QB-CAN-03`, `QB-CAN-04`, `QB-CAN-05`, and `QB-CAN-07`",
		"`QB-CAN-06` and internal `QB-CAN-02` remain supported but live-hold only",
		"the gateway band adds one live row plus three proof-backed rows",
		"serious bounded daily JS/TS capability surface",
	])

	const gapRegisterAligned = includesAll(gapRegisterText, [
		"`QB-GAP-274-01`",
		"`CLOSED_SESSION_274`",
		"## Session 274 Reading",
		"serious bounded daily JS/TS capability surface",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:live-gate`",
		"the Session 274 daily JS/TS capability gate now records QueenBee as a serious bounded daily JS/TS capability surface",
		"five provider-backed canonical live rows",
		"one provider-backed gateway live row",
		"remaining hold rows stay explicit",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 274 records QueenBee as a serious bounded daily JS/TS capability surface and opens Phase C inside the same envelope",
		"**Session:** 274",
		"`verify:queenbee:live-gate`",
		"`verify:queenbee:gateway`",
		"`verify:task-corpus`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B64 |",
		"serious bounded daily JS/TS capability surface",
		"`QUEENBEE_PROPORTIONAL_EXPANSION_GATE.md`",
		"`npm.cmd run verify:queenbee:live-gate`",
		"`npm.cmd run verify:task-corpus`",
		"same-assignment clone workers stay deferred",
	])

	const betaBoundaryPreserved =
		includesAll(betaGateText, [
			"Current gate answer: `EXPERIMENTAL_BETA_OK`",
			"`swarmengine` remains the shipped bounded engine",
			"`queenbee` remains experimental",
		]) &&
		includesAll(proportionalGateText, [
			"`swarmengine` remains the shipped bounded engine",
			"`queenbee` remains experimental",
			"keep default-engine, cross-tool, frontier-parity, and arbitrary-repo claims closed",
		])

	details.push(
		`proportionalGateAligned=${proportionalGateAligned ? "yes" : "no"}`,
		`liveEvalMatrixAligned=${liveEvalMatrixAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		proportionalGateAligned,
		liveEvalMatrixAligned,
		liveEvidencePackAligned,
		timeoutMatrixAligned,
		gatewayTaskSetAligned,
		reverseEngineeringAligned,
		gapRegisterAligned,
		verificationCatalogAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		betaBoundaryPreserved,
		details,
	}
}

export function formatQueenBeeLiveGateHarnessResult(result: QueenBeeLiveGateHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Proportional gate aligned: ${result.proportionalGateAligned ? "PASS" : "FAIL"}`,
		`Live eval matrix aligned: ${result.liveEvalMatrixAligned ? "PASS" : "FAIL"}`,
		`Live evidence pack aligned: ${result.liveEvidencePackAligned ? "PASS" : "FAIL"}`,
		`Timeout matrix aligned: ${result.timeoutMatrixAligned ? "PASS" : "FAIL"}`,
		`Gateway task set aligned: ${result.gatewayTaskSetAligned ? "PASS" : "FAIL"}`,
		`Reverse-engineering aligned: ${result.reverseEngineeringAligned ? "PASS" : "FAIL"}`,
		`Gap register aligned: ${result.gapRegisterAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Beta boundary preserved: ${result.betaBoundaryPreserved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeLiveGateHarness()
	console.log(formatQueenBeeLiveGateHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.proportionalGateAligned &&
			result.liveEvalMatrixAligned &&
			result.liveEvidencePackAligned &&
			result.timeoutMatrixAligned &&
			result.gatewayTaskSetAligned &&
			result.reverseEngineeringAligned &&
			result.gapRegisterAligned &&
			result.verificationCatalogAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.betaBoundaryPreserved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:live-gate] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
