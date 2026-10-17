import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./negotiation.css";
type Source = {
  id: string;
  kind: string;
  source: string;
  author: string;
  timestamp: string;
  text: string;
};
type Evidence = { source_id: string; exact_excerpt: string };
type Argument = { id: string; text: string; evidence_candidates: Evidence[] };
type Option = { kind: string; introduction: string; arguments: Argument[] };
type Row = {
  id: string;
  type: string;
  text: string;
  ts: string;
  author_id: string;
  hash: string;
  labels_mask: number;
  meta: Record<string, unknown>;
};
type Draft = Row & {
  meta: {
    options: Option[];
    team: string;
    mode: string;
    topic_id: string;
    provenance: Record<
      string,
      { author: string; timestamp: string; source: string }
    >;
  };
};
type Decision = Row & {
  accepted_B: boolean;
  accepted_T: boolean;
  status: string;
};
type State = {
  run_id: string;
  team: "B" | "T";
  mode: string;
  scenario: {
    vendor: string;
    client: string;
    topic: string;
    opening_request: string;
    fictional: boolean;
    as_of: string;
  };
  sources: Source[];
  messages: Row[];
  drafts: Draft[];
  decision: Decision | null;
};
type Session = { token: string; principal: { id: string; name: string } };
type Selection = {
  option: number;
  argument_ids: string[];
  evidence_keys: string[];
};
type Preview = { body: string; hash: string };
async function api<T>(
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api/negotiation" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Request failed");
  return data as T;
}
const time = (s: string) =>
  new Date(s).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const provider = (s: Source) =>
  s.source.startsWith("zoom:")
    ? "Zoom"
    : /github/.test(s.source)
      ? "GitHub"
      : /calendar/.test(s.source)
        ? "Calendar"
        : /crm/.test(s.source)
          ? "CRM"
          : /client|northstar/.test(s.source)
            ? "Client Chat"
            : "Team Chat";
function App() {
  const [identity, setIdentity] = useState("business-member"),
    [session, setSession] = useState<Session | null>(null),
    [state, setState] = useState<State | null>(null),
    [channel, setChannel] = useState("team-b"),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [review, setReview] = useState<Draft | null>(null),
    [detail, setDetail] = useState<Source | null>(null),
    [decisionOpen, setDecisionOpen] = useState(false),
    [resetOpen, setResetOpen] = useState(false);
  const generation = useRef(0),
    timeline = useRef<HTMLDivElement>(null),
    stateRef = useRef<State | null>(null);
  const team = identity === "business-member" ? "B" : "T",
    own = team === "B" ? "team-b" : "team-t";
  useEffect(() => {
    let alive = true;
    setSession(null);
    setState(null);
    stateRef.current = null;
    setReview(null);
    setDetail(null);
    setText("");
    setError("");
    setConfirmed(false);
    setDecisionOpen(false);
    setChannel(identity === "business-member" ? "team-b" : "team-t");
    void api<Session>("/session", undefined, { identity })
      .then((s) => {
        if (alive) setSession(s);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [identity]);
  const token = session?.token;
  async function refresh() {
    if (!token) return;
    const gen = generation.current;
    const next = await api<State>("/state?channel=" + channel, token);
    if (gen === generation.current) {
      if (stateRef.current && stateRef.current.run_id !== next.run_id) {
        setReview(null);
        setDetail(null);
        setDecisionOpen(false);
      }
      stateRef.current = next;
      setState(next);
    }
  }
  useEffect(() => {
    generation.current++;
    if (!token) return;
    let stopped = false;
    const controller = new AbortController();
    const gen = generation.current;
    const load = () => {
      if (!stopped)
        void api<State>("/state?channel=" + channel, token)
          .then((next) => {
            if (stopped || gen !== generation.current) return;
            if (stateRef.current && stateRef.current.run_id !== next.run_id) {
              setReview(null);
              setDetail(null);
              setDecisionOpen(false);
            }
            stateRef.current = next;
            setState(next);
          })
          .catch((e) => {
            if (!stopped) setError(e.message);
          });
    };
    load();
    const poll = setInterval(load, 2500);
    void (async () => {
      try {
        const res = await fetch("/api/negotiation/stream", {
          headers: { Authorization: "Bearer " + token },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const reader = res.body?.getReader();
        if (!reader) return;
        while (!stopped) {
          const r = await reader.read();
          if (r.done) break;
          load();
        }
      } catch {
        /* periodic reload remains available */
      }
    })();
    return () => {
      stopped = true;
      clearInterval(poll);
      controller.abort();
    };
  }, [token, channel]);
  useEffect(() => {
    setConfirmed(false);
    setText("");
  }, [channel]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await action(async () => {
      const r = await api<{ draft: Draft | null }>("/messages", token, {
        channel,
        text,
        confirmed,
      });
      setText("");
      setConfirmed(false);
      if (r.draft?.type === "neg_draft") setReview(r.draft);
    });
  }
  async function source(id: string) {
    const gen = generation.current;
    try {
      const record = await api<Source>(
        "/sources/" + encodeURIComponent(id),
        token,
      );
      if (gen === generation.current) setDetail(record);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const shared = channel === "collab",
    messages =
      state?.messages.filter((m) =>
        shared ? m.labels_mask === 0 : m.labels_mask !== 0,
      ) || [];
  const rounds =
    state?.messages.filter((m) => m.type === "neg_proposal").length || 0;
  const hasBoth =
    state?.messages.some(
      (m) => m.type === "neg_proposal" && m.meta.team === "B",
    ) &&
    state?.messages.some(
      (m) => m.type === "neg_proposal" && m.meta.team === "T",
    );
  return (
    <div className="relay-app">
      <aside className="sidebar">
        <a className="logo" href="/">
          relay<span>✳</span>
        </a>
        <div className="workspace">
          AsterCloud <span>DEMO</span>
        </div>
        <p className="side-label">CHANNELS</p>
        <nav>
          {["team-b", "team-t", "collab"].map((c) => (
            <button
              key={c}
              className={channel === c ? "channel active" : "channel"}
              disabled={c !== own && c !== "collab"}
              onClick={() => setChannel(c)}
            >
              <span>#</span>
              {c}
              {c !== "collab" && <small>{c === own ? "private" : "🔒"}</small>}
            </button>
          ))}
        </nav>
        <div className="side-story">
          <span className="live-dot" /> ONE TOPIC
          <p>Northstar pilot readiness</p>
          <small>
            Fictional evidence.
            <br />
            Real review boundaries.
          </small>
        </div>
        <div className="identity">
          <label htmlFor="identity">DEMO IDENTITY</label>
          <select
            id="identity"
            disabled={busy}
            value={identity}
            onChange={(e) => {
              generation.current++;
              setState(null);
              setSession(null);
              setReview(null);
              setDetail(null);
              setIdentity(e.target.value);
            }}
          >
            <option value="business-member">Maya · Business</option>
            <option value="technical-member">Noah · Technical</option>
          </select>
          <small>Team-scoped demo access · no real auth</small>
          <button className="reset" onClick={() => setResetOpen(true)}>
            ↻ Reset demo
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="channel-header">
          <div>
            <h1>
              <span>#</span> {channel}
            </h1>
            <p>
              {shared
                ? "Both teams · approved proposals and human discussion"
                : `Private to ${team === "B" ? "Business" : "Technical"} · humans + Agent ${team}`}
            </p>
          </div>
          <span className="audience">{shared ? "◎ Shared" : "◈ Private"}</span>
        </header>
        <div className={"mode-banner " + (state?.mode === "llm" ? "real" : "")}>
          <strong>
            {state?.mode === "llm" ? "LLM drafting" : "Offline simulation"}
          </strong>
          <span>
            {state?.mode === "llm"
              ? "Model-generated drafts, reviewed by humans."
              : "Deterministic evidence selection — not autonomous model reasoning."}
          </span>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {!state ? (
          <div className="loading">Loading your workspace…</div>
        ) : (
          <>
            <div className="topic-bar">
              <div>
                <span className="eyebrow">
                  {shared
                    ? "PINNED COLLABORATION TOPIC"
                    : "NORTHSTAR LOGISTICS · OCT 17, 2026"}
                </span>
                <strong>{state.scenario.topic}</strong>
                <span>
                  {shared
                    ? `${rounds}/3 proposal rounds · timing remains proposed until joint approval`
                    : "Agents prepare. Your team chooses what to share."}
                </span>
              </div>
              {!shared && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setText(
                      team === "B"
                        ? state.scenario.opening_request
                        : "@Agent T Prepare a response to the shared request with feasibility conditions.",
                    );
                  }}
                >
                  Use suggested request ↙
                </button>
              )}
              {shared && hasBoth && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setDecisionOpen(true)}
                >
                  Prepare decision
                </button>
              )}
            </div>
            {!shared && state.drafts.length > 0 && (
              <div className="review-notice">
                <span>
                  ✦ {state.drafts.length} private draft
                  {state.drafts.length > 1 ? "s" : ""} ready for review
                </span>
                <button
                  className="button primary"
                  onClick={() => setReview(state.drafts.at(-1)!)}
                >
                  Review draft →
                </button>
              </div>
            )}
            <div className="timeline" ref={timeline}>
              {!shared && (
                <div className="history-heading">
                  <span>PRIVATE SOURCE HISTORY</span>
                  <p>
                    Imported fictional records. Click a source to inspect its
                    full context.
                  </p>
                </div>
              )}
              {!shared &&
                state.sources.map((s) => (
                  <article className="message source-message" key={s.id}>
                    <div
                      className={
                        "avatar source-avatar " +
                        provider(s).toLowerCase().replace(" ", "-")
                      }
                    >
                      {provider(s).slice(0, 1)}
                    </div>
                    <div className="message-content">
                      <div className="message-meta">
                        <strong>{provider(s)}</strong>
                        <span className="bot-tag">SOURCE</span>
                        <time>{time(s.timestamp)}</time>
                      </div>
                      <p className="source-author">
                        {s.author} · {s.source}
                      </p>
                      <p>{s.text}</p>
                      <button
                        className="citation"
                        onClick={() => void source(s.id)}
                      >
                        {s.id} ↗
                      </button>
                    </div>
                  </article>
                ))}
              {shared && messages.length === 0 && (
                <div className="empty">
                  <div>↔</div>
                  <h2>A place to find a workable plan.</h2>
                  <p>
                    No private evidence has been shared. Start in #team-b, ask
                    Agent B to prepare a proposal, and approve exactly what
                    crosses teams.
                  </p>
                  <button className="button" onClick={() => setChannel(own)}>
                    Go to #{own}
                  </button>
                </div>
              )}
              {messages.map((m) => (
                <article className="message" key={m.id}>
                  <div
                    className={
                      "avatar " +
                      (m.type === "neg_proposal"
                        ? "agent-avatar"
                        : "human-avatar")
                    }
                  >
                    {m.type === "neg_proposal"
                      ? "✦"
                      : String(m.meta.author || m.meta.team || team).slice(
                          0,
                          1,
                        )}
                  </div>
                  <div className="message-content">
                    <div className="message-meta">
                      <strong>
                        {m.type === "neg_proposal"
                          ? `Agent ${m.meta.team}`
                          : m.type === "neg_notice"
                            ? `Agent ${team}`
                            : String(m.meta.author || m.author_id)}
                      </strong>
                      {m.type === "neg_proposal" && (
                        <span className="bot-tag">APPROVED DRAFT</span>
                      )}
                      <time>{time(m.ts)}</time>
                    </div>
                    {m.type === "neg_proposal" ? (
                      <Proposal row={m} ownTeam={team} onSource={source} />
                    ) : (
                      <p className="message-body">{m.text}</p>
                    )}
                  </div>
                </article>
              ))}
              {shared && state.decision && (
                <DecisionCard
                  decision={state.decision}
                  team={team}
                  busy={busy}
                  approve={(resolved) =>
                    action(() =>
                      api(
                        "/decisions/" + state.decision!.id + "/approve",
                        token,
                        {
                          hash: state.decision!.hash,
                          confirmed: true,
                          conditions_resolved: resolved,
                        },
                      ),
                    )
                  }
                />
              )}
              {!shared && (
                <div className="quick-start">
                  <strong>Work with Agent {team}</strong>
                  <p>
                    {team === "B"
                      ? "Build an evidence-backed request for Technical review."
                      : "Assess the approved request against Technical evidence."}
                  </p>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setText(
                        team === "B"
                          ? state.scenario.opening_request
                          : "@Agent T Prepare a counterproposal to the shared request with feasibility conditions and selected evidence.",
                      );
                      timeline.current?.scrollTo({
                        top: timeline.current.scrollHeight,
                        behavior: "smooth",
                      });
                    }}
                  >
                    Use suggested request ↙
                  </button>
                </div>
              )}
            </div>
            <form className="composer" onSubmit={(e) => void send(e)}>
              <textarea
                aria-label="Message"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
                placeholder={`Message #${channel}${shared ? ` · @Agent ${team} stages a private draft` : ` · mention @Agent ${team} to prepare a draft`}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!shared || confirmed) void send(e);
                  }
                }}
              />
              <div className="composer-bottom">
                {shared ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />{" "}
                    Visible to both teams. Mentions stage private drafts.
                  </label>
                ) : (
                  <span>◈ Only your team can see this channel</span>
                )}
                <button
                  className="button primary"
                  type="submit"
                  disabled={busy || !text.trim() || (shared && !confirmed)}
                >
                  {busy ? "Preparing…" : "Send ↑"}
                </button>
              </div>
            </form>
          </>
        )}
      </main>
      {review && token && (
        <Review
          draft={review}
          token={token}
          sources={state?.sources || []}
          onClose={() => setReview(null)}
          onSource={source}
          onPublished={() => {
            setReview(null);
            setChannel("collab");
            void refresh();
          }}
          onError={setError}
        />
      )}
      {detail && (
        <div className="modal-shade" onClick={() => setDetail(null)}>
          <section
            className="modal source-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close source"
              onClick={() => setDetail(null)}
            >
              ×
            </button>
            <span className="eyebrow">PRIVATE SOURCE · TEAM {team}</span>
            <h2 id="source-title">{detail.id}</h2>
            <p>
              <strong>{detail.author}</strong>
              <br />
              {time(detail.timestamp)} · {detail.source}
            </p>
            <blockquote>{detail.text}</blockquote>
            <p className="muted">
              This raw source stays private. Recipients of approved quotes can
              see only those excerpts, not this record.
            </p>
          </section>
        </div>
      )}
      {decisionOpen && state && token && (
        <DecisionModal
          state={state}
          token={token}
          onClose={() => setDecisionOpen(false)}
          onSaved={() => {
            setDecisionOpen(false);
            void refresh();
          }}
        />
      )}
      {resetOpen && (
        <div className="modal-shade">
          <section className="modal small" role="dialog" aria-modal="true">
            <h2>Reset the negotiation?</h2>
            <p>
              Restore the same private fixtures and an empty #collab. Previous
              audit records remain stored in the retired run.
            </p>
            <div className="actions">
              <button className="button" onClick={() => setResetOpen(false)}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api("/reset", token, { confirmed: true });
                    setResetOpen(false);
                    setReview(null);
                    setChannel(own);
                  })
                }
              >
                Reset demo
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Proposal({
  row,
  ownTeam,
  onSource,
}: {
  row: Row;
  ownTeam: string;
  onSource: (id: string) => void;
}) {
  const args = row.meta.arguments as { id: string; text: string }[];
  const evidence = row.meta.evidence as (Evidence & {
    author: string;
    timestamp: string;
    source: string;
  })[];
  return (
    <div className="proposal">
      <div className="proposal-label">
        PROPOSED · {String(row.meta.kind).replaceAll("_", " ")}{" "}
        <span>
          Human approved by{" "}
          {row.meta.approved_by === "business-member" ? "Maya" : "Noah"}
        </span>
      </div>
      <p>{String(row.meta.introduction || row.text.split("\n\n")[1])}</p>
      {args.map((a) => (
        <p key={a.id} className="argument">
          {a.text}
        </p>
      ))}
      {evidence.length > 0 ? (
        <div className="excerpts">
          <strong>Approved evidence excerpts</strong>
          {evidence.map((e, i) => (
            <div className="excerpt" key={i}>
              <blockquote>{e.exact_excerpt}</blockquote>
              <small>
                {e.author} · {time(e.timestamp)} · {e.source}
              </small>
              {row.meta.team === ownTeam ? (
                <button
                  className="citation"
                  onClick={() => onSource(e.source_id)}
                >
                  {e.source_id} · inspect source
                </button>
              ) : (
                <span className="citation read-only">
                  {e.source_id} · approved excerpt only
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No private evidence excerpts were shared.</p>
      )}
      <details className="approval-details">
        <summary>Approval record</summary>
        <p>
          Approved by {String(row.meta.approved_by)} · {time(row.ts)}
        </p>
        <code>SHA-256 {row.hash}</code>
        <p>Immutable publication · {row.id}</p>
        <p>
          {row.meta.mode === "rules"
            ? "Offline simulation draft"
            : "LLM-generated draft"}{" "}
          · source-supported proposals are not commitments.
        </p>
      </details>
    </div>
  );
}
function Review({
  draft,
  token,
  sources,
  onClose,
  onSource,
  onPublished,
  onError,
}: {
  draft: Draft;
  token: string;
  sources: Source[];
  onClose: () => void;
  onSource: (id: string) => void;
  onPublished: () => void;
  onError: (e: string) => void;
}) {
  const [option, setOption] = useState(0),
    [args, setArgs] = useState(
      draft.meta.options[0].arguments.map((a) => a.id),
    ),
    [quotes, setQuotes] = useState<string[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = draft.meta.options[option],
    selection: Selection = {
      option,
      argument_ids: args,
      evidence_keys: quotes,
    };
  function change() {
    setPreview(null);
    setConfirmed(false);
    setError("");
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-shade">
      <section
        className="modal review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
      >
        <button className="close" aria-label="Close review" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow">
          TEAM {draft.meta.team} · PRIVATE UNTIL APPROVED
        </span>
        <h2 id="review-title">Choose what crosses teams.</h2>
        <p className="muted">
          Review the agent’s wording as well as its evidence. Exact quotes are
          unchecked by default. Dates remain proposals.
        </p>
        {draft.meta.mode === "rules" && (
          <p className="simulation-note">
            Offline simulation · deterministic evidence selection
          </p>
        )}
        {draft.meta.options.length > 1 && (
          <div className="option-tabs">
            {draft.meta.options.map((o, i) => (
              <button
                key={i}
                className={option === i ? "button selected" : "button"}
                onClick={() => {
                  setOption(i);
                  setArgs(o.arguments.map((a) => a.id));
                  setQuotes([]);
                  change();
                }}
              >
                {o.kind === "accept_with_conditions"
                  ? "Accept with conditions"
                  : "Counterproposal"}
              </button>
            ))}
          </div>
        )}
        <div className="introduction">
          <strong>Topic introduction · included</strong>
          <p>{selected.introduction}</p>
        </div>
        {selected.arguments.map((a) => (
          <article className="review-argument" key={a.id}>
            <label className="argument-toggle">
              <input
                type="checkbox"
                checked={args.includes(a.id)}
                onChange={(e) => {
                  setArgs(
                    e.target.checked
                      ? [...args, a.id]
                      : args.filter((id) => id !== a.id),
                  );
                  setQuotes(quotes.filter((q) => !q.startsWith(a.id + ":")));
                  change();
                }}
              />
              <strong>{a.text}</strong>
            </label>
            <div className="evidence-candidates">
              {a.evidence_candidates.map((e, i) => {
                const key = a.id + ":" + i,
                  s =
                    sources.find((s) => s.id === e.source_id) ||
                    draft.meta.provenance?.[e.source_id];
                return (
                  <div className="candidate" key={key}>
                    <blockquote>{e.exact_excerpt}</blockquote>
                    <small>
                      {s?.author} · {s?.timestamp && time(s.timestamp)} ·{" "}
                      {s?.source}
                    </small>
                    <button
                      className="citation"
                      onClick={() => onSource(e.source_id)}
                    >
                      {e.source_id}
                    </button>
                    <label className="share-quote">
                      <input
                        type="checkbox"
                        checked={quotes.includes(key)}
                        disabled={!args.includes(a.id)}
                        onChange={(ev) => {
                          setQuotes(
                            ev.target.checked
                              ? [...quotes, key]
                              : quotes.filter((k) => k !== key),
                          );
                          change();
                        }}
                      />{" "}
                      Share this exact excerpt
                    </label>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
        {error && <div className="error">{error}</div>}
        {preview && (
          <section className="exact-preview">
            <span className="eyebrow">EXACT CONTENT TO BE PUBLISHED</span>
            <pre>{preview.body}</pre>
            <code>SHA-256 {preview.hash}</code>
            <label className="approval-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I approve this exact text and selected excerpts for both teams.
              These terms are proposed, not committed.
            </label>
          </section>
        )}
        <div className="actions review-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("/drafts/" + draft.id + "/discard", token, {});
                onClose();
              })
            }
          >
            Cancel & discard
          </button>
          <button
            className="button"
            disabled={busy || args.length === 0}
            onClick={() =>
              void run(async () => {
                setPreview(
                  await api<Preview>(
                    "/drafts/" + draft.id + "/preview",
                    token,
                    selection,
                  ),
                );
                setConfirmed(false);
              })
            }
          >
            Preview
          </button>
          <button
            className="button primary"
            disabled={busy || !preview || !confirmed}
            onClick={() =>
              void run(async () => {
                await api("/drafts/" + draft.id + "/publish", token, {
                  selection,
                  hash: preview!.hash,
                  confirmed: true,
                });
                onPublished();
              })
            }
          >
            {busy ? "Working…" : "Post to #collab"}
          </button>
        </div>
      </section>
    </div>
  );
}
function DecisionCard({
  decision,
  team,
  busy,
  approve,
}: {
  decision: Decision;
  team: string;
  busy: boolean;
  approve: (resolved: boolean) => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [resolved, setResolved] = useState(false);
  const accepted = team === "B" ? decision.accepted_B : decision.accepted_T;
  return (
    <section className="decision-card">
      <span className="eyebrow">
        JOINT DECISION ·{" "}
        {decision.status === "conditional"
          ? "CONDITIONAL / PENDING READINESS"
          : decision.status === "agreed"
            ? "APPROVED BY BOTH TEAMS"
            : "AWAITING TEAM APPROVALS"}
      </span>
      <h2>
        {decision.status === "agreed"
          ? "Agreed terms"
          : decision.status === "conditional"
            ? "Conditional agreement"
            : "Review the same decision together"}
      </h2>
      <p className="message-body">{decision.text}</p>
      <div className="vote-chips">
        <span>{decision.accepted_B ? "✓" : "○"} Business</span>
        <span>{decision.accepted_T ? "✓" : "○"} Technical</span>
      </div>
      <p className="muted">
        {decision.meta.conditional
          ? "Timing remains conditional even after both teams approve. No unconditional deadline is committed."
          : "Commitment requires both teams’ approval and confirmation that conditions are resolved."}
      </p>
      {!accepted && (
        <>
          <label className="approval-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I approve this exact decision for Team {team}.
          </label>
          {!decision.meta.conditional && (
            <label className="approval-check">
              <input
                type="checkbox"
                checked={resolved}
                onChange={(e) => setResolved(e.target.checked)}
              />{" "}
              All conditions are resolved; I authorize these terms.
            </label>
          )}
          <button
            className="button primary"
            disabled={
              busy || !confirmed || (!decision.meta.conditional && !resolved)
            }
            onClick={() =>
              void approve(resolved).then(() => setConfirmed(false))
            }
          >
            Approve for Team {team}
          </button>
        </>
      )}
      <details className="approval-details">
        <summary>Decision integrity</summary>
        <code>SHA-256 {decision.hash}</code>
        <p>Votes are separate immutable records bound to this exact text.</p>
      </details>
    </section>
  );
}
function DecisionModal({
  state,
  token,
  onClose,
  onSaved,
}: {
  state: State;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const proposals = state.messages.filter((m) => m.type === "neg_proposal");
  const last = proposals.slice(-2);
  const [text, setText] = useState(
      last
        .flatMap((p) =>
          (p.meta.arguments as { text: string }[]).map((a) => "• " + a.text),
        )
        .join("\n"),
    ),
    [conditional, setConditional] = useState(true),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save() {
    setBusy(true);
    try {
      await api("/decisions", token, { text, conditional, confirmed: true });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-shade">
      <section className="modal" role="dialog" aria-modal="true">
        <button className="close" onClick={onClose} aria-label="Close decision">
          ×
        </button>
        <span className="eyebrow">HUMAN-WRITTEN · APPROVED BY EACH TEAM</span>
        <h2>Write the final decision.</h2>
        <p className="muted">
          Starting points come only from approved shared arguments. Edit the
          scope, proposed dates, exclusions, and remaining gates. Posting starts
          review; it does not approve for either team.
        </p>
        <textarea
          aria-label="Decision summary"
          className="decision-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setConfirmed(false);
          }}
        />
        <label className="approval-check">
          <input
            type="checkbox"
            checked={conditional}
            onChange={(e) => {
              setConditional(e.target.checked);
              setConfirmed(false);
            }}
          />{" "}
          Conditional: readiness gates or timing remain unresolved
        </label>
        <label className="approval-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{" "}
          Publish this exact summary to both teams for separate approval
        </label>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !confirmed || !text.trim()}
            onClick={() => void save()}
          >
            Request both approvals
          </button>
        </div>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
