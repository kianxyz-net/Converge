import "../config.js";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const filename = process.env.DATABASE_PATH || ".data/relay.sqlite";
if (filename !== ":memory:")
  mkdirSync(path.dirname(filename), { recursive: true });
export const db = new Database(filename);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
try {
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS fts_probe USING fts5(text); DROP TABLE fts_probe",
  );
} catch {
  throw Error("SQLite FTS5 is required and unavailable");
}
db.exec(`
CREATE TABLE IF NOT EXISTS token_sessions(token_hash TEXT PRIMARY KEY,principal_id TEXT);
CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,label TEXT,bit INTEGER);
CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY,kind TEXT,name TEXT,team_id TEXT,clearance_mask INTEGER,authority_mask INTEGER,token_hash TEXT);
CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,name TEXT,account TEXT,created_by TEXT);
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,channel_id TEXT,user_id TEXT,agent_id TEXT,UNIQUE(channel_id,user_id));
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,channel_id TEXT,name TEXT,owner_id TEXT,state TEXT,labels_mask INTEGER,released_from TEXT,original_text TEXT);
CREATE TABLE IF NOT EXISTS cursors(channel_id TEXT,team_id TEXT,last_sha TEXT,last_seq INTEGER,updated_at TEXT,PRIMARY KEY(channel_id,team_id));
CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,channel_id TEXT,asker_id TEXT,text TEXT,state TEXT,event_seq INTEGER,answer_event_seq INTEGER);
CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,kind TEXT,draft_event_seq INTEGER,text TEXT,text_hash TEXT,labels_from INTEGER,labels_to INTEGER,state TEXT,approver_id TEXT);
CREATE TABLE IF NOT EXISTS connectors(id TEXT PRIMARY KEY,name TEXT,forced_mask INTEGER,token_hash TEXT);
CREATE TABLE IF NOT EXISTS llm_calls(id TEXT PRIMARY KEY,ts TEXT,principal_id TEXT,conversation_id TEXT,model TEXT,prompt_hash TEXT,prompt_text TEXT,in_tokens INTEGER,out_tokens INTEGER,latency_ms INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,ts TEXT,principal_id TEXT,action TEXT);
`);
if (
  !(db.pragma("table_info(documents)") as { name: string }[]).some(
    (c) => c.name === "original_text",
  )
)
  db.exec("ALTER TABLE documents ADD COLUMN original_text TEXT");
export function principal(id: string) {
  return db
    .prepare(
      "SELECT id,kind,name,team_id,clearance_mask,authority_mask FROM principals WHERE id=?",
    )
    .get(id) as import("../types.js").Principal | undefined;
}
export function agentFor(p: import("../types.js").Principal) {
  const a = principal("agent-" + p.team_id);
  if (!a) throw Error("No agent for principal");
  return a;
}
