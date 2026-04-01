import fs from "node:fs"
import path from "node:path"

export type DailyDriverRules = {
	requiredCreditedRuns: number
	requiredDistinctDates: number
	maxCreditedRunsPerDay: number
}

export type DailyDriverEntry = {
	date: string
	workspace: string
	task: string
	runId: string
	surface: string
	terminalStatus: string
	reviewerVerdict: string
	acceptanceGate: string
	verificationProfile: string
	manualRepair: boolean
	credited: boolean
	notes?: string
	endedAt?: string
	recordedAt?: string
	summaryPath?: string
}

export type DailyDriverLog = {
	version: number
	rules?: Partial<DailyDriverRules>
	entries: DailyDriverEntry[]
}

export type DailyDriverEvaluation = {
	passed: boolean
	creditedCount: number
	requiredCreditedRuns: number
	distinctDateCount: number
	requiredDistinctDates: number
	maxCreditedRunsPerDay: number
	maxObservedPerDay: number
	overfilledDates: string[]
	invalidCreditedEntries: string[]
	details: string[]
}

export type Rc1DailyDriverStatus = {
	currentDate: string
	creditedCount: number
	requiredCreditedRuns: number
	distinctDateCount: number
	requiredDistinctDates: number
	currentDateCreditedCount: number
	maxCreditedRunsPerDay: number
	latestCredited: DailyDriverEntry | null
	latestRejected: DailyDriverEntry | null
	remainingCreditedRuns?: number
	remainingDistinctDates?: number
	currentDateAtCap?: boolean
	nextEligibleDate?: string
}

export type Rc1AutoCreditDecision = "credited" | "rejected" | "duplicate" | "skipped"

export type Rc1AutoCreditResult = {
	decision: Rc1AutoCreditDecision
	reason: string
	runId: string | null
	entry: DailyDriverEntry | null
	logPath: string
	status: Rc1DailyDriverStatus
}

type ParsedRunSummary = {
	taskId: string
	task: string
	workspace: string
	dryRun: boolean
	status: string
	reviewerVerdict: string
	acceptanceGate: string
	verificationProfile: string
	manualRepair: boolean
	endedAt: string
	surface: string
}

type DailyDriverLogReadResult = {
	logPath: string
	log: DailyDriverLog | null
	parseError: string | null
}

type DerivedAutoCreditEntry = {
	entry: DailyDriverEntry
	reasons: string[]
	skipReason: string | null
}

export const RC1_DAILY_DRIVER_LOG_PATH = "RC1_DAILY_DRIVER_LOG.json"
const RC1_NON_CREDIT_SURFACE_REASONS = new Map<string, string>([
	["owner_smoke", "Owner smoke surface is non-credit by design."],
	["owner_guided_demo", "Owner guided demo surface is non-credit by design."],
	["demo_repo_pack", "Disposable demo repo pack surface is non-credit by design."],
])

export const RC1_NON_CREDIT_SURFACES = new Set(RC1_NON_CREDIT_SURFACE_REASONS.keys())

export const DEFAULT_DAILY_DRIVER_RULES: DailyDriverRules = {
	requiredCreditedRuns: 10,
	requiredDistinctDates: 3,
	maxCreditedRunsPerDay: 4,
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback
}

function asBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") return value
	if (typeof value === "number") {
		if (value === 1) return true
		if (value === 0) return false
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase()
		if (normalized === "true" || normalized === "yes" || normalized === "1") return true
		if (normalized === "false" || normalized === "no" || normalized === "0") return false
	}
	return null
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0
}

function hasExplicitManualRepairEvidence(summary: Record<string, unknown>, recovery: Record<string, unknown> | null): boolean {
	const manualRepairKeys = [
		"manualRepair",
		"requiresManualRepair",
		"manualIntervention",
		"manualInterventionRequired",
		"ownerManualRepair",
		"operatorManualRepair",
	]

	for (const key of manualRepairKeys) {
		const topLevel = asBoolean(summary[key])
		if (topLevel === true) return true

		const recoveryValue = asBoolean(recovery?.[key])
		if (recoveryValue === true) return true
	}

	const repair = asRecord(recovery?.["repair"])
	if (repair) {
		for (const key of manualRepairKeys) {
			const nested = asBoolean(repair[key])
			if (nested === true) return true
		}
	}

	return false
}

function normalizePathForCompare(value: string): string {
	const resolved = path.resolve(value)
	return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function isSubPath(candidatePath: string, parentPath: string): boolean {
	const normalizedCandidate = normalizePathForCompare(candidatePath)
	const normalizedParent = normalizePathForCompare(parentPath)
	if (normalizedCandidate === normalizedParent) return true
	const relativePath = path.relative(normalizedParent, normalizedCandidate)
	return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
}

function isValidIsoTimestamp(value: string): boolean {
	return !Number.isNaN(new Date(value).getTime())
}

function formatLocalIsoDate(value: Date): string {
	const year = value.getFullYear()
	const month = String(value.getMonth() + 1).padStart(2, "0")
	const day = String(value.getDate()).padStart(2, "0")
	return `${year}-${month}-${day}`
}

function isoDateFromTimestamp(value: string): string {
	return isValidIsoTimestamp(value) ? formatLocalIsoDate(new Date(value)) : ""
}

function todayIsoDate(now = new Date()): string {
	return formatLocalIsoDate(now)
}

function nextIsoDate(dateText: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return dateText
	const [yearText, monthText, dayText] = dateText.split("-")
	const year = Number.parseInt(yearText ?? "", 10)
	const month = Number.parseInt(monthText ?? "", 10)
	const day = Number.parseInt(dayText ?? "", 10)
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return dateText
	return formatLocalIsoDate(new Date(year, month - 1, day + 1))
}

function entryTimeMs(entry: DailyDriverEntry): number {
	const preferred = [entry.endedAt, entry.recordedAt]
	for (const candidate of preferred) {
		if (!isNonEmptyString(candidate)) continue
		const parsed = Date.parse(candidate)
		if (!Number.isNaN(parsed)) return parsed
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
		const parsed = Date.parse(`${entry.date}T00:00:00Z`)
		if (!Number.isNaN(parsed)) return parsed
	}
	return 0
}

function pickLatestEntry(entries: DailyDriverEntry[]): DailyDriverEntry | null {
	if (entries.length === 0) return null
	return [...entries].sort((left, right) => entryTimeMs(right) - entryTimeMs(left))[0] ?? null
}

function formatLatestEntry(entry: DailyDriverEntry | null): string {
	if (!entry) return "none"
	const reason = isNonEmptyString(entry.notes) ? entry.notes.trim() : "no reason recorded"
	return `${entry.runId} | ${entry.task || "(unknown task)"} | ${reason}`
}

export function resolveRc1RootDir(startDir = __dirname): string {
	let current = path.resolve(startDir)
	for (let depth = 0; depth < 6; depth += 1) {
		if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, "Readme.md"))) {
			return current
		}
		const parent = path.dirname(current)
		if (parent === current) break
		current = parent
	}
	return path.resolve(startDir)
}

export function mergeDailyDriverRules(rules?: Partial<DailyDriverRules>): DailyDriverRules {
	return {
		requiredCreditedRuns: Math.max(1, rules?.requiredCreditedRuns ?? DEFAULT_DAILY_DRIVER_RULES.requiredCreditedRuns),
		requiredDistinctDates: Math.max(1, rules?.requiredDistinctDates ?? DEFAULT_DAILY_DRIVER_RULES.requiredDistinctDates),
		maxCreditedRunsPerDay: Math.max(1, rules?.maxCreditedRunsPerDay ?? DEFAULT_DAILY_DRIVER_RULES.maxCreditedRunsPerDay),
	}
}

export function defaultDailyDriverLog(): DailyDriverLog {
	return {
		version: 1,
		rules: { ...DEFAULT_DAILY_DRIVER_RULES },
		entries: [],
	}
}

export function readDailyDriverLog(rootDir: string): DailyDriverLogReadResult {
	const logPath = path.join(rootDir, RC1_DAILY_DRIVER_LOG_PATH)
	if (!fs.existsSync(logPath)) {
		return { logPath, log: null, parseError: null }
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(logPath, "utf8")) as DailyDriverLog
		if (!Array.isArray(parsed.entries)) {
			return { logPath, log: null, parseError: `Unable to parse ${RC1_DAILY_DRIVER_LOG_PATH}: entries must be an array.` }
		}
		return { logPath, log: parsed, parseError: null }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return { logPath, log: null, parseError: `Unable to parse ${RC1_DAILY_DRIVER_LOG_PATH}: ${message}` }
	}
}

export function writeDailyDriverLog(logPath: string, log: DailyDriverLog): void {
	fs.writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`, "utf8")
}

export function describeRc1NonCreditReason(rootDir: string, workspace: string, surface: string): string | null {
	const normalizedSurface = surface.trim().toLowerCase()
	if (normalizedSurface && RC1_NON_CREDIT_SURFACES.has(normalizedSurface)) {
		return RC1_NON_CREDIT_SURFACE_REASONS.get(normalizedSurface) ?? "Run surface is non-credit by design."
	}

	const trimmedWorkspace = workspace.trim()
	if (!trimmedWorkspace) return null
	const resolvedWorkspace = path.resolve(trimmedWorkspace)
	const verificationDir = path.join(rootDir, "verification")
	if (fs.existsSync(verificationDir) && isSubPath(resolvedWorkspace, verificationDir)) {
		return "Verification fixture workspace is excluded from RC1 daily-driver credit."
	}

	return null
}

export function findDailyDriverEntryByRunId(rootDir: string, runId: string): DailyDriverEntry | null {
	const trimmedRunId = runId.trim()
	if (!trimmedRunId) return null
	const readResult = readDailyDriverLog(rootDir)
	if (readResult.parseError || !readResult.log) return null
	return readResult.log.entries.find((entry) => entry.runId === trimmedRunId) ?? null
}

export function evaluateDailyDriverLog(
	log: DailyDriverLog,
	rules = mergeDailyDriverRules(log.rules),
): DailyDriverEvaluation {
	const creditedEntries = Array.isArray(log.entries) ? log.entries.filter((entry) => entry?.credited === true) : []
	const invalidCreditedEntries: string[] = []
	const validCreditedEntries: DailyDriverEntry[] = []
	const seenRunIds = new Set<string>()

	for (const entry of creditedEntries) {
		const problems: string[] = []
		if (!isNonEmptyString(entry.date) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) problems.push("date")
		if (!isNonEmptyString(entry.workspace)) problems.push("workspace")
		if (!isNonEmptyString(entry.task)) problems.push("task")
		if (!isNonEmptyString(entry.runId)) problems.push("runId")
		if (!isNonEmptyString(entry.surface)) problems.push("surface")
		if (entry.terminalStatus !== "done") problems.push("terminalStatus")
		if (entry.reviewerVerdict !== "PASS") problems.push("reviewerVerdict")
		if (entry.acceptanceGate !== "passed") problems.push("acceptanceGate")
		if (!["passed", "not_applicable"].includes(entry.verificationProfile)) problems.push("verificationProfile")
		if (entry.manualRepair !== false) problems.push("manualRepair")
		if (isNonEmptyString(entry.runId) && seenRunIds.has(entry.runId)) problems.push("duplicateRunId")

		if (problems.length > 0) {
			invalidCreditedEntries.push(`${entry.runId || "(missing runId)"} -> ${problems.join(", ")}`)
			continue
		}

		seenRunIds.add(entry.runId)
		validCreditedEntries.push(entry)
	}

	const perDayCounts = new Map<string, number>()
	for (const entry of validCreditedEntries) {
		perDayCounts.set(entry.date, (perDayCounts.get(entry.date) ?? 0) + 1)
	}

	const distinctDateCount = perDayCounts.size
	const maxObservedPerDay = Math.max(0, ...perDayCounts.values())
	const overfilledDates = Array.from(perDayCounts.entries())
		.filter(([, count]) => count > rules.maxCreditedRunsPerDay)
		.map(([date]) => date)
		.sort((left, right) => left.localeCompare(right))

	const details = [
		`Credited runs: ${validCreditedEntries.length}/${rules.requiredCreditedRuns}.`,
		`Distinct dates: ${distinctDateCount}/${rules.requiredDistinctDates}.`,
		`Most credited runs on one date: ${maxObservedPerDay}/${rules.maxCreditedRunsPerDay}.`,
	]
	if (invalidCreditedEntries.length > 0) {
		details.push(`Invalid credited entries: ${invalidCreditedEntries.join(" | ")}`)
	}
	if (overfilledDates.length > 0) {
		details.push(`Too many credited runs on one date: ${overfilledDates.join(", ")}`)
	}

	const passed =
		invalidCreditedEntries.length === 0 &&
		overfilledDates.length === 0 &&
		validCreditedEntries.length >= rules.requiredCreditedRuns &&
		distinctDateCount >= rules.requiredDistinctDates

	return {
		passed,
		creditedCount: validCreditedEntries.length,
		requiredCreditedRuns: rules.requiredCreditedRuns,
		distinctDateCount,
		requiredDistinctDates: rules.requiredDistinctDates,
		maxCreditedRunsPerDay: rules.maxCreditedRunsPerDay,
		maxObservedPerDay,
		overfilledDates,
		invalidCreditedEntries,
		details,
	}
}

export function summarizeDailyDriverProgress(
	log: DailyDriverLog,
	now = new Date(),
): Rc1DailyDriverStatus {
	const evaluation = evaluateDailyDriverLog(log)
	const currentDate = todayIsoDate(now)
	const currentDateCreditedCount = log.entries.filter((entry) => entry.credited === true && entry.date === currentDate).length
	const remainingCreditedRuns = Math.max(0, evaluation.requiredCreditedRuns - evaluation.creditedCount)
	const remainingDistinctDates = Math.max(0, evaluation.requiredDistinctDates - evaluation.distinctDateCount)
	const currentDateAtCap = currentDateCreditedCount >= evaluation.maxCreditedRunsPerDay
	return {
		currentDate,
		creditedCount: evaluation.creditedCount,
		requiredCreditedRuns: evaluation.requiredCreditedRuns,
		distinctDateCount: evaluation.distinctDateCount,
		requiredDistinctDates: evaluation.requiredDistinctDates,
		currentDateCreditedCount,
		maxCreditedRunsPerDay: evaluation.maxCreditedRunsPerDay,
		latestCredited: pickLatestEntry(log.entries.filter((entry) => entry.credited === true)),
		latestRejected: pickLatestEntry(log.entries.filter((entry) => entry.credited !== true)),
		remainingCreditedRuns,
		remainingDistinctDates,
		currentDateAtCap,
		nextEligibleDate: currentDateAtCap ? nextIsoDate(currentDate) : currentDate,
	}
}

export function formatDailyDriverStatus(
	status: Rc1DailyDriverStatus,
	options: { blockedOnlyByRealStreak?: boolean | null } = {},
): string {
	const remainingCreditedRuns = status.remainingCreditedRuns ?? Math.max(0, status.requiredCreditedRuns - status.creditedCount)
	const remainingDistinctDates = status.remainingDistinctDates ?? Math.max(0, status.requiredDistinctDates - status.distinctDateCount)
	const currentDateAtCap = status.currentDateAtCap ?? status.currentDateCreditedCount >= status.maxCreditedRunsPerDay
	const nextEligibleDate = status.nextEligibleDate ?? (currentDateAtCap ? nextIsoDate(status.currentDate) : status.currentDate)
	const remainingSlotsToday = Math.max(0, status.maxCreditedRunsPerDay - status.currentDateCreditedCount)
	const blockedOnlyText =
		options.blockedOnlyByRealStreak == null
			? "not evaluated"
			: options.blockedOnlyByRealStreak
				? "YES"
				: "NO"

	return [
		`RC1 daily-driver progress: ${status.creditedCount}/${status.requiredCreditedRuns} runs, ${status.distinctDateCount}/${status.requiredDistinctDates} dates`,
		`Remaining for RC1 closeout: ${remainingCreditedRuns} run(s), ${remainingDistinctDates} distinct date(s)`,
		`Current date usage (${status.currentDate}): ${status.currentDateCreditedCount}/${status.maxCreditedRunsPerDay}`,
		currentDateAtCap
			? `Current date is capped for credit; next eligible credited date: ${nextEligibleDate}`
			: `Current date still has ${remainingSlotsToday} credited slot(s) left; next eligible credited date: ${nextEligibleDate}`,
		`Latest credited run: ${formatLatestEntry(status.latestCredited)}`,
		`Latest rejected run: ${formatLatestEntry(status.latestRejected)}`,
		`Blocked only by real credited dates/runs: ${blockedOnlyText}`,
	].join("\n")
}

function parseRunSummary(summaryPath: string): ParsedRunSummary | null {
	let raw: unknown
	try {
		raw = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as unknown
	} catch {
		return null
	}

	const summary = asRecord(raw)
	if (!summary) return null
	const acceptanceGate = asRecord(summary["acceptanceGate"])
	const verificationProfile = asRecord(summary["verificationProfile"])
	const recovery = asRecord(summary["recovery"])
	const workspace = asString(summary["workspace"]).trim()
	const taskId = asString(summary["taskId"], path.basename(path.dirname(summaryPath))).trim()
	const endedAt = asString(summary["endedAt"]).trim()
	const verificationStatus = verificationProfile ? asString(verificationProfile["status"]).trim() : "not_applicable"
	const manualRepair = hasExplicitManualRepairEvidence(summary, recovery)

	return {
		taskId,
		task: asString(summary["task"]).trim(),
		workspace,
		dryRun: summary["dryRun"] === true,
		status: asString(summary["status"]).trim(),
		reviewerVerdict: asString(summary["reviewerVerdict"]).trim(),
		acceptanceGate: acceptanceGate?.["passed"] === true ? "passed" : "failed",
		verificationProfile: verificationStatus || "missing",
		manualRepair,
		endedAt,
		surface: isNonEmptyString(summary["surface"])
			? String(summary["surface"]).trim()
			: isNonEmptyString(process.env["SWARM_RUN_SURFACE"])
				? String(process.env["SWARM_RUN_SURFACE"]).trim()
				: "cli_artifact",
	}
}

function deriveAutoCreditEntry(summaryPath: string, rootDir: string, now = new Date()): DerivedAutoCreditEntry {
	const parsedSummary = parseRunSummary(summaryPath)
	const fallbackRunId = path.basename(path.dirname(summaryPath))
	const recordedAt = now.toISOString()

	if (!parsedSummary) {
		return {
			entry: {
				date: "",
				workspace: "",
				task: "",
				runId: fallbackRunId || "(unknown run)",
				surface: "artifact_invalid",
				terminalStatus: "invalid_artifact",
				reviewerVerdict: "missing",
				acceptanceGate: "missing",
				verificationProfile: "missing",
				manualRepair: false,
				credited: false,
				notes: "Artifact could not be parsed as summary.json.",
				recordedAt,
				summaryPath: path.resolve(summaryPath),
			},
			reasons: ["artifact parse failed"],
			skipReason: null,
		}
	}

	const resolvedWorkspace = path.resolve(parsedSummary.workspace || ".")
	const nonCreditReason = describeRc1NonCreditReason(rootDir, resolvedWorkspace, parsedSummary.surface)
	if (nonCreditReason) {
		return {
			entry: {
				date: isoDateFromTimestamp(parsedSummary.endedAt),
				workspace: resolvedWorkspace,
				task: parsedSummary.task || "(unknown task)",
				runId: parsedSummary.taskId || fallbackRunId,
				surface: parsedSummary.surface,
				terminalStatus: parsedSummary.status || "unknown",
				reviewerVerdict: parsedSummary.reviewerVerdict || "missing",
				acceptanceGate: parsedSummary.acceptanceGate || "missing",
				verificationProfile: parsedSummary.verificationProfile || "missing",
				manualRepair: parsedSummary.manualRepair,
				credited: false,
				notes: nonCreditReason,
				endedAt: parsedSummary.endedAt || undefined,
				recordedAt,
				summaryPath: path.resolve(summaryPath),
			},
			reasons: [],
			skipReason: nonCreditReason,
		}
	}

	const reasons: string[] = []
	if (!parsedSummary.taskId) reasons.push("missing runId")
	if (!parsedSummary.task) reasons.push("missing task")
	if (!parsedSummary.workspace) reasons.push("missing workspace")
	if (!parsedSummary.endedAt || !isValidIsoTimestamp(parsedSummary.endedAt)) reasons.push("missing endedAt")
	if (parsedSummary.dryRun) reasons.push("dryRun=true")
	if (parsedSummary.status !== "done") reasons.push(`status=${parsedSummary.status || "missing"}`)
	if (parsedSummary.reviewerVerdict !== "PASS") reasons.push(`reviewerVerdict=${parsedSummary.reviewerVerdict || "missing"}`)
	if (parsedSummary.acceptanceGate !== "passed") reasons.push(`acceptanceGate=${parsedSummary.acceptanceGate || "missing"}`)
	if (!["passed", "not_applicable"].includes(parsedSummary.verificationProfile)) {
		reasons.push(`verificationProfile=${parsedSummary.verificationProfile || "missing"}`)
	}
	if (parsedSummary.manualRepair) reasons.push("manualRepair=true")

	const entry: DailyDriverEntry = {
		date: isoDateFromTimestamp(parsedSummary.endedAt),
		workspace: resolvedWorkspace,
		task: parsedSummary.task || "(unknown task)",
		runId: parsedSummary.taskId || fallbackRunId || "(unknown run)",
		surface: parsedSummary.surface || "cli_artifact",
		terminalStatus: parsedSummary.status || "missing",
		reviewerVerdict: parsedSummary.reviewerVerdict || "missing",
		acceptanceGate: parsedSummary.acceptanceGate || "missing",
		verificationProfile: parsedSummary.verificationProfile || "missing",
		manualRepair: parsedSummary.manualRepair,
		credited: reasons.length === 0,
		notes: reasons.length === 0 ? "Auto-credited from summary.json." : `Not credited: ${reasons.join(", ")}`,
		endedAt: parsedSummary.endedAt || undefined,
		recordedAt,
		summaryPath: path.resolve(summaryPath),
	}

	return { entry, reasons, skipReason: null }
}

export function recordDailyDriverFromSummaryPath(
	rootDir: string,
	summaryPath: string,
	now = new Date(),
): Rc1AutoCreditResult {
	const readResult = readDailyDriverLog(rootDir)
	const logPath = readResult.logPath
	if (readResult.parseError) {
		return {
			decision: "skipped",
			reason: readResult.parseError,
			runId: null,
			entry: null,
			logPath,
			status: summarizeDailyDriverProgress(defaultDailyDriverLog(), now),
		}
	}

	const derived = deriveAutoCreditEntry(summaryPath, rootDir, now)
	const existingLog = readResult.log ?? defaultDailyDriverLog()
	const rules = mergeDailyDriverRules(existingLog.rules)
	const statusBeforeWrite = summarizeDailyDriverProgress(existingLog, now)

	if (derived.skipReason) {
		return {
			decision: "skipped",
			reason: derived.skipReason,
			runId: derived.entry.runId || null,
			entry: null,
			logPath,
			status: statusBeforeWrite,
		}
	}

	if (existingLog.entries.some((entry) => entry.runId === derived.entry.runId)) {
		return {
			decision: "duplicate",
			reason: `Run ${derived.entry.runId} is already recorded in ${RC1_DAILY_DRIVER_LOG_PATH}.`,
			runId: derived.entry.runId,
			entry: null,
			logPath,
			status: statusBeforeWrite,
		}
	}

	const creditedOnDate = existingLog.entries.filter((entry) => entry.credited === true && entry.date === derived.entry.date).length
	if (derived.entry.credited && creditedOnDate >= rules.maxCreditedRunsPerDay) {
		derived.entry.credited = false
		derived.entry.notes = `Not credited: date ${derived.entry.date} already has ${creditedOnDate}/${rules.maxCreditedRunsPerDay} credited runs.`
	}

	const nextLog: DailyDriverLog = {
		...existingLog,
		rules: existingLog.rules ?? { ...DEFAULT_DAILY_DRIVER_RULES },
		entries: [...existingLog.entries, derived.entry],
	}
	writeDailyDriverLog(logPath, nextLog)

	const status = summarizeDailyDriverProgress(nextLog, now)
	return {
		decision: derived.entry.credited ? "credited" : "rejected",
		reason: derived.entry.notes ?? (derived.entry.credited ? "Auto-credited from summary.json." : "Run did not qualify."),
		runId: derived.entry.runId,
		entry: derived.entry,
		logPath,
		status,
	}
}
