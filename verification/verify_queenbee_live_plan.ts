import fs from "node:fs"
import path from "node:path"

export type QueenBeeLivePlanHarnessResult = {
	packageScriptPresent: boolean
	liveEvalMatrixPresent: boolean
	liveEvidencePackPresent: boolean
	rubricAligned: boolean
	reproAligned: boolean
	benchmarkAligned: boolean
	sideBySideAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
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

export async function runQueenBeeLivePlanHarness(rootDir = resolveRootDir()): Promise<QueenBeeLivePlanHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const liveEvalMatrixText = readText(rootDir, "QUEENBEE_LIVE_EVAL_MATRIX.md")
	const liveEvidencePackText = readText(rootDir, "QUEENBEE_LIVE_EVIDENCE_PACK.md")
	const rubricText = readText(rootDir, "QUEENBEE_EXPERT_EVAL_RUBRIC.md")
	const reproText = readText(rootDir, "QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md")
	const benchmarkText = readText(rootDir, "QUEENBEE_BENCHMARK_PLAN.md")
	const sideBySideText = readText(rootDir, "QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:live-plan"] === "npm run build && node dist/verification/verify_queenbee_live_plan.js"

	const liveEvalMatrixPresent = includesAll(liveEvalMatrixText, [
		"# QueenBee Live Eval Matrix",
		"`QB-LIVE-01`",
		"`QB-LIVE-06`",
		"`QB-LIVE-07`",
		"`providerName`",
		"`modelName`",
		"`selectedSpecialist`",
		"`proofBundle`",
		"`confidenceOutcome`",
		"`evidencePackPath`",
		"`planned_session230`",
		"`refusal_baseline_only`",
	])

	const liveEvidencePackPresent = includesAll(liveEvidencePackText, [
		"# QueenBee Live Evidence Pack",
		"`liveEvalId`",
		"`matrixRowId`",
		"`canonicalRowId`",
		"`providerName`",
		"`modelName`",
		"`selectedSpecialist`",
		"`proofBundleResult`",
		"`expertOutcome`",
		"`reproOutcome`",
		"`budgetFit`",
		"`confidenceOutcome`",
		"`lastEventAt`",
		"`missionClosedAt`",
		"`artifactRefs`",
		"`evidencePackPath`",
		"one lucky transcript",
	])

	const rubricAligned = includesAll(rubricText, [
		"## Live Eval Scoring Pack",
		"`matrixRowId`",
		"`providerName`",
		"`modelName`",
		"`proofBundleResult`",
		"`confidenceOutcome`",
		"`evidencePackPath`",
	])

	const reproAligned = includesAll(reproText, [
		"`matrixRowId`",
		"`confidenceOutcome`",
		"`lastEventAt` and `missionClosedAt`",
		"`evidencePackPath`",
		"timeout and TTL interpretation even when the exact timestamps vary",
	])

	const benchmarkAligned = includesAll(benchmarkText, [
		"## Session 228 Live Evidence Alignment",
		"`QB-LIVE-*` matrix row",
		"`QUEENBEE_LIVE_EVIDENCE_PACK.md`",
		"`confidenceOutcome`",
		"`evidencePackPath`",
	])

	const sideBySideAligned = includesAll(sideBySideText, [
		"## Live Evidence Alignment",
		"`QB-LIVE-*` row",
		"`QUEENBEE_LIVE_EVIDENCE_PACK.md`",
		"`confidenceOutcome`",
		"`evidencePackPath`",
		"`not_run`",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 228 records the live eval matrix and live evidence pack contract before the canonical live pack runs",
		"**Session:** 228",
		"`QUEENBEE_LIVE_EVAL_MATRIX.md`",
		"`QUEENBEE_LIVE_EVIDENCE_PACK.md`",
		"`verify:queenbee:live-plan`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B34 |",
		"`QUEENBEE_LIVE_EVAL_MATRIX.md`",
		"`QUEENBEE_LIVE_EVIDENCE_PACK.md`",
		"`npm.cmd run verify:queenbee:live-plan`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"51. `npm.cmd run verify:queenbee:live-plan`",
		"53. the Session 228 live eval matrix and live evidence pack contract now record provider, model, row, specialist, proofs, timing, artifacts, and confidence outcome together before the canonical live pack lands",
	])

	details.push(
		`liveEvalMatrixPresent=${liveEvalMatrixPresent ? "yes" : "no"}`,
		`liveEvidencePackPresent=${liveEvidencePackPresent ? "yes" : "no"}`,
		`benchmarkAligned=${benchmarkAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		liveEvalMatrixPresent,
		liveEvidencePackPresent,
		rubricAligned,
		reproAligned,
		benchmarkAligned,
		sideBySideAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeLivePlanHarnessResult(result: QueenBeeLivePlanHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Live eval matrix present: ${result.liveEvalMatrixPresent ? "PASS" : "FAIL"}`,
		`Live evidence pack present: ${result.liveEvidencePackPresent ? "PASS" : "FAIL"}`,
		`Rubric aligned: ${result.rubricAligned ? "PASS" : "FAIL"}`,
		`Repro aligned: ${result.reproAligned ? "PASS" : "FAIL"}`,
		`Benchmark aligned: ${result.benchmarkAligned ? "PASS" : "FAIL"}`,
		`Side-by-side aligned: ${result.sideBySideAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeLivePlanHarness()
	console.log(formatQueenBeeLivePlanHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.liveEvalMatrixPresent &&
			result.liveEvidencePackPresent &&
			result.rubricAligned &&
			result.reproAligned &&
			result.benchmarkAligned &&
			result.sideBySideAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:live-plan] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
