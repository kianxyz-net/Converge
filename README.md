# Relay

A shared knowledge and artifact workspace for teams and their agents. Share cited answers and documents while retaining control over private sources. The first workflow connects Engineering and Sales through exact-text, human-approved releases. Agents draft; people decide what crosses teams.

## Run in three commands

Node.js 20.12+ and pnpm are required. From this checkout:

```sh
pnpm install
pnpm seed
pnpm dev
```

Open **http://127.0.0.1:4173/demo**: Sales chat on the left, a shared thread in the middle, Engineering chat and release review on the right. Narrow screens stack the columns. `/` is the single-user workspace with a demo identity switcher. The demo header includes merge simulation, GitHub sync, channel creation, operator view, theme toggle, and reset.

Rules mode works offline with fixtures and no API keys. Both modes execute the real SQLite, label filtering, retrieval, approvals, digests and MCP services.

```sh
pnpm check       # strict TypeScript
pnpm test        # isolation, HITL, rules parity, HTTP/SSE and MCP clients
pnpm eval        # 24 cases, useful-answer/escalation rates and safety counters
ATTACK_RESULTS_PATH=.data/attack-results.json pnpm eval:attacks # scoped REST/MCP attacks
pnpm build       # React production bundle; no deployment
pnpm demo:reset  # append-only reset: retires old channels and seeds a fresh one
```

`pnpm seed` is idempotent. Reset never deletes or changes events. It excludes old channels from future context and creates a fresh active scenario. The in-app reset updates both panes live; a script reset is picked up by SSE polling. Historical records remain available to authorized inspection.

## The human approval boundary

- **Sales asks:** grounded answers carry citations and a status. Unknown product claims become `needs_escalation`; the agent will not guess.
- **Rep confirms:** an exact-question card offers **Send to Engineering** and **Cancel**. Nothing reaches Engineering and no draft job starts before confirmation. The proposed question uses only the current rep message and shared evidence, with a private-value scan.
- **Engineering drafts:** its agent uses Engineering-visible records. Dates, pricing, SLAs and availability use `[DATE]`, `[PRICE]`, `[SLA]`, `[AVAILABILITY]` placeholders and `high_risk_fields`.
- **Engineer approves:** the draft is editable. Dates require a date input or **No date is committed**; other high-risk fields also require a human value or no commitment. Internal terms show a warning and disable approval. The exact resolved text is previewed and hashed.
- **Server enforces:** human-only scoped tokens, source-label authority, no unresolved placeholders, no configured internal terms, exact-text hash and stale-draft binding. Approval creates an eng-only declassify audit and a new shared answer; originals remain unchanged. The rep receives “Engineering answered (approved by Ava): …” with a citation.
- **Reject or retract:** rejection leaves the question open with a visible note. Retraction appends a notice and excludes the released record, dependent chunks, answers and summaries from future context/retrieval. It cannot unsend content already delivered.

Humans can also post an exact shared message after checking **Both teams will see this exact message**. Private agent chat remains separate.

## Demo evidence

The active Northwind channel contains:

- Engineer brief about enterprise rate-limit behavior.
- Released enterprise documentation: **5,000 requests/min per API key**, bursts up to **2x for 10 seconds**.
- PR #412: per-key limits and HTTP 429 `Retry-After`; fixture data includes eight merged PRs, three customer-facing, and private open PR #419.
- Engineering-only on-prem note: uncommitted Q1 target, Basalt codename and Engineering canary.
- Sales-only signing condition and Sales canary.
- Two private documents ready for engineer release, plus a released injection-test document.

Expected rules-mode outcomes: enterprise limits and Retry-After answer with citations; on-prem stages escalation; Priya can answer when Northwind will sign from Sales-only context, while Engineering returns insufficient context; extraction attempts are declined. Isolation is between teams, not between people on a team. Product claims require released evidence; an internal customer-signing answer can cite its own team’s private note without sharing it.

## Environment and models

Optionally copy `.env.example` to `.env`; it loads automatically.

| Variable | Behavior |
|---|---|
| `AGENT_MODE=rules` | Deterministic keyword retrieval and grounded templates; default, no API key. |
| `AGENT_MODE=llm` | Anthropic tool loop and forced `respond`; requires `ANTHROPIC_API_KEY`. |
| `ANSWER_MODEL` / `SUMMARY_MODEL` | Defaults `claude-sonnet-5-5` / `claude-haiku-5-5`, as specified. Override for your account. |
| `LOG_PROMPTS=true` | Store prompts in local `llm_calls`; otherwise only hashes and usage. |
| `INTERNAL_TERMS` | Comma-separated release blocklist; defaults to Basalt and the Engineering canary. Served only to Engineering UI tokens. |
| `USE_FIXTURES=true` | Offline GitHub data; false uses Octokit with `GITHUB_REPO` and optionally `GITHUB_TOKEN`. Errors fall back explicitly to fixtures. |
| `DATABASE_PATH` | Default `.data/relay.sqlite`, SQLite WAL with startup FTS5 verification. |
| `PORT` / `HOST` | Default `4173` / `127.0.0.1`. |
| `ENABLE_DEMO_OPERATOR` | Default enabled. Set false to disable operator token issuance. |

There is **no auto-release configuration**. A model tool can only propose escalation. A server backstop converts uncited dates, prices, percentages and availability claims in Sales-facing output to escalation; Engineering drafts normalize high-risk facts to placeholders. Model responses are validated as a whole; SSE streams statuses and validated records, never raw reply tokens.

## Labels, lineage and inspector

Shared=0, eng=1, sales=2. Visibility is `(labels & ~clearance) === 0`. Only `server/store/visibility.ts` contains SQL for events, chunks or search. FTS5 filters clearance and withdrawals in the ranking query. Context labels union every actual input; tools cannot supply a principal or mask. Source lineage invalidates derived records after retraction.

“Why this answer” shows allowed labels, context records, tool calls, citation validation, scan result, output labels, model mode and latency. With `/demo?operator=1`, a clearly marked operator table shows all event records, their labels and visibility to each team. Operator mode intentionally has full clearance and is a demo feature, not production authentication.

## MCP and scoped tokens

Streamable HTTP: `http://127.0.0.1:4173/mcp` (stateless POST). First use `/api/auth/switch` to select a demo user, then exchange that UI token for a restricted token:

```sh
curl -s http://127.0.0.1:4173/api/auth/switch \
  -H 'Content-Type: application/json' -d '{"user_id":"priya"}'

curl -s http://127.0.0.1:4173/api/auth/mcp-token \
  -H 'Authorization: Bearer <UI_TOKEN>' -H 'Content-Type: application/json' -d '{}'
```

Configure MCP with `Authorization: Bearer <MCP_TOKEN>`. MCP tokens resolve to agent-kind principals with no release authority, including when used against REST. Plain UI tokens are rejected at `/mcp`; this avoids treating model calls as human approvals. Demo identity issuance itself is intentionally not production auth.

Tools: `ask_team_agent`, `get_delta`, `search_context`, `list_open_questions`, `list_pending_releases` (Engineering only). No approve, release, confirm escalation or retract tools.

```sh
RELAY_TOKEN=<MCP_TOKEN> pnpm mcp:stdio
```

HTTP and stdio use the same services and store. Per-conversation queues are in-process, so run one application writer for the demo; external stdio writes are picked up by SSE polling but do not share an in-memory queue with the web process.

## Connector scripts

Registered demo connector tokens: `engineering-files` → `demo-eng-connector` (forced eng); `sales-files` → `demo-sales-connector` (forced sales). Upload-supplied labels are ignored. Plain text defaults to the active demo channel; JSON may specify `channel_id` and `text`.

```sh
node --import tsx scripts/ingest.ts --connector engineering-files --file ./fixtures/documents/rate-limits.md --token demo-eng-connector
node --import tsx scripts/export.ts --team sales --token <USER_OR_MCP_TOKEN>
```

`RELAY_URL` overrides the loopback URL. Exports require the requested team’s clearance, log each call and rate-limit to 30/minute. Historical withdrawn records remain explicitly marked in authorized exports.

## Files and limitations

[DESIGN.md](DESIGN.md) records decisions; [AGENTS.md](AGENTS.md) contains invariants; [DEMO.md](DEMO.md) is the four-minute presentation script. `server/`, `web/`, `mcp/`, `scripts/`, `fixtures/`, `test/`, and `eval/` contain the implementation.

No deployment, production auth, multi-tenancy, PDF, embeddings, billing, branching or second-approver workflow. Fixture SHAs/URLs are illustrative. The Anthropic SDK is tested against a local HTTP mock for retries, scoped tools, structured output and high-risk backstops; real model/account access and live GitHub credentials remain unverified. Browser visual QA is unavailable in this environment.

Fingerprint scanning is defense in depth, not proof against all paraphrases. Authorized human releases still reveal information, bounded by the human decision and five-draft cap. No claim of production security certification is made.

## Artifact workspace

Open **Library** beside Activity: visible answers, updates, document uploads and released copies show stable ID, owner, audience, lifecycle status, version, timestamp and SHA-256. Open an artifact or its **History** to inspect permitted approval/source events. Private document revisions are not counted in Sales' versions. Answers are immutable v1 releases; a revised answer is a new release. Sources remain independently permission checked. Retractions stay visible as history while excluded from future retrieval.

**Approvals** is the Engineering review queue; **Docs** retains upload, chunk preview and exact-text release. The operator view requires an Engineering human UI token exchange and can be disabled with `ENABLE_DEMO_OPERATOR=false`. Demo identity switching is still freely selectable and is not real authentication. Record, manifest and artifact-history inspection attempts are audited by principal/action/ID, including denied reads, without storing source text in audit logs.

No generated software is executed or hosted. The future runtime boundary and unvalidated customer/buyer hypotheses are documented in DESIGN.md.
