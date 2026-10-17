import { randomBytes } from "node:crypto";
import { db, hash, principal } from "./store/db.js";
import type { Principal } from "./types.js";
export function issueToken(id: string) {
  const p = principal(id);
  if (!p) throw Error("Unknown identity");
  const token = randomBytes(32).toString("hex");
  db.prepare("UPDATE principals SET token_hash=? WHERE id=?").run(
    hash(token),
    id,
  );
  db.prepare("INSERT INTO token_sessions VALUES(?,?)").run(hash(token), id);
  return { token, principal: p };
}
export function fromToken(token: string | undefined): Principal | undefined {
  if (!token) return;
  return db
    .prepare(
      "SELECT id,kind,name,team_id,clearance_mask,authority_mask FROM principals WHERE id=(SELECT principal_id FROM token_sessions WHERE token_hash=?)",
    )
    .get(hash(token)) as Principal | undefined;
}
export function requireEngineer(p: Principal) {
  if (p.kind !== "user" || (p.authority_mask & 1) !== 1)
    throw Object.assign(Error("Engineering approval authority required"), {
      status: 403,
    });
}
