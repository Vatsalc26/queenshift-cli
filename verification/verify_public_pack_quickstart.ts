import fs from "node:fs"
import path from "node:path"

type PublicPackExportManifest = {
	futurePublicPackContents?: string[]
}

export type PublicPackQuickstartHarnessResult = {
	packageScriptPresent: boolean
	quickstartPresent: boolean
	quickstartStaysTruthful: boolean
	exportManifestIncludesQuickstart: boolean
	publicDocsIndexPresent: boolean
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

export async function runPublicPackQuickstartHarness(rootDir = resolveRootDir()): Promise<PublicPackQuickstartHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const exportManifest = readJson<PublicPackExportManifest>(rootDir, path.join("public_pack", "export_manifest.json"))
	const quickstartText = readText(rootDir, path.join("public_pack", "QUICKSTART.md"))
	const docsIndexText = readText(rootDir, path.join("public_pack", "docs", "README.md"))

	const packageScriptPresent =
		packageJson.scripts?.["verify:public-pack:quickstart"] ===
		"npm run build && node dist/verification/verify_public_pack_quickstart.js"
	const quickstartPresent = includesAll(quickstartText, [
		"# Queenshift Quickstart",
		"## 1. Machine Check",
		"## 2. Build The CLI",
		"## 3. Link The CLI Command",
		"## 4. Check The Product Surface",
		"## 5. Run The Guided First Pass",
		"## 6. Try A Real Repo",
		"## 7. If You Get Stuck",
	])
	const quickstartStaysTruthful = includesAll(quickstartText, [
		"local Windows bundle",
		"`queenshift-cli`",
		"npm.cmd link",
		"npm link",
		"`queenshift`",
		"clean-profile contributor or evaluator acceptance path",
		"primary public README path",
		"small clean Git repo",
		"docs/providers.md",
		"ready provider path",
		"`npm.cmd run verify:owner:smoke`",
		"checkout preparation",
		"product-command loop",
		"experimental public release surface",
		"production-ready normal-user CLI answer",
		"still `NO`",
		"final published install story is still incomplete",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
		"node -v",
		"git --version",
		"queenshift --help",
		"queenshift doctor",
		"queenshift owner:guided:demo",
		"queenshift demo:gallery",
		"queenshift demo:run",
		"queenshift repo:onboard --workspace <repo>",
		'queenshift "add a brief comment to hello.ts" --workspace <repo> --admitOnly',
		"--admitOnly",
		"`Current focus`",
		"`Visible progress`",
		"`Next step`",
		"short recovery loop",
		"tells you what failed",
		"gives the safest next command",
		"gives the recorded timeline",
		"queenshift incident:latest --workspace <repo>",
		"queenshift resume:latest --workspace <repo>",
		"queenshift owner:quick-actions --workspace <repo>",
	])
	const exportManifestIncludesQuickstart = arrayIncludesAll(exportManifest?.futurePublicPackContents, [
		"QUICKSTART.md",
		"docs/README.md",
	])
	const publicDocsIndexPresent = includesAll(docsIndexText, [
		"# Queenshift Public Docs",
		"`../QUICKSTART.md`",
		"`install.md`",
		"`providers.md`",
		"`task-families.md`",
	])

	details.push(
		`quickstartPresent=${quickstartPresent ? "yes" : "no"}`,
		`exportManifestIncludesQuickstart=${exportManifestIncludesQuickstart ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		quickstartPresent,
		quickstartStaysTruthful,
		exportManifestIncludesQuickstart,
		publicDocsIndexPresent,
		details,
	}
}

export function formatPublicPackQuickstartHarnessResult(result: PublicPackQuickstartHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Quickstart present: ${result.quickstartPresent ? "PASS" : "FAIL"}`,
		`Quickstart stays truthful: ${result.quickstartStaysTruthful ? "PASS" : "FAIL"}`,
		`Export manifest includes quickstart: ${result.exportManifestIncludesQuickstart ? "PASS" : "FAIL"}`,
		`Public docs index present: ${result.publicDocsIndexPresent ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPublicPackQuickstartHarness()
	console.log(formatPublicPackQuickstartHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.quickstartPresent &&
			result.quickstartStaysTruthful &&
			result.exportManifestIncludesQuickstart &&
			result.publicDocsIndexPresent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:public-pack:quickstart] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
