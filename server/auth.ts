import { randomBytes } from "node:crypto";
import { db, hash, principal } from "./store/db.js";
import type { Principal } from "./types.js";
export function issueToken(id: string, scope: "ui"|"mcp" = "ui") {
  const p = principal(id);
  if (!p) throw Error("Unknown identity");
  const token = randomBytes(32).toString("hex");
  db.prepare("UPDATE principals SET token_hash=? WHERE id=?").run(
    hash(token),
    id,
  );
  db.prepare("INSERT INTO token_sessions(token_hash,principal_id,scope) VALUES(?,?,?)").run(hash(token), id, scope);
  return { token, principal: scope === "mcp" ? asMcp(p) : {...p,scope} };
}
export function fromToken(token: string | undefined): Principal | undefined {
  if (!token) return;
  const row=db.prepare("SELECT p.id,p.kind,p.name,p.team_id,p.clearance_mask,p.authority_mask,s.scope FROM principals p JOIN token_sessions s ON s.principal_id=p.id WHERE s.token_hash=?").get(hash(token)) as Principal|undefined;
  return row?.scope==='mcp'?asMcp(row):row;
}
export const asMcp=(p:Principal):Principal=>({...p,kind:'agent',authority_mask:0,scope:'mcp'});
export function requireHuman(p:Principal,mask=0){if(p.kind!=='user'||p.scope==='mcp'||(mask&~p.authority_mask)!==0)throw Object.assign(Error('Human UI approval authority required'),{status:403})}

export function requireEngineer(p: Principal) {
  if (p.kind !== "user" || p.scope === "mcp" || (p.authority_mask & 1) !== 1)
    throw Object.assign(Error("Engineering approval authority required"), {
      status: 403,
    });
}
