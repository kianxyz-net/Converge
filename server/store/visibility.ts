import { db, hash } from "./db.js";
import { randomUUID } from "node:crypto";
import type { Principal, RecordRow, ChunkRow } from "../types.js";
// The sole SQL gateway for events, chunks and search, including schema and triggers.
db.exec(`CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,ts TEXT,type TEXT,author_id TEXT,channel_id TEXT,conversation_id TEXT,labels_mask INTEGER,text TEXT,meta TEXT,refs TEXT,hash TEXT);
CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY,doc_id TEXT,ord INTEGER,text TEXT,labels_mask INTEGER);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(text,ref_type UNINDEXED,ref_id UNINDEXED,labels_mask UNINDEXED);
CREATE TABLE IF NOT EXISTS dependencies(ref_id TEXT,source_id TEXT,PRIMARY KEY(ref_id,source_id));
CREATE TABLE IF NOT EXISTS withdrawals(ref_id TEXT PRIMARY KEY,event_id TEXT);`);
export const visible = (mask: number, p: Principal) =>
  (mask & ~p.clearance_mask) === 0;
const decode = (row: unknown): RecordRow => {
  const r = row as Omit<RecordRow, "meta" | "refs"> & {
    meta: string;
    refs: string;
  };
  return { ...r, meta: JSON.parse(r.meta), refs: JSON.parse(r.refs),withdrawn:!!db.prepare("SELECT ref_id FROM withdrawals WHERE ref_id=?").get(r.id) };
};
export interface EventInput {
  type: string;
  channel_id: string;
  conversation_id?: string;
  labels_mask: number;
  text: string;
  meta?: Record<string, unknown>;
  refs?: string[];
  id?: string;
  index?: boolean;
}
export function append(p: Principal, input: EventInput): RecordRow {
  if (!visible(input.labels_mask, p)) throw Error("Write outside clearance");
  const id = input.id || randomUUID();
  db.prepare(
    "INSERT INTO events(id,ts,type,author_id,channel_id,conversation_id,labels_mask,text,meta,refs,hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    new Date().toISOString(),
    input.type,
    p.id,
    input.channel_id,
    input.conversation_id || null,
    input.labels_mask,
    input.text,
    JSON.stringify(input.meta || {}),
    JSON.stringify(input.refs || []),
    hash(input.text),
  );
  if (input.index)
    db.prepare(
      "INSERT INTO search(text,ref_type,ref_id,labels_mask) VALUES(?,?,?,?)",
    ).run(input.text, "event", id, input.labels_mask);
  const manifest=input.meta?.manifest as {record_ids_in_prompt?:string[]}|undefined;
  for(const source of new Set([...(input.refs||[]),...(manifest?.record_ids_in_prompt||[])]))link(p,id,source);
  return get(p, id)!;
}
export function get(p: Principal, id: string) {
  const row = db
    .prepare("SELECT * FROM events WHERE id=? AND (labels_mask & ~?)=0")
    .get(id, p.clearance_mask);
  return row ? decode(row) : undefined;
}
export function bySeq(p: Principal, seq: number) {
  const row = db
    .prepare("SELECT * FROM events WHERE seq=? AND (labels_mask & ~?)=0")
    .get(seq, p.clearance_mask);
  return row ? decode(row) : undefined;
}
export function list(
  p: Principal,
  opts: {
    channel?: string;
    conversation?: string;
    after?: number;
    type?: string;
    limit?: number;
    sharedOnly?: boolean;
    activeOnly?:boolean;
  } = {},
) {
  let sql = "SELECT * FROM events WHERE (labels_mask & ~?)=0";
  const args: unknown[] = [p.clearance_mask];
  for (const [col, v] of [
    ["channel_id", opts.channel],
    ["conversation_id", opts.conversation],
    ["type", opts.type],
  ] as const) {
    if (v) {
      sql += ` AND ${col}=?`;
      args.push(v);
    }
  }
  if (opts.after !== undefined) {
    sql += " AND seq>?";
    args.push(opts.after);
  }
  if (opts.sharedOnly) sql += " AND labels_mask=0";
  if(opts.activeOnly)sql+=" AND NOT EXISTS(SELECT 1 FROM withdrawals w WHERE w.ref_id=events.id)";
  sql += " ORDER BY seq ASC LIMIT ?";
  args.push(opts.limit || 2000);
  return db
    .prepare(sql)
    .all(...args)
    .map(decode);
}
export function addChunk(p: Principal, c: ChunkRow) {
  if (!visible(c.labels_mask, p)) throw Error("Chunk outside clearance");
  db.prepare("INSERT INTO chunks VALUES(?,?,?,?,?)").run(
    c.id,
    c.doc_id,
    c.ord,
    c.text,
    c.labels_mask,
  );
  db.prepare(
    "INSERT INTO search(text,ref_type,ref_id,labels_mask) VALUES(?,?,?,?)",
  ).run(c.text, "chunk", c.id, c.labels_mask);
}
export function chunks(p: Principal, docId: string) {
  return db
    .prepare(
      "SELECT * FROM chunks WHERE doc_id=? AND (labels_mask & ~?)=0 ORDER BY ord",
    )
    .all(docId, p.clearance_mask) as ChunkRow[];
}
export function getChunk(p: Principal, id: string) {
  return db
    .prepare("SELECT * FROM chunks WHERE id=? AND (labels_mask & ~?)=0")
    .get(id, p.clearance_mask) as ChunkRow | undefined;
}
export interface ContextRecord {
  id: string;
  text: string;
  labels_mask: number;
  seq?: number;
  type?: string;
  meta?: Record<string, unknown>;
}
export interface Retriever {
  search(p: Principal, channel: string, query: string): ContextRecord[];
}
export const retriever: Retriever = {
  search(p, channel, query) {
    const terms = (query.match(/[\p{L}\p{N}_-]+/gu) || [])
      .filter((w) => w.length > 2)
      .slice(0, 18)
      .map((w) => '"' + w.replaceAll('"', "") + '"*');
    if (!terms.length) return [];
    const rows = db
      .prepare(
        `SELECT search.text,search.ref_id AS id,CAST(search.labels_mask AS INTEGER) AS labels_mask FROM search WHERE search MATCH ? AND (CAST(search.labels_mask AS INTEGER) & ~?)=0 AND NOT EXISTS(SELECT 1 FROM withdrawals w WHERE w.ref_id=search.ref_id) AND (EXISTS(SELECT 1 FROM events e WHERE e.id=search.ref_id AND e.channel_id=?) OR EXISTS(SELECT 1 FROM chunks c JOIN documents d ON c.doc_id=d.id WHERE c.id=search.ref_id AND d.channel_id=?)) ORDER BY bm25(search) LIMIT 6`,
      )
      .all(
        terms.join(" OR "),
        p.clearance_mask,
        channel,
        channel,
      ) as ContextRecord[];
    let budget = 6000;
    return rows
      .map((r) => {
        const text = r.text.slice(0, Math.max(0, budget));
        budget -= text.length;
        const event = get(p, r.id);
        return {
          ...r,
          text,
          type: event?.type || "document",
          meta: event?.meta || {},
        };
      })
      .filter((r) => r.text);
  },
};
export function outside(p: Principal): ContextRecord[] {
  return [
    ...db
      .prepare(
        "SELECT id,text,labels_mask FROM events WHERE (labels_mask & ~?)!=0",
      )
      .all(p.clearance_mask),
    ...db
      .prepare(
        "SELECT id,text,labels_mask FROM chunks WHERE (labels_mask & ~?)!=0",
      )
      .all(p.clearance_mask),
  ] as ContextRecord[];
}
export function exportRecords(p: Principal, mask: number) {
  if (!visible(mask, p)) throw Error("Forbidden export");
  return list(p, { limit: 100000 }).filter((r) => r.labels_mask === mask);
}
export function inspect(p: Principal, id: string) {
  const r = get(p, id);
  if (!r) return undefined;
  return r.meta.manifest;
}
export function assertAppendOnly(p: Principal) {
  const r = list(p)[0];
  if (!r) throw Error("Seed first");
  db.prepare("UPDATE events SET text=text WHERE id=?").run(r.id);
}
export function assertDeleteBlocked(p: Principal) {
  const r = list(p)[0];
  db.prepare("DELETE FROM events WHERE id=?").run(r.id);
}

export function active(p:Principal,opts:Parameters<typeof list>[1]={}){return list(p,{...opts,activeOnly:true})}
export function link(p:Principal,id:string,source:string){if(!get(p,id)&&!getChunk(p,id))throw Error('Dependency target not visible');db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?)').run(id,source)}
export function isActive(p:Principal,id:string){return !!(get(p,id)||getChunk(p,id))&&!db.prepare('SELECT ref_id FROM withdrawals WHERE ref_id=?').get(id)}
export function withdraw(p:Principal,targetId:string,noticeId:string){if(!get(p,targetId))throw Error('Retraction target not visible');const ids=db.prepare('WITH RECURSIVE affected(id) AS (SELECT ? UNION SELECT d.ref_id FROM dependencies d JOIN affected a ON d.source_id=a.id) SELECT id FROM affected').all(targetId) as {id:string}[];for(const {id}of ids)db.prepare('INSERT OR IGNORE INTO withdrawals VALUES(?,?)').run(id,noticeId);return ids.map(r=>r.id)}
export function retireChannel(p:Principal,channelId:string,noticeId:string){for(const r of list(p,{channel:channelId,limit:100000}))if(r.id!==noticeId)withdraw(p,r.id,noticeId);for(const c of db.prepare('SELECT c.id FROM chunks c JOIN documents d ON c.doc_id=d.id WHERE d.channel_id=? AND (c.labels_mask & ~?)=0').all(channelId,p.clearance_mask) as {id:string}[])db.prepare('INSERT OR IGNORE INTO withdrawals VALUES(?,?)').run(c.id,noticeId)}
