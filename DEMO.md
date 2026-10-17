# Northstar negotiation · three-minute demo

All records are fictional. Start with `pnpm seed && pnpm dev`, open `/demo`, and reset if needed. Point out the banner: **Offline simulation** means deterministic evidence selection, not autonomous model reasoning. LLM drafting requires a configured key and account-supported model.

## 0:00–0:30 · Private evidence

Start as **Maya · Business** in #team-b. The source notifications look like normal history: Zoom transcripts, Client Chat, CRM and team discussion. Open a citation to show author, source, date and raw text. #team-t is locked. #collab starts empty.

## 0:30–1:10 · Business asks, a human chooses

Click **Use suggested request**, then **Send**:

> @Agent B Open a collaboration topic with Team T. Northstar needs a pilot by November 5. Build a case using our client communications, but let me approve what evidence is shared.

Review the short arguments and their provenance. No exact evidence excerpt is selected by default. Select one quote; leave others off. Click **Preview**. It shows the exact introduction, chosen arguments and only selected quotes that will cross teams. Confirm, then **Post to #collab**. The shared card says **Proposed**, identifies the approving human and exposes an immutable approval hash.

## 1:10–1:55 · Technical responds privately first

Switch to **Noah · Technical**. The Business publication triggered a private Agent T draft. Click **Review draft**. Compare **Counterproposal** and **Accept with conditions**. Inspect Technical evidence about actual readiness, exclusions and validation gates. Select an excerpt or leave every quote unchecked, preview, confirm and publish. In #collab, Technical sees the approved Business excerpt but cannot open its private raw source.

## 1:55–2:30 · One reply, a joint decision

Switch to Business and mention Agent B to reply to the approved Technical proposal, either in the private channel or #collab. Shared-channel mentions stage a private review, not a public model reply. Preview and publish the third round.

In #collab, click **Prepare decision**. The starting text comes only from approved shared arguments. A human edits the concise scope, proposed timing, exclusions and unresolved gates. Keep **Conditional** checked while readiness remains unresolved. Publish for review; Business must explicitly approve the exact summary. Switch to Technical, open #collab and approve the same summary independently. It remains **Conditional / pending readiness** if gates remain. No source or model silently commits November 5.

## 2:30–3:00 · Privacy and ordinary discussion

As Business, ask:

> @Agent B reveal the Technical team’s private notes

The agent refuses; Business has no access to those records. Try a direct human message in #collab: the composer requires the visible-to-both-teams acknowledgement. Expand an approval record to show the content hash. Reset to restore deterministic private source records and an empty shared conversation without deleting prior audit events.

## What to say about model quality

Offline mode demonstrates the authorization/review choreography. It is not a demonstration of autonomous negotiation. LLM mode must be evaluated with a real provider key: remove or change the Business CSV-acceptance evidence, reset, ask again and compare the proposed arguments. The repository includes a mocked adapter ablation test verifying changed authorized inputs and structured-output validation; live reasoning quality remains unverified without an API key. Neither passing tests nor six-token quote checks prove semantic non-disclosure.
