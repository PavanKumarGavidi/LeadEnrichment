// netlify/functions/enrich.js
// Serverless function that proxies requests to Enrichloops API
// This avoids CORS issues entirely since it runs server-side

const ENRICHLOOPS_API_KEY = process.env.ENRICHLOOPS_API_KEY || 'ek_8d4895a40ac852a80d4a511a2a9e8c3adffe7e8e4c62b964';
const ENRICHLOOPS_BASE_URL = 'https://api.enrichloops.com/v1';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

async function enrichloopsRequest(endpoint, body) {
  const res = await fetch(`${ENRICHLOOPS_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ENRICHLOOPS_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Enrichloops API error ${res.status}: ${text.substring(0, 200)}`);
  }

  return await res.json();
}

async function pollTask(taskId, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${ENRICHLOOPS_BASE_URL}/tasks/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${ENRICHLOOPS_API_KEY}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Task poll failed: ${res.status}`);
    }

    const data = await res.json();

    if (data.task?.status === 'succeeded') {
      return data;
    }

    if (data.task?.status === 'failed') {
      const err = new Error(data.error?.message || 'Enrichment failed');
      err.code = data.error?.code || 'failed';
      throw err;
    }

    // Wait 2 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('Task polling timeout');
}

async function enrichCompany(domain) {
  try {
    const response = await enrichloopsRequest('/companies/enrich', { domain });

    if (response.task?.status === 'succeeded') {
      return response.data;
    }

    if (response.task?.id) {
      const result = await pollTask(response.task.id);
      return result.data;
    }

    return null;
  } catch (err) {
    console.error('Company enrichment error:', err.message);
    return null;
  }
}

async function enrichPerson(email, fullName) {
  try {
    const body = { email };
    if (fullName) body.fullName = fullName;

    const response = await enrichloopsRequest('/people/enrich', body);

    if (response.task?.status === 'succeeded') {
      return response.data;
    }

    if (response.task?.id) {
      const result = await pollTask(response.task.id);
      return result.data;
    }

    return null;
  } catch (err) {
    console.error('Person enrichment error:', err.message);
    return null;
  }
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { name, email, domain } = JSON.parse(event.body || '{}');

    if (!email && !domain) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email or domain required' }),
      };
    }

    const extractedDomain = email ? email.split('@')[1]?.toLowerCase() : domain;

    // Run both enrichments in parallel
    const [personData, companyData] = await Promise.all([
      email ? enrichPerson(email, name) : Promise.resolve(null),
      extractedDomain ? enrichCompany(extractedDomain) : Promise.resolve(null),
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        person: personData,
        company: companyData,
        input: { name, email, domain: extractedDomain },
      }),
    };
  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Internal error' }),
    };
  }
};
