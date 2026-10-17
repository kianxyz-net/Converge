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
  withdrawn?: boolean;
};
type Artifact = {
  id: string;
  type: string;
  title: string;
  version: number;
  owner: string;
  audience: string;
  labels_mask: number;
  status: string;
  hash: string;
  approved_by: string | null;
  created_at: string;
  source_ids: string[];
  text: string;
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
  onSession,
  channelOverride,
  releaseToken,
}: {
  initialUser: string;
  split?: boolean;
  onSession?: (s: Session | null) => void;
  channelOverride?: string;
  releaseToken?: string;
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
    [artifacts, setArtifacts] = useState<Artifact[]>([]),
    [tab, setTab] = useState(
      split && initialUser === "ava" ? "releases" : "thread",
    ),
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
  const [proposals, setProposals] = useState<
      { id: string; text: string; text_hash: string; state: string }[]
    >([]),
    [internalTerms, setInternalTerms] = useState<string[]>([]),
    [post, setPost] = useState(""),
    [postConfirmed, setPostConfirmed] = useState(false),
    [retractRecord, setRetractRecord] = useState<RecordRow | null>(null);
  const session = stored?.principal.id === identity ? stored : null,
    token = session?.token,
    eng = session?.principal.team_id === "eng";
  useEffect(() => {
    onSession?.(session);
  }, [stored, identity, onSession]);
  useEffect(() => {
    if (channelOverride) setChannelId(channelOverride);
  }, [channelOverride]);
  useEffect(() => {
    setInternalTerms([]);
    if (token && eng)
      void request<{ internalTerms: string[] }>("/policy", token).then((r) =>
        setInternalTerms(r.internalTerms),
      );
  }, [token, eng]);
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
    setArtifacts([]);
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
      const [m, t, q, r, d, ep, arts] = await Promise.all([
        request<RecordRow[]>(
          "/conversations/" + c.conversation_id + "/messages",
          token,
        ),
        request<RecordRow[]>("/channels/" + c.id + "/thread", token),
        request<Question[]>("/channels/" + c.id + "/questions", token),
        request<Release[]>("/releases/pending", token),
        request<Doc[]>("/channels/" + c.id + "/documents", token),
        request<
          { id: string; text: string; text_hash: string; state: string }[]
        >("/escalations?channel_id=" + c.id, token),
        request<Artifact[]>("/channels/" + c.id + "/artifacts", token),
      ]);
      if (gen !== alive.current || version !== loadVersion.current) return;
      setChannels(cs);
      setChannelId(c.id);
      setMessages(m);
      setThread(t);
      setQuestions(q);
      setReleases(r.filter((x) => x.event.channel_id === c.id));
      setDocs(d);
      setProposals(ep);
      setArtifacts(arts);
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
        {refs.map((id, i) => (
          <button key={id} onClick={() => void source(id)}>
            [r{i + 1}] ↗{" "}
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
              <span className={"state " + String(m.meta.status || "answered")}>
                {String(m.meta.status || "answered")}
              </span>
            )}
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
          {m.withdrawn && (
            <div className="withdrawn">
              Withdrawn context — excluded from future answers. Earlier
              deliveries cannot be unsent.
            </div>
          )}
          {m.meta.status === "needs_escalation" &&
            (() => {
              const staged = m.meta.escalation as
                | { id: string; text: string; text_hash: string; state: string }
                | undefined;
              if (!staged) return null;
              const proposal =
                proposals.find((p) => p.id === staged.id) || staged;
              return (
                <div className="escalated">
                  <strong>
                    {proposal.state === "staged"
                      ? "Nothing has been sent to Engineering."
                      : proposal.state === "cancelled"
                        ? "Escalation cancelled."
                        : "Sent to Engineering with your approval."}
                  </strong>
                  <p>{proposal.text}</p>
                  {proposal.state === "staged" && (
                    <div className="button-row">
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void run("/questions/escalate", {
                            proposal_id: proposal.id,
                            text_hash: proposal.text_hash,
                            confirmed: true,
                          })
                        }
                      >
                        Send to Engineering
                      </button>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void run("/questions/" + proposal.id + "/cancel", {})
                        }
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
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
            {mode === "rules" ? "Rules mode · offline" : "Anthropic connected"}
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
          <div className="quick-asks">
            {(eng
              ? ["What is the on-prem plan?", "When will Northwind sign?"]
              : [
                  "What are enterprise limits?",
                  "Do 429 responses include Retry-After?",
                  "What is the on-prem plan?",
                  "When will Northwind sign?",
                ]
            ).map((q) => (
              <button key={q} onClick={() => setText(q)}>
                {q}
              </button>
            ))}
          </div>
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
              ["thread", "Activity"],
              ["artifacts", "Library"],
              ["questions", "Questions"],
              ["releases", eng ? "Approvals" : "Review status"],
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
            {tab === "artifacts" && (
              <>
                <div className="panel-heading">
                  <span className="eyebrow">KNOWLEDGE LIBRARY</span>
                  <h2>Share the result. Keep control of the sources.</h2>
                  <p>
                    Only artifacts visible to your team appear here. Versions
                    count visible uploads of the same document name.
                  </p>
                </div>
                {!artifacts.length && (
                  <p className="empty-state">
                    No artifacts yet. Engineering can upload a document or
                    review an escalated answer.
                  </p>
                )}
                {artifacts.map((a) => (
                  <article className="thread-card artifact-card" key={a.id}>
                    <div className="card-meta">
                      <Badge mask={a.labels_mask} />
                      <span>
                        {a.type} · v{a.version} · {a.status}
                      </span>
                    </div>
                    <h3>{a.title}</h3>
                    <p>
                      {a.audience} · Owner: {a.owner}
                      {a.approved_by ? ` · Approved by ${a.approved_by}` : ""}
                    </p>
                    <p>
                      {a.text.slice(0, 240)}
                      {a.text.length > 240 ? "…" : ""}
                    </p>
                    <details>
                      <summary>Identity & integrity</summary>
                      <p>ID: {a.id}</p>
                      <p>{a.created_at}</p>
                      <code className="artifact-hash">SHA-256 {a.hash}</code>
                    </details>
                    <div className="artifact-actions">
                      <button
                        className="button"
                        onClick={() => void source(a.id)}
                      >
                        Open artifact
                      </button>
                      <button
                        className="button"
                        onClick={() => {
                          void request("/artifacts/" + a.id + "/history", token)
                            .then((data) =>
                              setDrawer({
                                title: "Visible approval & source history",
                                data,
                              }),
                            )
                            .catch((e) => setError(e.message));
                        }}
                      >
                        History
                      </button>
                    </div>
                    <div className="citations">
                      {a.source_ids.map((ref) => (
                        <button key={ref} onClick={() => void source(ref)}>
                          [{ref.slice(0, 8)}]
                        </button>
                      ))}
                    </div>
                    <small>
                      Sharing this output does not grant access to private
                      sources.
                      {a.status === "retracted"
                        ? " Withdrawn from future retrieval; delivered copies cannot be unsent."
                        : ""}
                    </small>
                  </article>
                ))}
              </>
            )}
            {tab === "thread" && (
              <>
                <div className="panel-heading">
                  <span className="eyebrow">SHARED WITH BOTH TEAMS</span>
                  <h2>Shared knowledge, with evidence.</h2>
                  <p>
                    Released answers, documents, updates, and team messages.
                  </p>
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
                    {m.withdrawn && (
                      <div className="withdrawn">
                        Retracted · Future context excludes this record. Earlier
                        deliveries cannot be unsent.
                      </div>
                    )}
                    {(eng || releaseToken) &&
                      !m.withdrawn &&
                      ["released_answer", "document", "update"].includes(
                        String(m.meta.kind),
                      ) && (
                        <button
                          className="text-button danger"
                          onClick={() => setRetractRecord(m)}
                        >
                          Retract release
                        </button>
                      )}
                    <button
                      className="text-button"
                      onClick={() => void source(m.id)}
                    >
                      View record ↗
                    </button>
                  </div>
                ))}
                <form
                  className="thread-composer"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const result = await run(
                      "/channels/" + channelId + "/thread",
                      { text: post, confirmed: true },
                    );
                    if (result) {
                      setPost("");
                      setPostConfirmed(false);
                    }
                  }}
                >
                  <label>
                    Shared human message
                    <textarea
                      value={post}
                      onChange={(e) => {
                        setPost(e.target.value);
                        setPostConfirmed(false);
                      }}
                      required
                      maxLength={12000}
                      placeholder="Post directly to both teams…"
                    />
                  </label>
                  <label className="confirm">
                    <input
                      type="checkbox"
                      checked={postConfirmed}
                      onChange={(e) => setPostConfirmed(e.target.checked)}
                    />
                    Both teams will see this exact message.
                  </label>
                  <button
                    className="button primary"
                    disabled={busy || !postConfirmed || !post.trim()}
                  >
                    Post to shared thread
                  </button>
                </form>
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
                        internalTerms={internalTerms}
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
      {retractRecord && (
        <div className="modal-backdrop">
          <section className="modal">
            <button className="close" onClick={() => setRetractRecord(null)}>
              ×
            </button>
            <h2>Retract this release?</h2>
            <p>
              It will be excluded from future retrieval and answers. Earlier
              deliveries cannot be unsent. Historical records remain in the
              audit log.
            </p>
            <pre className="release-preview">{retractRecord.text}</pre>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                try {
                  await request(
                    "/records/" + retractRecord.id + "/retract",
                    releaseToken || token,
                    { confirmed: true },
                  );
                  setRetractRecord(null);
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Confirm retraction
            </button>
          </section>
        </div>
      )}
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
            {(/\[(DATE|PRICE|SLA|AVAILABILITY)\]/.test(
              confirmDoc.original_text ||
                confirmDoc.chunks.map((c) => c.text).join(" "),
            ) ||
              internalTerms.some((term) =>
                (
                  confirmDoc.original_text ||
                  confirmDoc.chunks.map((c) => c.text).join(" ")
                )
                  .toLowerCase()
                  .includes(term.toLowerCase()),
              )) && (
              <div className="error">
                Remove internal terms and resolve placeholders in a new document
                version before release.
              </div>
            )}
            <pre className="release-preview">
              {confirmDoc.original_text ??
                confirmDoc.chunks.map((c) => c.text).join("\n\n")}
            </pre>
            <button
              className="button primary"
              disabled={
                busy ||
                /\[(DATE|PRICE|SLA|AVAILABILITY)\]/.test(
                  confirmDoc.original_text ||
                    confirmDoc.chunks.map((c) => c.text).join(" "),
                ) ||
                internalTerms.some((term) =>
                  (
                    confirmDoc.original_text ||
                    confirmDoc.chunks.map((c) => c.text).join(" ")
                  )
                    .toLowerCase()
                    .includes(term.toLowerCase()),
                )
              }
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
  internalTerms = [],
}: {
  release: Release;
  busy: boolean;
  onApprove: (s: string) => Promise<void>;
  onReject: () => void;
  citations: (refs: string[]) => React.ReactNode;
  internalTerms?: string[];
}) {
  const [text, setText] = useState(r.text),
    [confirm, setConfirm] = useState(false),
    [values, setValues] = useState<Record<string, string>>({}),
    [none, setNone] = useState<Record<string, boolean>>({});
  const fields = [
    ...new Set([
      ...(r.text.match(/\[(DATE|PRICE|SLA|AVAILABILITY)\]/g) || []).map((f) =>
        f.slice(1, -1),
      ),
      ...((r.event.meta.high_risk_fields as string[]) || []),
    ]),
  ];
  let approved = text;
  for (const field of fields)
    approved = approved.replaceAll(
      "[" + field + "]",
      none[field]
        ? `No ${field.toLowerCase()} is committed`
        : values[field] || "[" + field + "]",
    );
  const blockedLineage = !!r.event.withdrawn;
  const blockedTerms = internalTerms.filter((term) =>
    approved.toLowerCase().includes(term.toLowerCase()),
  );
  const unresolved =
    /\[(DATE|PRICE|SLA|AVAILABILITY)\]/.test(approved) ||
    fields.some((f) => !none[f] && !values[f]);
  return (
    <div className="thread-card release-card">
      <div className="card-meta">
        <Badge mask={1} />
        <span>
          {r.kind} · {r.state}
        </span>
      </div>
      {r.state === "staged" ? (
        <>
          <label>
            Editable Engineering draft
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
          {fields.map((field) => (
            <div className="risk-control" key={field}>
              <label>
                {field} — human supplied
                <input
                  type={field === "DATE" ? "date" : "text"}
                  aria-label={field + " value"}
                  value={values[field] || ""}
                  disabled={none[field]}
                  onChange={(e) => {
                    setValues({ ...values, [field]: e.target.value });
                    setConfirm(false);
                  }}
                />
              </label>
              <label className="confirm">
                <input
                  type="checkbox"
                  checked={!!none[field]}
                  onChange={(e) => {
                    setNone({ ...none, [field]: e.target.checked });
                    setConfirm(false);
                  }}
                />
                {field === "DATE"
                  ? "No date is committed"
                  : `No ${field.toLowerCase()} is committed`}
              </label>
            </div>
          ))}
          {blockedLineage && (
            <div className="withdrawn">
              This draft references withdrawn context. Generate a new draft
              before approval.
            </div>
          )}
          {blockedTerms.length > 0 && (
            <div className="error">
              Remove internal terms before release: {blockedTerms.join(", ")}
            </div>
          )}
          <label>Exact text that Sales will receive</label>
          <pre className="release-preview">{approved}</pre>
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
              disabled={
                busy ||
                !confirm ||
                !approved.trim() ||
                unresolved ||
                blockedTerms.length > 0 ||
                blockedLineage
              }
              onClick={() => void onApprove(approved)}
            >
              Approve and release to Sales
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
function Operator({ reviewerToken }: { reviewerToken?: string }) {
  const [token, setToken] = useState(""),
    [records, setRecords] = useState<RecordRow[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!reviewerToken) return;
    void request<{ token: string }>("/auth/operator", reviewerToken, {})
      .then((d) => setToken(d.token))
      .catch((e) => setError(e.message));
  }, [reviewerToken]);
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
        {records.reverse().map((r) => (
          <div key={r.id}>
            <span>#{r.seq}</span>
            <Badge mask={r.labels_mask} />
            <span>{r.type}</span>
            <span>
              Eng: {(r.labels_mask & ~1) === 0 ? "✓" : "—"} · Sales:{" "}
              {(r.labels_mask & ~2) === 0 ? "✓" : "—"}
            </span>
            <span>{r.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
function Demo() {
  const [sales, setSales] = useState<Session | null>(null),
    [eng, setEng] = useState<Session | null>(null),
    [channels, setChannels] = useState<Channel[]>([]),
    [channel, setChannel] = useState(""),
    [error, setError] = useState(""),
    [theme, setTheme] = useState(
      localStorage.getItem("relay-theme") || "light",
    ),
    [reset, setReset] = useState(false),
    [create, setCreate] = useState(false);
  const refresh = useCallback(() => {
    if (sales)
      void request<Channel[]>("/channels", sales.token).then((cs) => {
        setChannels(cs);
        setChannel((current) =>
          cs.some((c) => c.id === current) ? current : cs[0]?.id || "",
        );
      });
  }, [sales]);
  useEffect(refresh, [refresh]);
  useStream(sales?.token, refresh, () => {});
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("relay-theme", theme);
  }, [theme]);
  async function control(path: string, body: unknown) {
    if (!eng) return;
    try {
      const data = await request<{ channel_id?: string; id?: string }>(
        path,
        eng.token,
        body,
      );
      if (data.channel_id || data.id) setChannel(data.channel_id || data.id!);
      refresh();
      setReset(false);
      setCreate(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <header className="demo-header">
        <a className="brand" href="/demo">
          relay<span>✳</span>
        </a>
        <select
          aria-label="Shared demo channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="button"
          disabled={!eng}
          onClick={() => setCreate(true)}
        >
          ＋ Channel
        </button>
        <span className="header-caption">
          Sales ↔ Engineering · Human-controlled sharing
        </span>
        <button
          className="button"
          disabled={!eng || !channel}
          onClick={() => void control("/demo/merge", { channel_id: channel })}
        >
          ＋ Simulate a new customer-facing merge
        </button>
        <button
          className="button"
          disabled={!eng || !channel}
          onClick={() => void control("/github/sync", { channel_id: channel })}
        >
          Sync GitHub
        </button>
        <a
          className="button"
          href={
            location.search.includes("operator=1")
              ? "/demo"
              : "/demo?operator=1"
          }
        >
          Operator view
        </a>
        <button
          className="button"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          {theme === "light" ? "☾ Dark" : "☀ Light"}
        </button>
        <button
          className="button"
          disabled={!eng}
          onClick={() => setReset(true)}
        >
          Reset
        </button>
      </header>
      <div className="policy-banner">
        <strong>Agents draft. Humans approve.</strong> Engineering answers cross
        teams only after an engineer approves the exact text. Reps confirm
        escalations. Agents never fill in dates.
      </div>
      {error && <div className="error">{error}</div>}
      <div className="demo-grid">
        <RelayPane
          initialUser="priya"
          split
          onSession={setSales}
          channelOverride={channel}
          releaseToken={eng?.token}
        />
        <RelayPane
          initialUser="ava"
          split
          onSession={setEng}
          channelOverride={channel}
        />
      </div>
      {new URLSearchParams(location.search).get("operator") === "1" && (
        <Operator reviewerToken={eng?.token} />
      )}
      {create && (
        <div className="modal-backdrop">
          <section className="modal">
            <button className="close" onClick={() => setCreate(false)}>
              ×
            </button>
            <h2>Create a shared channel</h2>
            <p>
              The brief will be visible to both teams. Documents remain private
              until separately released.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                await control("/channels", {
                  name: form.get("name"),
                  account: form.get("account"),
                  brief: form.get("brief"),
                });
              }}
            >
              <label>
                Channel name
                <input name="name" required maxLength={120} />
              </label>
              <label>
                Account
                <input name="account" required maxLength={120} />
              </label>
              <label>
                Shared engineer brief
                <textarea name="brief" required maxLength={12000} />
              </label>
              <button className="button primary">
                Create shared channel as Ava
              </button>
            </form>
          </section>
        </div>
      )}
      {reset && (
        <div className="modal-backdrop">
          <section className="modal">
            <button className="close" onClick={() => setReset(false)}>
              ×
            </button>
            <h2>Reset the demo?</h2>
            <p>
              This retires current channels and seeds a fresh scenario. Audit
              history remains append-only.
            </p>
            <button
              className="button primary"
              onClick={() => void control("/demo/reset", {})}
            >
              Confirm demo reset
            </button>
          </section>
        </div>
      )}
    </>
  );
}
document.documentElement.dataset.theme =
  localStorage.getItem("relay-theme") || "light";
createRoot(document.getElementById("root")!).render(
  location.pathname === "/demo" ? <Demo /> : <RelayPane initialUser="priya" />,
);
