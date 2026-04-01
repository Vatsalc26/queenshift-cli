import fs from "node:fs"
import path from "node:path"

import { RegistryBee, buildDefaultQueenBeeRegistryEntries } from "../src/queenbee/RegistryBee"

export type QueenBeeRegistryHarnessResult = {
	registryFreezeContractPresent: boolean
	entryShapeAligned: boolean
	selectionAndInvariantsAligned: boolean
	firstRosterAligned: boolean
	runtimeRosterAligned: boolean
	runtimeLookupAndReservationAligned: boolean
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

function sameOrderedList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeRegistryHarness(rootDir = resolveRootDir()): Promise<QueenBeeRegistryHarnessResult> {
	const details: string[] = []
	const registryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const fieldMeaningSection = extractSection(registryText, "Recommended Field Meaning")
	const engineSection = extractSubsection(fieldMeaningSection, "engine")
	const languagePackSection = extractSubsection(fieldMeaningSection, "languagePack")
	const roleFamilySection = extractSubsection(fieldMeaningSection, "roleFamily")
	const availabilitySection = extractSubsection(fieldMeaningSection, "availabilityState")
	const trustSection = extractSubsection(fieldMeaningSection, "trustState")

	const registryFreezeContractPresent = includesAll(registryText, [
		"## Registry Freeze Contract",
		"`qb-v1` registry entry shape",
		"stored availability values stay a documented subset",
		"## Entry Invariants",
		"## Registry Change Control",
	])
	const entryShapeAligned = sameOrderedList(extractBacktickedItems(extractSection(registryText, "Registry Entry Shape")), [
		"beeId",
		"beeType",
		"engine",
		"protocolVersion",
		"languagePack",
		"roleFamily",
		"toolFamilies",
		"allowedRecipients",
		"availabilityState",
		"trustState",
		"concurrencyLimit",
		"currentAssignmentId",
		"cooldownUntil",
		"quarantineReason",
		"costClass",
		"speedClass",
		"notes",
	])
	const selectionAndInvariantsAligned =
		sameOrderedList(extractBacktickedItems(engineSection), ["swarmengine", "queenbee"]) &&
		sameOrderedList(extractBacktickedItems(languagePackSection), ["shared", "js_ts", "python"]) &&
		sameOrderedList(extractBacktickedItems(roleFamilySection), ["mission_owner", "router", "registry", "safety", "scout", "planner", "coder", "reviewer", "verifier", "merge", "archivist", "recovery"]) &&
		sameOrderedList(extractBacktickedItems(availabilitySection).slice(0, 8), ["idle", "reserved", "assigned", "executing", "waiting", "blocked", "cooling_off", "quarantined"]) &&
		sameOrderedList(extractBacktickedItems(trustSection), ["trusted", "observed", "restricted", "quarantined"]) &&
		includesAll(registryText, [
			"Transient runtime states like `reviewing`, `completed`, and `failed` still matter",
			"`protocolVersion` must be `qb-v1`",
			"`engine` must be `queenbee`",
			"`toolFamilies` must come from `QUEENBEE_TOOL_GRANTS.md`",
			"`allowedRecipients` must stay inside `QUEENBEE_PROTOCOL_MAP.md`",
		])
	const firstRosterAligned = sameOrderedList(extractBacktickedItems(extractSection(registryText, "First Registered QueenBee Bees")), [
		"queenbee.queen.001",
		"queenbee.router.001",
		"queenbee.registry.001",
		"queenbee.safety.001",
		"queenbee.scout.001",
		"queenbee.planner.001",
		"queenbee.jsts_coder.001",
		"queenbee.jsts_reviewer.001",
		"queenbee.verifier.001",
		"queenbee.merge.001",
		"queenbee.archivist.001",
		"queenbee.recovery.001",
	])
	const runtimeRegistry = new RegistryBee(buildDefaultQueenBeeRegistryEntries())
	const runtimeRoster = runtimeRegistry.listEntries()
	const runtimeRosterAligned =
		sameOrderedList(
			runtimeRoster.map((entry) => entry.beeId),
			[
				"queenbee.queen.001",
				"queenbee.router.001",
				"queenbee.registry.001",
				"queenbee.safety.001",
				"queenbee.scout.001",
				"queenbee.planner.001",
				"queenbee.jsts_coder.001",
				"queenbee.jsts_reviewer.001",
				"queenbee.verifier.001",
				"queenbee.merge.001",
				"queenbee.archivist.001",
				"queenbee.recovery.001",
			],
		) &&
		runtimeRoster.every((entry) => entry.engine === "queenbee" && entry.protocolVersion === "qb-v1")
	const lookupBefore = runtimeRegistry.lookup({
		roleFamily: "coder",
		languagePack: "js_ts",
		requiredToolFamilies: ["repo_edit"],
	})
	const reserve = runtimeRegistry.reserve({
		beeId: "queenbee.jsts_coder.001",
		assignmentId: "assign-registry-1",
	})
	const lookupWhileReserved = runtimeRegistry.lookup({
		roleFamily: "coder",
		languagePack: "js_ts",
		requiredToolFamilies: ["repo_edit"],
	})
	const release = runtimeRegistry.release({
		beeId: "queenbee.jsts_coder.001",
		assignmentId: "assign-registry-1",
	})
	const lookupAfterRelease = runtimeRegistry.lookup({
		roleFamily: "coder",
		languagePack: "js_ts",
		requiredToolFamilies: ["repo_edit"],
	})
	const runtimeLookupAndReservationAligned =
		sameOrderedList(
			lookupBefore.candidates.map((candidate) => candidate.beeId),
			["queenbee.jsts_coder.001"],
		) &&
		reserve.reserved === true &&
		reserve.entry?.availabilityState === "reserved" &&
		reserve.entry?.currentAssignmentId === "assign-registry-1" &&
		lookupWhileReserved.candidates.length === 0 &&
		release.released === true &&
		release.entry?.availabilityState === "idle" &&
		release.entry?.currentAssignmentId === null &&
		sameOrderedList(
			lookupAfterRelease.candidates.map((candidate) => candidate.beeId),
			["queenbee.jsts_coder.001"],
		)
	const changeControlPresent = includesAll(registryText, [
		"Do not add or remove a `qb-v1` registry field, state value, or bee entry without updating:",
		"`QUEENBEE_STATE_MACHINE.md`",
		"`QUEENBEE_TOOL_GRANTS.md`",
		"`ARCHITECTURE_DECISIONS.md`",
		"`npm.cmd run verify:queenbee:registry`",
	])

	details.push(
		`entryShape=${extractBacktickedItems(extractSection(registryText, "Registry Entry Shape")).join(",") || "missing"}`,
		`availabilityValues=${extractBacktickedItems(availabilitySection).join(",") || "missing"}`,
		`firstRoster=${extractBacktickedItems(extractSection(registryText, "First Registered QueenBee Bees")).join(",") || "missing"}`,
		`runtimeRoster=${runtimeRoster.map((entry) => entry.beeId).join(",") || "missing"}`,
		`lookupBefore=${lookupBefore.candidates.map((candidate) => candidate.beeId).join(",") || "missing"}`,
		`lookupAfterRelease=${lookupAfterRelease.candidates.map((candidate) => candidate.beeId).join(",") || "missing"}`,
	)

	return {
		registryFreezeContractPresent,
		entryShapeAligned,
		selectionAndInvariantsAligned,
		firstRosterAligned,
		runtimeRosterAligned,
		runtimeLookupAndReservationAligned,
		changeControlPresent,
		details,
	}
}

export function formatQueenBeeRegistryHarnessResult(result: QueenBeeRegistryHarnessResult): string {
	return [
		`Registry freeze contract present: ${result.registryFreezeContractPresent ? "PASS" : "FAIL"}`,
		`Entry shape aligned: ${result.entryShapeAligned ? "PASS" : "FAIL"}`,
		`Selection and invariants aligned: ${result.selectionAndInvariantsAligned ? "PASS" : "FAIL"}`,
		`First roster aligned: ${result.firstRosterAligned ? "PASS" : "FAIL"}`,
		`Runtime roster aligned: ${result.runtimeRosterAligned ? "PASS" : "FAIL"}`,
		`Runtime lookup and reservation aligned: ${result.runtimeLookupAndReservationAligned ? "PASS" : "FAIL"}`,
		`Change control present: ${result.changeControlPresent ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeRegistryHarness()
	console.log(formatQueenBeeRegistryHarnessResult(result))
	process.exit(
		result.registryFreezeContractPresent &&
			result.entryShapeAligned &&
			result.selectionAndInvariantsAligned &&
			result.firstRosterAligned &&
			result.runtimeRosterAligned &&
			result.runtimeLookupAndReservationAligned &&
			result.changeControlPresent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:registry] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
