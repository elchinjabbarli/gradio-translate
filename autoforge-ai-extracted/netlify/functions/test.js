// Test function — Stage 3: 10-iteration debug loop
// CommonJS syntax for Netlify Functions compatibility

const { callGeminiJSON } = require('./_utils/gemini');
const { checkRateLimit, getClientIP } = require('./_utils/rate-limiter');
const { TESTER_SYSTEM } = require('./_utils/prompts');

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
    const { files, iteration = 1, previousIssues = [] } = body;

    // Validate and limit iteration count to prevent DoS (max 10 iterations)
    const safeIteration = Math.max(1, Math.min(10, parseInt(iteration, 10) || 1));

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

    const previousContext = previousIssues.length > 0
      ? `\nPREVIOUS ISSUES FOUND (iteration ${safeIteration - 1}):\n${previousIssues.map(i => `- [${i.severity}] ${i.file}: ${i.title}`).join('\n')}\n\nCheck if these were properly fixed. Look for NEW issues.`
      : '';

    const userPrompt = `Perform deep code review iteration #${safeIteration} on this project:

${filesSummary}
${previousContext}

This is iteration ${safeIteration} of 10. Be extremely thorough. Check every file for bugs, security issues, missing error handling, performance problems, accessibility, and best practices.${safeIteration > 1 ? ' Focus on finding NEW issues that previous iterations missed. Also verify that previously found issues were properly fixed.' : ''}`;

    const result = await callGeminiJSON(userPrompt, {
      systemInstruction: TESTER_SYSTEM,
      temperature: 0.3,
      maxOutputTokens: 65536,
    });

    if (!result.json) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Failed to parse test output.', raw: result.rawText?.substring(0, 500) }),
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
        test: result.json,
        usage: result.usage,
        model: result.model,
      }),
    };
  } catch (error) {
    console.error('Test function error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
