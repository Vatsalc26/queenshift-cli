export type IncidentTriageCategory =
	| "provider_setup_issue"
	| "workspace_staging_issue"
	| "unsupported_task_scope"
	| "merge_or_review_failure"
	| "verification_or_quality_failure"
	| "unknown_incident"

export type FailureTaxonomyCode =
	| "provider_setup_auth"
	| "provider_transport_reliability"
	| "workspace_dirty_entry"
	| "workspace_active_lock"
	| "command_policy_violation"
	| "unsupported_scope_change"
	| "acceptance_gate_miss"
	| "review_blocked"
	| "merge_conflict"
	| "verification_profile_failure"
	| "runtime_guardrail_or_watchdog"
	| "unknown_failure"

export type FailureTaxonomy = {
	category: IncidentTriageCategory
	code: FailureTaxonomyCode
	label: string
	recommendedLabel: string
	defaultRationale: string
	firstInvariantAtRisk: string
	shortArea: string
	nearbyProofCommands: string[]
}

export type FixRedLaneSuggestion = {
	templatePath: string
	suggestedFileName: string
	firstInvariantAtRisk: string
	nearbyProofCommands: string[]
	evidence: string[]
	stageCommand: string
	scaffold: string
}

function unique(items: string[]): string[] {
	return Array.from(new Set(items.map((item) => item.trim()).filter((item) => item.length > 0)))
}

function taxonomyFor(code: FailureTaxonomyCode): FailureTaxonomy {
	switch (code) {
		case "provider_setup_auth":
			return {
				category: "provider_setup_issue",
				code,
				label: "Provider setup/auth issue",
				recommendedLabel: "investigate provider/auth setup",
				defaultRationale: "The incident points to provider credentials or launch setup rather than code-change scope.",
				firstInvariantAtRisk: "supported provider setup and launch path",
				shortArea: "ProviderSetup",
				nearbyProofCommands: ["npm.cmd run verify:provider:resilience", "npm.cmd run verify:owner:smoke"],
			}
		case "provider_transport_reliability":
			return {
				category: "provider_setup_issue",
				code,
				label: "Provider transport issue",
				recommendedLabel: "stabilize provider transport before retrying",
				defaultRationale: "The incident points to transport or timeout instability on the supported provider path.",
				firstInvariantAtRisk: "reliable provider transport on the supported path",
				shortArea: "ProviderReliability",
				nearbyProofCommands: ["npm.cmd run verify:provider:resilience", "npm.cmd run verify:owner:smoke"],
			}
		case "workspace_dirty_entry":
			return {
				category: "workspace_staging_issue",
				code,
				label: "Dirty workspace entry",
				recommendedLabel: "clean or explicitly allow the workspace state",
				defaultRationale: "The incident was blocked by pre-existing workspace state before a safe bounded run could begin.",
				firstInvariantAtRisk: "clean workspace admission boundary",
				shortArea: "WorkspaceAdmission",
				nearbyProofCommands: ["npm.cmd run verify:admission", "npm.cmd run verify:recovery"],
			}
		case "workspace_active_lock":
			return {
				category: "workspace_staging_issue",
				code,
				label: "Workspace already locked",
				recommendedLabel: "wait for or clear the active run lock",
				defaultRationale: "The incident hit the one-live-run-per-workspace lock and should not be retried blindly.",
				firstInvariantAtRisk: "one-live-run-per-workspace lock boundary",
				shortArea: "WorkspaceLock",
				nearbyProofCommands: ["npm.cmd run verify:admission", "npm.cmd run verify:recovery"],
			}
		case "command_policy_violation":
			return {
				category: "workspace_staging_issue",
				code,
				label: "Blocked by command policy",
				recommendedLabel: "inspect the blocked command and guardrail policy",
				defaultRationale: "The incident was refused by the command policy and should be narrowed before retrying.",
				firstInvariantAtRisk: "command allowlist boundary",
				shortArea: "CommandPolicy",
				nearbyProofCommands: ["npm.cmd run verify:guardrails", "npm.cmd run verify:incident"],
			}
		case "unsupported_scope_change":
			return {
				category: "unsupported_task_scope",
				code,
				label: "Scope drift",
				recommendedLabel: "narrow the task or stage FixRedLane",
				defaultRationale: "The incident drifted beyond the proven bounded lane for supported file scope.",
				firstInvariantAtRisk: "bounded task scope contract",
				shortArea: "ScopeDrift",
				nearbyProofCommands: ["npm.cmd run verify:acceptance:gates", "npm.cmd run verify:incident-triage"],
			}
		case "acceptance_gate_miss":
			return {
				category: "unsupported_task_scope",
				code,
				label: "Acceptance gate miss",
				recommendedLabel: "restore the expected diff or stage FixRedLane",
				defaultRationale: "The run reached an acceptance boundary but did not satisfy the expected bounded result.",
				firstInvariantAtRisk: "acceptance gate and expected diff contract",
				shortArea: "AcceptanceGate",
				nearbyProofCommands: ["npm.cmd run verify:acceptance:gates", "npm.cmd run verify:incident-triage"],
			}
		case "review_blocked":
			return {
				category: "merge_or_review_failure",
				code,
				label: "Review blocked",
				recommendedLabel: "resolve review evidence before retrying",
				defaultRationale: "The incident stopped at review and the current evidence is not yet safely approvable.",
				firstInvariantAtRisk: "review evidence approval boundary",
				shortArea: "ReviewBlocked",
				nearbyProofCommands: ["npm.cmd run verify:review:queue", "npm.cmd run verify:owner:quick-actions"],
			}
		case "merge_conflict":
			return {
				category: "merge_or_review_failure",
				code,
				label: "Merge conflict",
				recommendedLabel: "resolve merge evidence before retrying",
				defaultRationale: "The incident stopped at merge and needs artifact-backed cleanup or review before another run.",
				firstInvariantAtRisk: "isolated merge boundary",
				shortArea: "MergeConflict",
				nearbyProofCommands: ["npm.cmd run verify:review:queue", "npm.cmd run verify:incident"],
			}
		case "verification_profile_failure":
			return {
				category: "verification_or_quality_failure",
				code,
				label: "Verification profile failure",
				recommendedLabel: "inspect verification failure",
				defaultRationale: "The run reached post-edit verification and failed there, so the verification evidence should drive the next fix.",
				firstInvariantAtRisk: "post-edit verification contract",
				shortArea: "VerificationProfile",
				nearbyProofCommands: ["npm.cmd run verify:profiles", "npm.cmd run verify:incident"],
			}
		case "runtime_guardrail_or_watchdog":
			return {
				category: "verification_or_quality_failure",
				code,
				label: "Runtime guardrail or watchdog issue",
				recommendedLabel: "inspect the runtime guardrail before retrying",
				defaultRationale: "The run stopped because a runtime safety ceiling or watchdog boundary fired first.",
				firstInvariantAtRisk: "runtime guardrail and watchdog boundary",
				shortArea: "RuntimeGuardrail",
				nearbyProofCommands: ["npm.cmd run verify:guardrails", "npm.cmd run verify:owner:life-signal"],
			}
		default:
			return {
				category: "unknown_incident",
				code: "unknown_failure",
				label: "Unknown incident",
				recommendedLabel: "inspect the incident pack before retrying",
				defaultRationale: "No narrower diagnosis was derived safely from the recorded incident evidence.",
				firstInvariantAtRisk: "incident evidence classification",
				shortArea: "Incident",
				nearbyProofCommands: ["npm.cmd run verify:incident", "npm.cmd run verify:incident-triage"],
			}
	}
}

export function classifyFailureTaxonomy(input: {
	status: string | null
	stopReason: string | null
	failureBucket: string | null
	hasReviewPack?: boolean
}): FailureTaxonomy {
	const stopReason = input.stopReason ?? ""
	const failureBucket = input.failureBucket ?? ""
	const hasReviewPack = input.hasReviewPack === true

	switch (stopReason) {
		case "provider_auth_failure":
		case "provider_launch_failure":
			return taxonomyFor("provider_setup_auth")
		case "provider_timeout":
		case "provider_malformed_response":
		case "provider_empty_response":
		case "provider_transport_failure":
		case "provider_ceiling_reached":
			return taxonomyFor("provider_transport_reliability")
		case "dirty_repo_refusal":
			return taxonomyFor("workspace_dirty_entry")
		case "workspace_run_locked":
			return taxonomyFor("workspace_active_lock")
		case "command_blocked":
		case "verification_command_blocked":
			return taxonomyFor("command_policy_violation")
		case "scope_drift":
		case "missing_expected_change":
		case "too_many_changed_files":
			return taxonomyFor("unsupported_scope_change")
		case "acceptance_gate_failed":
		case "no_diff_evidence":
			return taxonomyFor("acceptance_gate_miss")
		case "review_blocked":
		case "reviewer_invalid":
		case "reviewer_unavailable":
			return taxonomyFor("review_blocked")
		case "merge_conflict":
			return taxonomyFor("merge_conflict")
		case "verification_failed":
		case "verification_timeout":
			return taxonomyFor("verification_profile_failure")
		case "run_duration_ceiling":
		case "model_call_ceiling":
		case "usage_budget_ceiling":
		case "timeout":
		case "watchdog_abort":
		case "ceiling_reached":
			return taxonomyFor("runtime_guardrail_or_watchdog")
	}

	if (input.status === "review_required" || hasReviewPack) {
		return taxonomyFor("review_blocked")
	}

	switch (failureBucket) {
		case "provider/config failure":
			return taxonomyFor("provider_transport_reliability")
		case "workspace active run lock":
			return taxonomyFor("workspace_active_lock")
		case "dirty repo refusal":
			return taxonomyFor("workspace_dirty_entry")
		case "command blocked":
			return taxonomyFor("command_policy_violation")
		case "scope or acceptance gate":
		case "scope drift":
			return taxonomyFor("unsupported_scope_change")
		case "review blocked":
			return taxonomyFor("review_blocked")
		case "merge conflict":
			return taxonomyFor("merge_conflict")
		case "verification profile":
			return taxonomyFor("verification_profile_failure")
		case "guardrail ceiling":
		case "timeout/watchdog":
		case "ceiling reached":
			return taxonomyFor("runtime_guardrail_or_watchdog")
		default:
			return taxonomyFor("unknown_failure")
	}
}

export function buildFixRedLaneSuggestion(input: {
	runId: string | null
	taxonomy: FailureTaxonomy
	summaryPath?: string | null
	incidentPackPath?: string | null
	reviewPackPath?: string | null
	stopReason?: string | null
	failureBucket?: string | null
	rationale?: string | null
	nextActionLabel?: string | null
}): FixRedLaneSuggestion {
	const templatePath = "Coding_sessions/FIX_RED_LANE_TEMPLATE.md"
	const suggestedFileName = `FixRedLane_SessionXX_${input.taxonomy.shortArea}.md`
	const nearbyProofCommands = unique(["npm.cmd test", "npm.cmd run verify:incident", ...input.taxonomy.nearbyProofCommands])
	const evidence = unique(
		[
			input.runId ? `runId=${input.runId}` : null,
			`taxonomy=${input.taxonomy.code}`,
			input.stopReason ? `stopReason=${input.stopReason}` : null,
			input.failureBucket ? `failureBucket=${input.failureBucket}` : null,
			input.nextActionLabel ? `nextAction=${input.nextActionLabel}` : null,
			input.summaryPath ? `summary=${input.summaryPath}` : null,
			input.reviewPackPath ? `reviewPack=${input.reviewPackPath}` : null,
			input.incidentPackPath ? `incidentPack=${input.incidentPackPath}` : null,
		].filter((value): value is string => Boolean(value)),
	)
	const stageCommand = [
		`Create Coding_sessions/${suggestedFileName}`,
		`from ${templatePath}`,
		`carry forward ${input.runId ? `run ${input.runId}` : "the blocked run"}`,
		`rerun nearby proofs: ${nearbyProofCommands.join(" ; ")}`,
	].join("; ")
	const scaffold = [
		`Suggested file: ${suggestedFileName}`,
		`Template: ${templatePath}`,
		"Blocked session: SessionXX (replace XX with the blocked numbered session)",
		"Failing proof command(s): rerun the blocked session proof command(s) first, then use the nearby proofs below as a safety net.",
		`First invariant at risk: ${input.taxonomy.firstInvariantAtRisk}`,
		...(input.rationale ? [`Why this is red: ${input.rationale}`] : []),
		"Nearby proofs:",
		...nearbyProofCommands.map((command) => `- ${command}`),
		...(evidence.length > 0 ? ["Evidence:", ...evidence.map((line) => `- ${line}`)] : []),
	].join("\n")

	return {
		templatePath,
		suggestedFileName,
		firstInvariantAtRisk: input.taxonomy.firstInvariantAtRisk,
		nearbyProofCommands,
		evidence,
		stageCommand,
		scaffold,
	}
}
