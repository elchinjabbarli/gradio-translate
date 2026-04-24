// Build function — Stage 2: Generates complete code
// CommonJS syntax for Netlify Functions compatibility

const { callGeminiJSON } = require('./_utils/gemini');
const { checkRateLimit, getClientIP } = require('./_utils/rate-limiter');
const { BUILDER_SYSTEM } = require('./_utils/prompts');

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
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ip = getClientIP(event);
  const rateCheck = checkRateLimit(ip);

  if (!rateCheck.allowed) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders(), 'X-RateLimit-Remaining': '0' },
      body: JSON.stringify({ error: 'Daily limit exceeded.', remaining: 0, resetAt: rateCheck.resetAt }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { plan, prompt, fileFilter } = body;

    if (!plan && !prompt) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Plan or prompt is required.' }),
      };
    }

    const planSummary = plan
      ? `PROJECT: ${plan.projectName || 'Unknown'}
DESCRIPTION: ${plan.description || ''}
TECH STACK: ${Array.isArray(plan.techStack) ? plan.techStack.join(', ') : (typeof plan.techStack === 'string' ? plan.techStack : 'Not specified')}

FILE STRUCTURE:
${Object.entries(plan.fileStructure || {}).map(([f, d]) => `  ${f} — ${d}`).join('\n')}

TASKS TO IMPLEMENT:
${(plan.phases || []).flatMap(p => (p.tasks || []).map(t => `  [${t.id}] ${t.title}: ${t.description}`)).join('\n')}
${fileFilter ? `\nFOCUS ON THESE FILES: ${fileFilter.join(', ')}` : ''}`
      : prompt;

    const userPrompt = `Based on this project plan, generate COMPLETE, WORKING code for ALL files:

${planSummary}

Generate every single file needed. No placeholders. No TODOs. Complete, production-ready code.`;

    const result = await callGeminiJSON(userPrompt, {
      systemInstruction: BUILDER_SYSTEM,
      temperature: 0.4,
      maxOutputTokens: 65536,
    });

    if (!result.json) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Failed to parse build output. Please try again.', raw: result.rawText?.substring(0, 500) }),
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
        build: result.json,
        usage: result.usage,
        model: result.model,
      }),
    };
  } catch (error) {
    console.error('Build function error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
