import fs from "node:fs"
import path from "node:path"

export type OwnerSurfaceHarnessResult = {
	canonicalScriptsPresent: boolean
	readmeCanonicalFlowAligned: boolean
	quickstartCanonicalFlowAligned: boolean
	oversightCanonicalFlowAligned: boolean
	releaseNotesCanonicalFlowAligned: boolean
	followUpSurfaceAligned: boolean
	canonicalDocsDemoteLegacyDefaults: boolean
	lowSteeringLoopDocsPresent: boolean
	failureNarrativeDocsPresent: boolean
	simpleFastLaneDocsPresent: boolean
	boundedReleaseChecklistPresent: boolean
	boundedSupportRunbookPresent: boolean
	supportIssueIntakeGuidePresent: boolean
	bugTemplateAligned: boolean
	outcomeDashboardDocsPresent: boolean
	publicBetaOperationsDocsPresent: boolean
	shipFirstReadinessDocsPresent: boolean
	contributorSourceCheckoutDocsPresent: boolean
	contributorProofLoopDocsPresent: boolean
	knowledgePackDocsPresent: boolean
	backgroundQueueDocsPresent: boolean
	ideSurfaceDocsPresent: boolean
	adapterDocsPresent: boolean
	largeRepoBetaDocsPresent: boolean
	comparativeBenchmarkDocsPresent: boolean
	generalUseRcGateDocsPresent: boolean
	generalUseDecisionDocsPresent: boolean
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

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function excludesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => !text.includes(snippet))
}

export async function runOwnerSurfaceHarness(rootDir = resolveRootDir()): Promise<OwnerSurfaceHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}
	const scripts = packageJson.scripts ?? {}
	const requiredScripts = [
		"owner:guided:demo",
		"verify:owner:provider-defaults",
		"verify:owner:smoke",
		"verify:owner:beta",
		"verify:owner:clarity",
		"verify:owner:quick-actions",
		"verify:owner:life-signal",
		"verify:owner:onboarding",
		"verify:owner:surface",
		"verify:owner:launcher",
		"verify:owner:profile-manifest",
		"task-corpus:report",
		"owner:provider:diagnose",
		"owner:quick-actions",
		"owner:life-signal",
		"owner:status",
		"repo:onboard",
		"rc1:status",
	]
	const canonicalScriptsPresent = requiredScripts.every((script) => typeof scripts[script] === "string")

	const readmeSection = extractSection(readText(rootDir, "Readme.md"), "Canonical Owner Path")
	const quickstartSection = extractSection(readText(rootDir, "QUICKSTART.md"), "Canonical Owner Path")
	const oversightSection = extractSection(readText(rootDir, "OWNER_OVERSIGHT_GUIDE.md"), "Canonical Owner Path")
	const releaseNotesSection = extractSection(readText(rootDir, "RC1_RELEASE_NOTES.md"), "Canonical Owner Path")
	const readmeOutcomeSection = extractSection(readText(rootDir, "Readme.md"), "Local Outcome Dashboard")
	const quickstartOutcomeSection = extractSection(readText(rootDir, "QUICKSTART.md"), "Local Outcome Dashboard")
	const oversightOutcomeSection = extractSection(readText(rootDir, "OWNER_OVERSIGHT_GUIDE.md"), "Local Outcome Dashboard")
	const releaseNotesOutcomeSection = extractSection(readText(rootDir, "RC1_RELEASE_NOTES.md"), "Local Outcome Dashboard")
	const readmePublicBetaOpsSection = extractSection(readText(rootDir, "Readme.md"), "Public Beta Operations Loop")
	const quickstartPublicBetaOpsSection = extractSection(readText(rootDir, "QUICKSTART.md"), "Public Beta Operations Loop")
	const oversightPublicBetaOpsSection = extractSection(readText(rootDir, "OWNER_OVERSIGHT_GUIDE.md"), "Public Beta Operations Loop")
	const releaseNotesPublicBetaOpsSection = extractSection(readText(rootDir, "RC1_RELEASE_NOTES.md"), "Public Beta Operations Loop")
	const readmeShipFirstSection = extractSection(readText(rootDir, "Readme.md"), "Ship-First Readiness Gate")
	const quickstartShipFirstSection = extractSection(readText(rootDir, "QUICKSTART.md"), "Ship-First Readiness Gate")
	const oversightShipFirstSection = extractSection(readText(rootDir, "OWNER_OVERSIGHT_GUIDE.md"), "Ship-First Readiness Gate")
	const releaseNotesShipFirstSection = extractSection(readText(rootDir, "RC1_RELEASE_NOTES.md"), "Ship-First Readiness Gate")
	const boundedReleaseChecklistText = readText(rootDir, "BOUNDED_1_0_RELEASE_CHECKLIST.md")
	const boundedSupportRunbookText = readText(rootDir, "BOUNDED_1_0_SUPPORT_RUNBOOK.md")
	const supportIssueIntakeText = readText(rootDir, "SUPPORT_ISSUE_INTAKE.md")
	const publicBetaOperationsText = readText(rootDir, "PUBLIC_BETA_OPERATIONS.md")
	const shipFirstReadinessText = readText(rootDir, "SHIP_FIRST_READINESS_GATE.md")
	const contributorSourceCheckoutText = readText(rootDir, "CONTRIBUTOR_SOURCE_CHECKOUT.md")
	const contributingText = readText(rootDir, "CONTRIBUTING.md")
	const supportedInstallText = readText(rootDir, "SUPPORTED_INSTALL_SURFACES.md")
	const knowledgePackText = readText(rootDir, "KNOWLEDGE_PACK_SETUP.md")
	const backgroundQueueText = readText(rootDir, "BACKGROUND_QUEUE_CANDIDATE.md")
	const ideSurfacesText = readText(rootDir, "IDE_SURFACES.md")
	const adapterDocsText = readText(rootDir, "ADAPTER_ECOSYSTEM_CANDIDATE.md")
	const largeRepoBetaText = readText(rootDir, "LARGE_REPO_BETA_MATRIX_V2.md")
	const comparativeBenchmarkText = readText(rootDir, "COMPARATIVE_BENCHMARK_REPORT.md")
	const generalUseRcGateText = readText(rootDir, "GENERAL_USE_RELEASE_CANDIDATE_GATE.md")
	const generalUseDecisionText = readText(rootDir, "GENERAL_USE_READINESS_DECISION.md")
	const bugTemplateText = readText(rootDir, ".github/ISSUE_TEMPLATE/bug_report.md")

	const readmeCanonicalFlowAligned = includesAll(readmeSection, [
		"owner:guided:demo",
		"repo:onboard",
		"verify:owner:smoke",
		"Guided",
		"owner:quick-actions",
		"owner:life-signal",
		"task-corpus:report",
		"owner:status",
		"verify:owner:beta",
		"rc1:status",
	])
	const quickstartCanonicalFlowAligned = includesAll(quickstartSection, [
		"owner:guided:demo",
		"repo:onboard",
		"verify:owner:smoke",
		"owner:quick-actions",
		"owner:life-signal",
		"task-corpus:report",
		"owner:status",
		"verify:owner:beta",
		"rc1:status",
		"Guided",
	])
	const oversightCanonicalFlowAligned = includesAll(oversightSection, [
		"owner:guided:demo",
		"verify:owner:smoke",
		"owner:quick-actions",
		"owner:life-signal",
		"task-corpus:report",
		"owner:status",
		"verify:owner:beta",
		"review:list",
		"incident:latest",
		"rc1:status",
	])
	const releaseNotesCanonicalFlowAligned = includesAll(releaseNotesSection, [
		"owner:guided:demo",
		"verify:owner:smoke",
		"owner:quick-actions",
		"owner:life-signal",
		"task-corpus:report",
		"owner:status",
		"verify:owner:beta",
		"rc1:status",
		"non-credit",
	])
	const followUpSurfaceAligned =
		includesAll(readmeSection, ["owner:quick-actions", "owner:life-signal"]) &&
		includesAll(quickstartSection, ["owner:quick-actions", "owner:life-signal"]) &&
		includesAll(oversightSection, ["owner:quick-actions", "owner:life-signal"]) &&
		includesAll(releaseNotesSection, ["owner:quick-actions", "owner:life-signal"])

	const legacyDefaults = ["verify:live:basic", "verify:live:matrix", "verify:live:beta"]
	const canonicalDocsDemoteLegacyDefaults =
		excludesAll(readmeSection, legacyDefaults) &&
		excludesAll(quickstartSection, legacyDefaults) &&
		excludesAll(oversightSection, legacyDefaults) &&
		excludesAll(releaseNotesSection, legacyDefaults)
	const lowSteeringLoopDocsPresent =
		includesAll(readmeSection, ["Low-steering loop:", "owner:guided:demo", "demo:run", "repo:onboard", "owner:life-signal", "owner:quick-actions"]) &&
		includesAll(quickstartSection, ["Low-steering loop:", "owner:guided:demo", "demo:run", "repo:onboard", "owner:life-signal", "owner:quick-actions"]) &&
		includesAll(oversightSection, ["Low-steering loop:", "owner:guided:demo", "demo:run", "repo:onboard", "owner:life-signal", "owner:quick-actions"]) &&
		includesAll(releaseNotesSection, ["Low-steering loop:", "owner:guided:demo", "demo:run", "repo:onboard", "owner:life-signal", "owner:quick-actions"])
	const failureNarrativeDocsPresent =
		includesAll(readmeSection, ["Failure narrative:", "resume:latest", "What failed", "Safest next step", "Keep these artifacts authoritative"]) &&
		includesAll(quickstartSection, ["Failure narrative:", "resume:latest", "What failed", "Safest next step", "Keep these artifacts authoritative"]) &&
		includesAll(oversightSection, ["Failure narrative:", "resume:latest", "What failed", "Safest next step", "Keep these artifacts authoritative"]) &&
		includesAll(releaseNotesSection, ["Failure narrative:", "resume:latest", "What failed", "Safest next step", "Keep these artifacts authoritative"]) &&
		includesAll(supportIssueIntakeText, ["Failure narrative:", "resume:latest", "What failed", "Safest next step", "Keep these artifacts authoritative"])
	const simpleFastLaneDocsPresent =
		includesAll(readmeSection, ["simple-task fast lane"]) &&
		includesAll(quickstartSection, ["simple-task fast lane"]) &&
		includesAll(oversightSection, ["simple-task fast lane"]) &&
		includesAll(releaseNotesSection, ["simple-task fast lane"])
	const boundedReleaseChecklistPresent = includesAll(boundedReleaseChecklistText, [
		"verify:owner:surface",
		"verify:release:public-beta",
		"verify:bundle:experience",
		"local Windows bundle",
	])
	const boundedSupportRunbookPresent = includesAll(boundedSupportRunbookText, [
		"rc1_install_check.ps1",
		"rc1_demo_run.ps1",
		"verify:owner:smoke",
		"owner:quick-actions",
		"owner:life-signal",
		"incident:latest",
		"SUPPORT_ISSUE_INTAKE.md",
		".github/ISSUE_TEMPLATE/bug_report.md",
	])
	const supportIssueIntakeGuidePresent = includesAll(supportIssueIntakeText, [
		"incident:latest",
		"replay:latest",
		"owner:quick-actions",
		"summary.json",
		"incident-pack.json",
		".github/ISSUE_TEMPLATE/bug_report.md",
	])
	const bugTemplateAligned = includesAll(bugTemplateText, [
		"SUPPORT_ISSUE_INTAKE.md",
		"incident-pack.json",
		"replay.json",
		"owner:quick-actions",
		"Failure Bucket",
		"Narrow Fix Scope",
	])
	const outcomeDashboardDocsPresent =
		includesAll(readmeOutcomeSection, ["owner:life-signal", "owner:status", "local"]) &&
		includesAll(quickstartOutcomeSection, ["owner:life-signal", "owner:status", "local"]) &&
		includesAll(oversightOutcomeSection, ["owner:life-signal", "owner:status", ".swarm/runs"]) &&
		includesAll(releaseNotesOutcomeSection, ["owner:life-signal", "owner:status", ".swarm/runs"])
	const publicBetaOperationsDocsPresent =
		includesAll(publicBetaOperationsText, [
			"steady loop",
			"verify:owner:surface",
			"verify:bundle:experience",
			"verify:release:public-beta",
			"BUNDLE_START_HERE.md",
			"PUBLIC_BETA_RELEASE_CHECKLIST.md",
			"announce",
		]) &&
		includesAll(readmePublicBetaOpsSection, ["PUBLIC_BETA_OPERATIONS.md", "verify:bundle:experience", "verify:release:public-beta"]) &&
		includesAll(quickstartPublicBetaOpsSection, ["PUBLIC_BETA_OPERATIONS.md", "verify:bundle:experience", "verify:release:public-beta"]) &&
		includesAll(oversightPublicBetaOpsSection, ["PUBLIC_BETA_OPERATIONS.md", "verify:bundle:experience", "verify:release:public-beta"]) &&
		includesAll(releaseNotesPublicBetaOpsSection, ["PUBLIC_BETA_OPERATIONS.md", "verify:bundle:experience", "verify:release:public-beta"])
	const shipFirstReadinessDocsPresent =
		includesAll(shipFirstReadinessText, [
			"`YES`",
			"STRANGER_FIRST_RUN_STUDY.md",
			"TASK_CORPUS.md",
			"HEAD_TO_HEAD_BENCHMARK.md",
			"PUBLIC_BETA_OPERATIONS.md",
			"verify:owner:surface",
			"verify:bundle:experience",
			"verify:release:public-beta",
		]) &&
		includesAll(readmeShipFirstSection, ["SHIP_FIRST_READINESS_GATE.md", "verify:bundle:experience", "verify:release:public-beta"]) &&
		includesAll(quickstartShipFirstSection, ["SHIP_FIRST_READINESS_GATE.md", "verify:bundle:experience", "verify:release:public-beta"]) &&
		includesAll(oversightShipFirstSection, ["SHIP_FIRST_READINESS_GATE.md", "verify:bundle:experience", "verify:release:public-beta"]) &&
		includesAll(releaseNotesShipFirstSection, ["SHIP_FIRST_READINESS_GATE.md", "verify:bundle:experience", "verify:release:public-beta"])
	const contributorSourceCheckoutDocsPresent = includesAll(contributorSourceCheckoutText, [
		"Windows",
		"macOS",
		"Linux",
		"npm.cmd test",
		"repo:onboard",
		"IDE_SURFACES.md",
	])
	const contributorProofLoopDocsPresent =
		includesAll(contributorSourceCheckoutText, [
			"Contributor Proof-First Loop",
			"verify:pr",
			"verify:profiles",
			"verify:bundle:experience",
			"CONTRIBUTING.md",
			"SUPPORT_ISSUE_INTAKE.md",
		]) &&
		includesAll(contributingText, [
			"Contributor-safe proof-first loop",
			"verify:pr",
			"repo:onboard",
			"verify:profiles",
			"verify:bundle:experience",
			"CONTRIBUTOR_SOURCE_CHECKOUT.md",
			"SUPPORT_ISSUE_INTAKE.md",
		]) &&
		includesAll(supportedInstallText, [
			"Supported Contributor Source Path",
			"verify:pr",
			"verify:profiles",
			"verify:bundle:experience",
			"CONTRIBUTING.md",
			"CONTRIBUTOR_SOURCE_CHECKOUT.md",
		])
	const knowledgePackDocsPresent = includesAll(knowledgePackText, [
		".swarmcoder.knowledge-pack.json",
		"--scaffoldKnowledgePack",
		"schemaVersion",
		"verify:owner:onboarding",
		"verify:context-packs",
	])
	const backgroundQueueDocsPresent = includesAll(backgroundQueueText, [
		"--backgroundCandidate",
		"queue:approve",
		"owner:life-signal",
		"awaiting_owner",
		"work-queue.json",
	])
	const ideSurfaceDocsPresent = includesAll(ideSurfacesText, [
		"Extension Development Host",
		"rc1_open_thin_shell.ps1",
		"`queenshift`",
		"`dist/swarm.js`",
		"summary.json",
		"verify:vscode:shell",
	])
	const adapterDocsPresent = includesAll(adapterDocsText, [
		"profiles:adapter-contracts",
		"local workspace only",
		"no shell chaining",
		"no hidden installs",
		"named catalog",
	])
	const largeRepoBetaDocsPresent = includesAll(largeRepoBetaText, [
		"verify:live:beta",
		"forensics:beta:latest",
		"Large repo tier 2 candidate",
		"12 rows",
	])
	const comparativeBenchmarkDocsPresent = includesAll(comparativeBenchmarkText, [
		"Roo Code",
		"Cline",
		"`not_run`",
		"No evidence-backed overall better/equal call yet",
	])
	const generalUseRcGateDocsPresent = includesAll(generalUseRcGateText, [
		"verify:bundle:experience",
		"verify:live:beta",
		"verify:release:fuller-v2",
		"verify:release:general-use-rc",
	]) && (generalUseRcGateText.includes("`HOLD`") || generalUseRcGateText.includes("`NO_GO`"))
	const generalUseDecisionDocsPresent = includesAll(generalUseDecisionText, [
		"`NO`",
		"ADAPTER_ECOSYSTEM_CANDIDATE.md",
		"LARGE_REPO_BETA_MATRIX_V2.md",
		"COMPARATIVE_BENCHMARK_REPORT.md",
		"GENERAL_USE_RELEASE_CANDIDATE_GATE.md",
	])

	details.push(
		`missingScripts=${requiredScripts.filter((script) => typeof scripts[script] !== "string").join(", ") || "none"}`,
		`readmeSection=${readmeSection ? "present" : "missing"}`,
		`quickstartSection=${quickstartSection ? "present" : "missing"}`,
		`oversightSection=${oversightSection ? "present" : "missing"}`,
		`releaseNotesSection=${releaseNotesSection ? "present" : "missing"}`,
		`simpleFastLaneDocs=${simpleFastLaneDocsPresent ? "present" : "missing"}`,
		`boundedReleaseChecklist=${boundedReleaseChecklistPresent ? "present" : "missing"}`,
		`boundedSupportRunbook=${boundedSupportRunbookPresent ? "present" : "missing"}`,
		`supportIssueIntake=${supportIssueIntakeGuidePresent ? "present" : "missing"}`,
		`bugTemplate=${bugTemplateAligned ? "aligned" : "missing"}`,
		`outcomeDashboardDocs=${outcomeDashboardDocsPresent ? "present" : "missing"}`,
		`publicBetaOperationsDocs=${publicBetaOperationsDocsPresent ? "present" : "missing"}`,
		`shipFirstReadinessDocs=${shipFirstReadinessDocsPresent ? "present" : "missing"}`,
		`contributorSourceCheckoutDocs=${contributorSourceCheckoutDocsPresent ? "present" : "missing"}`,
		`contributorProofLoopDocs=${contributorProofLoopDocsPresent ? "present" : "missing"}`,
		`knowledgePackDocs=${knowledgePackDocsPresent ? "present" : "missing"}`,
		`backgroundQueueDocs=${backgroundQueueDocsPresent ? "present" : "missing"}`,
		`ideSurfaceDocs=${ideSurfaceDocsPresent ? "present" : "missing"}`,
		`adapterDocs=${adapterDocsPresent ? "present" : "missing"}`,
		`largeRepoBetaDocs=${largeRepoBetaDocsPresent ? "present" : "missing"}`,
		`comparativeBenchmarkDocs=${comparativeBenchmarkDocsPresent ? "present" : "missing"}`,
		`generalUseRcGateDocs=${generalUseRcGateDocsPresent ? "present" : "missing"}`,
		`generalUseDecisionDocs=${generalUseDecisionDocsPresent ? "present" : "missing"}`,
	)

	return {
		canonicalScriptsPresent,
		readmeCanonicalFlowAligned,
		quickstartCanonicalFlowAligned,
		oversightCanonicalFlowAligned,
		releaseNotesCanonicalFlowAligned,
		followUpSurfaceAligned,
		canonicalDocsDemoteLegacyDefaults,
		lowSteeringLoopDocsPresent,
		failureNarrativeDocsPresent,
		simpleFastLaneDocsPresent,
		boundedReleaseChecklistPresent,
		boundedSupportRunbookPresent,
		supportIssueIntakeGuidePresent,
		bugTemplateAligned,
		outcomeDashboardDocsPresent,
		publicBetaOperationsDocsPresent,
		shipFirstReadinessDocsPresent,
		contributorSourceCheckoutDocsPresent,
		contributorProofLoopDocsPresent,
		knowledgePackDocsPresent,
		backgroundQueueDocsPresent,
		ideSurfaceDocsPresent,
		adapterDocsPresent,
		largeRepoBetaDocsPresent,
		comparativeBenchmarkDocsPresent,
		generalUseRcGateDocsPresent,
		generalUseDecisionDocsPresent,
		details,
	}
}

export function formatOwnerSurfaceHarnessResult(result: OwnerSurfaceHarnessResult): string {
	return [
		`Canonical scripts present: ${result.canonicalScriptsPresent ? "PASS" : "FAIL"}`,
		`Readme canonical flow aligned: ${result.readmeCanonicalFlowAligned ? "PASS" : "FAIL"}`,
		`Quickstart canonical flow aligned: ${result.quickstartCanonicalFlowAligned ? "PASS" : "FAIL"}`,
		`Oversight guide canonical flow aligned: ${result.oversightCanonicalFlowAligned ? "PASS" : "FAIL"}`,
		`Release notes canonical flow aligned: ${result.releaseNotesCanonicalFlowAligned ? "PASS" : "FAIL"}`,
		`Follow-up surface aligned: ${result.followUpSurfaceAligned ? "PASS" : "FAIL"}`,
		`Canonical docs demote legacy defaults: ${result.canonicalDocsDemoteLegacyDefaults ? "PASS" : "FAIL"}`,
		`Low-steering loop docs present: ${result.lowSteeringLoopDocsPresent ? "PASS" : "FAIL"}`,
		`Failure narrative docs present: ${result.failureNarrativeDocsPresent ? "PASS" : "FAIL"}`,
		`Simple-task fast lane docs present: ${result.simpleFastLaneDocsPresent ? "PASS" : "FAIL"}`,
		`Bounded 1.0 release checklist present: ${result.boundedReleaseChecklistPresent ? "PASS" : "FAIL"}`,
		`Bounded 1.0 support runbook present: ${result.boundedSupportRunbookPresent ? "PASS" : "FAIL"}`,
		`Support issue intake guide present: ${result.supportIssueIntakeGuidePresent ? "PASS" : "FAIL"}`,
		`Bug template aligned: ${result.bugTemplateAligned ? "PASS" : "FAIL"}`,
		`Outcome dashboard docs present: ${result.outcomeDashboardDocsPresent ? "PASS" : "FAIL"}`,
		`Public beta operations docs present: ${result.publicBetaOperationsDocsPresent ? "PASS" : "FAIL"}`,
		`Ship-first readiness docs present: ${result.shipFirstReadinessDocsPresent ? "PASS" : "FAIL"}`,
		`Contributor source-checkout docs present: ${result.contributorSourceCheckoutDocsPresent ? "PASS" : "FAIL"}`,
		`Contributor proof-loop docs present: ${result.contributorProofLoopDocsPresent ? "PASS" : "FAIL"}`,
		`Knowledge-pack docs present: ${result.knowledgePackDocsPresent ? "PASS" : "FAIL"}`,
		`Background-queue docs present: ${result.backgroundQueueDocsPresent ? "PASS" : "FAIL"}`,
		`IDE surface docs present: ${result.ideSurfaceDocsPresent ? "PASS" : "FAIL"}`,
		`Adapter docs present: ${result.adapterDocsPresent ? "PASS" : "FAIL"}`,
		`Large-repo beta docs present: ${result.largeRepoBetaDocsPresent ? "PASS" : "FAIL"}`,
		`Comparative benchmark docs present: ${result.comparativeBenchmarkDocsPresent ? "PASS" : "FAIL"}`,
		`General-use RC gate docs present: ${result.generalUseRcGateDocsPresent ? "PASS" : "FAIL"}`,
		`General-use decision docs present: ${result.generalUseDecisionDocsPresent ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerSurfaceHarness()
	console.log(formatOwnerSurfaceHarnessResult(result))
	process.exit(
		result.canonicalScriptsPresent &&
			result.readmeCanonicalFlowAligned &&
			result.quickstartCanonicalFlowAligned &&
			result.oversightCanonicalFlowAligned &&
			result.releaseNotesCanonicalFlowAligned &&
			result.followUpSurfaceAligned &&
			result.canonicalDocsDemoteLegacyDefaults &&
			result.lowSteeringLoopDocsPresent &&
			result.failureNarrativeDocsPresent &&
			result.simpleFastLaneDocsPresent &&
			result.boundedReleaseChecklistPresent &&
			result.boundedSupportRunbookPresent &&
			result.supportIssueIntakeGuidePresent &&
			result.bugTemplateAligned &&
			result.outcomeDashboardDocsPresent &&
			result.publicBetaOperationsDocsPresent &&
			result.shipFirstReadinessDocsPresent &&
			result.contributorSourceCheckoutDocsPresent &&
			result.contributorProofLoopDocsPresent &&
			result.knowledgePackDocsPresent &&
			result.backgroundQueueDocsPresent &&
			result.ideSurfaceDocsPresent &&
			result.adapterDocsPresent &&
			result.largeRepoBetaDocsPresent &&
			result.comparativeBenchmarkDocsPresent &&
			result.generalUseRcGateDocsPresent &&
			result.generalUseDecisionDocsPresent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:surface] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
