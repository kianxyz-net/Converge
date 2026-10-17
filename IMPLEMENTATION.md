# Three-team handoff implementation report

## Main files and behavior

- `server/handoff.ts`: deterministic seven-source fixtures with masks 0/1/2/4; controlled Sales/Engineering/Infrastructure principals; existing scoped generation; citation/evidence projections; explicit escalation; immutable draft revisions; separate exact-hash approval and release; append-only history/reset. Conflicting rate values or explicitly stale sources cannot return a verified answer.
- `server/handoff-api.ts`: token-derived principals, strict request schemas, source inspection, question/escalation, revision/approve/release, security runner and reset endpoints.
- `server/handoff-checks.ts`: eight repeatable, real backend scenarios in isolated scratch channels. Checks return sanitized outcomes and retire scratch records. A fault-injection test proves a backend failure produces a failed result.
- `server/store/visibility.ts`, `server/security.ts`: retain the sole protected SQL gateway and bitmask model; add optional channel-scoped outbound scanning to prevent unrelated historical transcript fingerprints from breaking repeatable checks. Existing callers keep their old defaults.
- `server/agents/turn.ts`: reuse grounded rules/LLM generation, citations, high-risk normalization and full-output validation; server-only forced rules mode for reproducible checks. No tool gains permissions.
- `server/app.ts`, `server/index.ts`, `scripts/seed.ts`: mount/seed the handoff, block current sessions from archived privilege routes, and sanitize validation errors/default logs.
- `web/main.tsx`, `web/handoff.css`: single-screen team switcher, suggested questions, answer/citation panel, authorized evidence inspector, review/approval/release tabs, actual scenario results, shared artifacts and reset. Previous negotiation UI preserved internally in `web/negotiation-main.tsx`.
- `test/handoff.test.ts`, `scripts/browser-rehearsal.py`: workflow/API/security/fault/repeatability tests and actual headless Chrome rehearsal. Prior negotiation browser script archived under `scripts/legacy/`.

No dependencies, database or live connectors added. Preserved the existing SQLite/WAL/FTS5, visibility choke point, principals/authority, immutable event storage, core release validation and Anthropic wrapper, plus all prior regression tests.

## Verification actually run

- Baseline: `pnpm test` **32/32**; `pnpm check` passed.
- Final `pnpm check`, `pnpm test`: **36/36**. Includes both directions of three-team source isolation, actual DOC/PR citations, whole handoff, unresolved placeholder/authority/hash rejection, edit invalidation, exact output, original preservation, reset, malicious API fields/IDs, MCP/agent denial, sanitized errors, conflict/stale cases, all eight scenarios, repeated scenario G and deliberate injected failure.
- `pnpm eval`: original knowledge-answer regression **24/24**, useful supported answers **8/8**, observed canary leaks **0**, agent-filled dates **0**.
- `ATTACK_RESULTS_PATH=.data/attack-results-handoff-regression.json pnpm eval:attacks`: retained legacy REST/MCP harness **35 scenarios**, no unauthorized canary observed. It is separate from the new runner and does not measure every new path.
- `pnpm build` and `git diff --check` passed.
- `PORT=4181 DATABASE_PATH=:memory: AGENT_MODE=rules pnpm dev`, then `python3 scripts/browser-rehearsal.py`: actual Chrome UI passed rate-limit answer/citations, explicit escalation, Engineering review, editing after approval, reapproval/release, Sales follow-up, all eight security scenarios after a live release, direct extraction refusal, Infrastructure read-only state, reset and mobile overflow check. Desktop and 390px screenshots inspected locally (`/tmp/relay-handoff-*.png`).

## Failures discovered and fixed

A new conflict/staleness regression initially returned an answer; added the narrow backstop and verified escalation. The first full browser security run exposed a real repeatability failure: an unrelated old private transcript fingerprint blocked approval-invalidation scenario G. The UI correctly showed Fail. Scoping this flow's scanner to its workspace and adding repeated-run tests fixed it. Browser automation also needed to wait for the newly selected identity's scoped snapshot before clicking; the UI now disables asking until the snapshot is ready.

## Limitations and incomplete verification

All required no-key demo flows and eight deterministic scenarios are implemented and verified. **No real API key was available: live provider/model availability, live reasoning quality and live-model prompt-injection robustness remain unverified.** SDK mock tests cover adapter mechanics only. Configure `AGENT_MODE=llm`, a server-side `ANTHROPIC_API_KEY` and an account-supported `ANSWER_MODEL`; the inherited default model name requires verification.

Demo identities are freely selectable, not production authentication. Isolation is between teams, not colleagues. Valid IDs/substrings do not prove semantic entailment; conflict detection is limited to explicit rate values/staleness. Fingerprint scanning can miss paraphrases and humans can authorize a mistaken disclosure. Security checks are scoped synthetic assertions, not absolute proof of non-disclosure. Private prompt logging is off by default; enabling it stores local private context. No production tenancy/auth, live integrations, software execution or deployment. No fresh-machine dependency-install verification was performed.


Concurrent GitHub work was preserved through a normal merge: updated attack payload labels/results, the report component/styles and `/attacks` route. The archive is labeled historical, lazy-loaded, and its endpoint redacts synthetic canary tokens without changing the saved original. It is separate from current Security-tab results. Engineering-only release terms were also removed from the shared frontend bundle. Post-merge tests include archive redaction and team-scoped terms.
