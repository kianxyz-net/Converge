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
