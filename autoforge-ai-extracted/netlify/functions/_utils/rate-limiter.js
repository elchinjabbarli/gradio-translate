// Simple in-memory rate limiter (per IP, per day)
// CommonJS syntax for Netlify Functions compatibility
//
// IMPORTANT: Netlify Functions are stateless and may spin down between
// requests (cold starts). When a cold start occurs, this in-memory Map is
// reset to empty, effectively allowing a fresh set of requests regardless of
// the previous count. This means the rate limit is best-effort and NOT
// guaranteed to be accurate across cold starts.

const DAILY_LIMIT = 30;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Store: Map<ip, { count, resetAt }>
const store = new Map();

function getClientIP(event) {
  return (
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['client-ip'] ||
    'unknown'
  );
}

function checkRateLimit(ip) {
  const now = Date.now();
  let data = store.get(ip);

  if (!data || now > data.resetAt) {
    data = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, data);
  }

  data.count++;

  return {
    allowed: data.count <= DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - data.count),
    limit: DAILY_LIMIT,
    resetAt: data.resetAt,
  };
}

module.exports = {
  getClientIP,
  checkRateLimit,
};
