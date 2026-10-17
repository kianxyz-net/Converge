# Acme Cloud API enterprise rate limits
Enterprise accounts use a token bucket with a sustained limit of 600 requests per minute and a burst allowance of 100 requests. Limits apply per enterprise account, not per API key.
When the bucket is exhausted the API responds with HTTP 429 and a Retry-After header expressed in seconds. Clients should honor Retry-After and use exponential backoff with jitter. Standard-plan limits are unchanged.
Customers can observe remaining capacity using X-RateLimit-Remaining and the reset time using X-RateLimit-Reset. Rate-limit responses do not count as successful billable requests.
