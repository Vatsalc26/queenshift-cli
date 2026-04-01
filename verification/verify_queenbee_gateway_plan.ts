import fs from "node:fs"
import path from "node:path"

export type QueenBeeGatewayPlanHarnessResult = {
	packageScriptPresent: boolean
	gatewayTaskSetPresent: boolean
	canonicalTaskSetAligned: boolean
	benchmarkPlanAligned: boolean
	evalRubricAligned: boolean
	reproAligned: boolean
	publicUsabilityAligned: boolean
	sideBySideAligned: boolean
	taskCorpusAligned: boolean
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

export async function runQueenBeeGatewayPlanHarness(rootDir = resolveRootDir()): Promise<QueenBeeGatewayPlanHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const gatewayTaskSetText = readText(rootDir, "QUEENBEE_GATEWAY_TASK_SET.md")
	const canonicalTaskSetText = readText(rootDir, "QUEENBEE_CANONICAL_TASK_SET.md")
	const benchmarkPlanText = readText(rootDir, "QUEENBEE_BENCHMARK_PLAN.md")
	const evalRubricText = readText(rootDir, "QUEENBEE_EXPERT_EVAL_RUBRIC.md")
	const reproText = readText(rootDir, "QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md")
	const publicUsabilityText = readText(rootDir, "QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md")
	const sideBySideText = readText(rootDir, "QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:gateway-plan"] === "npm run build && node dist/verification/verify_queenbee_gateway_plan.js"

	const gatewayTaskSetPresent = includesAll(gatewayTaskSetText, [
		"# QueenBee Gateway Task Set",
		"`QB-GW-01`",
		"`QB-GW-04`",
		"`verify:queenbee:gateway:helper-test`",
		"`verify:queenbee:gateway:ui-logic`",
		"`verify:queenbee:gateway`",
		"compile back into the existing canonical task set",
		"no same-assignment clone-worker fan-out or cross-tool victory claim is implied here",
	])

	const canonicalTaskSetAligned = includesAll(canonicalTaskSetText, [
		"## Session 235 Gateway Task Set Reading",
		"`QUEENBEE_GATEWAY_TASK_SET.md`",
		"`QB-GW-01` through `QB-GW-04`",
		"compile back to the current canonical rows",
	])

	const benchmarkPlanAligned = includesAll(benchmarkPlanText, [
		"## Session 235 Gateway Benchmark Queue",
		"`QB-BM-08`",
		"`QB-BM-11`",
		"`QB-GW-01`",
		"`QB-GW-04`",
		"`verify:queenbee:gateway:helper-test`",
		"`verify:queenbee:gateway:ui-logic`",
		"gateway-task band benchmark-ready",
	])

	const evalRubricAligned = includesAll(evalRubricText, [
		"## Session 235 Gateway Row Reading",
		"`QUEENBEE_GATEWAY_TASK_SET.md`",
		"`gatewayRowId`",
		"compiled explicit internal scope",
		"repo-wide CLI surgery",
	])

	const reproAligned = includesAll(reproText, [
		"## Session 235 Gateway Row Repro Reading",
		"`gatewayRowId`",
		"compiled canonical mix",
		"compiled explicit target-file set",
		"planning guidance for Sessions `236-238`",
	])

	const publicUsabilityAligned = includesAll(publicUsabilityText, [
		"## Session 235 Gateway-Task Alignment",
		"`QB-PUR-03`, `QB-PUR-05`, `QB-PUR-06`, `QB-PUR-07`, `QB-PUR-10`",
		"compile to explicit internal targets before coding begins",
		"clone-worker, cross-tool, or broad public-support language",
	])

	const sideBySideAligned = includesAll(sideBySideText, [
		"## Session 235 Gateway Example Queue",
		"`QB-EX-08`",
		"`QB-EX-11`",
		"`QB-GW-01`",
		"`QB-GW-04`",
		"`QUEENBEE_GATEWAY_TASK_SET.md`",
	])

	const taskCorpusAligned = includesAll(taskCorpusText, [
		"## Session 235 QueenBee Gateway Task Set Note",
		"`QUEENBEE_GATEWAY_TASK_SET.md`",
		"`QB-GW-01` through `QB-GW-04`",
		"reuse the current bounded QueenBee families instead of adding new public task families",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 235 records a bounded gateway-task set before bigger QueenBee rows are treated like capability gains",
		"**Session:** 235",
		"`QUEENBEE_GATEWAY_TASK_SET.md`",
		"`verify:queenbee:gateway-plan`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B41 |",
		"`QUEENBEE_GATEWAY_TASK_SET.md`",
		"`npm.cmd run verify:queenbee:gateway-plan`",
		"planning-ready gateway rows",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:gateway-plan`",
		"the Session 235 gateway-task set now records four bigger bounded real-user rows",
		"helper/test, retry/caller, node-command, and UI-logic widening begins",
		"`npm.cmd run verify:queenbee:gateway`",
	])

	details.push(
		`gatewayTaskSetPresent=${gatewayTaskSetPresent ? "yes" : "no"}`,
		`benchmarkPlanAligned=${benchmarkPlanAligned ? "yes" : "no"}`,
		`taskCorpusAligned=${taskCorpusAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		gatewayTaskSetPresent,
		canonicalTaskSetAligned,
		benchmarkPlanAligned,
		evalRubricAligned,
		reproAligned,
		publicUsabilityAligned,
		sideBySideAligned,
		taskCorpusAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeGatewayPlanHarnessResult(result: QueenBeeGatewayPlanHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Gateway task set present: ${result.gatewayTaskSetPresent ? "PASS" : "FAIL"}`,
		`Canonical task set aligned: ${result.canonicalTaskSetAligned ? "PASS" : "FAIL"}`,
		`Benchmark plan aligned: ${result.benchmarkPlanAligned ? "PASS" : "FAIL"}`,
		`Eval rubric aligned: ${result.evalRubricAligned ? "PASS" : "FAIL"}`,
		`Repro aligned: ${result.reproAligned ? "PASS" : "FAIL"}`,
		`Public usability aligned: ${result.publicUsabilityAligned ? "PASS" : "FAIL"}`,
		`Side-by-side aligned: ${result.sideBySideAligned ? "PASS" : "FAIL"}`,
		`Task corpus aligned: ${result.taskCorpusAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeGatewayPlanHarness()
	console.log(formatQueenBeeGatewayPlanHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.gatewayTaskSetPresent &&
			result.canonicalTaskSetAligned &&
			result.benchmarkPlanAligned &&
			result.evalRubricAligned &&
			result.reproAligned &&
			result.publicUsabilityAligned &&
			result.sideBySideAligned &&
			result.taskCorpusAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:gateway-plan] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
