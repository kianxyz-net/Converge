import React from "react";
import results from "../eval/results.json";

type Attempt = {
  index: number;
  class: string;
  interface: string;
  kind: string;
  attack: string;
  http_status: number | null;
  agent_status: string | null;
  outcome: "blocked" | "leaked";
};
type Results = {
  generated_at: string;
  mode: string;
  attacks: number;
  attempts: number;
  blocked: number;
  leaked: number;
  per_class: Record<string, { attempts: number; blocked: number; leaked: number }>;
  attempts_detail: Attempt[];
  prompt_leaks: number;
  clean: boolean;
};
const r = results as Results;

const iface = (i: string) => (i === "mcp" ? "MCP" : "REST");

export function AttacksPanel() {
  const leaked = r.attempts_detail.filter((a) => a.outcome === "leaked");
  return (
    <section className="attacks-panel">
      <header className="topbar attacks-topbar">
        <a className="brand" href="/">
          relay<span>✳</span>
        </a>
        <span className="divider" />
        <span className="workspace-name">Leak-attack panel</span>
        <a className="attacks-link" href="/demo">
          Multiplayer demo ↗
        </a>
      </header>
      {leaked.length > 0 && (
        <div className="attacks-banner" role="alert">
          ⚠ {leaked.length} attempt(s) leaked Engineering content to a Sales
          principal. The isolation boundary did not hold.
        </div>
      )}
      <div className="attacks-body">
        <div className="panel-heading">
          <span className="eyebrow">ISOLATION EVIDENCE · DISPLAY ONLY</span>
          <h2>Can Sales extract Engineering-only content?</h2>
          <p>
            Every attempt below was replayed by the offline harness
            (<code>pnpm eval:attacks</code>) against REST and MCP as a Sales
            principal. This panel reads a bundled results file; it renders no
            responses and exposes no endpoint.
          </p>
        </div>
        <div className="attacks-summary">
          <div className="thread-card attacks-stat">
            <span className="eyebrow">LEAK COUNT</span>
            <strong className={leaked.length ? "leaked" : "ok"}>
              {leaked.length}
            </strong>
          </div>
          <div className="thread-card attacks-stat">
            <span className="eyebrow">BLOCKED / ATTEMPTS</span>
            <strong>
              {r.blocked} / {r.attempts}
            </strong>
          </div>
          <div className="thread-card attacks-stat">
            <span className="eyebrow">GENERATED</span>
            <strong>{r.generated_at}</strong>
          </div>
        </div>
        <div className="attacks-mode">
          Offline deterministic mode, isolation layer only. Not a live-model
          test.
        </div>
        <div className="panel-heading">
          <span className="eyebrow">PER CLASS</span>
        </div>
        <table className="attacks-table">
          <thead>
            <tr>
              <th>Attack class</th>
              <th>Blocked / attempts</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(r.per_class).map(([name, s]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>
                  {s.blocked} / {s.attempts}
                  {s.leaked > 0 && <span className="badge leaked">leaked {s.leaked}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="panel-heading">
          <span className="eyebrow">EVERY ATTEMPT</span>
          <h2>{r.attempts} recorded attempts</h2>
        </div>
        <table className="attacks-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Class</th>
              <th>Interface</th>
              <th>Attack</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {r.attempts_detail.map((a) => (
              <tr key={a.index}>
                <td>{a.index}</td>
                <td>{a.class}</td>
                <td>{iface(a.interface)}</td>
                <td className="attack-text">{a.attack || "(tool probe)"}</td>
                <td>
                  <span
                    className={
                      a.outcome === "leaked" ? "attacks-badge leaked" : "attacks-badge blocked"
                    }
                  >
                    {a.outcome === "leaked" ? "LEAKED" : "BLOCKED"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="chat-footnote">
          Results are generated offline by the leak-attack harness. Labels,
          the SQL gateway and outbound validation are the isolation boundary;
          this page is evidence, not a control.
        </p>
      </div>
    </section>
  );
}
