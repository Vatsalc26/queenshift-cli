export const SUPPORTED_SWARM_ENGINES = ["swarmengine", "queenbee"] as const

export type SwarmEngineName = (typeof SUPPORTED_SWARM_ENGINES)[number]

export type EngineSelectionSource = "default" | "flag"

export type EngineSelection = {
	engine: SwarmEngineName
	source: EngineSelectionSource
}

function isSupportedEngine(value: string): value is SwarmEngineName {
	return (SUPPORTED_SWARM_ENGINES as readonly string[]).includes(value)
}

export function resolveEngineSelection(rawValue: unknown): EngineSelection {
	if (rawValue === undefined) {
		return {
			engine: "swarmengine",
			source: "default",
		}
	}

	if (typeof rawValue !== "string" || !rawValue.trim()) {
		throw new Error(`--engine requires a value. Allowed values: ${SUPPORTED_SWARM_ENGINES.join(", ")}`)
	}

	const normalized = rawValue.trim().toLowerCase()
	if (!isSupportedEngine(normalized)) {
		throw new Error(`unsupported --engine value "${rawValue}". Allowed values: ${SUPPORTED_SWARM_ENGINES.join(", ")}`)
	}

	return {
		engine: normalized,
		source: "flag",
	}
}

export function formatEngineSelection(selection: EngineSelection): string {
	return `[Swarm] Engine: ${selection.engine}${selection.source === "default" ? " (default)" : " (explicit)"}`
}
