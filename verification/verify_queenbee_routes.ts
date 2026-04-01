import fs from "node:fs"
import path from "node:path"

export type QueenBeeRoutesHarnessResult = {
	routeFreezeContractPresent: boolean
	allowedEdgesAligned: boolean
	routerMediationPreserved: boolean
	forbiddenEdgesAligned: boolean
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

function extractTablePairs(section: string): string[] {
	return section
		.split(/\r?\n/)
		.filter((line) => /^\|\s*[A-Za-z]/.test(line))
		.map((line) => line.split("|").map((part) => part.trim()))
		.filter((parts) => parts.length >= 4)
		.filter((parts) => parts[1] !== "Sender" && parts[2] !== "Recipient")
		.map((parts) => `${parts[1]}->${parts[2]}`)
}

function extractBacktickedItems(section: string): string[] {
	return Array.from(section.matchAll(/`([^`]+)`/g), (match) => match[1] ?? "").filter((item) => item.length > 0)
}

function sameOrderedList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeRoutesHarness(rootDir = resolveRootDir()): Promise<QueenBeeRoutesHarnessResult> {
	const details: string[] = []
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")

	const allowedEdgesSection = extractSection(protocolMapText, "Allowed Edges")
	const forbiddenSection = extractSection(protocolMapText, "Forbidden Direct Edges")
	const tinyTaskSection = extractSection(protocolMapText, "Tiny Task Shortcut")

	const expectedPairs = [
		"QueenBee->RouterBee",
		"RouterBee->RegistryBee",
		"RouterBee->SafetyBee",
		"RouterBee->ScoutBee",
		"RouterBee->PlannerBee",
		"RouterBee->JSTSCoderBee",
		"RouterBee->JSTSReviewerBee",
		"RouterBee->VerifierBee",
		"RouterBee->MergeBee",
		"RouterBee->ArchivistBee",
		"RouterBee->RecoveryBee",
		"RegistryBee->RouterBee",
		"SafetyBee->RouterBee",
		"ScoutBee->RouterBee",
		"PlannerBee->RouterBee",
		"JSTSCoderBee->RouterBee",
		"JSTSReviewerBee->RouterBee",
		"VerifierBee->RouterBee",
		"MergeBee->RouterBee",
		"ArchivistBee->RouterBee",
		"RecoveryBee->RouterBee",
	]
	const actualPairs = extractTablePairs(allowedEdgesSection)

	const routeFreezeContractPresent = includesAll(protocolMapText, [
		"## Route Freeze Contract",
		"`qb-v1` route graph",
		"all cross-bee worker handoffs must pass through `RouterBee`",
		"## Undefined Edge Rule",
		"## Route Change Control",
	])
	const allowedEdgesAligned = sameOrderedList(actualPairs, expectedPairs)
	const routerMediationPreserved =
		actualPairs.every((pair) => pair.includes("RouterBee")) &&
		includesAll(tinyTaskSection, [
			"`QueenBee -> RouterBee -> SafetyBee`",
			"`QueenBee -> RouterBee -> RegistryBee`",
			"`QueenBee -> RouterBee -> JSTSCoderBee`",
			"`JSTSCoderBee -> RouterBee -> JSTSReviewerBee`",
			"`JSTSReviewerBee -> RouterBee -> ArchivistBee`",
			"`ArchivistBee -> RouterBee -> QueenBee`",
			"It does not create any new direct peer edge outside the frozen map.",
		])
	const forbiddenEdgesAligned = sameOrderedList(extractBacktickedItems(forbiddenSection), [
		"JSTSCoderBee -> MergeBee",
		"JSTSCoderBee -> VerifierBee",
		"ScoutBee -> JSTSCoderBee",
		"JSTSReviewerBee -> MergeBee",
		"VerifierBee -> QueenBee",
		"AnyBee -> AnyBee",
	])
	const changeControlPresent = includesAll(protocolMapText, [
		"Do not add or remove a route in `qb-v1` without updating:",
		"`QUEENBEE_MESSAGE_SCHEMA.md`",
		"`ARCHITECTURE_DECISIONS.md`",
		"`npm.cmd run verify:queenbee:routes`",
	])

	details.push(
		`allowedPairs=${actualPairs.join(",") || "missing"}`,
		`forbiddenEdges=${extractBacktickedItems(forbiddenSection).join(",") || "missing"}`,
		`tinyTaskSection=${tinyTaskSection ? "present" : "missing"}`,
	)

	return {
		routeFreezeContractPresent,
		allowedEdgesAligned,
		routerMediationPreserved,
		forbiddenEdgesAligned,
		changeControlPresent,
		details,
	}
}

export function formatQueenBeeRoutesHarnessResult(result: QueenBeeRoutesHarnessResult): string {
	return [
		`Route freeze contract present: ${result.routeFreezeContractPresent ? "PASS" : "FAIL"}`,
		`Allowed edges aligned: ${result.allowedEdgesAligned ? "PASS" : "FAIL"}`,
		`Router mediation preserved: ${result.routerMediationPreserved ? "PASS" : "FAIL"}`,
		`Forbidden edges aligned: ${result.forbiddenEdgesAligned ? "PASS" : "FAIL"}`,
		`Change control present: ${result.changeControlPresent ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeRoutesHarness()
	console.log(formatQueenBeeRoutesHarnessResult(result))
	process.exit(
		result.routeFreezeContractPresent &&
			result.allowedEdgesAligned &&
			result.routerMediationPreserved &&
			result.forbiddenEdgesAligned &&
			result.changeControlPresent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:routes] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
