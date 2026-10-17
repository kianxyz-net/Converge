export const ENG = 1,
  SALES = 2,
  SHARED = 0;
export interface Principal {
  id: string;
  kind: "user" | "agent";
  name: string;
  team_id: string;
  clearance_mask: number;
  authority_mask: number;
  scope?: "ui" | "mcp";
}
export interface RecordRow {
  seq: number;
  id: string;
  ts: string;
  type: string;
  author_id: string;
  channel_id: string;
  conversation_id: string | null;
  labels_mask: number;
  text: string;
  meta: Record<string, unknown>;
  refs: string[];
  hash: string;
  withdrawn?: boolean;
}
export interface ChunkRow {
  id: string;
  doc_id: string;
  ord: number;
  text: string;
  labels_mask: number;
}
export interface Release {
  id: string;
  kind: string;
  draft_event_seq: number;
  text: string;
  text_hash: string;
  labels_from: number;
  labels_to: number;
  state: string;
  approver_id: string | null;
}
export interface Question {
  id: string;
  channel_id: string;
  asker_id: string;
  text: string;
  state: string;
  event_seq: number;
  answer_event_seq: number | null;
}
export interface Answer {
  answer_markdown: string;
  source_ids: string[];
  status:
    | "answered"
    | "needs_escalation"
    | "insufficient_context"
    | "declined"
    | "blocked";
  high_risk_fields?: string[];
}
export interface Manifest {
  allowed_mask: number;
  record_ids_in_prompt: string[];
  tool_calls: unknown[];
  citations_validated: string[];
  scan_result: string;
  output_labels: number;
  model: string;
  latency: number;
  context_labels: Record<string, number>;
}
