import { randomUUID } from "node:crypto";
import { db, principal, hash } from "./store/db.js";
import * as store from "./store/visibility.js";
import type { Principal, RecordRow, Question, Release } from "./types.js";
import { requireEngineer, requireHuman } from "./auth.js";
import { releaseProblem } from "./security.js";
export const fail = (message: string, status = 400) => {
  throw Object.assign(Error(message), { status });
};
export function channel(id: string) {
  const c = db
    .prepare("SELECT * FROM channels WHERE id=? AND COALESCE(retired,0)=0")
    .get(id) as { id: string; name: string; account: string } | undefined;
  return c || fail("Channel not found", 404);
}
export function conversation(p: Principal, id: string) {
  const c = db.prepare("SELECT * FROM conversations WHERE id=?").get(id) as
    | { id: string; channel_id: string; user_id: string; agent_id: string }
    | undefined;
  if (!c || c.user_id !== p.id) fail("Conversation not found", 404);
  return c!;
}
export function myConversation(p: Principal, channelId: string) {
  channel(channelId);
  if (
    !["eng", "sales"].includes(p.team_id) ||
    (p.kind !== "user" && p.scope !== "mcp")
  )
    fail("User identity required", 403);
  const id = channelId + "-" + p.id;
  db.prepare("INSERT OR IGNORE INTO conversations VALUES(?,?,?,?)").run(
    id,
    channelId,
    p.id,
    "agent-" + p.team_id,
  );
  return id;
}
export function questions(p: Principal, channelId: string) {
  channel(channelId);
  const qs = db
    .prepare("SELECT * FROM questions WHERE channel_id=? ORDER BY rowid DESC")
    .all(channelId) as Question[];
  return qs.filter((q) => !!store.bySeq(p, q.event_seq));
}
export function pending(p: Principal) {
  const rows = db
    .prepare("SELECT * FROM releases ORDER BY rowid DESC")
    .all() as Release[];
  return rows
    .filter((r) => !!store.bySeq(p, r.draft_event_seq))
    .map((r) => ({ ...r, event: store.bySeq(p, r.draft_event_seq) }));
}
export function draftRelease(
  p: Principal,
  kind: "answer" | "update" | "document",
  event: RecordRow,
  text: string,
) {
  if (!store.visible(event.labels_mask, p)) fail("Forbidden", 403);
  const id = randomUUID();
  db.prepare("INSERT INTO releases VALUES(?,?,?,?,?,?,?,?,NULL)").run(
    id,
    kind,
    event.seq,
    text,
    hash(text),
    event.labels_mask,
    0,
    "staged",
  );
  return id;
}
export function approve(
  p: Principal,
  id: string,
  text: string,
  textHash: string,
  expectedHash: string,
) {
  requireEngineer(p);
  const release = db.prepare("SELECT * FROM releases WHERE id=?").get(id) as
    | Release
    | undefined;
  if (!release || !store.bySeq(p, release.draft_event_seq))
    fail("Release not found", 404);
  const r = release!;
  if (r.state !== "staged") fail("Release is already finalized", 409);
  if ((r.labels_from & ~p.authority_mask) !== 0)
    fail("Missing label authority", 403);
  if (hash(text) !== textHash || r.text_hash !== expectedHash)
    fail("Text hash changed; review the exact text again", 409);
  const problem = releaseProblem(text);
  if (problem) fail(problem, 422);
  const draft = store.bySeq(p, r.draft_event_seq)!;
  channel(draft.channel_id);
  if (!store.isActive(p, draft.id))
    fail("Draft references withdrawn context; generate a new draft", 422);
  return db.transaction(() => {
    const audit = store.append(p, {
      type: "declassify",
      channel_id: draft.channel_id,
      labels_mask: r.labels_from,
      text,
      refs: [draft.id],
      meta: {
        kind: "approval_audit",
        text_hash: textHash,
        release_id: id,
        approved_by: p.id,
      },
    });
    const event = store.append(p, {
      type: "ingest",
      channel_id: draft.channel_id,
      labels_mask: 0,
      text,
      refs: [audit.id],
      meta: {
        kind: r.kind === "answer" ? "released_answer" : r.kind,
        text_hash: textHash,
        labels_from: r.labels_from,
        labels_to: 0,
        release_id: id,
        approved_by: p.id,
      },
      index: true,
    });
    db.prepare(
      "UPDATE releases SET state=?,approver_id=?,text=?,text_hash=? WHERE id=?",
    ).run("approved", p.id, text, textHash, id);
    const questionId = draft.meta.question_id as string | undefined;
    if (questionId) {
      const q = db
        .prepare("SELECT * FROM questions WHERE id=?")
        .get(questionId) as Question;
      db.prepare(
        "UPDATE questions SET state=?,answer_event_seq=? WHERE id=?",
      ).run("answered", event.seq, questionId);
      const asker = principal(q.asker_id)!;
      const conv = myConversation(asker, q.channel_id);
      store.append(asker, {
        type: "agent_message",
        channel_id: q.channel_id,
        conversation_id: conv,
        labels_mask: asker.clearance_mask,
        text: `Engineering answered (approved by ${p.name}): ${event.text}`,
        refs: [event.id],
        meta: {
          kind: "answer_available",
          status: "answered",
          question_id: questionId,
          manifest: {
            allowed_mask: asker.clearance_mask,
            record_ids_in_prompt: [event.id],
            tool_calls: [],
            citations_validated: [event.id],
            scan_result: "approved-release-only",
            output_labels: asker.clearance_mask,
            model: "released-record",
            latency: 0,
            context_labels: { [event.id]: 0 },
          },
        },
      });
    }
    return event;
  })();
}
export function reject(p: Principal, id: string) {
  requireEngineer(p);
  const r = pending(p).find((x) => x.id === id);
  if (!r) fail("Release not found", 404);
  if (r!.state !== "staged") fail("Release already finalized", 409);
  db.prepare("UPDATE releases SET state=?,approver_id=? WHERE id=?").run(
    "rejected",
    p.id,
    id,
  );
  const q = r!.event?.meta.question_id;
  if (typeof q === "string")
    db.prepare("UPDATE questions SET state=? WHERE id=?").run(
      "draft_rejected",
      q,
    );
  if (typeof q === "string") {
    const question = db
      .prepare("SELECT channel_id FROM questions WHERE id=?")
      .get(q) as { channel_id: string };
    store.append(p, {
      type: "message",
      channel_id: question.channel_id,
      labels_mask: 0,
      text: `${p.name} rejected the draft. The question remains open.`,
      meta: { kind: "draft_rejected", question_id: q },
    });
  }
}
export function splitChunks(text: string) {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 255) {
    chunks.push(words.slice(i, i + 300).join(" "));
    if (i + 300 >= words.length) break;
  }
  return chunks;
}
export function upload(
  p: Principal,
  channelId: string,
  name: string,
  text: string,
) {
  requireEngineer(p);
  channel(channelId);
  const id = randomUUID();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO documents(id,channel_id,name,owner_id,state,labels_mask,released_from,original_text) VALUES(?,?,?,?,?,?,NULL,?)",
    ).run(id, channelId, name, p.id, "pending", 1, text);
    splitChunks(text).forEach((chunk, ord) =>
      store.addChunk(p, {
        id: randomUUID(),
        doc_id: id,
        ord,
        text: chunk,
        labels_mask: 1,
      }),
    );
    store.append(p, {
      type: "document_chunk_ref",
      channel_id: channelId,
      labels_mask: 1,
      text: name,
      meta: { document_id: id },
      refs: store.chunks(p, id).map((c) => c.id),
    });
  })();
  return id;
}
export function documents(p: Principal, channelId: string) {
  channel(channelId);
  return (
    db
      .prepare(
        "SELECT * FROM documents WHERE channel_id=? AND (labels_mask & ~?)=0",
      )
      .all(channelId, p.clearance_mask) as {
      id: string;
      name: string;
      state: string;
      labels_mask: number;
      released_from: string | null;
      original_text: string | null;
    }[]
  )
    .map((d) => ({
      ...d,
      chunks: store.chunks(p, d.id).filter((c) => store.isActive(p, c.id)),
    }))
    .filter((d) => d.chunks.length > 0);
}
export function releaseDocument(
  p: Principal,
  id: string,
  confirmed: boolean,
  expectedHash: string,
) {
  requireEngineer(p);
  const doc = db.prepare("SELECT * FROM documents WHERE id=?").get(id) as
    | {
        channel_id: string;
        labels_mask: number;
        name: string;
        state: string;
        original_text: string | null;
      }
    | undefined;
  if (!doc || !store.visible(doc.labels_mask, p))
    fail("Document not found", 404);
  if (doc!.state !== "pending") fail("Document is already released", 409);
  const chunks = store.chunks(p, id);
  channel(doc!.channel_id);
  const text = doc!.original_text ?? chunks.map((c) => c.text).join("\n\n");
  if (!confirmed || hash(text) !== expectedHash)
    fail("Confirm release of the exact document text", 409);
  const problem = releaseProblem(text);
  if (problem) fail(problem, 422);
  return db.transaction(() => {
    const sharedId = randomUUID();
    const audit = store.append(p, {
      type: "declassify",
      channel_id: doc!.channel_id,
      labels_mask: 1,
      text,
      refs: chunks.map((c) => c.id),
      meta: {
        kind: "document_approval_audit",
        text_hash: hash(text),
        approved_by: p.id,
      },
    });
    const event = store.append(p, {
      type: "ingest",
      channel_id: doc!.channel_id,
      labels_mask: 0,
      text,
      refs: [audit.id],
      meta: {
        kind: "document",
        original_document: id,
        released_document: sharedId,
        approved_by: p.id,
        text_hash: hash(text),
        labels_from: doc!.labels_mask,
        labels_to: 0,
      },
      index: true,
    });
    db.prepare(
      "INSERT INTO documents(id,channel_id,name,owner_id,state,labels_mask,released_from,original_text) VALUES(?,?,?,?,?,?,?,?)",
    ).run(sharedId, doc!.channel_id, doc!.name, p.id, "released", 0, id, text);
    chunks.forEach((c) =>
      (() => {
        const chunkId = randomUUID();
        store.addChunk(p, {
          ...c,
          id: chunkId,
          doc_id: sharedId,
          labels_mask: 0,
        });
        store.link(p, chunkId, event.id);
      })(),
    );
    db.prepare("UPDATE documents SET state=? WHERE id=?").run("released", id);
    return event;
  })();
}

export function retract(p: Principal, id: string) {
  requireHuman(p);
  const release = db.prepare("SELECT * FROM releases WHERE id=?").get(id) as
    | Release
    | undefined;
  const event = release
    ? store
        .active(p)
        .find((e) => e.meta.release_id === id && e.labels_mask === 0)
    : store.get(p, id);
  if (
    !event ||
    event.labels_mask !== 0 ||
    !["released_answer", "document", "update"].includes(String(event.meta.kind))
  )
    fail("Released record not found", 404);
  if (!store.isActive(p, event!.id)) fail("Record already retracted", 409);
  if (p.team_id !== "eng" && p.id !== event!.author_id)
    fail("Retraction authority required", 403);
  return db.transaction(() => {
    const notice = store.append(p, {
      type: "retraction",
      channel_id: event!.channel_id,
      labels_mask: 0,
      text: `${p.name} retracted a released record. This excludes it from future answers; earlier deliveries cannot be unsent.`,
      refs: [],
      meta: { target_id: event!.id, kind: "retraction" },
    });
    store.withdraw(p, event!.id, notice.id);
    db.prepare(
      "UPDATE questions SET state=?,answer_event_seq=NULL WHERE answer_event_seq=?",
    ).run("open", event!.seq);
    if (release)
      db.prepare("UPDATE releases SET state=? WHERE id=?").run(
        "retracted",
        release.id,
      );
    else if (typeof event!.meta.release_id === "string")
      db.prepare("UPDATE releases SET state=? WHERE id=?").run(
        "retracted",
        event!.meta.release_id,
      );
    return notice;
  })();
}
export function humanPost(
  p: Principal,
  channelId: string,
  text: string,
  confirmed: boolean,
) {
  requireHuman(p, p.clearance_mask);
  channel(channelId);
  if (!confirmed) fail("Confirm both teams will see this message", 422);
  const audit = store.append(p, {
    type: "declassify",
    channel_id: channelId,
    labels_mask: p.clearance_mask,
    text,
    meta: { kind: "human_post_audit", text_hash: hash(text) },
  });
  return store.append(p, {
    type: "human_post",
    channel_id: channelId,
    labels_mask: 0,
    text,
    refs: [audit.id],
    meta: {
      kind: "human_post",
      author_name: p.name,
      text_hash: hash(text),
      approved_by: p.id,
    },
  });
}
