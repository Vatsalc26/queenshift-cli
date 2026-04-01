import fs from "node:fs"
import path from "node:path"

import { formatQueenshiftDoctorReport, formatQueenshiftHelp, formatQueenshiftVersion } from "../src/cli/ProductSurface"
import { buildOwnerProviderDiagnostic, resolveOwnerProviderSelection } from "../src/owner/ProviderResolution"

export type QueenshiftDoctorHarnessResult = {
	packageScriptPresent: boolean
	swarmWiringPresent: boolean
	helpSurfacePresent: boolean
	versionSurfacePresent: boolean
	doctorSurfacePresent: boolean
	rootDocsAligned: boolean
	contributorDocsAligned: boolean
	installDocsAligned: boolean
	productReadinessAligned: boolean
	verificationCatalogAligned: boolean
	architectureDecisionRecorded: boolean
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

export async function runQueenshiftDoctorHarness(rootDir = resolveRootDir()): Promise<QueenshiftDoctorHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const swarmText = readText(rootDir, "swarm.ts")
	const quickstartText = readText(rootDir, "QUICKSTART.md")
	const contributorText = readText(rootDir, "CONTRIBUTOR_SOURCE_CHECKOUT.md")
	const installText = readText(rootDir, "SUPPORTED_INSTALL_SURFACES.md")
	const readinessText = readText(rootDir, "QUEENSHIFT_PRODUCT_READINESS_STACK.md")
	const verificationText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")

	const oauthDir = path.join(rootDir, "verification", `.tmp-queenshift-doctor-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	const oauthPath = path.join(oauthDir, "oauth_creds.json")
	fs.mkdirSync(oauthDir, { recursive: true })
	fs.writeFileSync(oauthPath, `${JSON.stringify({ refresh_token: "fixture" }, null, 2)}\n`, "utf8")

	try {
		const helpOutput = formatQueenshiftHelp(rootDir)
		const versionOutput = formatQueenshiftVersion(rootDir)
		const selection = resolveOwnerProviderSelection({
			GEMINI_CLI_OAUTH_PATH: oauthPath,
			GEMINI_CLI_COMMAND: "__missing_gemini_cli_for_queenshift_doctor__",
		})
		const doctorOutput = formatQueenshiftDoctorReport(buildOwnerProviderDiagnostic(selection), rootDir)

		const packageScriptPresent =
			packageJson.scripts?.["verify:queenshift:doctor"] ===
			"npm run build && node dist/verification/verify_queenshift_doctor.js"
		const swarmWiringPresent = includesAll(swarmText, [
			"formatQueenshiftHelp(__dirname)",
			"formatQueenshiftVersion(__dirname)",
			'if (command === "doctor")',
		])
		const helpSurfacePresent =
			includesAll(helpOutput, [
				"Queenshift CLI",
				"Usage:",
				"queenshift doctor",
				"First steps:",
				"queenshift owner:guided:demo",
				"queenshift demo:run",
				"--version",
				"swarmengine",
				"queenbee",
			])
		const versionSurfacePresent = includesAll(versionOutput, ["Queenshift CLI", "0.1.0-rc1"])
		const doctorSurfacePresent =
			selection.ready &&
			includesAll(doctorOutput, [
				"Queenshift doctor",
				"Provider: gemini (cli)",
				"Config truth:",
				"queenshift owner:guided:demo",
				"queenshift demo:run",
				"queenshift repo:onboard --workspace <repo>",
			]) &&
			!doctorOutput.includes("verify:owner:smoke") &&
			!doctorOutput.includes("verify:provider:resilience")
		const rootDocsAligned = includesAll(quickstartText, [
			"`npm.cmd exec -- queenshift --help`",
			"`npm.cmd exec -- queenshift --version`",
			"`npm.cmd exec -- queenshift doctor`",
		])
		const contributorDocsAligned = includesAll(contributorText, [
			"npm.cmd exec -- queenshift doctor",
			"npm exec -- queenshift doctor",
		])
		const installDocsAligned = includesAll(installText, [
			"`npm.cmd exec -- queenshift doctor`",
			"product command surface is `queenshift`",
			"clean-profile acceptance path",
			"`npm.cmd run verify:owner:smoke`",
		])
		const productReadinessAligned = includesAll(readinessText, [
			"## Session 266 Production Gate Answer",
			"production-ready normal-user CLI answer is still `NO`",
			"published normal-user install command",
			"local Windows bundle",
		])
		const verificationCatalogAligned = includesAll(verificationText, [
			"The current production-ready CLI gate answer relies on:",
			"`npm.cmd run verify:queenshift:doctor`",
			"`npm.cmd run verify:queenshift:command`",
			"`npm.cmd run verify:public-pack:readme`",
			"`queenshift --help`",
			"`queenshift --version`",
			"`queenshift doctor`",
			"published normal-user install path",
		])
		const architectureDecisionRecorded = includesAll(architectureText, [
			"## Decision: Session 266 records the final production-ready normal-user CLI gate as `NO`",
			"published normal-user install command",
			"experimental public release surface",
			"local Windows bundle",
		])

		details.push(`doctorReady=${selection.ready ? "yes" : "no"}`, `version=${versionOutput}`, `helpHasDoctor=${helpOutput.includes("queenshift doctor") ? "yes" : "no"}`)

		return {
			packageScriptPresent,
			swarmWiringPresent,
			helpSurfacePresent,
			versionSurfacePresent,
			doctorSurfacePresent,
			rootDocsAligned,
			contributorDocsAligned,
			installDocsAligned,
			productReadinessAligned,
			verificationCatalogAligned,
			architectureDecisionRecorded,
			details,
		}
	} finally {
		if (fs.existsSync(oauthDir)) fs.rmSync(oauthDir, { recursive: true, force: true })
	}
}

export function formatQueenshiftDoctorHarnessResult(result: QueenshiftDoctorHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Swarm wiring present: ${result.swarmWiringPresent ? "PASS" : "FAIL"}`,
		`Help surface present: ${result.helpSurfacePresent ? "PASS" : "FAIL"}`,
		`Version surface present: ${result.versionSurfacePresent ? "PASS" : "FAIL"}`,
		`Doctor surface present: ${result.doctorSurfacePresent ? "PASS" : "FAIL"}`,
		`Root docs aligned: ${result.rootDocsAligned ? "PASS" : "FAIL"}`,
		`Contributor docs aligned: ${result.contributorDocsAligned ? "PASS" : "FAIL"}`,
		`Install docs aligned: ${result.installDocsAligned ? "PASS" : "FAIL"}`,
		`Product readiness aligned: ${result.productReadinessAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenshiftDoctorHarness()
	console.log(formatQueenshiftDoctorHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.swarmWiringPresent &&
			result.helpSurfacePresent &&
			result.versionSurfacePresent &&
			result.doctorSurfacePresent &&
			result.rootDocsAligned &&
			result.contributorDocsAligned &&
			result.installDocsAligned &&
			result.productReadinessAligned &&
			result.verificationCatalogAligned &&
			result.architectureDecisionRecorded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenshift:doctor] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
