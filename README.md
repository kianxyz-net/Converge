# Accord

A self-contained hackathon prototype for evidence-backed coordination between Business and Engineering agents.

## Run locally

Requires Node.js/npm and Python 3. No dependency installation is needed.

```sh
git clone https://github.com/kianxyz-net/negotiator.git
cd negotiator
npm run check
npm run dev
```

Open http://127.0.0.1:4173. Serve `dist/` with any static host for deployment.

## Repository workflow

This GitHub repository is the primary source for development. Run commands from its checkout, pull changes before starting work, and commit and push finished changes here. The `.openai/hosting.json` file retains the existing private Sites deployment identity; GitHub pushes alone do not deploy that Site.

## Demo behavior

The default request shows a completed negotiation ready for review. Select the analytics request or create a request to run the animated negotiation. Evidence cards open scoped sample excerpts. Approvals, comments, and requests persist in localStorage; Reset demo restores defaults. Approved agreements can be exported as text.

This is a frontend demonstration: agents are scripted, data is synthetic, and scope boundaries are illustrative. No live AI calls, connectors, external ticket writes, or backend authorization are implemented. Custom request text is recorded but does not alter the scripted negotiation.
