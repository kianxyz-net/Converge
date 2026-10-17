import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  Message,
} from "@anthropic-ai/sdk/resources/messages";
import { randomUUID } from "node:crypto";
import { db, hash } from "../store/db.js";
import type { Principal } from "../types.js";
export const answerModel = () =>
  process.env.ANSWER_MODEL || "claude-sonnet-5-5";
export const summaryModel = () =>
  process.env.SUMMARY_MODEL || "claude-haiku-5-5";
export const offline = () =>
  !process.env.ANTHROPIC_API_KEY || process.env.LLM_MODE === "offline";
export function logCall(
  p: Principal,
  conversation: string,
  model: string,
  prompt: string,
  input: number,
  output: number,
  latency: number,
) {
  db.prepare("INSERT INTO llm_calls VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    randomUUID(),
    new Date().toISOString(),
    p.id,
    conversation,
    model,
    hash(prompt),
    process.env.LOG_PROMPTS === "false" ? null : prompt,
    input,
    output,
    latency,
  );
}
export async function llmCall(
  p: Principal,
  conversation: string,
  system: string,
  messages: MessageParam[],
  tools: Tool[],
  final = false,
  model = answerModel(),
): Promise<Message> {
  const start = Date.now(),
    prompt = JSON.stringify({ system, messages, tools });
  const client = new Anthropic({ maxRetries: 0 });
  let response: Message | undefined;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await client.messages.create({
          model,
          max_tokens: 1600,
          system,
          messages,
          tools,
          tool_choice: final
            ? { type: "tool", name: "respond" }
            : { type: "any" },
          stream: false,
        });
        break;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (
          attempt === 1 ||
          !(
            status === 429 ||
            (status !== undefined && status >= 500) ||
            status === undefined
          )
        )
          throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!response) throw Error("No model response");
    return response;
  } finally {
    logCall(
      p,
      conversation,
      model,
      prompt,
      response?.usage.input_tokens || 0,
      response?.usage.output_tokens || 0,
      Date.now() - start,
    );
  }
}
