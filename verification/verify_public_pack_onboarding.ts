import fs from "node:fs"
import path from "node:path"

type PublicPackExportManifest = {
	futurePublicPackContents?: string[]
}

export type PublicPackOnboardingHarnessResult = {
	packageScriptPresent: boolean
	installDocPresent: boolean
	providerDocPresent: boolean
	taskFamiliesDocPresent: boolean
	docsIndexLinked: boolean
	exportManifestIncludesOnboardingDocs: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	const filePath = path.join(rootDir, relativePath)
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
}

function readJson<T>(rootDir: string, relativePath: string): T | null {
	try {
		return JSON.parse(readText(rootDir, relativePath)) as T
	} catch {
		return null
	}
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function arrayIncludesAll(values: string[] | undefined, expected: string[]): boolean {
	return Array.isArray(values) && expected.every((value) => values.includes(value))
}

export async function runPublicPackOnboardingHarness(rootDir = resolveRootDir()): Promise<PublicPackOnboardingHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const exportManifest = readJson<PublicPackExportManifest>(rootDir, path.join("public_pack", "export_manifest.json"))
	const installText = readText(rootDir, path.join("public_pack", "docs", "install.md"))
	const providerText = readText(rootDir, path.join("public_pack", "docs", "providers.md"))
	const taskFamiliesText = readText(rootDir, path.join("public_pack", "docs", "task-families.md"))
	const docsIndexText = readText(rootDir, path.join("public_pack", "docs", "README.md"))
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:public-pack:onboarding"] ===
		"npm run build && node dist/verification/verify_public_pack_onboarding.js"
	const installDocPresent = includesAll(installText, [
		"# Queenshift Install Surfaces",
		"## Current Install Truth",
		"local Windows bundle",
		"partial contributor-style path",
		"clean-profile acceptance path",
		"## Public Product Path",
		"primary public README",
		"queenshift doctor",
		"owner:guided:demo",
		"## Repo-Based Checkout",
		"## Acceptance Answer",
		"Node `24.x`",
		"`npm.cmd run verify:owner:smoke`",
		"stranger clean-machine path",
		"## Out Of Scope",
	])
	const providerDocPresent = includesAll(providerText, [
		"# Queenshift Provider Setup",
		"queenshift doctor",
		"Ready: yes",
		"owner:guided:demo",
		"demo:run",
		"repo:onboard --workspace <repo>",
		'`queenshift "<task>" --workspace <repo> --admitOnly`',
		"demo:reset",
		"Gemini CLI OAuth",
		"OpenAI API key",
		"`OPENAI_API_KEY`",
		"`SWARM_GEMINI_AUTH`",
		"no hidden credential storage",
		"does not silently switch between Gemini and OpenAI",
		"maintainer-only verification wrappers",
	])
	const taskFamiliesDocPresent = includesAll(taskFamiliesText, [
		"# Queenshift Task Families",
		"## Best First Tasks",
		"`comment_file`",
		"`update_named_file`",
		"## Bounded Follow-On Tasks",
		"`medium_multi_file_update`",
		"`cross_language_sync`",
		"## First-Run Rules",
		"`queenshift demo:gallery`",
	])
	const docsIndexLinked = includesAll(docsIndexText, [
		"`install.md`",
		"`providers.md`",
		"`task-families.md`",
		"`../.github/ISSUE_TEMPLATE/`",
	])
	const exportManifestIncludesOnboardingDocs = arrayIncludesAll(exportManifest?.futurePublicPackContents, [
		"docs/install.md",
		"docs/providers.md",
		"docs/task-families.md",
	])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 253 moves the public first-run docs onto the real Queenshift product loop",
		"**Session:** 253",
		"`queenshift doctor`",
		"`repo:onboard`",
		'`queenshift "<task>" --workspace <repo> --admitOnly`',
		"`--admitOnly`",
	])
	const capabilityChecklistAligned = includesAll(capabilityText, [
		"Does the future public pack now teach the real Queenshift install and first-run path instead of older repo-only habits?",
		"`public_pack/docs/install.md`",
		"`public_pack/docs/providers.md`",
		"`public_pack/docs/task-families.md`",
	])

	details.push(
		`docsIndexLinked=${docsIndexLinked ? "yes" : "no"}`,
		`exportManifestIncludesOnboardingDocs=${exportManifestIncludesOnboardingDocs ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		installDocPresent,
		providerDocPresent,
		taskFamiliesDocPresent,
		docsIndexLinked,
		exportManifestIncludesOnboardingDocs,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		details,
	}
}

export function formatPublicPackOnboardingHarnessResult(result: PublicPackOnboardingHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Install doc present: ${result.installDocPresent ? "PASS" : "FAIL"}`,
		`Provider doc present: ${result.providerDocPresent ? "PASS" : "FAIL"}`,
		`Task-families doc present: ${result.taskFamiliesDocPresent ? "PASS" : "FAIL"}`,
		`Docs index linked: ${result.docsIndexLinked ? "PASS" : "FAIL"}`,
		`Export manifest includes onboarding docs: ${result.exportManifestIncludesOnboardingDocs ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPublicPackOnboardingHarness()
	console.log(formatPublicPackOnboardingHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.installDocPresent &&
			result.providerDocPresent &&
			result.taskFamiliesDocPresent &&
			result.docsIndexLinked &&
			result.exportManifestIncludesOnboardingDocs &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:public-pack:onboarding] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
