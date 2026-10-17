# Non-negotiable invariants

I1. Labels are bitmasks. Shared = mask 0. A record is visible to a principal iff `(record.labels_mask & ~principal.clearance_mask) == 0`.
I2. Exactly one module (`server/store/visibility.ts`) may query events, chunks, or the search index. Everything else (REST, SSE, MCP, agents, scripts, inspector) goes through it with an explicit principal. Add a test that greps the source and fails if any other module contains SQL touching those tables.
I3. Agent context is assembled server-side from records visible to the agent's principal. No tool accepts a label, mask, or principal argument from the model. Tool arguments cannot widen access.
I4. Output labels = OR of the masks of every record actually placed in the prompt or returned by tools in that turn, plus the conversation's label.
I5. Cross-team movement happens only via a declassify event: a human with authority over the labels approves the exact text. The server stores sha256(text) and creates a NEW record with the wider labels whose text equals the approved text. Originals are never mutated.
I6. events is append-only (SQLite triggers reject UPDATE and DELETE).
I7. Connectors stamp labels from their registration, ignoring labels inside uploaded content. GitHub labeling is deterministic code: merged AND label "customer-facing" -> shared; everything else -> eng.
I8. All documents, PR text, and user text are untrusted data. Wrap in delimiters in prompts, and never let them change tool permissions.
I9. Answers cite record ids. The server validates that every cited id was in the prompt or in a tool result this turn. If an "answered" reply has zero valid citations, the server converts it to needs_escalation (sales) or insufficient_context (eng).
I10. No token streaming to clients. The full reply is validated (I9 + outbound scan) before delivery. Stream only step statuses (retrieving, drafting, validating).

# Working rules
TypeScript strict. Minimal dependencies. Every milestone runnable and committed. No deployment. Do not weaken isolation to get a demo working. Document cuts honestly and remove UI for unsupported actions.

I11. Human-in-the-loop policy is non-negotiable:
H1. Agents draft, propose and stage only. Every cross-team release, document release and escalation requires an explicit click by a human (kind=user) with authority over the source labels.
H2. No auto-release. A rep sees and confirms the exact staged question before it reaches Engineering; question construction uses the single current rep message plus shared records, never accumulated Sales-private context, and is scanned against private values.
H3. Human-action endpoints reject agent principals and MCP callers with 403. MCP exposes no approve, release, retract or escalation-confirm tool.
H4. Drafted -> staged -> approved. Only human approval creates a shared record. Reject leaves the question open with a visible draft_rejected note.
H5. Retraction is a new append-only event. Withdrawn records and their derived context are excluded from future retrieval; the UI explains that earlier deliveries cannot be unsent.

High-risk backstop: normalize agent-drafted dates, prices, SLAs, availability and commitments to [DATE], [PRICE], [SLA], [AVAILABILITY]. Track high_risk_fields. Reject approval with unresolved placeholders or internal terms. Convert unsupported Sales-facing high-risk claims to needs_escalation. Never auto-fill a date in an agent draft.

Artifact catalogs and histories must be projections through visibility.ts with an explicit principal. Never count hidden revisions or expose private source content through released-artifact metadata. Audit source/manifest/history inspection without recording source text. Preserve independent review authority and clearance. No generated-code runtime in this slice.

Northstar scenario: source-supported dates may appear only as human-reviewed PROPOSALS, superseding blanket placeholder normalization in that scenario. Final decisions require two distinct team approvals of the same hash; unresolved conditions remain conditional. Never import QA reference/expected discovery into runtime context. New cross-team argument prose must not contain verbatim private quotes; evidence excerpts are selected separately, unchecked by default.
