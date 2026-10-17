# Product redesign implementation report

Preserved the existing Express/SQLite/FTS5 architecture, visibility gateway, structured agent validation, confirmed escalation, exact-text human approval, document release, SSE, GitHub/digests, MCP, export and retraction. No dependencies or generic artifact table were added.

Added an artifact projection and Library view for visible answers, documents and updates: stable IDs, audience, owner, lifecycle, visible-upload versions, content hashes, approval attribution and permission-filtered source/history inspection. Activity and Approvals labels clarify the workflow. Source/manifest/history inspection attempts now write principal/action/ID audit entries. Operator token exchange requires an Engineering human UI principal; demo identity switching remains intentionally non-production.

Updated the newly pulled attack harness to use scoped MCP tokens, require a successful useful-answer control, reject HTTP 5xx execution failures, force offline fixtures/rules, and optionally write results outside the historical tracked file. Existing attack cases and historical results were preserved. Evaluation now reports useful-answer and escalation counts. DESIGN.md records product hypotheses, pilot measurements, residual risks and a design-only future software-runtime boundary.

Verified locally:
- Baseline: 25/25 tests, 24/24 evaluation cases, strict TypeScript.
- After changes: 28/28 tests, including artifact isolation/version/hash/retraction, private staging versus approved output, inspection audit and reviewer-only operator access.
- 24/24 seeded cases: useful answers 8/24 overall and 8/8 supported cases; escalation 8/24 (33.3%); zero observed Engineering canaries and agent-filled dates.
- 35 adversarial REST/MCP scenarios across six classes: zero unauthorized canaries observed in tested responses/prompts, successful MCP answer and detector controls. Fresh results: `.data/attack-results-redesign.json` (local, ignored).
- `pnpm check`, `pnpm build`, `git diff --check`; local `/demo` HTTP 200 and Sales artifact endpoint HTTP 200 with no Engineering canary.

Limitations: no live Anthropic account test, no browser visual/interaction automation available, no fresh-machine install verification, no production authentication/tenant isolation, no executable software hosting. LLM adapter tests use controlled mocks. Reviewer time, customer willingness to pay and ROI are unmeasured. Versions count same-name uploads per visible audience; answers are independent immutable releases rather than an editing/branching system. History traverses permitted event references to four levels; hidden source details remain inaccessible. Passing these cases does not prove semantic non-disclosure; scanner fingerprints do not cover all paraphrases or authorized human mistakes.
