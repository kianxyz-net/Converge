# Northstar negotiation implementation report

## Changed and preserved

- `server/negotiation.ts`: read-only fixture import, dedicated Business/Technical principals, authorized evidence selection, structured LLM drafting, explicitly labeled deterministic simulation, review selections, exact hash-bound publication, private approval audits, automatic private Technical drafting, three-round limit, two-team decision voting and append-only reset. Uses existing events/releases/settings, not a second database.
- `server/negotiation-api.ts`: scoped sessions, channel-specific snapshots, protected local citations, human review/publish/discard, human messages, decision proposals/approvals and content-free SSE refresh. Collaboration snapshots exclude private sources and drafts.
- `server/app.ts`, `server/index.ts`, `scripts/seed.ts`: mount the new flow, block negotiation tokens from archived API/privilege paths, and seed only the fictional negotiation at app startup. Old service implementations and regression tests remain intact.
- `web/main.tsx`, `web/negotiation.css`: responsive Slack-style sidebar, exactly three channels, timelines, source notifications, local source detail, argument/evidence review, exact previews and final decision approvals. Old dashboard archived in `web/legacy-main.tsx` and not imported. No operator, artifact, export, MCP, integration or hosting controls in the new UI.
- `fixtures/negotiation/`: 38 Business and 33 Technical records, plus a public-field-only scenario file. QA reference and evaluation-only expected discovery were not copied into runtime data.
- New workflow, HTTP/SSE, structured-adapter and fresh-process tests; `scripts/browser-rehearsal.py`; README, design, invariants, env example and three-minute walkthrough updated.

Preserved SQLite/WAL/FTS5, bitmask visibility gateway, server bearer principals and authority, immutable records, exact-content approval pattern, Anthropic retry/logging wrapper and existing knowledge-answer services/tests. No dependencies added. No live connector or deployment work.

## Commands and observed results

- Before changes: `pnpm test` **28/28**, `pnpm check` passed.
- After changes: `pnpm check`; `pnpm test` **32/32**. New tests cover both directions of private source isolation; malicious team/clearance/source overrides; agent/MCP denial; exact substring citations and hash tampering; unselected quotes excluded from shared output; automatic Technical draft privacy; three rounds; separate team votes; conditional status; reset; refresh-only SSE; mock structured LLM and CSV-evidence ablation; genuine fresh-process startup.
- `pnpm eval`: retained original knowledge-answer set **24/24**, useful supported answers **8/8**, observed canary leaks **0**, agent-filled dates **0**. This is a legacy regression set, not a measure of negotiation quality.
- `ATTACK_RESULTS_PATH=.data/attack-results-negotiation-regression.json pnpm eval:attacks`: retained legacy REST/MCP attack harness **35 scenarios**, no unauthorized canary observed. Historical tracked results preserved. New negotiation boundaries are exercised separately by the new tests.
- `pnpm build` and `git diff --check` passed.
- Browser rehearsal: run `PORT=4180 DATABASE_PATH=:memory: AGENT_MODE=rules pnpm dev` in one terminal, then `python3 scripts/browser-rehearsal.py` against that empty isolated server. Headless Chrome completed three rounds, evidence-default and selected-quote checks, both team decision approvals, conditional final status, a privacy refusal after three rounds, a human message visible to both teams, and a reset to empty collaboration. Desktop (1440px) and mobile (390px) screenshots were inspected; no horizontal mobile overflow. Screenshots are local `/tmp/relay-*-qa.png`.

## Failures found and corrected

The first browser rehearsal found missing sources on a fresh database: old startup seeding retired the new run. Removed old seeding from the app entry and added the fresh-process regression. Also separated collaboration snapshots from private data and blocked negotiation sessions from the legacy operator exchange. Draft quotation, source, hash and privilege failures are deliberate rejected test cases, not ignored runtime failures.

## Remaining limitations

No provider key was available: **live LLM mode and live CSV-ablation reasoning quality remain unverified**. The local SDK mock verifies plumbing, prompt scope and schema validation only. Rules mode demonstrates deterministic evidence selection and real approval services, not autonomous reasoning. Every claim is human reviewed, but source IDs/substring checks and sensitive-text/quote matching cannot establish semantic entailment or prevent all paraphrased disclosures. The UI limits to one active topic and three proposals; no free-form argument editing, automated final commitment, production auth, tenant isolation, live integrations or software execution. Buyer value and time saved remain unmeasured. Demo identities are intentionally freely selectable. Default prompt logs are off; tests log only in memory. No claim of production-grade security.
