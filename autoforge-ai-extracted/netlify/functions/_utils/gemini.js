// Gemini API Client with retry + key rotation + DYNAMIC MODEL DISCOVERY
// CommonJS syntax for Netlify Functions compatibility
//
// Strategy:
// 1. On first call, dynamically discover all available models via API
// 2. Try each model in priority order (newest → oldest, flash → pro)
// 3. On 429 (quota exceeded), mark model as exhausted and try next
// 4. Cooldown exhausted models for 2 minutes, then retry
// 5. Rotate API keys with round-robin + failover

const { getKey, reportFailure, reportSuccess, getKeys } = require('./key-manager');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 3;
const MODEL_COOLDOWN_MS = 120_000; // 2 minutes cooldown for exhausted models

// ─── COMPREHENSIVE STATIC MODEL LIST ───────────────────────────
// Covers Gemini 1.5 → 3.1, all variants (flash, pro, lite, thinking)
// Ordered by priority: newest first, flash before pro (faster & cheaper)
const STATIC_MODEL_CHAIN = [
  // ── Gemini 3.x ──
  'gemini-3.1-flash',
  'gemini-3.1-flash-preview',
  'gemini-3.1-pro',
  'gemini-3.1-pro-preview',
  'gemini-3.0-flash',
  'gemini-3.0-flash-preview',
  'gemini-3.0-pro',
  'gemini-3.0-pro-preview',

  // ── Gemini 2.5 ──
  'gemini-2.5-flash',
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-flash-lite-preview-06-17',
  'gemini-2.5-pro',
  'gemini-2.5-pro-preview-05-06',
  'gemini-2.5-pro-preview-06-05',

  // ── Gemini 2.0 ──
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-2.0-pro',

  // ── Gemini 1.5 ──
  'gemini-1.5-flash',
  'gemini-1.5-flash-002',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash-8b-001',
  'gemini-1.5-pro',
  'gemini-1.5-pro-002',
  'gemini-1.5-pro-001',

  // ── Gemini 1.0 (legacy) ──
  'gemini-1.0-pro',
  'gemini-pro',
];

// ─── DYNAMIC MODEL DISCOVERY ───────────────────────────────────
// Cached list of models discovered from the Gemini API
let discoveredModels = null;
let discoveredAt = 0;
const DISCOVERY_CACHE_MS = 300_000; // 5 minutes cache

/**
 * Query the Gemini API to discover which models are actually available.
 * This is more reliable than a static list because:
 * - New models may have been added
 * - Deprecated models are automatically excluded
 * - Only models that support generateContent are included
 */
async function discoverAvailableModels() {
  const now = Date.now();

  // Return cached if fresh
  if (discoveredModels && (now - discoveredAt) < DISCOVERY_CACHE_MS) {
    return discoveredModels;
  }

  const keys = getKeys();
  if (keys.length === 0) {
    console.log('No API keys available for model discovery, using static list');
    return STATIC_MODEL_CHAIN;
  }

  // Try each key until one works for discovery
  for (const apiKey of keys) {
    try {
      const url = `${GEMINI_BASE}?key=${apiKey}&pageSize=200`;
      const response = await fetch(url, { method: 'GET' });

      if (!response.ok) {
        console.log(`Model discovery failed with key ...${apiKey.slice(-4)}: ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (!data.models || !Array.isArray(data.models)) {
        console.log('Model discovery: unexpected response format, using static list');
        break;
      }

      // Filter to models that support generateContent
      const generativeModels = data.models
        .filter(m =>
          m.supportedGenerationMethods?.includes('generateContent') &&
          !m.name.includes('embedding') &&
          !m.name.includes('aqa')
        )
        .map(m => m.name.replace('models/', ''));

      if (generativeModels.length > 0) {
        // Sort: prioritize by version (newest first), then flash over pro
        const sorted = sortModelsByPriority(generativeModels);
        discoveredModels = sorted;
        discoveredAt = now;
        console.log(`Discovered ${sorted.length} available Gemini models: ${sorted.slice(0, 5).join(', ')}...`);
        return sorted;
      }
    } catch (err) {
      console.log(`Model discovery error with key ...${apiKey.slice(-4)}: ${err.message}`);
    }
  }

  // Fallback to static list
  console.log('Model discovery failed for all keys, using static list');
  return STATIC_MODEL_CHAIN;
}

/**
 * Sort models by priority: higher version first, flash before pro
 */
function sortModelsByPriority(models) {
  return models.sort((a, b) => {
    // Extract version number for comparison
    const versionA = parseFloat(a.match(/gemini-(\d+\.?\d*)/)?.[1] || '0');
    const versionB = parseFloat(b.match(/gemini-(\d+\.?\d*)/)?.[1] || '0');

    // Higher version first
    if (versionB !== versionA) return versionB - versionA;

    // Flash before pro (same version)
    const aIsFlash = a.includes('flash') || a.includes('lite');
    const bIsFlash = b.includes('flash') || b.includes('lite');
    if (aIsFlash && !bIsFlash) return -1;
    if (!aIsFlash && bIsFlash) return 1;

    // Lite after flash
    const aIsLite = a.includes('lite');
    const bIsLite = b.includes('lite');
    if (aIsLite && !bIsLite) return 1;
    if (!aIsLite && bIsLite) return -1;

    // Preview after stable
    const aIsPreview = a.includes('preview');
    const bIsPreview = b.includes('preview');
    if (aIsPreview && !bIsPreview) return 1;
    if (!aIsPreview && bIsPreview) return -1;

    return a.localeCompare(b);
  });
}

// ─── MODEL QUOTA TRACKING ──────────────────────────────────────
const modelQuotaExhausted = new Map(); // model → timestamp

function isModelOnCooldown(model) {
  const now = Date.now();
  // Clean up expired cooldowns
  for (const [m, ts] of modelQuotaExhausted.entries()) {
    if (now - ts > MODEL_COOLDOWN_MS) {
      modelQuotaExhausted.delete(m);
    }
  }
  return modelQuotaExhausted.has(model);
}

function markModelExhausted(model, isQuotaZero) {
  // If limit is 0, use longer cooldown (this model won't recover soon)
  const cooldown = isQuotaZero ? MODEL_COOLDOWN_MS * 5 : MODEL_COOLDOWN_MS;
  modelQuotaExhausted.set(model, Date.now());
  console.log(`Model ${model} marked as exhausted (limit: 0 = ${isQuotaZero}), cooldown ${cooldown / 1000}s`);
  
  // Schedule cleanup after cooldown expires
  setTimeout(() => {
    if (modelQuotaExhausted.has(model)) {
      const ts = modelQuotaExhausted.get(model);
      if (Date.now() - ts > MODEL_COOLDOWN_MS) {
        modelQuotaExhausted.delete(model);
        console.log(`Model ${model} cooldown expired, removed from exhausted list`);
      }
    }
  }, cooldown + 1000);
}

// ─── CORE API CALL ─────────────────────────────────────────────
async function callGeminiWithModel(prompt, model, apiKey, systemInstruction, temperature, maxOutputTokens) {
  const requestBody = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'text/plain',
    },
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();

    if (response.status === 429) {
      const isQuotaZero = errorBody.includes('limit: 0');
      // More flexible regex to handle various retry delay formats
      const retryMatch = errorBody.match(/retryDelay[^\d]*(\d+)/i) || errorBody.match(/(\d+)s/);
      const retryDelay = retryMatch ? parseInt(retryMatch[1], 10) : 60;
      // Ensure retryDelay is a valid number, fallback to 60 seconds
      const safeRetryDelay = Number.isFinite(retryDelay) && retryDelay > 0 ? retryDelay : 60;
      return {
        ok: false,
        status: 429,
        isQuotaError: true,
        isQuotaZero,
        error: errorBody,
        retryDelay: safeRetryDelay,
      };
    }

    if (response.status === 400 && errorBody.includes('does not exist')) {
      // Model doesn't exist — skip permanently
      return {
        ok: false,
        status: 400,
        isQuotaError: false,
        isModelNotFound: true,
        error: errorBody,
      };
    }

    if (response.status >= 500) {
      return {
        ok: false,
        status: response.status,
        isQuotaError: false,
        error: errorBody,
      };
    }

    const err = new Error(`Gemini API error ${response.status}: ${errorBody}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();

  if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
    if (data.candidates?.[0]?.finishReason === 'SAFETY') {
      throw new Error('Response blocked by Gemini safety filters. Try rephrasing your prompt.');
    }
    throw new Error('Empty response from Gemini API');
  }

  return {
    ok: true,
    text: data.candidates[0].content.parts[0].text,
    usage: data.usageMetadata || {},
    model: model,
    finishReason: data.candidates[0].finishReason || 'STOP',
  };
}

// ─── MAIN CALL WITH FULL FALLBACK ──────────────────────────────
async function callGemini(prompt, options = {}) {
  const {
    model: preferredModel,
    temperature = 0.7,
    maxOutputTokens = 65536,
    systemInstruction = null,
    retries = MAX_RETRIES,
  } = options;

  let lastError;
  const triedModels = new Set();

  // Get available model list (dynamic discovery or static fallback)
  const availableModels = await discoverAvailableModels();

  // Build the full attempt chain: preferred model first, then discovered models
  let modelChain = [];

  // If user specified a preferred model, try it first
  if (preferredModel && !isModelOnCooldown(preferredModel)) {
    modelChain.push(preferredModel);
  }

  // Add all discovered/static models that aren't on cooldown
  for (const model of availableModels) {
    if (!isModelOnCooldown(model) && !modelChain.includes(model)) {
      modelChain.push(model);
    }
  }

  // If everything is on cooldown, also include exhausted models as last resort
  if (modelChain.length === 0) {
    modelChain = [preferredModel || availableModels[0]];
    // Clear all cooldowns as last resort
    modelQuotaExhausted.clear();
    console.log('All models on cooldown — cleared cooldowns for last-resort attempt');
  }

  console.log(`Model fallback chain (${modelChain.length} models): ${modelChain.slice(0, 5).join(', ')}${modelChain.length > 5 ? '...' : ''}`);

  // Try each model in order
  for (const model of modelChain) {
    if (triedModels.has(model)) continue;
    triedModels.add(model);

    // Try each API key with this model
    for (let attempt = 0; attempt < Math.min(retries, getKeys().length || 1); attempt++) {
      const { key, index } = getKey();

      try {
        const result = await callGeminiWithModel(
          prompt, model, key, systemInstruction, temperature, maxOutputTokens
        );

        if (!result.ok) {
          if (result.isQuotaError) {
            markModelExhausted(model, result.isQuotaZero);
            reportFailure(index);

            console.log(`Model ${model} → 429 (key #${index + 1}), ` +
              `${result.isQuotaZero ? 'FREE TIER LIMIT = 0' : 'rate limited'}. ` +
              `Trying next model...`);

            // Break key loop, try next model
            break;
          }

          if (result.isModelNotFound) {
            console.log(`Model ${model} → NOT FOUND. Skipping permanently.`);
            // Don't retry this model with other keys
            break;
          }

          // Server error — try another key
          reportFailure(index);
          lastError = new Error(`Gemini API error ${result.status}: ${result.error}`);
          continue;
        }

        reportSuccess(index);

        console.log(`Success with model: ${model} (key #${index + 1})`);

        return {
          text: result.text,
          usage: result.usage,
          model: result.model,
          finishReason: result.finishReason,
        };
      } catch (error) {
        lastError = error;
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
  }

  throw lastError || new Error(
    'All Gemini models and API keys exhausted. ' +
    `Tried ${triedModels.size} models. ` +
    'Wait a few minutes and try again, or enable billing at https://ai.google.dev/'
  );
}

// ─── JSON HELPER ───────────────────────────────────────────────
async function callGeminiJSON(prompt, options = {}) {
  const result = await callGemini(prompt, {
    ...options,
    temperature: options.temperature || 0.5,
  });

  let jsonText = result.text;

  // Remove markdown code blocks if present
  const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1];
  }

  try {
    return {
      ...result,
      json: JSON.parse(jsonText.trim()),
    };
  } catch {
    const objectMatch = jsonText.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return {
          ...result,
          json: JSON.parse(objectMatch[0]),
        };
      } catch {
        // Give up
      }
    }
    return {
      ...result,
      json: null,
      rawText: result.text,
    };
  }
}

module.exports = {
  callGemini,
  callGeminiJSON,
  discoverAvailableModels,
  STATIC_MODEL_CHAIN,
};
