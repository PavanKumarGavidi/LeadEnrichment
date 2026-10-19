// netlify/functions/api.js
// Handles login, logout, session, and enrich endpoints on Netlify

const crypto = require('crypto');

// Personal email domains
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com',
  'yandex.com', 'qq.com', '163.com',
]);

// Company cache (in-memory, resets on function cold start)
const companyCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCachedCompany(domain) {
  const entry = companyCache.get(domain);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    companyCache.delete(domain);
    return undefined;
  }
  return entry.data;
}

function setCachedCompany(domain, data) {
  companyCache.set(domain, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// Constant-time password comparison
function secureCompare(input, stored) {
  const inputHash = crypto.createHash('sha256').update(input).digest();
  const storedHash = crypto.createHash('sha256').update(stored).digest();
  if (inputHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(inputHash, storedHash);
}

// Simple session management using a cookie
function getSession(event) {
  const cookie = event.headers.cookie || '';
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString();
    const session = JSON.parse(decoded);
    if (session.expiresAt && Date.now() < session.expiresAt) {
      return session;
    }
  } catch {}
  return null;
}

function setSessionCookie(authed) {
  if (!authed) {
    return 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  }
  const session = {
    authed: true,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
  };
  const encoded = Buffer.from(JSON.stringify(session)).toString('base64');
  return `session=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${8 * 60 * 60}`;
}

function joinLocation(city, state, country) {
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

async function lookupPerson(name, email) {
  const url = 'https://api.apollo.io/api/v1/people/match';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify({ name, email }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 429) throw new Error('RATE_LIMIT');
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error('APOLLO_ERROR');
    }

    const data = await response.json();
    return data.person || null;
  } catch (err) {
    clearTimeout(timeout);
    if (err.message === 'RATE_LIMIT') throw err;
    return null;
  }
}

async function lookupCompany(domain) {
  const url = `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': process.env.APOLLO_API_KEY,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 429) throw new Error('RATE_LIMIT');
    if (!response.ok) {
      if (response.status === 404) return null;
      return null;
    }

    const data = await response.json();
    return data.organization || null;
  } catch (err) {
    clearTimeout(timeout);
    if (err.message === 'RATE_LIMIT') throw err;
    return null;
  }
}

exports.handler = async (event) => {
  const path = event.path.replace('/.netlify/functions/api', '').replace('/api', '');
  const method = event.httpMethod;
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  
  // Session check
  if (path === '/session' && method === 'GET') {
    const session = getSession(event);
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ authed: !!session?.authed }),
    };
  }
  
  // Login
  if (path === '/login' && method === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const password = body.password;
    
    if (!password || !secureCompare(password, process.env.TEAM_PASSWORD || '')) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid password' }),
      };
    }
    
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Set-Cookie': setSessionCookie(true),
      },
      body: JSON.stringify({ authed: true }),
    };
  }
  
  // Logout
  if (path === '/logout' && method === 'POST') {
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Set-Cookie': setSessionCookie(false),
      },
      body: JSON.stringify({ authed: false }),
    };
  }
  
  // Enrich
  if (path === '/enrich' && method === 'POST') {
    const session = getSession(event);
    if (!session?.authed) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Not authenticated' }),
      };
    }
    
    try {
      const body = JSON.parse(event.body || '{}');
      const { name, email } = body;
      
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Name is required' }),
        };
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Valid email required' }),
        };
      }
      
      const domain = email.split('@')[1].toLowerCase();
      
      if (PERSONAL_DOMAINS.has(domain)) {
        return {
          statusCode: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Personal email addresses not supported' }),
        };
      }
      
      const cachedCompany = getCachedCompany(domain);
      const [personResult, companyResult] = await Promise.all([
        lookupPerson(name.trim(), email.trim()),
        cachedCompany !== undefined ? Promise.resolve(cachedCompany) : lookupCompany(domain),
      ]);
      
      if (cachedCompany === undefined && companyResult !== null) {
        setCachedCompany(domain, companyResult);
      }
      
      let person = personResult;
      let company = companyResult;
      
      if (!company && person?.organization) {
        company = person.organization;
      }
      
      const response = {
        input: { name: name.trim(), email: email.trim(), domain },
        person: person ? {
          name: person.name || null,
          title: person.title || null,
          seniority: person.seniority || null,
          linkedin: person.linkedin_url || null,
          location: joinLocation(person.city, person.state, person.country),
        } : null,
        company: company ? {
          name: company.name || null,
          website: company.website_url || null,
          industry: company.industry || null,
          employees: company.estimated_num_employees?.toLocaleString('en-US') || null,
          revenue: company.annual_revenue_printed || null,
          revenueValue: company.annual_revenue || null,
          linkedin: company.linkedin_url || null,
          location: joinLocation(company.city, company.state, company.country),
        } : null,
        matched: { person: !!person, company: !!company },
      };
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      };
    } catch (err) {
      if (err.message === 'RATE_LIMIT') {
        return {
          statusCode: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Rate limit reached' }),
        };
      }
      return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Internal error' }),
      };
    }
  }
  
  return {
    statusCode: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Not found' }),
  };
};
