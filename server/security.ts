import type { Principal } from "./types.js";
import { outside, type ContextRecord } from "./store/visibility.js";
export const unionLabels = (
  records: ContextRecord[],
  conversationMask: number,
) => records.reduce((m, r) => m | r.labels_mask, conversationMask);
export function outboundScan(
  p: Principal,
  text: string,
  allowed: ContextRecord[],
  excludedIds: string[] = [],
  channel?: string,
) {
  const permitted = allowed.map((r) => r.text).join("\n");
  for (const row of outside(p, channel)) {
    if (excludedIds.includes(row.id)) continue;
    const tokens = row.text.match(/\S+/g) || [];
    const values = [
      ...(row.text.match(/CANARY-[A-Z0-9-]+/g) || []),
      ...(row.text.match(/\b\d+(?:\.\d+)?%?\b/g) || []),
      ...(row.text.match(/"[^"\n]{3,}"/g) || []),
    ];
    for (let i = 0; i + 5 < tokens.length; i++)
      values.push(tokens.slice(i, i + 6).join(" "));
    for (const v of values) {
      if (v.length && text.includes(v) && !permitted.includes(v))
        return { ok: false, reason: "outside-clearance fingerprint" };
    }
  }
  return { ok: true, reason: "passed" };
}
export function safeEscalation(text: string) {
  if (
    /ignore\s+(previous|all)|print.*notes|system\s*prompt|CANARY|secret|private\s+(notes|context)|reveal|extract/i.test(
      text,
    )
  )
    return "Please clarify the customer-facing capability question without requesting private information.";
  return text.slice(0, 2000);
}
export function validateCitations(
  status: string,
  ids: string[],
  allowed: ContextRecord[],
  team: string,
) {
  const permitted = new Set(allowed.map((r) => r.id));
  const valid = [...new Set(ids.filter((id) => permitted.has(id)))];
  return {
    source_ids: valid,
    status:
      status === "answered" && !valid.length
        ? team === "sales"
          ? "needs_escalation"
          : "insufficient_context"
        : status,
  };
}
export const dataBlock = (value: unknown) =>
  `<untrusted_data_json>\n${JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")}\n</untrusted_data_json>`;

export const internalTerms = () =>
  (process.env.INTERNAL_TERMS || "Basalt,CANARY-ENG-7F3A")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
export const unresolved = (text: string) => [
  ...new Set(text.match(/\[(DATE|PRICE|SLA|AVAILABILITY)\]/g) || []),
];
export function releaseProblem(text: string) {
  if (unresolved(text).length)
    return "Resolve every high-risk placeholder before approval";
  if (
    internalTerms().some((term) =>
      text.toLowerCase().includes(term.toLowerCase()),
    )
  )
    return "Remove internal terms before release";
  return null;
}
export function highRiskFacts(text: string) {
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2}(?:,?\s+\d{4})?|\d{4})\b/gi,
    /\bQ[1-4](?:\s+\d{4})?\b/gi,
    /\b20\d{2}\b/g,
    /\b(?:today|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi,
    /\b(?:price|costs?|discount|SLA|uptime)\s*(?:is|of|:|=)?\s*\d[\d,.]*(?:\s*(?:USD|EUR|GBP|dollars|%))?/gi,
    /\b(?:this|next)\s+(?:week|month|quarter|year)\b/gi,
    /[$€£]\s?\d[\d,.]*(?:\s?(?:USD|EUR|GBP|per\s+month))?/g,
    /\b\d+(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars|percent|%)\b/gi,
    /\b\d+(?:\.\d+)?%/g,
    /\b(?:will ship|will launch|will be available|will sign|generally available|guaranteed uptime|legally binding|committed to|GA on|available on)\b/gi,
  ];
  return [...new Set(patterns.flatMap((p) => text.match(p) || []))];
}
export function highRiskBackstop(text: string, cited: ContextRecord[]) {
  const evidence = cited.map((r) => r.text.toLowerCase()).join("\n");
  const unsupported = highRiskFacts(text).filter(
    (f) => !evidence.includes(f.toLowerCase()),
  );
  return { ok: unsupported.length === 0, unsupported };
}
export function normalizeDraft(text: string, query: string) {
  let result = text;
  for (const term of internalTerms()) {
    let start = 0,
      index: number;
    const lower = result.toLowerCase(),
      needle = term.toLowerCase();
    const pieces: string[] = [];
    while ((index = lower.indexOf(needle, start)) >= 0) {
      pieces.push(result.slice(start, index), "[internal detail withheld]");
      start = index + term.length;
    }
    pieces.push(result.slice(start));
    result = pieces.join("");
  }
  for (const fact of highRiskFacts(result)) {
    const field = /[$€£]|USD|EUR|GBP|dollars|price|cost|discount/i.test(fact)
      ? "PRICE"
      : /%|uptime|SLA/i.test(fact)
        ? "SLA"
        : /will ship|launch|available|binding|committed/i.test(fact)
          ? "AVAILABILITY"
          : "DATE";
    result = result.replaceAll(fact, "[" + field + "]");
  }
  for (const [pattern, field] of [
    [/when|date|on.prem|Q[1-4]/i, "DATE"],
    [/price|cost|discount|[$€£]/i, "PRICE"],
    [/SLA|uptime|guarantee/i, "SLA"],
    [/on.prem|availability|\bGA\b|will ship|launch/i, "AVAILABILITY"],
  ] as const) {
    if (pattern.test(query) && !result.includes("[" + field + "]"))
      result +=
        "\n" + field[0] + field.slice(1).toLowerCase() + ": [" + field + "].";
  }
  return {
    text: result,
    fields: unresolved(result).map((f) => f.slice(1, -1)),
  };
}
