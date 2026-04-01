export type SummaryLike = {
	task?: unknown
	status?: unknown
	stopReason?: unknown
	taskContract?: unknown
	verificationProfile?: unknown
	guardrails?: unknown
	replayArtifactPath?: unknown
}

export function classifyStopReason(stopReason: string): { bucket: string; nextPlaceToLook: string } {
	switch (stopReason) {
		case "workspace_run_locked":
			return {
				bucket: "workspace active run lock",
				nextPlaceToLook: "Inspect summary.json guardrails.workspaceRunLock to see which live run is holding the workspace.",
			}
		case "run_duration_ceiling":
		case "model_call_ceiling":
		case "usage_budget_ceiling":
		case "review_blocked":
		case "reviewer_invalid":
		case "reviewer_unavailable":
			if (stopReason === "run_duration_ceiling" || stopReason === "model_call_ceiling" || stopReason === "usage_budget_ceiling") {
				return {
					bucket: "guardrail ceiling",
					nextPlaceToLook: "Inspect summary.json guardrails for the specific runtime, model-call, or usage ceiling that fired.",
				}
			}
			return { bucket: "review blocked", nextPlaceToLook: "Inspect summary.json reviewer fields and recent reviewer logs." }
		case "command_blocked":
			return { bucket: "command blocked", nextPlaceToLook: "Inspect CommandGate allowlist and builder command attempts." }
		case "verification_failed":
		case "verification_command_blocked":
		case "verification_timeout":
			return {
				bucket: "verification profile",
				nextPlaceToLook: "Inspect verificationProfile fields and captured verification output in summary.json.",
			}
		case "scope_drift":
		case "missing_expected_change":
		case "too_many_changed_files":
		case "acceptance_gate_failed":
			return { bucket: "scope or acceptance gate", nextPlaceToLook: "Inspect acceptanceGate and taskContract fields in summary.json." }
		case "no_diff_evidence":
			return { bucket: "no diff evidence", nextPlaceToLook: "Inspect changedFiles and git diff evidence in summary.json." }
		case "timeout":
		case "watchdog_abort":
			return { bucket: "timeout/watchdog", nextPlaceToLook: "Inspect agent iteration counts and watchdog-related logs." }
		case "merge_conflict":
			return { bucket: "merge conflict", nextPlaceToLook: "Inspect merger output and branch list in summary.json." }
		case "dirty_repo_refusal":
			return { bucket: "dirty repo refusal", nextPlaceToLook: "Check workspace status or rerun with --allowDirty only if intentional." }
		case "ceiling_reached":
			return { bucket: "ceiling reached", nextPlaceToLook: "Inspect summary usage/model-call counts and agent iterations." }
		case "provider_auth_failure":
		case "provider_launch_failure":
		case "provider_timeout":
		case "provider_malformed_response":
		case "provider_empty_response":
		case "provider_transport_failure":
		case "provider_ceiling_reached":
			return { bucket: "provider/config failure", nextPlaceToLook: "Inspect summary provider/runtime fields and recent provider_failure events." }
		case "operator_abort":
			return { bucket: "operator abort", nextPlaceToLook: "Inspect recovery fields and run_end events in summary.json." }
		case "success":
			return { bucket: "success", nextPlaceToLook: "Inspect summary.json if you need changed-files or cost details." }
		default:
			return { bucket: "unknown", nextPlaceToLook: "Inspect the latest summary.json and raw CLI output." }
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function formatForensicsReport(summaryPath: string | null, summary: SummaryLike | null): string {
	if (!summaryPath || !summary) {
		return "No run artifacts found yet. Run npm run verify:live:basic or a live swarm task first."
	}

	const task = typeof summary.task === "string" ? summary.task : "(unknown task)"
	const status = typeof summary.status === "string" ? summary.status : "unknown"
	const stopReason = typeof summary.stopReason === "string" ? summary.stopReason : "unknown"
	const replayArtifactPath = typeof summary.replayArtifactPath === "string" ? summary.replayArtifactPath : null
	const taskContract = asRecord(summary.taskContract)
	const derivation = asRecord(taskContract?.["derivation"])
	const derivationMode = typeof derivation?.["mode"] === "string" ? derivation["mode"] : null
	const derivationTaskClass = typeof derivation?.["taskClass"] === "string" ? derivation["taskClass"] : null
	const derivationSummary = typeof derivation?.["summary"] === "string" ? derivation["summary"] : null
	let diagnosis = classifyStopReason(stopReason)
	if (
		derivationMode === "semi_open" &&
		(stopReason === "scope_drift" ||
			stopReason === "missing_expected_change" ||
			stopReason === "too_many_changed_files" ||
			stopReason === "acceptance_gate_failed")
	) {
		diagnosis = {
			bucket: "semi-open scope discovery",
			nextPlaceToLook: "Inspect summary.json taskContract.derivation and acceptanceGate for the derived candidate file set.",
		}
	}
	const verification = summary.verificationProfile && typeof summary.verificationProfile === "object"
		? (summary.verificationProfile as Record<string, unknown>)
		: null
	const verificationStatus = typeof verification?.status === "string" ? verification.status : null
	const verificationName = typeof verification?.profileName === "string" ? verification.profileName : null
	const verificationMessage = typeof verification?.message === "string" ? verification.message : null
	const guardrails = asRecord(summary.guardrails)
	const runtimeGuardrail = asRecord(guardrails?.["runtimeMs"])
	const modelCallGuardrail = asRecord(guardrails?.["modelCalls"])
	const usageGuardrail = asRecord(guardrails?.["estimatedUsageTokens"])
	const workspaceLock = asRecord(guardrails?.["workspaceRunLock"])
	const runtimeUsed = typeof runtimeGuardrail?.["used"] === "number" ? runtimeGuardrail["used"] : null
	const runtimeLimit = typeof runtimeGuardrail?.["limit"] === "number" ? runtimeGuardrail["limit"] : null
	const runtimeReached = runtimeGuardrail?.["reached"] === true
	const modelCallsUsed = typeof modelCallGuardrail?.["used"] === "number" ? modelCallGuardrail["used"] : null
	const modelCallsLimit = typeof modelCallGuardrail?.["limit"] === "number" ? modelCallGuardrail["limit"] : null
	const modelCallsReached = modelCallGuardrail?.["reached"] === true
	const usageUsed = typeof usageGuardrail?.["used"] === "number" ? usageGuardrail["used"] : null
	const usageLimit = typeof usageGuardrail?.["limit"] === "number" ? usageGuardrail["limit"] : null
	const usageReached = usageGuardrail?.["reached"] === true
	const lockBlocked = workspaceLock?.["blockedByActiveRun"] === true
	const lockTaskId = typeof workspaceLock?.["blockingTaskId"] === "string" ? workspaceLock["blockingTaskId"] : null
	const lockPid = typeof workspaceLock?.["blockingPid"] === "number" ? workspaceLock["blockingPid"] : null
	const lockAcquiredAt = typeof workspaceLock?.["acquiredAt"] === "string" ? workspaceLock["acquiredAt"] : null

	const lines = [
		`Latest task: ${task}`,
		`Terminal status: ${status}`,
		`Likely failure bucket: ${diagnosis.bucket}`,
		`Next place to inspect: ${diagnosis.nextPlaceToLook}`,
		`Artifact: ${summaryPath}`,
		...(replayArtifactPath ? [`Replay: ${replayArtifactPath}`] : []),
	]

	if (derivationMode === "semi_open") {
		lines.splice(
			2,
			0,
			`Derived scope: semi_open${derivationTaskClass ? `/${derivationTaskClass}` : ""}${derivationSummary ? ` -> ${derivationSummary}` : ""}`,
		)
	}

	if (verificationStatus) {
		lines.splice(
			3,
			0,
			`Verification: ${verificationName ? `${verificationName} -> ` : ""}${verificationStatus}${verificationMessage ? ` (${verificationMessage})` : ""}`,
		)
	}

	if (runtimeUsed !== null && runtimeLimit !== null && modelCallsUsed !== null && modelCallsLimit !== null && usageUsed !== null && usageLimit !== null) {
		lines.splice(
			2,
			0,
			`Guardrails: runtime ${runtimeUsed}/${runtimeLimit}ms${runtimeReached ? " [REACHED]" : ""} | model calls ${modelCallsUsed}/${modelCallsLimit}${modelCallsReached ? " [REACHED]" : ""} | estimated tokens ${usageUsed}/${usageLimit}${usageReached ? " [REACHED]" : ""}`,
		)
	}

	if (lockBlocked) {
		lines.splice(
			3,
			0,
			`Workspace lock: blocked by active live run ${lockTaskId ?? "unknown"}${lockPid !== null ? ` (pid ${lockPid})` : ""}${lockAcquiredAt ? ` acquired ${lockAcquiredAt}` : ""}`,
		)
	}

	return lines.join("\n")
}
