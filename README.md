# Accord

A multiplayer workspace where Business and Engineering teams resolve competing priorities with help from department assistants.

## Run

Requires Node.js 20 or newer. No dependencies or API keys are needed.

```sh
git clone https://github.com/kianxyz-net/negotiator.git
cd negotiator
npm run check
npm test
npm run dev
```

Open http://127.0.0.1:4173. Use two different browsers or a private window to represent different teammates. The shared server, rather than browser localStorage, owns negotiations. Rooms, messages, constraints, drafts, and approvals persist in `.data/workspace.json` (ignored by Git). Restarting the server requires people to identify themselves again.

For a same-network demo, run `HOST=0.0.0.0 npm run dev`, then share `http://YOUR-LAN-IP:4173/#ROOM-ID`. Teammates must reach the same running server; a localhost link only works on the host computer. `PORT` and `ACCORD_DATA_DIR` can override the defaults.

## Demo walkthrough

1. Join as Jamie from Business, then copy the room link.
2. Open the link in another browser; join as Alex from Engineering.
3. Ask Maya, the Business helper, to prepare the shared SSO pilot draft.
4. Post messages from either window and see updates in both.
5. As Engineering, choose **Redirect helpers & revise proposal** and submit: “We cannot postpone the dashboard refresh.” Theo revises the proposal to leave the SSO date pending capacity review.
6. Approve the same draft revision as both departments. One department’s approval alone does not complete the agreement.
7. Add another constraint and see previous approvals cleared.

## What is implemented

- Shared server state, live updates via Server-Sent Events, and shareable room URLs.
- Multiple human participants with department labels and a helper for each department.
- Shared messages, human constraints, versioned proposals, and separate department approvals.
- Server checks for room membership and stale approval revisions.
- Department-specific sample evidence and persisted collaboration history.

## Demo limitations

Helpers are deterministic, not LLM agents. They use a sample SSO case study, reference only their department’s sample evidence, and recognize the dashboard capacity constraint. Other constraints are preserved verbatim for human review; arbitrary natural-language constraints are not automatically solved. Custom rooms still use the SSO sample proposal.

Department identity is self-declared. There is no production authentication, verified approval authority, private department chat, or live company integration. Only public sample excerpts are sent to clients. This server is for trusted hackathon participants using sample information, not production company data. Presence means “joined this room,” not currently online.

## Hosting and workflow

This repository is the source for development. Pull before work, run checks here, and commit/push completed changes to GitHub.

The current multiplayer version requires the Node server and writable persistent storage. A static host serving `dist/` cannot provide the API or live updates. `.openai/hosting.json` retains the earlier static prototype’s Sites identity; the existing hosted static prototype is not upgraded by a GitHub push. Deploy this version to a Node-capable host with a persistent volume, or port the API and storage to the hosting platform before redeployment. Run a single server instance for this file-backed demo.
