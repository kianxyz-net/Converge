# Relay

A multi-team agent workspace for Acme Cloud API. Sales reps talk to their Sales agent. Engineers talk to their Engineering agent. Engineering-only information reaches Sales through explicit, exact-text human releases.

## Run in three commands

Requires Node.js 20.12+ and pnpm. Run from this repository checkout:

```sh
pnpm install
pnpm seed
pnpm dev
```

Open **http://127.0.0.1:4173/demo** for Priya (Sales) and Ava (Engineering) side by side. Open **http://127.0.0.1:4173/demo?operator=1** to add the clearly marked full-clearance operator log. `/` is the single-person workspace with Ava, Priya, and Ben in the identity switcher.

The demo works without API keys using deterministic, source-grounded answers and GitHub fixtures. This mode is labeled in the UI and answer manifests. It runs the actual database, label enforcement, retrieval, questions, release approvals, digests, SSE and MCP tools; it does not pretend to call a model.

```sh
pnpm check       # strict TypeScript
pnpm test        # isolation, workflow, REST/SSE and MCP client integration
pnpm eval        # 20 offline cases, pass rate per class and leak count
pnpm build       # React production bundle; no deployment
```

Tests start a temporary loopback server. Stop the running app before `pnpm demo:reset`, then restart `pnpm dev`. Reset wipes the SQLite file and reseeds; ordinary `pnpm seed` is idempotent.

## Four-minute demonstration

See [DEMO.md](DEMO.md). The initial two Engineering docs are private. Release them as Ava, ask source-grounded Sales questions, escalate the uncovered on-prem question, approve the exact draft, and inspect the resulting answer manifest.

## Environment and live adapters

Optional: copy `.env.example` to `.env`; it is loaded automatically. Defaults work offline.

- `DATABASE_PATH=.data/relay.sqlite` — SQLite WAL database, ignored by Git.
- `PORT=4173`, `HOST=127.0.0.1` — local server. Binding to a LAN interface is optional; everyone must reach the same trusted demo server.
- `ANTHROPIC_API_KEY` — enables the Anthropic adapter unless `LLM_MODE=offline`.
- `ANSWER_MODEL=claude-sonnet-5-5`, `SUMMARY_MODEL=claude-haiku-5-5` — task-specified defaults, not verified against a live account. Override with model identifiers available to your account.
- `USE_FIXTURES=true` — fixture PRs. Set false with `GITHUB_REPO=owner/repo` and optionally `GITHUB_TOKEN` for Octokit REST; live failures fall back to fixtures with a returned warning.
- `LOG_PROMPTS=true` — stores prompt text in local `llm_calls`; false retains hashes and usage only.
- `AUTO_RELEASE_QUESTIONS=true` — auto-releases sanitized current questions. False keeps them team-private and does not dispatch an Engineering job.
- `ENABLE_DEMO_OPERATOR=true` — allows the explicit full-clearance demo operator endpoint. Set false to disable.

The Anthropic adapter uses tool calling, a forced `respond` tool for final output, citation checks, outbound validation and one transient retry. No reply tokens are streamed. Only retrieving/drafting/validating statuses stream before the validated record is delivered. `EVAL_LIVE=true pnpm eval` exercises the configured live adapter and can incur API charges; the reported default evaluation results are offline.

## Labels and release boundary

`shared=0`, `eng=1`, `sales=2`; visibility is `(labels & ~clearance) === 0`. All protected-table SQL is confined to `server/store/visibility.ts`. Search filters labels and BM25 ranks in a single FTS5 SQL query. Tools close over the authenticated principal; models cannot supply a principal or mask. Documents are untrusted and cannot grant access.

User chats remain team-labeled. Shared channel threads contain released records, safe questions, briefs and shipped digests. Engineers edit and approve exact answer text, bound by SHA-256 and a stale-draft hash. Approval creates a new shared record, never changes the private original, and posts an answer built only from that released record to the asking rep. Documents require a separate explicit confirmation and create shared chunk copies.

Teammates intentionally share team-level clearance. Personal conversation routes additionally require the conversation owner. Demo identity selection is not production authentication. The operator endpoint is intentionally omniscient and unauthenticated at issuance, like the user switcher; it is a demo control, not a tenant boundary.

## MCP

Streamable HTTP endpoint: `http://127.0.0.1:4173/mcp` (POST, stateless). Obtain a user token through:

```sh
curl -s http://127.0.0.1:4173/api/auth/switch \
  -H 'Content-Type: application/json' -d '{"user_id":"priya"}'
```

Configure your MCP client with `Authorization: Bearer <token>`. Tools: `ask_team_agent`, `get_delta`, `search_context`, `list_open_questions`, `list_pending_releases` (Engineering only). There is deliberately no approve-release tool. The sales-token tests use both SDK in-memory and actual Streamable HTTP clients with adversarial queries.

Stdio uses the same database and services:

```sh
RELAY_TOKEN=<user-token> pnpm mcp:stdio
```

MCP runs a principal-scoped service instance. HTTP sessions stream no model tokens. Stdio processes should not be run concurrently with write-heavy dev sessions: per-conversation queues are in-process, as specified.

## Team scripts

Connector tokens are seeded demo credentials, not GitHub or model credentials. `engineering-files` uses `demo-eng-connector` (forced eng); `sales-files` uses `demo-sales-connector` (forced sales). A JSON input may include `channel_id` and `text`; plain text defaults to the Northwind channel. Any content-supplied labels are ignored.

```sh
node --import tsx scripts/ingest.ts --connector engineering-files --file ./fixtures/documents/rate-limits.md --token demo-eng-connector
node --import tsx scripts/export.ts --team sales --token <sales-user-token>
```

Exports require clearance for the requested label, include only that label’s visible records, log each call, and allow 30 calls per principal per minute. `RELAY_URL` overrides the loopback URL.

## Layout

- `server/`: Express API, agent loop, Anthropic adapter, GitHub/ingest connectors, SQLite gateway.
- `web/`: React + Vite + Tailwind interface and split demo.
- `mcp/`: Streamable HTTP and stdio transports sharing REST service functions.
- `fixtures/`: two private Markdown docs, 8 merged PRs (3 customer-facing), and 1 private open PR.
- `test/`, `eval/`: boundary tests and 20 evaluation cases.
- [DESIGN.md](DESIGN.md), [AGENTS.md](AGENTS.md): decisions and enforced invariants.

## Scope and verification limits

Markdown/text uploads only. No PDF, embeddings, billing, conversation branching, real auth, multi-tenancy or deployment. Fixture GitHub URLs and SHAs are illustrative; they are not evidence of live changes. Arbitrary product questions outside the offline rules escalate rather than fabricate answers. The live Anthropic and GitHub adapters require credentials and were not verified against external accounts.

Isolation is the primary boundary; outbound fingerprint scanning is defense in depth and cannot prevent every paraphrase. Authorized humans can explicitly release sensitive text. This local demo is not production security certification. The server is single-process; event ordering and SSE resume are persisted, while live job queues are in-memory.

GitHub is the primary source repository. The old static Accord implementation has been removed from this checkout. Existing hosted static prototypes are unchanged; no deployment work is performed for this task.
