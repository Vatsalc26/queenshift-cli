import fs from "node:fs"
import path from "node:path"

export type QueenBeeGrantsHarnessResult = {
	grantFreezeContractPresent: boolean
	toolFamiliesAligned: boolean
	defaultGrantMatrixAligned: boolean
	denialsAndTokenRulesAligned: boolean
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

function extractSubsection(section: string, heading: string): string {
	const headingPattern = new RegExp(`^### ${escapeRegExp(heading)}\\b.*$`, "m")
	const headingMatch = headingPattern.exec(section)
	if (!headingMatch || typeof headingMatch.index !== "number") return ""

	const sectionStart = headingMatch.index
	const afterHeading = section.slice(sectionStart)
	const remainder = afterHeading.slice(headingMatch[0].length)
	const nextHeadingIndex = remainder.search(/\n###\s/u)
	if (nextHeadingIndex === -1) return afterHeading.trimEnd()
	return afterHeading.slice(0, headingMatch[0].length + nextHeadingIndex).trimEnd()
}

function extractBacktickedItems(section: string): string[] {
	return Array.from(section.matchAll(/`([^`]+)`/g), (match) => match[1] ?? "").filter((item) => item.length > 0)
}

function extractGrantRows(section: string): string[] {
	return section
		.split(/\r?\n/)
		.filter((line) => /^\|\s*[A-Za-z]/.test(line))
		.map((line) => line.split("|").map((part) => part.trim()))
		.filter((parts) => parts.length >= 3)
		.filter((parts) => parts[1] !== "Bee")
		.map((parts) => `${parts[1]}:${parts[2]}`)
}

function sameOrderedList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeGrantsHarness(rootDir = resolveRootDir()): Promise<QueenBeeGrantsHarnessResult> {
	const details: string[] = []
	const grantsText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const denialsSection = extractSection(grantsText, "Explicit Denials")

	const grantFreezeContractPresent = includesAll(grantsText, [
		"## Grant Freeze Contract",
		"`qb-v1` tool-family catalog",
		"## Grant Invariants",
		"## Grant Change Control",
	])
	const toolFamiliesAligned = sameOrderedList(extractBacktickedItems(extractSection(grantsText, "Tool Families")).slice(0, 10), [
		"message",
		"registry_read",
		"safety_check",
		"repo_read",
		"repo_edit",
		"verify_exec",
		"git_merge",
		"artifact_write",
		"failure_analyze",
		"human_explain",
	])
	const defaultGrantMatrixAligned = sameOrderedList(extractGrantRows(extractSection(grantsText, "Default Grants By Bee")), [
		"QueenBee:`message`, `human_explain`",
		"RouterBee:`message`",
		"RegistryBee:`message`, `registry_read`",
		"SafetyBee:`message`, `safety_check`, `human_explain`",
		"ScoutBee:`message`, `repo_read`, `human_explain`",
		"PlannerBee:`message`, `human_explain`",
		"JSTSCoderBee:`message`, `repo_read`, `repo_edit`, `human_explain`",
		"JSTSReviewerBee:`message`, `repo_read`, `human_explain`",
		"VerifierBee:`message`, `verify_exec`, `human_explain`",
		"MergeBee:`message`, `repo_read`, `git_merge`, `human_explain`",
		"ArchivistBee:`message`, `artifact_write`",
		"RecoveryBee:`message`, `failure_analyze`, `human_explain`",
	]) &&
		includesAll(grantsText, [
			"no bee should hold both `repo_edit` and `git_merge`",
			"`QueenBee` stays mission-level and explanation-only",
			"`RouterBee` stays message-only",
			"`ArchivistBee` stays write-only on artifacts",
			"`RecoveryBee` diagnoses and recommends",
		])
	const denialsAndTokenRulesAligned =
		sameOrderedList(extractBacktickedItems(extractSubsection(denialsSection, "QueenBee")), ["repo_edit", "git_merge", "verify_exec"]) &&
		sameOrderedList(extractBacktickedItems(extractSubsection(denialsSection, "RouterBee")), ["repo_edit", "verify_exec", "git_merge", "failure_analyze"]) &&
		sameOrderedList(extractBacktickedItems(extractSubsection(denialsSection, "JSTSCoderBee")), ["git_merge", "verify_exec"]) &&
		sameOrderedList(extractBacktickedItems(extractSubsection(denialsSection, "ArchivistBee")), ["message", "artifact_write"]) &&
		sameOrderedList(extractBacktickedItems(extractSubsection(denialsSection, "RecoveryBee")), ["repo_edit", "git_merge"])
	const tokenFields = extractBacktickedItems(extractSection(grantsText, "Tool Grant Tokens"))
	const tokenRulePresent =
		tokenFields.includes("toolGrantToken") &&
		includesAll(grantsText, ["1. bee id", "2. assignment id", "3. allowed families", "4. expiry", "5. scope token"])
	const changeControlPresent = includesAll(grantsText, [
		"Do not add or remove a `qb-v1` tool family or grant row without updating:",
		"`QUEENBEE_CAPABILITY_REGISTRY.md`",
		"`ARCHITECTURE_DECISIONS.md`",
		"`npm.cmd run verify:queenbee:grants`",
	])

	details.push(
		`toolFamilies=${extractBacktickedItems(extractSection(grantsText, "Tool Families")).slice(0, 10).join(",") || "missing"}`,
		`grantRows=${extractGrantRows(extractSection(grantsText, "Default Grants By Bee")).join(" | ") || "missing"}`,
		`tokenFields=${tokenFields.join(",") || "missing"}`,
	)

	return {
		grantFreezeContractPresent,
		toolFamiliesAligned,
		defaultGrantMatrixAligned,
		denialsAndTokenRulesAligned: denialsAndTokenRulesAligned && tokenRulePresent,
		changeControlPresent,
		details,
	}
}

export function formatQueenBeeGrantsHarnessResult(result: QueenBeeGrantsHarnessResult): string {
	return [
		`Grant freeze contract present: ${result.grantFreezeContractPresent ? "PASS" : "FAIL"}`,
		`Tool families aligned: ${result.toolFamiliesAligned ? "PASS" : "FAIL"}`,
		`Default grant matrix aligned: ${result.defaultGrantMatrixAligned ? "PASS" : "FAIL"}`,
		`Denials and token rules aligned: ${result.denialsAndTokenRulesAligned ? "PASS" : "FAIL"}`,
		`Change control present: ${result.changeControlPresent ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeGrantsHarness()
	console.log(formatQueenBeeGrantsHarnessResult(result))
	process.exit(
		result.grantFreezeContractPresent &&
			result.toolFamiliesAligned &&
			result.defaultGrantMatrixAligned &&
			result.denialsAndTokenRulesAligned &&
			result.changeControlPresent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:grants] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
