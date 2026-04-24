// API Key Manager with Round-Robin + Failover
// CommonJS syntax for Netlify Functions compatibility


const keyStats = new Map();
const COOLDOWN_MS = 60_000;

function getKeys() {
  // Always read fresh from process.env (never cache across cold starts)
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
  ].filter(Boolean);

  // Initialize stats for each key
  keys.forEach((_, i) => {
    if (!keyStats.has(i)) {
      keyStats.set(i, { calls: 0, failures: 0, lastFailure: 0 });
    }
  });

  return keys;
}

function getKey() {
  const keys = getKeys();

  if (keys.length === 0) {
    throw new Error(
      'No Gemini API keys configured. Set GEMINI_API_KEY_1-4 in Netlify Environment Variables.'
    );
  }

  const now = Date.now();
  const maxAttempts = keys.length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Use random index instead of round-robin for better distribution across cold starts
    const idx = Math.floor(Math.random() * keys.length);
    const stats = keyStats.get(idx);

    if (!stats) continue;

    // Skip keys in cooldown
    if (stats.failures >= 3 && (now - stats.lastFailure) < COOLDOWN_MS * Math.pow(2, stats.failures - 3)) {
      continue;
    }

    // Reset cooldown if expired
    if (stats.failures >= 3 && (now - stats.lastFailure) >= COOLDOWN_MS * Math.pow(2, stats.failures - 3)) {
      stats.failures = 0;
    }

    stats.calls++;
    return { key: keys[idx], index: idx };
  }

  // All keys in cooldown, use least recently failed
  let bestIdx = 0;
  let lastFail = Infinity;
  for (const [idx, stats] of keyStats) {
    if (stats.lastFailure < lastFail) {
      lastFail = stats.lastFailure;
      bestIdx = idx;
    }
  }
  const stats = keyStats.get(bestIdx);
  stats.calls++;
  return { key: keys[bestIdx], index: bestIdx };
}

function reportFailure(index) {
  const stats = keyStats.get(index);
  if (stats) {
    stats.failures++;
    stats.lastFailure = Date.now();
  }
}

function reportSuccess(index) {
  const stats = keyStats.get(index);
  if (stats) {
    stats.failures = 0;
  }
}

function getKeyCount() {
  return getKeys().length;
}

function getDebugInfo() {
  const allEnvKeys = Object.keys(process.env).filter(k => k.startsWith('GEMINI')).sort();
  return {
    keysFound: getKeys().length,
    envVarNames: allEnvKeys,
    envVarCount: allEnvKeys.length,
  };
}

module.exports = {
  getKeys,
  getKey,
  reportFailure,
  reportSuccess,
  getKeyCount,
  getDebugInfo,
};
