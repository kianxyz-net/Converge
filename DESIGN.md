# Relay design

## Decisions made before implementation
1. Principals are Ava (Engineering), Priya and Ben (Sales), agent-eng and agent-sales. Team members share team context and clearance. Demo identities are not production authentication.
2. Labels are integer bitmasks: shared=0, eng=1, sales=2. `server/store/visibility.ts` is the only module allowed SQL access to events, chunks, and search. Every read and write takes a server-resolved principal; schema creation lives in that module too.
3. One personal conversation per person/channel with their department agent. Shared channel thread contains permitted briefs, releases, questions, and digests. People never message the other department's agent directly.
4. Digest cursors are per channel/team, advance on validated delivery, and point to the last merge SHA actually included, plus its event sequence.
5. Shipped means merged to the default branch AND customer-facing. Connector code assigns labels; upload labels are ignored.
6. Documents need an explicit confirm. Answers and proactive updates require exact-text approval by an engineer with authority covering all source labels. Immutable originals remain; declassification creates a new shared record and a SHA-256 binding. Questions default to auto-release using the single current rep message plus shared context, never accumulated sales context.
7. Forced structured responses carry source ids. Invalid citations are discarded; an answered response with no valid citation becomes an escalation or insufficient context. No guessing.
8. FTS5 BM25 filters label visibility in the retrieval SQL, top six and at most about 1,500 tokens total. A Retriever interface keeps retrieval replaceable.
9. Summaries are per conversation/audience after twelve messages, include source sequence ranges, and union all input masks.
10. At most five drafts per question. An engineer sees and approves the exact shared text. Residual risk: an authorized human can intentionally disclose sensitive content, and repeated paraphrases are not fully caught by outbound scanning.
11. All text is untrusted, JSON encoded inside explicit data delimiters. Tools close over a fixed principal; the model cannot supply a principal or mask. Seeded injection text is data and has no permission effects.
12. Offline deterministic fixture mode is the default without an API key. This mode is explicitly labeled in UI/manifests and executes real retrieval/release workflows, not fake network calls. With an API key the Anthropic adapter uses the configured models, tool calls, forced final output, usage logging and one transient retry. Model defaults are prompt-specified identifiers and may need overriding for the user's account. GitHub uses fixtures by default and falls back explicitly on live errors.
13. Per-conversation serial queues order turns; SQLite AUTOINCREMENT orders events; SSE resumes from Last-Event-ID. WAL and FTS5 verified at startup. One Node process for this demo.
14. Branching/carry-over is cut. New chats inherit only channel context and shared questions; no private transcript merging.
15. Docs/repo conflict resolution is cut. Citations identify sources so humans can resolve conflicts.

## Assumptions and implementation boundaries
- No deployment work. GitHub remains the source repository; local dev runs the full stack.
- A local SQLite database stores demo data, token hashes, releases and LLM call logs. Tokens never appear in logs. Demo switcher intentionally permits choosing any named user; it is not an access boundary against an operator deliberately switching identity.
- The server owns all tokens and principals. A separate operator principal (mask 3) is issued only by an explicit demo-operator endpoint when operator mode is enabled, and the UI only uses it with `?operator=1`. Operator mode is visibly labeled.
- Uploaded Markdown/text only; PDF, embeddings, auth, deployment and branching are excluded.
- Outbound scan is defense in depth. It compares unique canaries, numbers/percentages, quoted values and six-token shingles outside clearance against allowed context, rather than relying on scanning as the primary isolation boundary.
- Engineering drafts remain eng-labeled even when they reference shared sources; human approval is the only route to Sales.
- Team-only chats are team-visible at the record layer, as requested, but conversation routes restrict personal transcript access to the owner. No private raw chat is indexed for retrieval.
- All manifests and tokens are checked server-side. Models cannot approve releases or choose labels.
