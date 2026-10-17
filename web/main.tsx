import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
type Principal = {
  id: string;
  name: string;
  team_id: string;
  clearance_mask: number;
};
type Session = { token: string; principal: Principal };
type RecordRow = {
  id: string;
  channel_id: string;
  seq: number;
  type: string;
  text: string;
  labels_mask: number;
  refs: string[];
  meta: Record<string, unknown>;
  conversation_id: string | null;
};
type Channel = {
  id: string;
  name: string;
  account: string;
  conversation_id: string;
};
type Question = {
  id: string;
  text: string;
  state: string;
  answer_event_seq: number | null;
};
type Release = {
  id: string;
  text: string;
  text_hash: string;
  state: string;
  kind: string;
  event: RecordRow;
};
type Doc = {
  id: string;
  name: string;
  state: string;
  labels_mask: number;
  released_from: string | null;
  original_text: string | null;
  chunks: { id: string; text: string }[];
};
const label = (mask: number) =>
  mask === 0
    ? "shared"
    : mask === 1
      ? "eng"
      : mask === 2
        ? "sales"
        : "operator";
async function sha(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
async function request<T>(
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api" + path, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Request failed");
  return data as T;
}
function useStream(
  token: string | undefined,
  onRecord: () => void,
  onStep: (s: string) => void,
) {
  const recordRef = useRef(onRecord),
    stepRef = useRef(onStep);
  recordRef.current = onRecord;
  stepRef.current = onStep;
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let after = 0;
    async function connect() {
      while (!controller.signal.aborted) {
        try {
          const res = await fetch("/api/stream", {
            headers: {
              Authorization: "Bearer " + token,
              "Last-Event-ID": String(after),
            },
            signal: controller.signal,
          });
          if (!res.ok) throw Error("Stream disconnected");
          const reader = res.body!.getReader(),
            decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let index: number;
            while ((index = buffer.indexOf("\n\n")) !== -1) {
              const block = buffer.slice(0, index);
              buffer = buffer.slice(index + 2);
              const data = block
                .split("\n")
                .find((l) => l.startsWith("data: "))
                ?.slice(6);
              const seq = block
                .split("\n")
                .find((l) => l.startsWith("id: "))
                ?.slice(4);
              if (seq) after = Number(seq);
              if (!data) continue;
              if (block.includes("event: step"))
                stepRef.current(JSON.parse(data).status);
              else recordRef.current();
            }
          }
        } catch {
          if (controller.signal.aborted) return;
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    void connect();
    return () => controller.abort();
  }, [token]);
}
function Badge({ mask }: { mask: number }) {
  return <span className={"badge " + label(mask)}>{label(mask)}</span>;
}
function RelayPane({
  initialUser,
  split = false,
}: {
  initialUser: string;
  split?: boolean;
}) {
  const [identity, setIdentity] = useState(initialUser),
    [stored, setStored] = useState<Session | null>(null),
    [channels, setChannels] = useState<Channel[]>([]),
    [channelId, setChannelId] = useState("northwind"),
    [messages, setMessages] = useState<RecordRow[]>([]),
    [thread, setThread] = useState<RecordRow[]>([]),
    [questions, setQuestions] = useState<Question[]>([]),
    [releases, setReleases] = useState<Release[]>([]),
    [docs, setDocs] = useState<Doc[]>([]),
    [tab, setTab] = useState("thread"),
    [text, setText] = useState(""),
    [status, setStatus] = useState("idle"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [drawer, setDrawer] = useState<{ title: string; data: unknown } | null>(
      null,
    ),
    [confirmDoc, setConfirmDoc] = useState<Doc | null>(null),
    [newChannel, setNewChannel] = useState(false),
    [update, setUpdate] = useState(false),
    [mode, setMode] = useState("offline");
  const session = stored?.principal.id === identity ? stored : null,
    token = session?.token,
    eng = session?.principal.team_id === "eng";
  const conv = channels.find((c) => c.id === channelId)?.conversation_id;
  const loadVersion = useRef(0);
  const alive = useRef(0),
    refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const gen = ++alive.current;
    setStored(null);
    setMessages([]);
    setThread([]);
    setReleases([]);
    setDocs([]);
    setQuestions([]);
    setDrawer(null);
    setText("");
    setError("");
    void request<Session>("/auth/switch", undefined, { user_id: identity })
      .then((s) => {
        if (alive.current === gen) setStored(s);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive.current++;
    };
  }, [identity]);
  const load = useCallback(async () => {
    if (!token) return;
    const gen = alive.current,
      version = ++loadVersion.current;
    try {
      const cs = await request<Channel[]>("/channels", token);
      const c = cs.find((c) => c.id === channelId) || cs[0];
      if (!c) return;
      const [m, t, q, r, d] = await Promise.all([
        request<RecordRow[]>(
          "/conversations/" + c.conversation_id + "/messages",
          token,
        ),
        request<RecordRow[]>("/channels/" + c.id + "/thread", token),
        request<Question[]>("/channels/" + c.id + "/questions", token),
        request<Release[]>("/releases/pending", token),
        request<Doc[]>("/channels/" + c.id + "/documents", token),
      ]);
      if (gen !== alive.current || version !== loadVersion.current) return;
      setChannels(cs);
      setChannelId(c.id);
      setMessages(m);
      setThread(t);
      setQuestions(q);
      setReleases(r.filter((x) => x.event.channel_id === c.id));
      setDocs(d);
    } catch (e) {
      if (gen === alive.current) setError((e as Error).message);
    }
  }, [token, channelId]);
  useEffect(() => {
    void load();
    return () => clearTimeout(refreshTimer.current);
  }, [load]);
  const schedule = () => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void load(), 80);
  };
  useStream(token, schedule, setStatus);
  useEffect(() => {
    void request<{ mode: string }>("/health").then((d) => setMode(d.mode));
  }, []);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, status]);
  const autoDelivered = useRef(new Set<string>());
  useEffect(() => {
    if (!token || !conv) return;
    const key = identity + ":" + channelId;
    if (autoDelivered.current.has(key)) return;
    autoDelivered.current.add(key);
    void request("/channels/" + channelId + "/digest", token, {})
      .then(() => load())
      .catch((e) => setError(e.message));
  }, [token, conv, channelId, identity]);
  async function run(path: string, body: unknown) {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await request(path, token, body);
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("idle");
    }
  }
  async function source(id: string) {
    try {
      setDrawer({
        title: "Source record",
        data: await request("/records/" + encodeURIComponent(id), token),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function inspect(id: string) {
    try {
      setDrawer({
        title: "Why this answer",
        data: await request(
          "/events/" + encodeURIComponent(id) + "/inspect",
          token,
        ),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const citations = (refs: string[]) =>
    refs.length > 0 && (
      <div className="citations">
        {refs.map((id) => (
          <button key={id} onClick={() => void source(id)}>
            ↗{" "}
            {id.startsWith("github")
              ? "GitHub PR"
              : id.startsWith("doc-")
                ? "Document"
                : "Record"}{" "}
            <span>{id.slice(-7)}</span>
          </button>
        ))}
      </div>
    );
  const msg = (m: RecordRow) => {
    const isAgent = m.type === "agent_message" || m.type === "digest";
    return (
      <article
        className={"message " + (isAgent ? "agent" : "person")}
        key={m.id}
      >
        <div className={"avatar " + (isAgent ? "bot" : "")}>
          {isAgent ? "✦" : session?.principal.name[0]}
        </div>
        <div className="message-body">
          <div className="message-head">
            <strong>
              {m.type === "digest"
                ? "Release radar"
                : isAgent
                  ? eng
                    ? "Engineering agent"
                    : "Sales agent"
                  : session?.principal.name}
            </strong>
            <Badge mask={m.labels_mask} />
            {isAgent && (
              <button className="inspect" onClick={() => void inspect(m.id)}>
                Why this answer ↗
              </button>
            )}
          </div>
          <p className="preserve">{m.text}</p>
          {citations(m.refs)}
          {typeof m.meta.compare_url === "string" && (
            <a
              className="compare"
              href={m.meta.compare_url}
              target="_blank"
              rel="noreferrer"
            >
              Compare changes on GitHub ↗
            </a>
          )}
          {m.meta.status === "needs_escalation" && (
            <div className="escalated">
              ↗ Escalated to Engineering · See Questions for the exact shared
              text
            </div>
          )}
        </div>
      </article>
    );
  };
  return (
    <section className={"workspace " + (split ? "split-pane" : "")}>
      <header className="topbar">
        <a className="brand" href="/">
          relay<span>✳</span>
        </a>
        <span className="divider" />
        <span className="workspace-name">Acme Cloud API</span>
        <div className="identity">
          <Badge mask={eng ? 1 : 2} />
          <select
            aria-label="Demo identity"
            value={identity}
            onChange={(e) => {
              setIdentity(e.target.value);
              autoDelivered.current.clear();
            }}
          >
            <option value="priya">Priya · Sales</option>
            <option value="ben">Ben · Sales</option>
            <option value="ava">Ava · Engineering</option>
          </select>
        </div>
      </header>
      <div className="workspace-bar">
        <div>
          <span className="eyebrow">ACCOUNT CHANNEL</span>
          <div className="channel-choice">
            <span>#</span>
            <select
              aria-label="Channel"
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
                setDrawer(null);
              }}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {eng && (
              <button
                className="icon-button"
                title="Create channel"
                onClick={() => setNewChannel(true)}
              >
                ＋
              </button>
            )}
          </div>
        </div>
        <div className="channel-actions">
          <span className="mode">
            <i />
            {mode === "offline"
              ? "Offline demo · grounded rules"
              : "Anthropic connected"}
          </span>
          <button
            className="button"
            disabled={busy || !token}
            onClick={() => void run("/channels/" + channelId + "/digest", {})}
          >
            ◷ What’s new
          </button>
          {eng && (
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run("/github/sync", { channel_id: channelId })
              }
            >
              Sync GitHub
            </button>
          )}
        </div>
      </div>
      <div className="content">
        <section className="chat">
          <div className="chat-title">
            <div className="agent-orb">✦</div>
            <div>
              <h1>Your {eng ? "Engineering" : "Sales"} agent</h1>
              <p>
                {eng
                  ? "Full engineering context. You control what leaves."
                  : "Answers from released context. No guessing."}
              </p>
            </div>
            <span className="private-tag">◈ {eng ? "eng" : "sales"} only</span>
          </div>
          <div className="chat-scroll">
            {!session ? (
              <div className="empty">Joining your team workspace…</div>
            ) : messages.length ? (
              messages
                .filter((m) =>
                  ["message", "agent_message", "digest"].includes(m.type),
                )
                .map(msg)
            ) : (
              <div className="welcome">
                <span>✦</span>
                <h2>
                  Your team’s context,
                  <br />
                  one conversation away.
                </h2>
                <p>
                  {eng
                    ? "Review questions, prepare answers, and approve exactly what Sales can see."
                    : "Ask about the platform. Your agent cites released information and asks Engineering when it doesn’t know."}
                </p>
                <div className="suggestions">
                  {(eng
                    ? [
                        "Draft an update about rate limits",
                        "What is our internal on-prem plan?",
                      ]
                    : [
                        "What is the enterprise rate limit?",
                        "How should customers handle HTTP 429?",
                        "What is the on-prem plan?",
                      ]
                  ).map((t) => (
                    <button key={t} onClick={() => setText(t)}>
                      {t} ↗
                    </button>
                  ))}
                </div>
              </div>
            )}
            {status !== "idle" && (
              <div className="step-status">
                <span className="pulse" /> {status} · validating before delivery
              </div>
            )}
            <div ref={chatEnd} />
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          <form
            className="composer"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim() || !conv) return;
              const before = text;
              setText("");
              const result = await run("/conversations/" + conv + "/messages", {
                text: before,
              });
              if (!result) setText(before);
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "Ask your " + (eng ? "Engineering" : "Sales") + " agent…"
              }
              aria-label="Message your team agent"
              required
              maxLength={12000}
              disabled={busy || !token}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="composer-footer">
              <span>◈ Only your team’s agent sees this conversation.</span>
              <button
                className="send"
                type="submit"
                disabled={busy || !token || !text.trim()}
              >
                {busy ? "…" : "↑"}
              </button>
            </div>
          </form>
          <p className="chat-footnote">
            Sources are untrusted data. Cross-team releases require approval.
          </p>
        </section>
        <aside className="context">
          <div className="context-tabs">
            {[
              ["thread", "Thread"],
              ["questions", "Questions"],
              ["releases", "Releases"],
              ["documents", "Docs"],
            ].map(([key, title]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {title}
                {key === "questions" &&
                  questions.filter((q) => q.state !== "answered").length >
                    0 && (
                    <span>
                      {questions.filter((q) => q.state !== "answered").length}
                    </span>
                  )}
              </button>
            ))}
          </div>
          <div className="context-scroll">
            {tab === "thread" && (
              <>
                <div className="panel-heading">
                  <span className="eyebrow">SHARED WITH BOTH TEAMS</span>
                  <h2>One source of alignment.</h2>
                  <p>Briefs, released context, and approved answers.</p>
                </div>
                {thread.map((m) => (
                  <div className="thread-card" key={m.id}>
                    <div className="card-meta">
                      <span>
                        {m.meta.kind === "brief"
                          ? "CHANNEL BRIEF"
                          : m.meta.kind === "open_question"
                            ? "OPEN QUESTION"
                            : m.meta.kind === "released_answer"
                              ? "APPROVED ANSWER"
                              : m.type === "digest"
                                ? "SHIPPED CHANGES"
                                : m.meta.kind === "document"
                                  ? "RELEASED DOCUMENT"
                                  : m.type.toUpperCase()}
                      </span>
                      <Badge mask={0} />
                    </div>
                    <p className="preserve">{m.text}</p>
                    {citations(
                      m.refs.filter((ref) => thread.some((t) => t.id === ref)),
                    )}
                    <button
                      className="text-button"
                      onClick={() => void source(m.id)}
                    >
                      View record ↗
                    </button>
                  </div>
                ))}
              </>
            )}
            {tab === "questions" && (
              <>
                <div className="panel-heading">
                  <span className="eyebrow">NO GUESSING, NO LOST CONTEXT</span>
                  <h2>Questions in flight.</h2>
                  <p>The exact text below was shared with Engineering.</p>
                </div>
                {questions.length ? (
                  questions.map((q) => (
                    <div className="thread-card" key={q.id}>
                      <span className={"state " + q.state}>{q.state}</span>
                      <p>{q.text}</p>
                      {eng && q.state !== "answered" && (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void run("/questions/" + q.id + "/draft", {})
                          }
                        >
                          Draft another answer
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="empty">No open questions yet.</div>
                )}
              </>
            )}
            {tab === "releases" && (
              <>
                <div className="panel-heading">
                  <span className="eyebrow">HUMANS CONTROL THE BOUNDARY</span>
                  <h2>{eng ? "Review before release." : "Release status."}</h2>
                  <p>
                    {eng
                      ? "Edit the exact text Sales will receive. Approval creates a new shared record."
                      : "Engineering drafts remain private until an engineer approves them."}
                  </p>
                  {eng && (
                    <button className="button" onClick={() => setUpdate(true)}>
                      ＋ Proactive update
                    </button>
                  )}
                </div>
                {eng ? (
                  releases.length ? (
                    releases.map((r) => (
                      <ReleaseCard
                        key={r.id}
                        release={r}
                        busy={busy}
                        onApprove={async (value) => {
                          await run("/releases/" + r.id + "/approve", {
                            text: value,
                            text_hash: await sha(value),
                            expected_hash: r.text_hash,
                          });
                        }}
                        onReject={() =>
                          void run("/releases/" + r.id + "/reject", {})
                        }
                        citations={citations}
                      />
                    ))
                  ) : (
                    <div className="empty">
                      No drafts pending. Ask a question as Sales to start a
                      release workflow.
                    </div>
                  )
                ) : (
                  questions.map((q) => (
                    <div className="thread-card" key={q.id}>
                      <span className={"state " + q.state}>
                        {q.state === "answered"
                          ? "Released"
                          : q.state === "drafted"
                            ? "Awaiting engineer approval"
                            : "Awaiting draft"}
                      </span>
                      <p>{q.text}</p>
                    </div>
                  ))
                )}
              </>
            )}
            {tab === "documents" && (
              <>
                <div className="panel-heading">
                  <span className="eyebrow">
                    KNOWLEDGE WITH CLEAR BOUNDARIES
                  </span>
                  <h2>
                    {eng ? "Preview. Then release." : "Released documents."}
                  </h2>
                  <p>
                    {eng
                      ? "Uploads are Engineering-only by default. Re-uploading creates a new version."
                      : "Only explicitly released document copies are visible here."}
                  </p>
                  {eng && (
                    <label className="button upload">
                      ＋ Upload .md / .txt
                      <input
                        type="file"
                        accept=".md,.txt"
                        disabled={busy}
                        onChange={async (e) => {
                          const input = e.currentTarget;
                          const file = input.files?.[0];
                          if (file) {
                            if (file.size > 200000) {
                              setError("Use a document under 200 KB");
                              return;
                            }
                            await run("/channels/" + channelId + "/documents", {
                              name: file.name,
                              text: await file.text(),
                            });
                            input.value = "";
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
                {docs.map((d) => (
                  <div className="thread-card" key={d.id}>
                    <div className="card-meta">
                      <Badge mask={d.labels_mask} />
                      <span>
                        {d.released_from
                          ? "RELEASED COPY"
                          : d.state.toUpperCase()}
                      </span>
                    </div>
                    <h3>{d.name}</h3>
                    <p>
                      {d.chunks.length} chunk{d.chunks.length !== 1 ? "s" : ""}{" "}
                      · {d.chunks.reduce((n, c) => n + c.text.length, 0)}{" "}
                      characters
                    </p>
                    <details>
                      <summary>Preview chunks</summary>
                      {d.chunks.map((c, i) => (
                        <div className="chunk" key={c.id}>
                          <small>CHUNK {i + 1}</small>
                          <p>{c.text}</p>
                        </div>
                      ))}
                    </details>
                    {eng && d.labels_mask === 1 && d.state === "pending" && (
                      <button
                        className="button primary"
                        onClick={() => setConfirmDoc(d)}
                      >
                        Release to Sales →
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>
      </div>
      <footer>
        <span>✦ Human-approved knowledge, team-scoped agents.</span>
        <span>
          {split
            ? "Independent identity & live stream"
            : "Demo identities · Not production authentication"}
        </span>
      </footer>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <section className="drawer" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setDrawer(null)}>
              ×
            </button>
            <span className="eyebrow">SERVER-VALIDATED RECORD</span>
            <h2>{drawer.title}</h2>
            <Inspector data={drawer.data} onSource={source} />
          </section>
        </div>
      )}
      {confirmDoc && (
        <div className="modal-backdrop">
          <section className="modal">
            <button className="close" onClick={() => setConfirmDoc(null)}>
              ×
            </button>
            <span className="eyebrow">EXPLICIT DECLASSIFICATION</span>
            <h2>Release {confirmDoc.name} to Sales?</h2>
            <p>
              The exact text below will become a new shared record. The original
              stays Engineering-only.
            </p>
            <pre className="release-preview">
              {confirmDoc.original_text ??
                confirmDoc.chunks.map((c) => c.text).join("\n\n")}
            </pre>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                await run("/documents/" + confirmDoc.id + "/release", {
                  confirmed: true,
                  text_hash: await sha(
                    confirmDoc.original_text ??
                      confirmDoc.chunks.map((c) => c.text).join("\n\n"),
                  ),
                });
                setConfirmDoc(null);
              }}
            >
              Confirm exact-text release →
            </button>
          </section>
        </div>
      )}
      {(newChannel || update) && (
        <div className="modal-backdrop">
          <section className="modal">
            <button
              className="close"
              onClick={() => {
                setNewChannel(false);
                setUpdate(false);
              }}
            >
              ×
            </button>
            <h2>
              {newChannel
                ? "Create a shared channel"
                : "Draft a proactive update"}
            </h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const body = newChannel
                  ? {
                      name: form.get("name"),
                      account: form.get("account"),
                      brief: form.get("text"),
                    }
                  : { text: form.get("text") };
                const result = await run(
                  newChannel
                    ? "/channels"
                    : "/channels/" + channelId + "/updates",
                  body,
                );
                if (result) {
                  setNewChannel(false);
                  setUpdate(false);
                }
              }}
            >
              {newChannel && (
                <>
                  <label>
                    Channel name
                    <input name="name" required maxLength={120} />
                  </label>
                  <label>
                    Account
                    <input name="account" required maxLength={120} />
                  </label>
                </>
              )}
              <label>
                {newChannel
                  ? "Shared brief (visible to Sales)"
                  : "Engineering-only draft"}
                <textarea name="text" required maxLength={12000} />
              </label>
              <button className="button primary" disabled={busy}>
                {newChannel
                  ? "Publish shared channel"
                  : "Save draft for approval"}
              </button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
function ReleaseCard({
  release: r,
  busy,
  onApprove,
  onReject,
  citations,
}: {
  release: Release;
  busy: boolean;
  onApprove: (s: string) => Promise<void>;
  onReject: () => void;
  citations: (refs: string[]) => React.ReactNode;
}) {
  const [text, setText] = useState(r.text),
    [confirm, setConfirm] = useState(false);
  return (
    <div className="thread-card release-card">
      <div className="card-meta">
        <Badge mask={1} />
        <span>
          {r.kind} · {r.state}
        </span>
      </div>
      {r.state === "pending" ? (
        <>
          <label>
            Exact text to share
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setConfirm(false);
              }}
              maxLength={12000}
            />
          </label>
          {citations(r.event.refs)}
          <label className="confirm">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            I approve this exact text for Sales.
          </label>
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy || !confirm || !text.trim()}
              onClick={() => void onApprove(text)}
            >
              Approve & release
            </button>
            <button className="button" disabled={busy} onClick={onReject}>
              Reject
            </button>
          </div>
        </>
      ) : (
        <p className="preserve">{r.text}</p>
      )}
    </div>
  );
}
function Inspector({
  data,
  onSource,
}: {
  data: unknown;
  onSource: (id: string) => void;
}) {
  const d = data as Record<string, unknown>;
  if (!d) return <p>No manifest.</p>;
  if ("allowed_mask" in d) {
    const labels = (d.context_labels as Record<string, number>) || {};
    return (
      <>
        <div className="inspector-grid">
          <div>
            <small>AUDIENCE / ALLOWED LABELS</small>
            <Badge mask={0} />
            <Badge mask={Number(d.allowed_mask)} />
          </div>
          <div>
            <small>OUTPUT LABELS</small>
            <Badge mask={Number(d.output_labels)} />
          </div>
          <div>
            <small>MODEL</small>
            <strong>{String(d.model)}</strong>
          </div>
          <div>
            <small>LATENCY</small>
            <strong>{String(d.latency)} ms</strong>
          </div>
        </div>
        <h3>Records actually in context</h3>
        {[0, 1, 2]
          .filter((mask) => Object.values(labels).includes(mask))
          .map((mask) => (
            <div className="context-group" key={mask}>
              <Badge mask={mask} />
              {Object.entries(labels)
                .filter(([, m]) => m === mask)
                .map(([id]) => (
                  <button
                    className="source-id"
                    key={id}
                    onClick={() => onSource(id)}
                  >
                    {id} ↗
                  </button>
                ))}
            </div>
          ))}
        <h3>Citation validation</h3>
        <pre>{JSON.stringify(d.citations_validated, null, 2)}</pre>
        <h3>Outbound scan</h3>
        <p className="scan-result">✓ {String(d.scan_result)}</p>
        <h3>Tool calls</h3>
        <pre>{JSON.stringify(d.tool_calls, null, 2)}</pre>
      </>
    );
  }
  return (
    <>
      <Badge mask={Number(d.labels_mask || 0)} />
      <p className="preserve">{String(d.text || d.note || "")}</p>
      <details>
        <summary>Record metadata</summary>
        <pre>{JSON.stringify(d, null, 2)}</pre>
      </details>
    </>
  );
}
function Operator() {
  const [token, setToken] = useState(""),
    [records, setRecords] = useState<RecordRow[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    void request<{ token: string }>("/auth/operator", undefined, {})
      .then((d) => setToken(d.token))
      .catch((e) => setError(e.message));
  }, []);
  const load = useCallback(() => {
    if (token)
      void request<RecordRow[]>("/operator/log", token)
        .then(setRecords)
        .catch((e) => setError(e.message));
  }, [token]);
  useEffect(load, [load]);
  useStream(token, load, () => {});
  return (
    <section className="operator-strip">
      <div>
        <strong>⚠ DEMO OPERATOR · FULL CLEARANCE</strong>
        <span>Intentionally sees both teams. Never a Sales-agent tool.</span>
      </div>
      {error && <p>{error}</p>}
      <div className="operator-log">
        {records
          .slice(-100)
          .reverse()
          .map((r) => (
            <div key={r.id}>
              <span>#{r.seq}</span>
              <Badge mask={r.labels_mask} />
              <span>{r.type}</span>
              <span>{r.text}</span>
            </div>
          ))}
      </div>
    </section>
  );
}
const demo = location.pathname === "/demo";
createRoot(document.getElementById("root")!).render(
  demo ? (
    <>
      <div className="demo-banner">
        <strong>Relay multiplayer demo</strong>
        <span>
          Two independent principals. Two team agents. One controlled boundary.
        </span>
        <a href="/">Single workspace ↗</a>
      </div>
      <div className="demo-grid">
        <RelayPane initialUser="priya" split />
        <RelayPane initialUser="ava" split />
      </div>
      {new URLSearchParams(location.search).get("operator") === "1" && (
        <Operator />
      )}
    </>
  ) : (
    <RelayPane initialUser="priya" />
  ),
);
