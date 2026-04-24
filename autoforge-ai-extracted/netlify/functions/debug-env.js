// Debug function to check environment variable availability
// CommonJS syntax for Netlify Functions compatibility

exports.handler = async (event) => {
  const allEnvKeys = Object.keys(process.env).sort();
  const geminiKeys = allEnvKeys.filter(k => k.startsWith('GEMINI'));
  const netlifyKeys = allEnvKeys.filter(k => k.startsWith('NETLIFY') || k.startsWith('REACT_APP'));

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Environment Debug Info',
      geminiKeys: geminiKeys,
      geminiKeyCount: geminiKeys.length,
      allEnvKeyCount: allEnvKeys.length,
      sampleEnvKeys: allEnvKeys.slice(0, 30),
      netlifyKeys: netlifyKeys,
      nodeVersion: process.version,
      // Show first 6 chars + last 4 chars of each GEMINI key value (for verification, not full key)
      geminiKeyPreviews: geminiKeys.reduce((acc, k) => {
        const val = process.env[k];
        acc[k] = val ? `${val.substring(0, 6)}...${val.substring(val.length - 4)}` : 'UNDEFINED';
        return acc;
      }, {}),
    }, null, 2),
  };
};
