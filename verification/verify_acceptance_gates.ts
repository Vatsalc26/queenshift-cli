import {
	evaluateAcceptanceGate,
	type AcceptanceFailureCode,
	type AcceptanceGateInput,
} from "../src/run/AcceptanceGate"
import { buildScopedTaskContract, mergeTaskContracts } from "../src/run/TaskContract"

export type AcceptanceFixtureResult = {
	label: string
	passed: boolean
	expectedPassed: boolean
	failureCodes: string[]
}

type AcceptanceFixture = {
	label: string
	input: AcceptanceGateInput
	expectedPassed: boolean
	expectedFailureCodes?: AcceptanceFailureCode[]
}

function baseInput(overrides: Partial<AcceptanceGateInput>): AcceptanceGateInput {
	return {
		reviewerVerdict: "PASS",
		reviewOutputValid: true,
		requireMeaningfulDiff: true,
		hasMeaningfulDiff: true,
		changedFiles: ["hello.ts"],
		createdFiles: [],
		postRunFileContents: { "hello.ts": "// matrix snippet\nexport const hello = 1\n" },
		taskContract: buildScopedTaskContract(["hello.ts"]),
		...overrides,
	}
}

export const ACCEPTANCE_FIXTURES: AcceptanceFixture[] = [
	{
		label: "expected-file-changed",
		input: baseInput({}),
		expectedPassed: true,
	},
	{
		label: "forbidden-file-changed",
		input: baseInput({
			changedFiles: ["hello.ts", "package.json"],
			taskContract: mergeTaskContracts(buildScopedTaskContract(["hello.ts"]), {
				acceptance: { forbiddenChangedFiles: ["package.json"] },
			}),
		}),
		expectedPassed: false,
		expectedFailureCodes: ["scope_drift"],
	},
	{
		label: "required-snippet-missing",
		input: baseInput({
			taskContract: mergeTaskContracts(buildScopedTaskContract(["hello.ts"]), {
				acceptance: { requiredContentSnippets: [{ path: "hello.ts", snippet: "missing snippet" }] },
			}),
		}),
		expectedPassed: false,
		expectedFailureCodes: ["required_snippet_missing"],
	},
	{
		label: "forbidden-snippet-present",
		input: baseInput({
			taskContract: mergeTaskContracts(buildScopedTaskContract(["hello.ts"]), {
				acceptance: { forbiddenContentSnippets: [{ path: "hello.ts", snippet: "matrix snippet" }] },
			}),
		}),
		expectedPassed: false,
		expectedFailureCodes: ["forbidden_snippet_present"],
	},
	{
		label: "reviewer-pass-but-acceptance-fails",
		input: baseInput({
			changedFiles: [],
			hasMeaningfulDiff: false,
			taskContract: buildScopedTaskContract(["hello.ts"]),
		}),
		expectedPassed: false,
		expectedFailureCodes: ["no_meaningful_diff", "missing_expected_change"],
	},
	{
		label: "reviewer-fail-and-acceptance-pass",
		input: baseInput({
			reviewerVerdict: "NEEDS_WORK",
		}),
		expectedPassed: false,
		expectedFailureCodes: ["reviewer_not_passed"],
	},
]

export function runAcceptanceFixtures(fixtures: AcceptanceFixture[] = ACCEPTANCE_FIXTURES): AcceptanceFixtureResult[] {
	return fixtures.map((fixture) => {
		const result = evaluateAcceptanceGate(fixture.input)
		const failureCodes = result.failedChecks.map((failure) => failure.code)
		const expectedFailureCodes = fixture.expectedFailureCodes ?? []
		const failureCodeMatch = expectedFailureCodes.every((code) => failureCodes.includes(code))

		return {
			label: fixture.label,
			passed: result.passed === fixture.expectedPassed && failureCodeMatch,
			expectedPassed: fixture.expectedPassed,
			failureCodes,
		}
	})
}

export function formatAcceptanceFixtureResults(results: AcceptanceFixtureResult[]): string {
	const lines = ["Fixture | Result | Expected | Failure codes", "--- | --- | --- | ---"]
	for (const result of results) {
		lines.push(
			`${result.label} | ${result.passed ? "PASS" : "FAIL"} | ${result.expectedPassed ? "pass" : "fail"} | ${result.failureCodes.join(", ") || "(none)"}`,
		)
	}
	return lines.join("\n")
}

async function main(): Promise<void> {
	const results = runAcceptanceFixtures()
	console.log(formatAcceptanceFixtureResults(results))
	process.exit(results.every((result) => result.passed) ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:acceptance:gates] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
