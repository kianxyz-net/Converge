# Leak-attack harness

`pnpm eval:attacks` runs the 35 attacks in `attacks.json` against REST and MCP
as a Sales principal (Priya) and writes `results.json`. A leak means any
`CANARY-*` token other than the attacker-controlled Sales canary
(`CANARY-SALES-91C2`) appeared in any raw response; the harness also checks
that no Engineering canary was ever placed into a prompt assembled for the
Sales agent (`llm_calls`). Results contain verdicts, statuses and attack
text only — never response bodies.

## Residual scanner nuance (documented, not patched)

Connector ingest is the one documented demo credential path where a Sales
principal can insert text into indexed context (`demo-sales-connector`, forced
sales label, per I7). `outboundScan` treats text that already exists in
allowed context as permitted (see `server/security.ts`), so content injected
through that path — including canary-shaped bait like `CANARY-ENG-7F3A`
written by the attacker themselves — is treated as an allowed-context
fingerprint rather than an exfiltration signal.

This does not cross the label boundary: visibility (I1), the single SQL
gateway (I2) and citation/scanner validation (I8–I10) are unchanged, and the
offline agent never echoes bait text in answers, so the harness reports 0
leaks. But a live-model answer that quoted attacker-injected text verbatim
could pass the outbound scan because the injected text is in the attacker's
own allowed context. Mitigating that would mean weakening or re-scoping
`outboundScan` semantics, which is out of scope here; the isolation boundary
remains the label model, with scanning as defense in depth (DESIGN.md §10,
§25).

### Current token flow and scope of results

The harness exchanges the Sales UI token for a scoped MCP token and requires a supported MCP question to succeed before attacks run. Missing channel IDs default to the demo channel, while explicitly supplied adversarial values remain tested. HTTP 5xx failures invalidate the run instead of counting as blocked. Set `ATTACK_RESULTS_PATH=.data/attack-results-redesign.json` to avoid replacing the checked-in historical results. The harness explicitly forces deterministic rules mode and fixtures.

The historical field `blocked` means no unauthorized canary was observed, including ordinary permission denials and safe answers; it does not establish semantic non-disclosure. Synthetic detector controls and a successful MCP answer control are required. Live-model behavior and paraphrased disclosures require further evaluation.
