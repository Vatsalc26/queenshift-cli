import fs from "node:fs"
import path from "node:path"

import { runAcceptanceFixtures } from "./verify_acceptance_gates"
import { runAdmissionHarness } from "./verify_admission"
import { runCheckpointHarness } from "./verify_checkpoints"
import { runCriticLaneHarness } from "./verify_critic_lane"
import { runDemoRunHarness } from "./verify_demo_run"
import { runGuardrailsHarness } from "./verify_guardrails"
import { runMediumLaneHarness } from "./verify_lane_medium"
import { runOwnerBetaFixturesHarness } from "./verify_owner_beta_fixtures"
import { runOwnerSurfaceHarness } from "./verify_owner_surface"
import { runPackageRc1Harness } from "./verify_package_rc1"
import { runPlanSchemaHarness } from "./verify_plan_schema"
import { runProfilesHarness } from "./verify_profiles"
import { runReplayExportHarness } from "./verify_replay_export"
import { runResumeHarness } from "./verify_resume"
import { runRetrySnapshotHarness } from "./verify_retry_snapshots"
import { runSemiOpenHarness } from "./verify_semiopen"
import { runTaskTemplateHarness } from "./verify_task_templates"
import { runOwnerLauncherHarness } from "../src/owner/VerifyOwnerLauncher"
import { runOwnerProfileManifestHarness } from "../src/owner/VerifyOwnerProfileManifest"
import { evaluateFullerSwarmBenchmarkGate } from "../src/release/FullerSwarmBenchmarkGate"
import { evaluateRecordedProofGate, type RecordedProofGateDefinition } from "../src/release/Rc1Gate"

export type ProofBundleId =
	| "lane_small"
	| "lane_small_replay"
	| "lane_medium"
	| "lane_semiopen"
	| "release_public_beta"
	| "bundle_experience"
	| "release_fuller_v2"

export type ProofBundleCheck = {
	label: string
	passed: boolean
	details: string[]
}

export type ProofBundleResult = {
	bundleId: ProofBundleId
	label: string
	covers: string[]
	notCovered: string[]
	checks: ProofBundleCheck[]
}

const RELEASE_RECORDED_PROOF_GATES: RecordedProofGateDefinition[] = [
	{
		key: "semiopen_bundle",
		label: "Recorded semi-open proof bundle",
		proofLabel: "Current semi-open proof bundle",
		maxAgeDays: 7,
	},
	{
		key: "public_beta_bundle",
		label: "Recorded public-beta release bundle",
		proofLabel: "Current public-beta release bundle",
		maxAgeDays: 7,
	},
]

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function buildResult(
	bundleId: ProofBundleId,
	label: string,
	covers: string[],
	notCovered: string[],
	checks: ProofBundleCheck[],
): ProofBundleResult {
	return {
		bundleId,
		label,
		covers,
		notCovered,
		checks,
	}
}

export function proofBundlePassed(result: ProofBundleResult): boolean {
	return result.checks.every((check) => check.passed)
}

export function formatProofBundleResult(result: ProofBundleResult): string {
	return [
		`Proof bundle: ${result.label}`,
		`Status: ${proofBundlePassed(result) ? "PASS" : "FAIL"}`,
		`Covers: ${result.covers.join(" | ")}`,
		`Does not cover: ${result.notCovered.join(" | ")}`,
		"Checks:",
		...result.checks.map((check) => `- ${check.label}: ${check.passed ? "PASS" : "FAIL"}`),
		...result.checks.flatMap((check) =>
			check.passed || check.details.length === 0 ? [] : check.details.map((detail) => `  detail: ${detail}`),
		),
	].join("\n")
}

function summarizeBundleFailures(result: ProofBundleResult): string[] {
	const failures = result.checks.filter((check) => !check.passed)
	if (failures.length === 0) return []
	return failures.flatMap((check) => (check.details.length > 0 ? [check.label, ...check.details] : [check.label]))
}

function evaluateReleaseRecordedProofs(rootDir = resolveRootDir(), now = new Date()): ProofBundleCheck[] {
	const readmePath = path.join(rootDir, "Readme.md")
	const readmeText = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : ""
	return RELEASE_RECORDED_PROOF_GATES.map((definition) => {
		const result = evaluateRecordedProofGate(readmeText, definition, now)
		return {
			label: definition.label,
			passed: result.status === "PASS",
			details: result.details,
		}
	})
}

export async function runSmallLaneBundle(): Promise<ProofBundleResult> {
	const admission = await runAdmissionHarness()
	const acceptance = await runAcceptanceFixtures()
	const profiles = await runProfilesHarness()
	const guardrails = await runGuardrailsHarness()
	const templates = await runTaskTemplateHarness()

	return buildResult(
		"lane_small",
		"Small Lane",
		[
			"single-file safe admission and refusal behavior",
			"acceptance gate truth before done",
			"repo verification profiles and scope hints",
			"runtime guardrails and workspace lock safety",
			"guided task authoring that still routes through admission",
		],
		[
			"6-10 file medium coordination",
			"semi-open anchored discovery",
			"live provider mutation rows",
			"package and release surfaces",
		],
		[
			{
				label: "Admission fixtures",
				passed:
					admission.cleanSafeRepoAdmitted &&
					admission.dirtyRepoRefused &&
					admission.unsupportedTaskRefused &&
					admission.scopedSafeTaskAdmitted &&
					admission.missingVerificationProfileSurfaced,
				details: admission.details,
			},
			{
				label: "Acceptance gate fixtures",
				passed: acceptance.every((entry) => entry.passed),
				details: acceptance.filter((entry) => !entry.passed).map((entry) => entry.label),
			},
			{
				label: "Verification profile fixtures",
				passed:
					profiles.matchingProfilePasses &&
					profiles.manifestBackedScriptPasses &&
					profiles.matchingProfileFails &&
					profiles.noApplicableProfileReported &&
					profiles.blockedCommandRefused &&
					profiles.manifestDriftBlocked &&
					profiles.timeoutSurfaced &&
					profiles.modeSelectorVisible,
				details: profiles.details,
			},
			{
				label: "Guardrail fixtures",
				passed:
					guardrails.modelCallCeilingStopsRun &&
					guardrails.runtimeCeilingStopsRun &&
					guardrails.usageBudgetCeilingStopsRun &&
					guardrails.ceilingArtifactsReported &&
					guardrails.fastLaneVisible &&
					guardrails.agentWaitCoversProviderTimeout &&
					guardrails.workspaceSingleRunLock &&
					guardrails.secondLiveRunRefusedGracefully,
				details: guardrails.details,
			},
			{
				label: "Guided template fixtures",
				passed:
					templates.templateGeneratesExpectedTaskContract &&
					templates.missingRequiredFieldBlocked &&
					templates.previewShowsExpectedScope &&
					templates.unsupportedTemplateOptionRefused &&
					templates.guidedTaskRoutesThroughAdmission,
				details: templates.details,
			},
		],
	)
}

export async function runSmallReplayBundle(): Promise<ProofBundleResult> {
	const checkpoints = await runCheckpointHarness()
	const retrySnapshots = await runRetrySnapshotHarness()
	const replayExport = await runReplayExportHarness()
	const resume = await runResumeHarness()

	return buildResult(
		"lane_small_replay",
		"Small Lane Replay",
		[
			"checkpoint truth for partial progress",
			"exact retry snapshot linkage",
			"replay reproducibility and bounded divergence reporting",
			"bounded resume from recorded artifacts",
		],
		[
			"live provider execution quality",
			"medium task planning",
			"package and bundle checks",
		],
		[
			{
				label: "Checkpoint fixtures",
				passed:
					checkpoints.checkpointArtifactPersisted &&
					checkpoints.partialProgressVisible &&
					checkpoints.retrySnapshotLinked &&
					checkpoints.manifestHashPreserved,
				details: checkpoints.details,
			},
			{
				label: "Retry snapshot fixtures",
				passed:
					retrySnapshots.snapshotPersisted &&
					retrySnapshots.assignmentStatePreserved &&
					retrySnapshots.manifestHashPreserved &&
					retrySnapshots.missingSnapshotFailsClosed,
				details: retrySnapshots.details,
			},
			{
				label: "Replay export fixtures",
				passed:
					replayExport.replayArtifactPersisted &&
					replayExport.stageSequenceVisible &&
					replayExport.manifestMetadataVisible &&
					replayExport.overviewVisible &&
					replayExport.campaignVisible &&
					replayExport.learningLoopVisible &&
					replayExport.reproducibilityVisible &&
					replayExport.divergenceComparisonVisible &&
					replayExport.replayLocationVisible,
				details: replayExport.details,
			},
			{
				label: "Resume fixtures",
				passed:
					resume.resumeSuccessVisible &&
					resume.remainingWorkReconstructed &&
					resume.manifestValidationFailsClosed &&
					resume.missingCompletedBranchFailsClosed,
				details: resume.details,
			},
		],
	)
}

export async function runMediumLaneBundle(): Promise<ProofBundleResult> {
	const medium = await runMediumLaneHarness()
	const planSchema = await runPlanSchemaHarness()
	const critic = await runCriticLaneHarness()
	const checkpoints = await runCheckpointHarness()
	const retrySnapshots = await runRetrySnapshotHarness()

	return buildResult(
		"lane_medium",
		"Medium Lane",
		[
			"explicit 6-10 file admission and bounded routing",
			"plan artifact truth for coordinated work",
			"critic visibility for risky bounded plans",
			"checkpoint and retry evidence on partial outcomes",
		],
		[
			"semi-open discovery",
			"arbitrary repo-wide planning",
			"stranger-facing package and release experience",
		],
		[
			{
				label: "Medium routing fixtures",
				passed:
					medium.mediumTaskAdmitted &&
					medium.tooWideTaskRefused &&
					medium.mediumPlanRecorded &&
					medium.criticRequirementVisible &&
					medium.mediumLaneReliabilityVisible &&
					medium.modelClassificationBypassed,
				details: medium.details,
			},
			{
				label: "Plan schema fixtures",
				passed:
					planSchema.stableSubtaskIds &&
					planSchema.dependencyFieldsPresent &&
					planSchema.builderCountAwareHints &&
					planSchema.planExecutionSeparated &&
					planSchema.refusalFailsClosed &&
					planSchema.repoMapAttached,
				details: planSchema.details,
			},
			{
				label: "Critic lane fixtures",
				passed:
					critic.entryConditionsBounded &&
					critic.structuredOutputVisible &&
					critic.concernVisibleOnComplexRun &&
					critic.executionTruthSeparated,
				details: critic.details,
			},
			{
				label: "Checkpoint fixtures",
				passed:
					checkpoints.checkpointArtifactPersisted &&
					checkpoints.partialProgressVisible &&
					checkpoints.retrySnapshotLinked &&
					checkpoints.manifestHashPreserved,
				details: checkpoints.details,
			},
			{
				label: "Retry snapshot fixtures",
				passed:
					retrySnapshots.snapshotPersisted &&
					retrySnapshots.assignmentStatePreserved &&
					retrySnapshots.manifestHashPreserved &&
					retrySnapshots.missingSnapshotFailsClosed,
				details: retrySnapshots.details,
			},
		],
	)
}

export async function runSemiOpenLaneBundle(): Promise<ProofBundleResult> {
	const semiopen = await runSemiOpenHarness()
	const failedFixtureChecks = semiopen.fixtureChecks.filter((check) => !check.passed)
	const failedLiveChecks = semiopen.liveChecks.filter((check) => !check.passed)

	return buildResult(
		"lane_semiopen",
		"Semi-Open Lane",
		[
			"anchored helper-test, docs-sync, config-sync, and rename-export discovery",
			"fail-closed refusal on ambiguity or broad discovery",
			"live provider-backed rows for supported semi-open tasks",
		],
		[
			"unanchored natural-language discovery",
			"medium 6-10 file planning",
			"package, bundle, and contributor surfaces",
		],
		[
			{
				label: "Fixture semi-open checks",
				passed: failedFixtureChecks.length === 0,
				details: failedFixtureChecks.flatMap((check) => [check.label, ...check.details]),
			},
			{
				label: "Live semi-open checks",
				passed: failedLiveChecks.length === 0,
				details: failedLiveChecks.flatMap((check) => [check.label, ...check.details]),
			},
		],
	)
}

export async function runPublicBetaReleaseBundle(): Promise<ProofBundleResult> {
	const ownerBeta = await runOwnerBetaFixturesHarness()
	const ownerSurface = await runOwnerSurfaceHarness()
	const ownerLauncher = await runOwnerLauncherHarness()
	const ownerManifest = await runOwnerProfileManifestHarness()
	const demoRun = await runDemoRunHarness()

	return buildResult(
		"release_public_beta",
		"Release Public Beta",
		[
			"canonical owner wrapper surface and docs alignment",
			"frozen owner profile manifest and launcher path",
			"demo run path for stranger-facing evaluation",
			"beta aggregate truth without pretending RC1/RC2 release readiness",
		],
		[
			"package install experience",
			"final fuller-swarm release gate",
			"unsupported repo classes or autonomy claims",
		],
		[
			{
				label: "Owner beta aggregate fixtures",
				passed:
					ownerBeta.requiredEvidencePasses &&
					ownerBeta.smokeFailureBlocksBeta &&
					ownerBeta.missingCreditedRunBlocksBeta &&
					ownerBeta.betaCanBeReadyWhileRc1StillRed,
				details: ownerBeta.details,
			},
			{
				label: "Owner surface fixtures",
				passed:
					ownerSurface.canonicalScriptsPresent &&
					ownerSurface.readmeCanonicalFlowAligned &&
					ownerSurface.quickstartCanonicalFlowAligned &&
					ownerSurface.oversightCanonicalFlowAligned &&
					ownerSurface.releaseNotesCanonicalFlowAligned &&
					ownerSurface.followUpSurfaceAligned &&
					ownerSurface.canonicalDocsDemoteLegacyDefaults &&
					ownerSurface.boundedReleaseChecklistPresent &&
					ownerSurface.boundedSupportRunbookPresent &&
					ownerSurface.supportIssueIntakeGuidePresent &&
					ownerSurface.bugTemplateAligned &&
					ownerSurface.outcomeDashboardDocsPresent &&
					ownerSurface.publicBetaOperationsDocsPresent &&
					ownerSurface.shipFirstReadinessDocsPresent &&
					ownerSurface.contributorSourceCheckoutDocsPresent &&
					ownerSurface.contributorProofLoopDocsPresent,
				details: ownerSurface.details,
			},
			{
				label: "Owner launcher fixtures",
				passed:
					ownerLauncher.canonicalWorkspaceSelected &&
					ownerLauncher.canonicalProviderDefaultsApplied &&
					ownerLauncher.passOutputCompact &&
					ownerLauncher.failureOutputCompact &&
					ownerLauncher.manifestExposed,
				details: ownerLauncher.details,
			},
			{
				label: "Owner profile manifest fixtures",
				passed:
					ownerManifest.manifestCreated &&
					ownerManifest.manifestStable &&
					ownerManifest.driftFailsClosed &&
					ownerManifest.manifestFieldsVisible,
				details: ownerManifest.details,
			},
			{
				label: "Demo run fixtures",
				passed:
					demoRun.disposableWorkspaceStaged &&
					demoRun.resetRemovesPreviousDrift &&
					demoRun.frozenProviderDefaultsApplied &&
					demoRun.passOutputShowsArtifactsAndDiffs &&
					demoRun.failOutputStaysCompact &&
					demoRun.resetOutputUseful,
				details: demoRun.details,
			},
		],
	)
}

export async function runBundleExperienceBundle(): Promise<ProofBundleResult> {
	const packageRc1 = await runPackageRc1Harness()
	const ownerSurface = await runOwnerSurfaceHarness()
	const ownerLauncher = await runOwnerLauncherHarness()
	const ownerManifest = await runOwnerProfileManifestHarness()
	const demoRun = await runDemoRunHarness()

	return buildResult(
		"bundle_experience",
		"Bundle Experience",
		[
			"packaged launch and safe-task smoke path",
			"license and runtime contract presence in the bundle",
			"canonical demo and owner guidance surfaced from the shipped path",
			"wrapper-only owner truth and manifest-drift protection",
		],
		[
			"unsupported installer formats",
			"broad repo compatibility claims",
			"final fuller-swarm release decision",
		],
		[
			{
				label: "Package RC1 fixtures",
				passed:
					packageRc1.bundleArtifactsBuilt &&
					packageRc1.runtimeContractAligned &&
					packageRc1.licenseIncluded &&
					packageRc1.cleanInstallSmoke &&
					packageRc1.installDiagnosticsVisible &&
					packageRc1.launchSmoke &&
					packageRc1.safeTaskThroughPackagedPath &&
					packageRc1.bundleDocsPresent &&
					packageRc1.demoPackIncluded &&
					packageRc1.demoScriptsPresent &&
					packageRc1.guidedDemoAndProviderScriptsPresent &&
					packageRc1.replayAndGalleryScriptsPresent &&
					packageRc1.missingPrerequisiteMessage,
				details: packageRc1.details,
			},
			{
				label: "Owner surface fixtures",
				passed:
					ownerSurface.canonicalScriptsPresent &&
					ownerSurface.readmeCanonicalFlowAligned &&
					ownerSurface.quickstartCanonicalFlowAligned &&
					ownerSurface.oversightCanonicalFlowAligned &&
					ownerSurface.releaseNotesCanonicalFlowAligned &&
					ownerSurface.followUpSurfaceAligned &&
					ownerSurface.canonicalDocsDemoteLegacyDefaults &&
					ownerSurface.boundedReleaseChecklistPresent &&
					ownerSurface.boundedSupportRunbookPresent &&
					ownerSurface.supportIssueIntakeGuidePresent &&
					ownerSurface.bugTemplateAligned &&
					ownerSurface.outcomeDashboardDocsPresent &&
					ownerSurface.publicBetaOperationsDocsPresent &&
					ownerSurface.shipFirstReadinessDocsPresent &&
					ownerSurface.contributorSourceCheckoutDocsPresent &&
					ownerSurface.contributorProofLoopDocsPresent,
				details: ownerSurface.details,
			},
			{
				label: "Owner launcher fixtures",
				passed:
					ownerLauncher.canonicalWorkspaceSelected &&
					ownerLauncher.canonicalProviderDefaultsApplied &&
					ownerLauncher.passOutputCompact &&
					ownerLauncher.failureOutputCompact &&
					ownerLauncher.manifestExposed,
				details: ownerLauncher.details,
			},
			{
				label: "Owner profile manifest fixtures",
				passed:
					ownerManifest.manifestCreated &&
					ownerManifest.manifestStable &&
					ownerManifest.driftFailsClosed &&
					ownerManifest.manifestFieldsVisible,
				details: ownerManifest.details,
			},
			{
				label: "Demo run fixtures",
				passed:
					demoRun.disposableWorkspaceStaged &&
					demoRun.resetRemovesPreviousDrift &&
					demoRun.frozenProviderDefaultsApplied &&
					demoRun.passOutputShowsArtifactsAndDiffs &&
					demoRun.failOutputStaysCompact &&
					demoRun.resetOutputUseful,
				details: demoRun.details,
			},
		],
	)
}

export async function runFullerSwarmReleaseBundle(): Promise<ProofBundleResult> {
	const small = await runSmallLaneBundle()
	const smallReplay = await runSmallReplayBundle()
	const medium = await runMediumLaneBundle()
	const recordedProofChecks = evaluateReleaseRecordedProofs()
	const bundleExperience = await runBundleExperienceBundle()
	const benchmarkGate = evaluateFullerSwarmBenchmarkGate(resolveRootDir())

	return buildResult(
		"release_fuller_v2",
		"Fuller V2 Release Gate",
		[
			"small, replay, medium, and semi-open bounded lanes",
			"fixed benchmark, task-corpus, and demo evidence for the fuller-swarm band closeout",
			"serial release-gate discipline via recorded dated PASS evidence for expensive predecessor lanes",
			"bundle experience plus canonical owner and demo surfaces",
			"profile manifest freeze, manifest-drift protection, and wrapper-only truth on the shipping path",
		],
		[
			"general autonomous coding claims",
			"unsupported repo classes",
			"installer formats beyond the verified local Windows bundle",
		],
		[
			{
				label: "Small lane bundle",
				passed: proofBundlePassed(small),
				details: summarizeBundleFailures(small),
			},
			{
				label: "Small replay bundle",
				passed: proofBundlePassed(smallReplay),
				details: summarizeBundleFailures(smallReplay),
			},
			{
				label: "Medium lane bundle",
				passed: proofBundlePassed(medium),
				details: summarizeBundleFailures(medium),
			},
			...recordedProofChecks,
			{
				label: "Fuller-swarm benchmark gate",
				passed: benchmarkGate.decision === "GO",
				details: [benchmarkGate.summary, ...benchmarkGate.checks.filter((check) => !check.passed).flatMap((check) => [check.label, ...check.details])],
			},
			{
				label: "Bundle experience bundle",
				passed: proofBundlePassed(bundleExperience),
				details: summarizeBundleFailures(bundleExperience),
			},
		],
	)
}
