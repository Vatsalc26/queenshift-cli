import fs from "node:fs"
import path from "node:path"

export type QueenBeeBudgetsHarnessResult = {
	packageScriptPresent: boolean
	budgetsDocPresent: boolean
	toolGrantAlignmentPresent: boolean
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

export async function runQueenBeeBudgetsHarness(rootDir = resolveRootDir()): Promise<QueenBeeBudgetsHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const budgetsText = readText(rootDir, "QUEENBEE_COST_LATENCY_BUDGETS.md")
	const toolGrantsText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:budgets"] === "npm run build && node dist/verification/verify_queenbee_budgets.js"

	const budgetsDocPresent = includesAll(budgetsText, [
		"# QueenBee Cost Latency Budgets",
		"`thinking_role_count`",
		"`verification_command_count`",
		"`review_cycle_count`",
		"`merge_count`",
		"`latency_class`",
		"`comment_file` and `update_named_file`",
		"`bounded_node_cli_task`",
		"`off_nominal_recovery`",
		"extra tool authority does not buy extra budget",
	])

	const toolGrantAlignmentPresent = includesAll(toolGrantsText, [
		"## Session 221 Budget And Benchmark Alignment",
		"`QUEENBEE_COST_LATENCY_BUDGETS.md`",
		"`ScoutBee` may use `repo_read` only for explicit targets plus the smallest bounded evidence",
		"`JSTSCoderBee` may not gain direct `verify_exec` or `git_merge`",
		"`VerifierBee` may use `verify_exec` only for the named bounded proof bundle",
		"`MergeBee` may not absorb `repo_edit`",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 221 records bounded budgets, stronger tool-grant discipline, and a benchmark plan before canonical tasks",
		"**Session:** 221",
		"`QUEENBEE_COST_LATENCY_BUDGETS.md`",
		"`npm.cmd run verify:queenbee:budgets`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B27 |",
		"`QUEENBEE_COST_LATENCY_BUDGETS.md`",
		"`QUEENBEE_TOOL_GRANTS.md`",
		"`npm.cmd run verify:queenbee:budgets`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:budgets`",
		"cost and latency budgets",
		"tool-grant discipline",
		"budget pressure",
	])

	details.push(
		`budgetsDocPresent=${budgetsDocPresent ? "yes" : "no"}`,
		`toolGrantAlignmentPresent=${toolGrantAlignmentPresent ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		budgetsDocPresent,
		toolGrantAlignmentPresent,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeBudgetsHarnessResult(result: QueenBeeBudgetsHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Budgets doc present: ${result.budgetsDocPresent ? "PASS" : "FAIL"}`,
		`Tool-grant alignment present: ${result.toolGrantAlignmentPresent ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeBudgetsHarness()
	console.log(formatQueenBeeBudgetsHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.budgetsDocPresent &&
			result.toolGrantAlignmentPresent &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:budgets] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
