import { db, hash } from "./store/db.js";
import * as store from "./store/visibility.js";
import { channel, pending } from "./core.js";
import type { Principal } from "./types.js";

// A read projection, not a second lifecycle or permission store.
export function artifacts(p: Principal, channelId: string) {
  channel(channelId);
  const records = store.list(p, { channel: channelId, limit: 100000 });
  const docs = db
    .prepare(
      "SELECT id,name,owner_id,original_text FROM documents WHERE channel_id=? AND (labels_mask & ~?)=0",
    )
    .all(channelId, p.clearance_mask) as {
    id: string;
    name: string;
    owner_id: string;
    original_text: string | null;
  }[];
  const drafts = pending(p);
  const versions = new Map<string, number>();
  return [...records]
    .sort((a, b) => a.seq - b.seq)
    .flatMap((event) => {
      const kind = String(event.meta.kind || "");
      const documentId = String(
        event.meta.released_document || event.meta.document_id || "",
      );
      const doc = docs.find((d) => d.id === documentId);
      const release = drafts.find((r) => r.draft_event_seq === event.seq);
      if (!doc && !release && !["released_answer", "update"].includes(kind))
        return [];
      const type = doc
        ? "document"
        : release?.kind || (kind === "released_answer" ? "answer" : "update");
      const title =
        doc?.name ||
        `${type === "answer" ? "Answer" : "Update"} · ${event.text.slice(0, 65)}`;
      // Draft and released document copies have independent audience version sequences.
      const key = `${type}:${doc?.name || event.id}:${event.labels_mask}`;
      const version = (versions.get(key) || 0) + 1;
      versions.set(key, version);
      return [
        {
          id: event.id,
          type,
          title,
          version,
          owner: doc?.owner_id || event.author_id,
          audience:
            event.labels_mask === 0
              ? "Both teams"
              : event.labels_mask === 1
                ? "Engineering"
                : "Sales",
          labels_mask: event.labels_mask,
          status: event.withdrawn
            ? "retracted"
            : release?.state ||
              (event.labels_mask === 0 ? "released" : "private"),
          hash:
            doc?.original_text != null ? hash(doc.original_text) : event.hash,
          approved_by: event.meta.approved_by || release?.approver_id || null,
          created_at: event.ts,
          source_ids: event.refs.filter(
            (ref) => !!store.get(p, ref) || !!store.getChunk(p, ref),
          ),
          text: doc?.original_text ?? event.text,
        },
      ];
    })
    .reverse();
}

export function artifactHistory(p: Principal, artifactId: string) {
  const root = store.get(p, artifactId);
  if (!root || !artifacts(p, root.channel_id).some((a) => a.id === artifactId))
    return null;
  const seen = new Set<string>();
  const walk = (id: string, depth: number): void => {
    if (seen.has(id) || depth > 4) return;
    const event = store.get(p, id);
    if (!event) return;
    seen.add(id);
    event.refs.forEach((ref) => walk(ref, depth + 1));
  };
  walk(root.id, 0);
  return store
    .list(p, { channel: root.channel_id, limit: 100000 })
    .filter(
      (e) =>
        seen.has(e.id) ||
        (e.type === "retraction" && seen.has(String(e.meta.target_id))),
    )
    .map((e) => ({
      id: e.id,
      ts: e.ts,
      type: e.type,
      action: e.meta.kind || e.type,
      author: e.author_id,
      approved_by: e.meta.approved_by || null,
      hash: e.hash,
      labels_mask: e.labels_mask,
      withdrawn: !!e.withdrawn,
    }));
}
