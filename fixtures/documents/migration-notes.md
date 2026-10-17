# Migration guide
Enterprise customers should enable exponential backoff with jitter before the rollout. Existing API keys remain valid. No endpoint URLs change. Start with a staging test and monitor 429 responses before production migration.
The rollout applies to the hosted Acme Cloud API. This document does not state any on-prem availability, dates, pricing, or plan.
