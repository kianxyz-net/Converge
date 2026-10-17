# Relay · permission-aware answers and human-controlled handoffs

A single-screen, fictional Northwind demo. Sales gets cited product answers, escalates unknown questions to Engineering, and receives only the exact response a human engineer approved. Infrastructure has separate private context and no release authority.

## Run in three commands

Node 20.12+ and pnpm are required. From this checkout:

```sh
pnpm install
pnpm seed
pnpm dev
```

Open **http://127.0.0.1:4173/demo** (or `/`). No API key is needed. The default **Offline demo** uses deterministic rules and the real retrieval, approval, release and security-check services.

## The 90-second flow

1. Start as **Sales · Priya**. Click **Enterprise rate limits**: the answer includes 5,000 requests/minute per API key, 2x bursts for 10 seconds, and HTTP 429 with Retry-After. Open the DOC-001 and PR-412 citations in the evidence inspector.
2. Click **On-prem launch date**. There is no confirmed date in released evidence. Confirm the exact question and click **Send to Engineering**.
3. Switch to **Engineering · Ava**. The Review tab contains a private draft. Edit the text or click **Use no-commitment wording**, then **Save revision**. Review the exact text, check approval and click **Approve exact text**.
4. Approval alone shares nothing. Check the release acknowledgement and click **Release to Sales**. Editing before release clears the approval; save and reapprove the new hash.
5. Return to Sales and ask the on-prem question again. It cites the new shared artifact. Original Engineering notes and PR #419 remain inaccessible.
6. Open **Security**, run all eight checks, and inspect the real results. **Reset demo** restores the original fixtures, empty approvals and no released artifacts.

The evidence inspector shows source ID, owner, access policy, source type, state and content. Only authorized source counts are shown. Infrastructure can inspect its own restricted source, but cannot approve or release. [DEMO.md](DEMO.md) is the timed walkthrough.

## Seeded data and permissions

| Audience | Sources |
|---|---|
| Shared | Enterprise documentation; merged/customer-approved PR #412 |
| Engineering only (bit 1) | Tentative on-prem roadmap; unreleased PR #419; malicious test-only source; Engineering canary |
| Sales only (bit 2) | Unconfirmed Northwind signing condition; Sales canary |
| Infrastructure only (bit 4) | Restricted operational source; Infrastructure canary |

Shared records have mask 0. The server resolves principals from opaque demo tokens. Events, chunks and search are accessed only through `server/store/visibility.ts`. The mask is applied in SQL before source retrieval/model context construction. Source inspection uses the same rule. UI identities never select their own clearance or release authority. Demo identities are freely selectable and **not production authentication**.

## Security runner

The clickable scenarios execute backend checks in isolated scratch channels in the same SQLite store. Results are computed, not prefilled. They cover:

- A: supported answer, valid citations and evidence.
- B: direct extraction refusal and pre-generation filtering.
- C: a real malicious private document cannot grant access to Infrastructure.
- D: no other-team canaries in tested answers, citations, evidence or scoped snapshots.
- E: an unconfirmed launch date stages escalation without sending it.
- F: Sales, Infrastructure, agents and MCP-scoped principals cannot approve/release.
- G: edit invalidates approval; only reapproval permits the new exact text to be released.
- H: team-filtered SQL retrieval and inspection deny other teams.

The runner always uses deterministic generation, even if interactive LLM mode is enabled. These are scoped synthetic enforcement checks, **not proof against every leak or a live-model injection benchmark**. Reports contain no private source text/canaries. Repeating checks does not alter the active conversation. Scratch records are retired append-only.

## Tests and verification

```sh
pnpm check             # strict TypeScript
pnpm test              # full regression suite, including three-team handoff and scenario runner
pnpm eval:handoff      # focused handoff acceptance tests
pnpm eval              # retained original 24-case knowledge-answer regression set
pnpm build             # production bundle; no deployment
pnpm demo:reset        # new active fixture run; preserves historical events
```

Optional browser rehearsal on macOS with installed Chrome:

```sh
# terminal 1: separate, empty in-memory demo
PORT=4181 DATABASE_PATH=:memory: AGENT_MODE=rules pnpm dev
# terminal 2
python3 scripts/browser-rehearsal.py
```

The browser script uses an isolated temporary profile and only port 4181. It publishes demo content and resets that scratch workspace. Never point it at an active user workspace. `RELAY_BROWSER_PATH` can select another Chrome executable. Concurrent dev servers may log a Vite HMR-port warning; the HTTP flow remains functional.

`eval:attacks` retains the older 35-scenario REST/MCP regression harness; use `ATTACK_RESULTS_PATH=.data/attack-results.json` to preserve historical results. The previous negotiation implementation/tests remain internally, with its UI archived in `web/negotiation-main.tsx`. It is not the active demo. No old dashboard/operator privilege exchange is available to handoff session tokens.

## Optional real model

Copy `.env.example` to `.env` if desired. For live generation, configure:

```sh
AGENT_MODE=llm
ANTHROPIC_API_KEY=your-server-side-key
ANSWER_MODEL=an-account-supported-model
```

Restart the server. The existing Anthropic adapter sits behind the structured generation service, with bounded tools, one transient retry and full-response validation. Credentials stay on the server. No model gets shell, SQL, filesystem or unrestricted network tools. Explicit rules mode needs no provider. The inherited default model name requires account verification; set a model your account supports.

No real API key was available during this implementation: **live provider/model availability and live-model injection robustness remain unverified**. Existing SDK mock tests validate adapter mechanics, not real model quality. If live generation fails, no unvalidated answer is returned; reset/retry after fixing configuration. `LOG_PROMPTS` defaults false. Enabling it stores private prompts locally; tests enable it only in memory.

## Boundaries and limitations

Approving and releasing are separate server transitions. Both require a human with Engineering release authority and the current content hash. Each saved edit appends a private revision and invalidates approval. Release creates a new immutable shared artifact; its API projection excludes private refs, manifests and draft reasoning. Original sources never change. Approval/release history stays private to authorized reviewers. Unknown source IDs and forbidden IDs use the same error response; validation errors/default logs do not echo input/model values.

The source-conflict backstop detects inconsistent rate-limit values or explicitly stale/expired source states. It is not a general semantic conflict detector. Valid citations do not prove entailment. Fingerprint scanning is defense in depth and can miss paraphrases; humans can approve a mistaken disclosure. Isolation is between teams, not people within one team. Refresh polling updates team snapshots; unvalidated model tokens are never streamed. No production auth, tenant isolation, live connectors, software execution or deployment is included.

See [DESIGN.md](DESIGN.md), [AGENTS.md](AGENTS.md) and [IMPLEMENTATION.md](IMPLEMENTATION.md) for decisions, invariants and verification details.
