import "../server/config.js";
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf("--" + name);
  return i < 0 ? undefined : args[i + 1];
};
const team = flag("team"),
  token = flag("token");
if (!team || !token)
  throw Error(
    "Usage: node --import tsx scripts/export.ts --team eng|sales --token <user-token>",
  );
const res = await fetch(
  (process.env.RELAY_URL || "http://127.0.0.1:4173") +
    "/api/export?team=" +
    encodeURIComponent(team),
  { headers: { Authorization: "Bearer " + token } },
);
const result = await res.json();
if (!res.ok) throw Error(result.error);
console.log(JSON.stringify(result, null, 2));
