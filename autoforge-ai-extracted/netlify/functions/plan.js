// Plan function — Stage 1: Generates 100+ task plan
// CommonJS syntax for Netlify Functions compatibility

const { callGeminiJSON } = require('./_utils/gemini');
const { checkRateLimit, getClientIP } = require('./_utils/rate-limiter');
const { PLANNER_SYSTEM } = require('./_utils/prompts');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ip = getClientIP(event);
  const rateCheck = checkRateLimit(ip);

  if (!rateCheck.allowed) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders(), 'X-RateLimit-Limit': String(rateCheck.limit), 'X-RateLimit-Remaining': '0' },
      body: JSON.stringify({
        error: 'Daily limit exceeded. Try again tomorrow.',
        remaining: 0,
        resetAt: rateCheck.resetAt,
      }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { prompt, techStack, complexity } = body;

    if (!prompt || prompt.trim().length < 5) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Prompt must be at least 5 characters.' }),
      };
    }

    const userPrompt = `Create a comprehensive project plan for the following:

PROJECT: ${prompt}
${techStack ? `PREFERRED TECH STACK: ${techStack}` : ''}
${complexity ? `COMPLEXITY LEVEL: ${complexity}` : ''}

Generate at least 100 granular tasks organized into phases. Be extremely detailed and thorough.`;

    const result = await callGeminiJSON(userPrompt, {
      systemInstruction: PLANNER_SYSTEM,
      temperature: 0.6,
      maxOutputTokens: 65536,
    });

    if (!result.json) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Failed to parse plan. Please try again.', raw: result.rawText?.substring(0, 500) }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        'X-RateLimit-Limit': String(rateCheck.limit),
        'X-RateLimit-Remaining': String(rateCheck.remaining),
      },
      body: JSON.stringify({
        plan: result.json,
        usage: result.usage,
        model: result.model,
      }),
    };
  } catch (error) {
    console.error('Plan function error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
