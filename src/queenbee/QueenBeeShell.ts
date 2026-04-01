import { ArchivistBee } from "./ArchivistBee"
import { JSTSCoderBee } from "./JSTSCoderBee"
import { JSTSReviewerBee } from "./JSTSReviewerBee"
import { MergeBee } from "./MergeBee"
import { RegistryBee, buildDefaultQueenBeeRegistryEntries } from "./RegistryBee"
import { QueenBeeMessageValidator } from "./QueenBeeMessageValidator"
import { QueenBeeProtocolLedger } from "./QueenBeeProtocolLedger"
import { PlannerBee } from "./PlannerBee"
import { RecoveryBee } from "./RecoveryBee"
import { RouterBee } from "./RouterBee"
import { ScoutBee } from "./ScoutBee"
import { SafetyBee } from "./SafetyBee"
import { VerifierBee, type QueenBeeVerifierExecutor } from "./VerifierBee"
import { QUEENBEE_PROTOCOL_VERSION, type QueenBeeBeeId } from "./QueenBeeProtocol"

export type QueenBeeShell = {
	protocolVersion: typeof QUEENBEE_PROTOCOL_VERSION
	registeredBeeIds: QueenBeeBeeId[]
	messageValidator: QueenBeeMessageValidator
	protocolLedger: QueenBeeProtocolLedger
	registry: RegistryBee
	scout: ScoutBee
	planner: PlannerBee
	coder: JSTSCoderBee
	reviewer: JSTSReviewerBee
	verifier: VerifierBee
	merge: MergeBee
	archivist: ArchivistBee
	recovery: RecoveryBee
	router: RouterBee
	safety: SafetyBee
}

export function createQueenBeeShell(options: { workspaceRoot?: string; verifierExecutor?: QueenBeeVerifierExecutor } = {}): QueenBeeShell {
	const protocolLedger = new QueenBeeProtocolLedger()
	const messageValidator = new QueenBeeMessageValidator()
	const registry = new RegistryBee(buildDefaultQueenBeeRegistryEntries(), "queenbee.registry.001", protocolLedger)
	const scout = new ScoutBee()
	const planner = new PlannerBee()
	const coder = new JSTSCoderBee(options.workspaceRoot ?? process.cwd())
	const reviewer = new JSTSReviewerBee()
	const verifier = new VerifierBee(options.workspaceRoot ?? process.cwd(), options.verifierExecutor)
	const merge = new MergeBee(options.workspaceRoot ?? process.cwd())
	const archivist = new ArchivistBee(options.workspaceRoot ?? process.cwd())
	const recovery = new RecoveryBee()
	const router = new RouterBee(registry, protocolLedger, messageValidator, scout, planner, coder, reviewer, verifier, merge, archivist, recovery)
	const safety = new SafetyBee()
	return {
		protocolVersion: QUEENBEE_PROTOCOL_VERSION,
		registeredBeeIds: registry.listEntries().map((entry) => entry.beeId),
		messageValidator,
		protocolLedger,
		registry,
		scout,
		planner,
		coder,
		reviewer,
		verifier,
		merge,
		archivist,
		recovery,
		router,
		safety,
	}
}
