export type RuntimeConfig = {
	providerCallTimeoutMs: number
	providerRetryBackoffMs: number
	agentWaitTimeoutMs: number
	overallRunCeilingMs: number
	maxModelCallsPerRun: number
	smallTaskMaxModelCalls: number
	mediumTaskMaxModelCalls: number
	maxEstimatedTokensPerRun: number
	smallTaskMaxEstimatedTokens: number
	mediumTaskMaxEstimatedTokens: number
	maxConcurrentLiveRunsPerWorkspace: number
	agentStaleThresholdMs: number
	watchdogCheckIntervalMs: number
	heartbeatIntervalMs: number
	providerMaxRetries: number
	admissionMaxRepoFileCount: number
	admissionMaxRepoBytes: number
	admissionTier2MaxRepoFileCount: number
	admissionTier2MaxRepoBytes: number
	admissionBinaryGeneratedDominanceRatio: number
	admissionBinaryGeneratedMinFileCount: number
	admissionMaxScopedFileCount: number
	verificationProfileDefaultTimeoutMs: number
	verificationProfileMaxTimeoutMs: number
	verificationProfileMaxOutputChars: number
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseRatio(raw: string | undefined, fallback: number): number {
	const parsed = raw ? Number.parseFloat(raw) : Number.NaN
	return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback
}

export function resolveRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
	const providerCallTimeoutMs = parsePositiveInt(
		env["SWARM_PROVIDER_CALL_TIMEOUT_MS"] ?? env["GEMINI_CLI_TIMEOUT_MS"] ?? env["SWARM_GEMINI_CLI_TIMEOUT_MS"],
		300_000,
	)
	const watchdogCheckIntervalMs = parsePositiveInt(env["SWARM_WATCHDOG_INTERVAL_MS"], 30_000)
	const heartbeatIntervalMs = parsePositiveInt(env["SWARM_HEARTBEAT_INTERVAL_MS"], 15_000)
	const requestedAgentWaitTimeoutMs = parsePositiveInt(env["SWARM_AGENT_WAIT_TIMEOUT_MS"], 300_000)
	const minimumAgentWaitTimeoutMs = providerCallTimeoutMs + watchdogCheckIntervalMs + heartbeatIntervalMs

	return {
		providerCallTimeoutMs,
		providerRetryBackoffMs: parsePositiveInt(env["SWARM_PROVIDER_RETRY_BACKOFF_MS"], 1_500),
		agentWaitTimeoutMs: Math.max(requestedAgentWaitTimeoutMs, minimumAgentWaitTimeoutMs),
		overallRunCeilingMs: parsePositiveInt(env["SWARM_RUN_CEILING_MS"], 600_000),
		maxModelCallsPerRun: parsePositiveInt(env["SWARM_MAX_MODEL_CALLS"], 10),
		smallTaskMaxModelCalls: parsePositiveInt(env["SWARM_SMALL_TASK_MAX_MODEL_CALLS"], 6),
		mediumTaskMaxModelCalls: parsePositiveInt(env["SWARM_MEDIUM_TASK_MAX_MODEL_CALLS"], 9),
		maxEstimatedTokensPerRun: parsePositiveInt(env["SWARM_MAX_ESTIMATED_TOKENS"], 50_000),
		smallTaskMaxEstimatedTokens: parsePositiveInt(env["SWARM_SMALL_TASK_MAX_ESTIMATED_TOKENS"], 25_000),
		mediumTaskMaxEstimatedTokens: parsePositiveInt(env["SWARM_MEDIUM_TASK_MAX_ESTIMATED_TOKENS"], 42_500),
		maxConcurrentLiveRunsPerWorkspace: 1,
		agentStaleThresholdMs: parsePositiveInt(env["SWARM_AGENT_STALE_THRESHOLD_MS"], 120_000),
		watchdogCheckIntervalMs,
		heartbeatIntervalMs,
		providerMaxRetries: Math.max(0, parsePositiveInt(env["SWARM_PROVIDER_MAX_RETRIES"], 1)),
		admissionMaxRepoFileCount: parsePositiveInt(env["SWARM_ADMISSION_MAX_REPO_FILE_COUNT"], 2_000),
		admissionMaxRepoBytes: parsePositiveInt(env["SWARM_ADMISSION_MAX_REPO_BYTES"], 10_000_000),
		admissionTier2MaxRepoFileCount: parsePositiveInt(env["SWARM_ADMISSION_TIER2_MAX_REPO_FILE_COUNT"], 6_000),
		admissionTier2MaxRepoBytes: parsePositiveInt(env["SWARM_ADMISSION_TIER2_MAX_REPO_BYTES"], 30_000_000),
		admissionBinaryGeneratedDominanceRatio: parseRatio(env["SWARM_ADMISSION_BINARY_GENERATED_RATIO"], 0.6),
		admissionBinaryGeneratedMinFileCount: parsePositiveInt(env["SWARM_ADMISSION_BINARY_GENERATED_MIN_FILES"], 15),
		admissionMaxScopedFileCount: parsePositiveInt(env["SWARM_ADMISSION_MAX_SCOPED_FILE_COUNT"], 10),
		verificationProfileDefaultTimeoutMs: parsePositiveInt(env["SWARM_VERIFICATION_PROFILE_DEFAULT_TIMEOUT_MS"], 60_000),
		verificationProfileMaxTimeoutMs: parsePositiveInt(env["SWARM_VERIFICATION_PROFILE_MAX_TIMEOUT_MS"], 120_000),
		verificationProfileMaxOutputChars: parsePositiveInt(env["SWARM_VERIFICATION_PROFILE_MAX_OUTPUT_CHARS"], 20_000),
	}
}
