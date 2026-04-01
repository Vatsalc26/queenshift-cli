import fs from "node:fs"
import path from "node:path"

export type QueenBeeStateHarnessResult = {
	stateFreezeContractPresent: boolean
	sharedStatesAligned: boolean
	transitionsAligned: boolean
	beeClassCoveragePresent: boolean
	changeControlPresent: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function extractSection(text: string, heading: string): string {
	const headingPattern = new RegExp(`^## ${escapeRegExp(heading)}\\b.*$`, "m")
	const headingMatch = headingPattern.exec(text)
	if (!headingMatch || typeof headingMatch.index !== "number") return ""

	const sectionStart = headingMatch.index
	const afterHeading = text.slice(sectionStart)
	const remainder = afterHeading.slice(headingMatch[0].length)
	const nextHeadingIndex = remainder.search(/\n##\s/u)
	if (nextHeadingIndex === -1) return afterHeading.trimEnd()
	return afterHeading.slice(0, headingMatch[0].length + nextHeadingIndex).trimEnd()
}

function extractBacktickedItems(section: string): string[] {
	return Array.from(section.matchAll(/`([^`]+)`/g), (match) => match[1] ?? "").filter((item) => item.length > 0)
}

function extractTablePairs(section: string): string[] {
	return section
		.split(/\r?\n/)
		.filter((line) => /^\|\s*[A-Za-z]/.test(line))
		.map((line) => line.split("|").map((part) => part.trim()))
		.filter((parts) => parts.length >= 4)
		.filter((parts) => parts[1] !== "From" && parts[2] !== "To")
		.map((parts) => `${parts[1]}->${parts[2]}`)
}

function sameOrderedList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeStateHarness(rootDir = resolveRootDir()): Promise<QueenBeeStateHarnessResult> {
	const details: string[] = []
	const stateText = readText(rootDir, "QUEENBEE_STATE_MACHINE.md")

	const sharedStatesSection = extractSection(stateText, "Shared States")
	const transitionsSection = extractSection(stateText, "Common Transitions")
	const forbiddenSection = extractSection(stateText, "Forbidden Transitions")
	const assignmentTokensSection = extractSection(stateText, "Assignment Tokens")

	const stateFreezeContractPresent = includesAll(stateText, [
		"## State Freeze Contract",
		"`qb-v1` state vocabulary",
		"## Transition Invariants",
		"## State Change Control",
	])
	const sharedStatesAligned = sameOrderedList(extractBacktickedItems(sharedStatesSection), [
		"Idle",
		"Reserved",
		"Assigned",
		"Executing",
		"Waiting",
		"Reviewing",
		"Blocked",
		"Completed",
		"Failed",
		"CoolingOff",
		"Quarantined",
	])
	const transitionsAligned =
		sameOrderedList(extractTablePairs(transitionsSection), [
			"Idle->Reserved",
			"Reserved->Assigned",
			"Assigned->Executing",
			"Executing->Waiting",
			"Waiting->Executing",
			"Executing->Reviewing",
			"Executing->Completed",
			"Executing->Blocked",
			"Executing->Failed",
			"Reviewing->Completed",
			"Blocked->Waiting",
			"Failed->CoolingOff",
			"Failed->Quarantined",
			"CoolingOff->Idle",
			"Completed->Idle",
		]) &&
		sameOrderedList(extractBacktickedItems(forbiddenSection), [
			"Idle -> Executing",
			"Assigned -> Completed",
			"Blocked -> Completed",
			"Quarantined -> Executing",
			"Failed -> Idle",
			"Executing -> Idle",
		]) &&
		includesAll(stateText, [
			"entering `Executing` requires a valid assignment token",
			"`Completed` is a reporting state",
			"`Quarantined` is fail-closed",
		]) &&
		sameOrderedList(extractBacktickedItems(assignmentTokensSection), [
			"assignmentId",
			"missionId",
			"beeId",
			"scopeToken",
			"toolGrantToken",
			"attempt",
			"protocolVersion",
			"Executing",
		])
	const beeClassCoveragePresent = includesAll(stateText, [
		"### RouterBee",
		"### RegistryBee",
		"### SafetyBee",
		"### ScoutBee",
		"### PlannerBee",
		"### JSTSCoderBee",
		"### JSTSReviewerBee",
		"### VerifierBee",
		"### MergeBee",
		"### ArchivistBee",
		"### RecoveryBee",
	])
	const changeControlPresent = includesAll(stateText, [
		"Do not add, remove, or rename a `qb-v1` state or transition without updating:",
		"`QUEENBEE_CAPABILITY_REGISTRY.md`",
		"`ARCHITECTURE_DECISIONS.md`",
		"`npm.cmd run verify:queenbee:state`",
	])

	details.push(
		`sharedStates=${extractBacktickedItems(sharedStatesSection).join(",") || "missing"}`,
		`transitions=${extractTablePairs(transitionsSection).join(",") || "missing"}`,
		`forbidden=${extractBacktickedItems(forbiddenSection).join(",") || "missing"}`,
	)

	return {
		stateFreezeContractPresent,
		sharedStatesAligned,
		transitionsAligned,
		beeClassCoveragePresent,
		changeControlPresent,
		details,
	}
}

export function formatQueenBeeStateHarnessResult(result: QueenBeeStateHarnessResult): string {
	return [
		`State freeze contract present: ${result.stateFreezeContractPresent ? "PASS" : "FAIL"}`,
		`Shared states aligned: ${result.sharedStatesAligned ? "PASS" : "FAIL"}`,
		`Transitions aligned: ${result.transitionsAligned ? "PASS" : "FAIL"}`,
		`Bee-class coverage present: ${result.beeClassCoveragePresent ? "PASS" : "FAIL"}`,
		`Change control present: ${result.changeControlPresent ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeStateHarness()
	console.log(formatQueenBeeStateHarnessResult(result))
	process.exit(
		result.stateFreezeContractPresent &&
			result.sharedStatesAligned &&
			result.transitionsAligned &&
			result.beeClassCoveragePresent &&
			result.changeControlPresent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:state] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
