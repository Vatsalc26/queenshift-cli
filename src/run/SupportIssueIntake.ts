import { formatQueenshiftWorkspaceCommand } from "../cli/CommandSurface"

export type SupportIssueIntake = {
	guidePath: string
	templatePath: string
	suggestedTitle: string
	summary: string
	proofCommands: string[]
	artifactPaths: string[]
	note: string
}

export type SupportIssueIntakeInput = {
	runId: string
	task: string
	workspace: string
	status: string
	failureBucket: string
	stopReason: string
	pathChosen: string | null
	reviewerVerdict: string | null
	summaryPath: string
	incidentPackPath: string
	reviewPackPath: string | null
}

export const SUPPORT_ISSUE_INTAKE_GUIDE_RELATIVE_PATH = "SUPPORT_ISSUE_INTAKE.md"
export const SUPPORT_ISSUE_TEMPLATE_RELATIVE_PATH = ".github/ISSUE_TEMPLATE/bug_report.md"

function normalizeToken(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function buildTitleFragment(input: SupportIssueIntakeInput): string {
	const bucket = normalizeToken(input.failureBucket)
	if (bucket.length > 0) return bucket
	const stopReason = normalizeToken(input.stopReason)
	if (stopReason.length > 0) return stopReason
	return "bounded run failure"
}

function buildSummary(input: SupportIssueIntakeInput): string {
	const scope = input.pathChosen ? ` on ${input.pathChosen}` : ""
	const reviewer = input.reviewerVerdict ? ` reviewer=${input.reviewerVerdict}` : ""
	return `Run ${input.runId} ended ${input.status}${scope} with failure bucket "${input.failureBucket}" and stop reason "${input.stopReason}".${reviewer}`.trim()
}

export function buildSupportIssueIntake(input: SupportIssueIntakeInput): SupportIssueIntake {
	const proofCommands = [
		"npm.cmd test",
		formatQueenshiftWorkspaceCommand(["incident:show", input.runId], input.workspace),
		formatQueenshiftWorkspaceCommand(["replay:latest"], input.workspace),
		formatQueenshiftWorkspaceCommand(["owner:quick-actions"], input.workspace),
	]
	const artifactPaths = [input.summaryPath, input.incidentPackPath, input.reviewPackPath].filter(
		(value): value is string => typeof value === "string" && value.trim().length > 0,
	)
	const titleFragment = buildTitleFragment(input)
	return {
		guidePath: SUPPORT_ISSUE_INTAKE_GUIDE_RELATIVE_PATH,
		templatePath: SUPPORT_ISSUE_TEMPLATE_RELATIVE_PATH,
		suggestedTitle: `[bug] ${titleFragment}`,
		summary: buildSummary(input),
		proofCommands,
		artifactPaths,
		note: "Paste the artifact-backed details from the latest incident pack instead of reconstructing the failure from memory.",
	}
}
