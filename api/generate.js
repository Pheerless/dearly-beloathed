// Persistent rate limiter using Upstash Redis (via Vercel KV)
const RATE_LIMIT = 10; // requests per window
const RATE_WINDOW_SECONDS = 60 * 60; // 1 hour

async function checkRateLimit(ip) {
  const key = `ratelimit:${ip}`;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    // Fail open if KV isn't configured — better to serve than to block everyone
    console.warn('KV not configured, skipping rate limit');
    return { allowed: true };
  }

  // Atomically increment counter
  const incrRes = await fetch(`${url}/incr/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { result: count } = await incrRes.json();

  // If this is the first hit in the window, set expiry
  if (count === 1) {
    await fetch(`${url}/expire/${key}/${RATE_WINDOW_SECONDS}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  if (count > RATE_LIMIT) {
    // Get remaining TTL for a helpful error message
    const ttlRes = await fetch(`${url}/ttl/${key}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { result: ttl } = await ttlRes.json();
    const resetIn = Math.max(1, Math.ceil(ttl / 60));
    return { allowed:
