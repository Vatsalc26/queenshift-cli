import fs from "fs"
import path from "path"

export type DbRunResult = {
	changes: number
	lastInsertRowid: number | bigint
}

type StatementLike = {
	run: (...params: unknown[]) => DbRunResult
	get: (...params: unknown[]) => unknown
	all: (...params: unknown[]) => unknown[]
}

type DatabaseLike = {
	exec: (sql: string) => void
	prepare: (sql: string) => StatementLike
	close: () => void
}

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

export class DatabaseService {
	private static instance: DatabaseService | null = null
	private db: DatabaseLike

	private constructor(dbPath: string) {
		const dir = path.dirname(dbPath)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

		this.db = DatabaseService.openDatabase(dbPath)
		DatabaseService.applyPragmas(this.db)

		const directSchemaPath = path.join(__dirname, "schema.sql")
		const rootDir = resolveSwarmCoderRootDir(__dirname)
		const fallbackSchemaPath = path.join(rootDir, "src", "db", "schema.sql")
		const schemaPath = fs.existsSync(directSchemaPath) ? directSchemaPath : fallbackSchemaPath

		const schema = fs.readFileSync(schemaPath, "utf-8")
		this.db.exec(schema)
	}

	private static openDatabase(dbPath: string): DatabaseLike {
		const errors: string[] = []

		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const BetterSqlite3 = require("better-sqlite3") as new (file: string) => DatabaseLike & { pragma?: (s: string) => void }
			return new BetterSqlite3(dbPath)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			errors.push(`better-sqlite3: ${msg}`)
		}

		try {
			// `node:sqlite` exists in newer Node versions (experimental). We use it as a fallback when
			// native better-sqlite3 binaries don't match the current Node ABI (common in CI/dev envs).
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const nodeSqlite = require("node:sqlite") as { DatabaseSync: new (file: string) => DatabaseLike }
			return new nodeSqlite.DatabaseSync(dbPath)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			errors.push(`node:sqlite: ${msg}`)
		}

		throw new Error(`DatabaseService: failed to open sqlite database.\n${errors.join("\n")}`)
	}

	private static applyPragmas(db: DatabaseLike): void {
		const anyDb = db as unknown as { pragma?: (s: string) => void }
		const setPragma = (pragma: string) => {
			if (typeof anyDb.pragma === "function") {
				anyDb.pragma(pragma)
				return
			}
			db.exec(`PRAGMA ${pragma}`)
		}

		setPragma("journal_mode = WAL")
		setPragma("busy_timeout = 5000")
		setPragma("foreign_keys = ON")
	}

	static getInstance(dbPath?: string): DatabaseService {
		if (!DatabaseService.instance) {
			if (!dbPath) throw new Error("DatabaseService: dbPath required on first call")
			DatabaseService.instance = new DatabaseService(dbPath)
		}
		return DatabaseService.instance
	}

	static reset(): void {
		DatabaseService.instance = null
	}

	run(sql: string, params: unknown[] = []): DbRunResult {
		return this.db.prepare(sql).run(...params)
	}

	get<T>(sql: string, params: unknown[] = []): T | undefined {
		return this.db.prepare(sql).get(...params) as T | undefined
	}

	all<T>(sql: string, params: unknown[] = []): T[] {
		return this.db.prepare(sql).all(...params) as T[]
	}

	close(): void {
		this.db.close()
	}
}
