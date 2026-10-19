// netlify/functions/apollo-proxy.js
// Proxies Apollo API calls to avoid CORS issues

exports.handler = async (event) => {
  // Get the Apollo API path from query parameter
  const apolloPath = event.queryStringParameters?.path || '';
  
  // Preserve any query parameters from the original request
  const originalQuery = event.rawQuery || '';
  const apolloUrl = `https://api.apollo.io/${apolloPath}${originalQuery ? '?' + originalQuery : ''}`;
  
  // Get API key from environment
  const apiKey = process.env.APOLLO_API_KEY;
  
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured' })
    };
  }
  
  try {
    // Forward the request to Apollo
    const response = await fetch(apolloUrl, {
      method: event.httpMethod,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey,
      },
      body: event.body,
    });
    
    const data = await response.text();
    
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: data,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Proxy error', message: error.message })
    };
  }
};
