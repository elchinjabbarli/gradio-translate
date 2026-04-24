// Packager function — Stage 4: Deploy-ready packaging
// CommonJS syntax for Netlify Functions compatibility

const { callGeminiJSON } = require('./_utils/gemini');
const { checkRateLimit, getClientIP } = require('./_utils/rate-limiter');
const { PACKAGER_SYSTEM } = require('./_utils/prompts');

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
    const { files, projectName, techStack, testResults } = body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Files array is required.' }),
      };
    }

    const filesSummary = files.map(f => `
=== FILE: ${f.path} ===
${f.content}
`).join('\n');

    const testSummary = testResults
      ? `\nTEST RESULTS:\nIterations run: ${testResults.iterations || 'N/A'}\nFinal score: ${testResults.finalScore || 'N/A'}\nIssues found: ${testResults.totalIssues || 0}\nCritical issues: ${testResults.criticalIssues || 0}`
      : '';

    const userPrompt = `Package this project for deployment:

PROJECT: ${projectName || 'Generated Project'}
TECH STACK: ${Array.isArray(techStack) ? techStack.join(', ') : (typeof techStack === 'string' ? techStack : 'Not specified')}

${filesSummary}
${testSummary}

Ensure this project is fully deployable. Add any missing deployment files, configuration, documentation, and verify everything is in order.`;

    const result = await callGeminiJSON(userPrompt, {
      systemInstruction: PACKAGER_SYSTEM,
      temperature: 0.3,
      maxOutputTokens: 65536,
    });

    if (!result.json) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Failed to parse package output.', raw: result.rawText?.substring(0, 500) }),
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
        package: result.json,
        usage: result.usage,
        model: result.model,
      }),
    };
  } catch (error) {
    console.error('Package function error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
