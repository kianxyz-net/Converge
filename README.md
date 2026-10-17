# Relay · two teams, one workable plan

A Slack-style negotiation demo for AsterCloud’s fictional Northstar pilot. Each team works with its own agent and private evidence. Humans choose exactly which arguments and quotations reach the other team. Both teams must approve the final decision.

## Run

Requires Node 20.12+ and pnpm. From this checkout:

```sh
pnpm install
pnpm seed
pnpm dev
```

Open **http://127.0.0.1:4173/demo** (or `/`). There are exactly three channels:

- **#team-b**: Maya, Agent B, and 38 private Business records from client calls/chats, internal discussion and CRM.
- **#team-t**: Noah, Agent T, and 33 private Technical records from GitHub, team discussion and calendars.
- **#collab**: approved proposals, selected excerpts, direct human discussion and joint decision review.

Switch identities in the sidebar. The other team’s channel stays locked. Click source IDs for local source details; fictional GitHub URLs are not external links. Use **Reset demo** for a new empty collaboration with the same private fixtures. Reset preserves old immutable audit records in a retired run.

## Three-minute flow

1. As Business, click **Use suggested request**, then **Send**. Agent B prepares 2–4 cited argument cards.
2. Review every argument. Evidence sharing is **off by default**. Select any exact quotes you want to share, click **Preview**, confirm the exact text, then **Post to #collab**.
3. Switch to Technical. Its agent has automatically staged a private response to the approved request. Review **Counterproposal** or **Accept with conditions**, select optional evidence, preview and publish.
4. Switch back to Business. Mention Agent B to prepare a reply. Every new agent publication needs another human review. The showcase permits three proposal rounds.
5. In #collab, **Prepare decision**. Edit the summary from approved shared arguments, keep unresolved readiness gates conditional, and request separate approvals. Both teams approve the same content hash. A conditional plan stays **Conditional / pending readiness** even after both approve.

Ordinary human messages can be sent in #collab after acknowledging **Visible to both teams**. Shared-channel mentions stage private drafts; they do not automatically publish the request or reply. [DEMO.md](DEMO.md) has the full walkthrough and privacy check.

## Honest offline mode and real LLM mode

With no API key, the default is **Offline simulation**: deterministic evidence-selection heuristics, not autonomous model reasoning. It reads the real scoped fixtures and uses the same review, quotation validation and publish services as LLM mode. It does not read a precomputed compromise.

For real generation, set these in `.env`:

```sh
AGENT_MODE=llm
ANTHROPIC_API_KEY=your-key
ANSWER_MODEL=your-account-supported-model
```

Restart `pnpm dev`. If mode is unset and a key is present, the negotiation uses LLM mode. Explicit `AGENT_MODE=rules` always selects simulation. Missing keys in explicit LLM mode produce a clear error, never a silent canned response. The existing Anthropic wrapper handles retries, usage logging and forced structured `respond` output. The inherited default model name must be supported by your account; live account/model availability was not verified here.

Only authorized evidence (maximum twelve retrieved records) and approved shared discussion enter generation. QA reference and `evaluation_only_expected_discovery` are excluded from runtime fixtures. Changing source fixtures requires a demo reset to load the new run. Live reasoning and the CSV-evidence ablation must be tested with your model; local adapter mocks do not establish model quality.

## Verification

```sh
pnpm check             # strict TypeScript
pnpm test              # existing safeguards + negotiation HTTP/SSE/workflow/adapter tests
pnpm eval:negotiation  # focused new workflow and structured-adapter tests
pnpm eval              # retained original 24-case knowledge-answer regression set
pnpm build             # production bundle; no deployment
pnpm demo:reset        # new run, original fixture IDs, empty collaboration
```

The retained `eval:attacks` command exercises the older knowledge-answer services; set `ATTACK_RESULTS_PATH=.data/attack-results.json` to preserve historical checked-in results. It is not a substitute for the new negotiation tests.

## Boundaries and limitations

Server-side bearer principals determine clearance and release authority. Shared=0, Technical=1, Business=2. `server/store/visibility.ts` remains the sole gateway to events, chunks and search. Drafts stay private. Publications validate source ownership and exact substring quotations, bind the server-built preview hash, and create an immutable private approval audit plus a new shared record. The shared snapshot contains no raw private sources or drafts. Recipients can inspect approved excerpts but cannot retrieve the underlying private record. SSE carries refresh notifications, not raw source or model-token payloads.

Draft arguments must cite retrieved sources, avoid financial/internal deal material and avoid six-token verbatim private quotes in prose. These checks are heuristics, not semantic proof. Humans must review agent prose even when no evidence checkbox is selected. Source-supported dates are explicitly proposals; a final commitment requires exact-text approval from each team and resolved conditions. Demo identities are freely selectable and are **not production authentication**. Team clearance does not isolate individuals on a team.

`LOG_PROMPTS` defaults false; enabling it stores private prompts in the local database. Tests enable it only in memory. `.env` and `.data/` are ignored. No live GitHub/Zoom/CRM/Slack integrations, operator UI, artifact manager, export UI, MCP UI, software hosting, or production deployment are part of this demo. Older services/tests are retained internally; the old dashboard entry module is archived in `web/legacy-main.tsx` and is not imported by the app.

See [DESIGN.md](DESIGN.md) for architecture and decisions, [AGENTS.md](AGENTS.md) for invariants, and [IMPLEMENTATION.md](IMPLEMENTATION.md) for commands actually run and limitations.

Optional browser rehearsal on macOS (uses a separate empty memory database):

```sh
# terminal 1
PORT=4180 DATABASE_PATH=:memory: AGENT_MODE=rules pnpm dev
# terminal 2
python3 scripts/browser-rehearsal.py
```

This drives installed Chrome with an isolated temporary profile. It publishes demo content and resets **port 4180 only**; never point it at an active workspace. `RELAY_BROWSER_PATH` can select a different Chrome executable. Running two dev servers may log a Vite HMR-port warning; it does not affect the tested HTTP/SSE workflow.
