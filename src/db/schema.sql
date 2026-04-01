-- Messages between agents
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read INTEGER NOT NULL DEFAULT 0
);

-- Agent status tracking
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',  -- idle | running | done | failed
  last_heartbeat TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Task tracking
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | done | failed | review_required
  complexity TEXT,  -- SIMPLE | COMPLEX
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

-- Run-level guardrail state (budget usage and ceilings)
CREATE TABLE IF NOT EXISTS run_guardrails (
  task_id TEXT PRIMARY KEY,
  max_model_calls INTEGER NOT NULL,
  model_calls_used INTEGER NOT NULL DEFAULT 0,
  max_estimated_tokens INTEGER NOT NULL,
  estimated_tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single live-run workspace lock
CREATE TABLE IF NOT EXISTS workspace_run_locks (
  lock_key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  task TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Feed events for observability
CREATE TABLE IF NOT EXISTS feed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  agent_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
