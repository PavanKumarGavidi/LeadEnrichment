import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Validate required env vars ──────────────────────────────────────────────
const requiredVars = ['APOLLO_API_KEY', 'TEAM_PASSWORD', 'SESSION_SECRET'];
const missing = requiredVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`\n✗ Missing required environment variables: ${missing.join(', ')}`);
  console.error('  Copy .env.example to .env and fill in the values.\n');
  process.exit(1);
}

const {
  APOLLO_API_KEY,
  TEAM_PASSWORD,
  SESSION_SECRET,
  PORT = 3000,
  SECURE_COOKIES = 'false',
} = process.env;

// ─── Personal/free email domains ─────────────────────────────────────────────
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com',
  'yandex.com', 'qq.com', '163.com',
]);

// ─── Company cache (24h TTL) ─────────────────────────────────────────────────
const companyCache = new Map(); // domain -> { data, expiresAt }
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

// ─── Constant-time password comparison ────────────────────────────────────────
function secureCompare(input, stored) {
  const inputHash = crypto.createHash('sha256').update(input).digest();
  const storedHash = crypto.createHash('sha256').update(stored).digest();
  if (inputHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(inputHash, storedHash);
}

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);

// Body parser with 10kb limit
app.use(express.json({ limit: '10kb' }));

// Session
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: SECURE_COOKIES === 'true',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

// ─── Rate limiters ───────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

const enrichLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
});

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.authed) {
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

// ─── API routes ──────────────────────────────────────────────────────────────

// Session check
app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// Login
app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required' });
  }
  if (secureCompare(password, TEAM_PASSWORD)) {
    req.session.authed = true;
    return res.json({ authed: true });
  }
  return res.status(401).json({ error: 'Invalid password' });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.clearCookie('connect.sid');
    return res.json({ authed: false });
  });
});

// Enrich
app.post('/api/enrich', requireAuth, enrichLimiter, async (req, res) => {
  try {
    const { name, email } = req.body || {};

    // Validate input
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required and must be non-empty' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    // Extract domain
    const domain = email.split('@')[1].toLowerCase();

    // Check personal domain
    if (PERSONAL_DOMAINS.has(domain)) {
      return res.status(422).json({
        error: 'Personal email addresses (Gmail, Yahoo, etc.) are not supported. Please provide a work email address.',
      });
    }

    // Check company cache
    const cachedCompany = getCachedCompany(domain);

    // Parallel lookups
    const personPromise = lookupPerson(name.trim(), email.trim());
    const companyPromise = cachedCompany !== undefined
      ? Promise.resolve(cachedCompany)
      : lookupCompany(domain);

    const [personResult, companyResult] = await Promise.all([
      personPromise,
      companyPromise,
    ]);

    // Cache company result if not from cache
    if (cachedCompany === undefined && companyResult !== null) {
      setCachedCompany(domain, companyResult);
    }

    // Build response
    const person = personResult;
    let company = companyResult;

    // Fallback: use person.organization if company lookup returned nothing
    if (!company && person && person._orgFallback) {
      company = person._orgFallback;
    }

    // Clean up internal fields
    if (person) {
      delete person._orgFallback;
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
        employees: company.estimated_num_employees
          ? company.estimated_num_employees.toLocaleString('en-US')
          : null,
        revenue: company.annual_revenue_printed || null,
        revenueValue: company.annual_revenue || null,
        linkedin: company.linkedin_url || null,
        location: joinLocation(company.city, company.state, company.country),
      } : null,
      matched: {
        person: !!person,
        company: !!company,
      },
    };

    return res.json(response);
  } catch (err) {
    // Handle Apollo-specific errors
    if (err.message === 'RATE_LIMIT' || err.status === 429) {
      return res.status(429).json({ error: 'Rate limit reached. Please try again shortly.' });
    }
    if (err.message === 'APOLLO_ERROR' || err.message === 'APOLLO_TIMEOUT') {
      return res.status(502).json({ error: 'Could not retrieve data from the enrichment service. Please try again.' });
    }
    console.error('Enrichment error:', err);
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// ─── Apollo API helpers ──────────────────────────────────────────────────────

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
        'x-api-key': APOLLO_API_KEY,
      },
      body: JSON.stringify({ name, email }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 429) {
      const err = new Error('RATE_LIMIT');
      err.status = 429;
      throw err;
    }

    if (!response.ok) {
      const err = new Error('APOLLO_ERROR');
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const person = data.person;
    if (!person) return null;

    // Extract organization fallback
    if (data.person && data.person.organization) {
      person._orgFallback = {
        name: data.person.organization.name || null,
        website_url: data.person.organization.website_url || null,
        industry: data.person.organization.industry || null,
        estimated_num_employees: data.person.organization.estimated_num_employees || null,
        annual_revenue_printed: data.person.organization.annual_revenue_printed || null,
        annual_revenue: data.person.organization.annual_revenue || null,
        linkedin_url: data.person.organization.linkedin_url || null,
        city: data.person.organization.city || null,
        state: data.person.organization.state || null,
        country: data.person.organization.country || null,
      };
    }

    return person;
  } catch (err) {
    clearTimeout(timeout);
    if (err.message === 'RATE_LIMIT') throw err;
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('APOLLO_TIMEOUT'), { status: 504 });
    }
    // Person not found is not an error
    if (err.status === 404) return null;
    throw err;
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
        'x-api-key': APOLLO_API_KEY,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 429) {
      const err = new Error('RATE_LIMIT');
      err.status = 429;
      throw err;
    }

    if (!response.ok) {
      // Company not found is not an error
      if (response.status === 404) return null;
      const err = new Error('APOLLO_ERROR');
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    return data.organization || null;
  } catch (err) {
    clearTimeout(timeout);
    if (err.message === 'RATE_LIMIT') throw err;
    if (err.name === 'AbortError') {
      // Timeout - return null (failure-tolerant)
      return null;
    }
    // Company lookup is failure-tolerant
    console.error('Company lookup error:', err.message);
    return null;
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function joinLocation(city, state, country) {
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ─── Apollo proxy (for when backend is running) ──────────────────────────────
// This lets the frontend call Apollo through the backend, avoiding CORS issues
app.all('/api/apollo-proxy/*', requireAuth, async (req, res) => {
  try {
    const apolloPath = req.params[0] || '';
    const targetUrl = `https://api.apollo.io/${apolloPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': APOLLO_API_KEY,
      },
      signal: controller.signal,
    };

    if (req.method === 'POST' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeout);

    const data = await response.text();
    res.status(response.status);
    res.set('Content-Type', 'application/json');
    res.send(data);
  } catch (err) {
    console.error('Apollo proxy error:', err.message);
    res.status(502).json({ error: 'Could not reach Apollo API' });
  }
});

// ─── Serve static files ──────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ─── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✓ Lead Lookup running on http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
