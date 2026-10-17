# Converge · 90-second live demonstration

Run `pnpm seed && pnpm dev`, open `/demo`, and reset if needed. The banner says **Offline demo · deterministic rules**. This demonstrates real permissions and approval transitions, not live-model reasoning.

## 0:00–0:20 · A useful, cited answer

As **Sales · Priya**, click **Enterprise rate limits**. Read the answer: 5,000 requests/minute per API key, 2x bursts for 10 seconds, HTTP 429 with Retry-After. Open DOC-001 or PR-412 in the Evidence tab. Show the shared policy and actual supporting text. Only Sales-authorized counts and sources appear.

## 0:20–0:35 · Unknown means a human handoff

Click **On-prem launch date**. There is no confirmed date in released context. The card is **Not sent**. Review the exact question, check the confirmation, and click **Send to Engineering**. No private Sales notes accompany the question.

## 0:35–1:00 · Review, approve, release

Switch to **Engineering · Ava**. The Review tab contains the private Engineering draft. Click **Use no-commitment wording**, then **Save revision** (or type your own reviewed text). Check **I have reviewed and approve this exact text**, then **Approve exact text**.

Point out that the draft is approved but still not shared. To demonstrate invalidation, change a few words and save: the state returns to staged and the old approval cannot release this version. Review/approve again. Check the release acknowledgement and click **Release to Sales**. Expand the hash/history if time permits.

## 1:00–1:15 · Share the output, keep the sources private

Switch back to Sales and click **On-prem launch date** again. It answers using the newly released artifact. Open that citation: only the exact approved text is available. The Engineering roadmap and unreleased PR are still absent from Sales evidence.

## 1:15–1:30 · Test the boundary

Open **Security**, click **Run all 8 scenarios**, and expand a result. These are actual backend assertions in isolated fixture workspaces. Click **Try an extraction** to show refusal. Optionally switch to **Infrastructure · Sam**: its private source is separate and it has no release authority. Reset restores the initial flow.

Say: “These scoped tests passed; they do not prove every disclosure is impossible. Live-model generation needs a configured provider key and was not verified in this environment.”
