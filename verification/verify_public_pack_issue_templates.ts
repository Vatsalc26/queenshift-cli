import fs from "node:fs"
import path from "node:path"

type PublicPackExportManifest = {
	futurePublicPackContents?: string[]
}

export type PublicPackIssueTemplatesHarnessResult = {
	packageScriptPresent: boolean
	bugTemplatePresent: boolean
	taskFamilyTemplatePresent: boolean
	exportManifestIncludesIssueTemplates: boolean
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

export async function runPublicPackIssueTemplatesHarness(rootDir = resolveRootDir()): Promise<PublicPackIssueTemplatesHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const exportManifest = readJson<PublicPackExportManifest>(rootDir, path.join("public_pack", "export_manifest.json"))
	const bugTemplateText = readText(rootDir, path.join("public_pack", ".github", "ISSUE_TEMPLATE", "bug_report.md"))
	const taskFamilyTemplateText = readText(rootDir, path.join("public_pack", ".github", "ISSUE_TEMPLATE", "task_family_request.md"))

	const packageScriptPresent =
		packageJson.scripts?.["verify:public-pack:issue-templates"] ===
		"npm run build && node dist/verification/verify_public_pack_issue_templates.js"
	const bugTemplatePresent = includesAll(bugTemplateText, [
		"name: Bounded bug report",
		"Queenshift bug",
		"`SECURITY.md`",
		"## Summary",
		"## Commands",
		"## Artifact Paths",
		"## Failure Narrative",
		"incident:latest",
		"replay:latest",
		"## Smallest Fix Scope",
	])
	const taskFamilyTemplatePresent = includesAll(taskFamilyTemplateText, [
		"name: Task family request",
		"Queenshift task family",
		"`SECURITY.md`",
		"## Summary",
		"## Example Task Text",
		"## Named Files And Repo Shape",
		"## Why Current Families Do Not Fit",
		"## Smallest Useful Proof",
		"## Risk Boundary",
	])
	const exportManifestIncludesIssueTemplates = arrayIncludesAll(exportManifest?.futurePublicPackContents, [
		".github/ISSUE_TEMPLATE/bug_report.md",
		".github/ISSUE_TEMPLATE/task_family_request.md",
	])

	details.push(
		`bugTemplatePresent=${bugTemplatePresent ? "yes" : "no"}`,
		`taskFamilyTemplatePresent=${taskFamilyTemplatePresent ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		bugTemplatePresent,
		taskFamilyTemplatePresent,
		exportManifestIncludesIssueTemplates,
		details,
	}
}

export function formatPublicPackIssueTemplatesHarnessResult(result: PublicPackIssueTemplatesHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Bug template present: ${result.bugTemplatePresent ? "PASS" : "FAIL"}`,
		`Task-family template present: ${result.taskFamilyTemplatePresent ? "PASS" : "FAIL"}`,
		`Export manifest includes issue templates: ${result.exportManifestIncludesIssueTemplates ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPublicPackIssueTemplatesHarness()
	console.log(formatPublicPackIssueTemplatesHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.bugTemplatePresent &&
			result.taskFamilyTemplatePresent &&
			result.exportManifestIncludesIssueTemplates
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:public-pack:issue-templates] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
