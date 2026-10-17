# Acme Cloud API enterprise rate limits
Enterprise accounts get 5,000 requests/min per key; bursts up to 2x for 10 seconds; limits are per API key.
When limits are exceeded, HTTP 429 responses include Retry-After. Clients should honor the Retry-After header and use exponential backoff with jitter.
Remaining capacity is exposed in X-RateLimit-Remaining and reset time in X-RateLimit-Reset. Standard-plan limits are unchanged. Rate-limit responses do not count as successful billable requests.
