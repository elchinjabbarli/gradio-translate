// Status / health check endpoint
// CommonJS syntax for Netlify Functions compatibility

const { getKeyCount, getDebugInfo } = require('./_utils/key-manager');
const { discoverAvailableModels, STATIC_MODEL_CHAIN } = require('./_utils/gemini');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const debug = getDebugInfo();

  // Discover available models dynamically
  let availableModels = [];
  let discoveryError = null;
  try {
    availableModels = await discoverAvailableModels();
  } catch (err) {
    discoveryError = err.message;
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      status: 'online',
      version: '1.1.0',
      apiKeysConfigured: getKeyCount(),
      models: {
        discovered: availableModels.length,
        discoveryError,
        top5: availableModels.slice(0, 5),
        staticFallbackCount: STATIC_MODEL_CHAIN.length,
      },
      debug: {
        envVarNames: debug.envVarNames,
        envVarCount: debug.envVarCount,
      },
      pipeline: {
        stages: ['plan', 'build', 'test', 'packager'],
        maxTestIterations: 10,
      },
      rateLimit: {
        dailyLimit: 30,
      },
    }, null, 2),
  };
};
