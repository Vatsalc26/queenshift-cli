import fs from "fs"
import path from "path"

import type { ChatMessage, IModelClient, ModelCallOptions } from "./IModelClient"

function resolveSwarmCoderRootDir(fromDir: string): string {
	const candidates = [path.resolve(fromDir, "../.."), path.resolve(fromDir, "../../..")]
	for (const dir of candidates) {
		try {
			if (fs.existsSync(path.join(dir, "package.json"))) return dir
		} catch {
			// ignore
		}
	}
	return path.resolve(fromDir, "../..")
}

export class StubModelClient implements IModelClient {
	private fixtureNames: string[]
	private callCount = 0

	constructor(fixtureName: string | string[]) {
		this.fixtureNames = Array.isArray(fixtureName) ? fixtureName : [fixtureName]
		if (this.fixtureNames.length === 0) {
			throw new Error("StubModelClient: at least one fixture name is required")
		}
	}

	async chat(_messages: ChatMessage[], _options?: ModelCallOptions): Promise<string> {
		const idx = Math.min(this.callCount, this.fixtureNames.length - 1)
		const fixtureName = this.fixtureNames[idx] as string
		this.callCount++

		const rootDir = resolveSwarmCoderRootDir(__dirname)
		const fixturePath = path.join(rootDir, "verification", "stub_fixtures", `${fixtureName}.json`)

		if (!fs.existsSync(fixturePath)) {
			throw new Error(
				`StubFixtureNotFound: ${fixturePath}\n` + "Create this fixture file with the expected model response JSON.",
			)
		}

		const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as { response: string }
		return fixture.response
	}
}
