import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Configuration ───────────────────────────────────────────────────────────
const APOLLO_API_KEY = 'UhKB7c0hM4t2Ep1ihvRBRg';
const TEAM_PASSWORD = 'demo123';

// CORS proxy to allow browser → Apollo API calls
// Apollo blocks direct browser requests (CORS), so we route through a proxy
const CORS_PROXY = 'https://corsproxy.io/?url=';

// ─── Personal/free email domains ─────────────────────────────────────────────
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com',
  'yandex.com', 'qq.com', '163.com',
]);

// ─── Company cache (24h TTL) ─────────────────────────────────────────────────
const companyCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCachedCompany(domain: string) {
  const entry = companyCache.get(domain);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    companyCache.delete(domain);
    return undefined;
  }
  return entry.data;
}

function setCachedCompany(domain: string, data: any) {
  companyCache.set(domain, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface PersonData {
  name: string | null;
  title: string | null;
  seniority: string | null;
  linkedin: string | null;
  location: string | null;
}

interface CompanyData {
  name: string | null;
  website: string | null;
  industry: string | null;
  employees: string | null;
  revenue: string | null;
  revenueValue: number | null;
  linkedin: string | null;
  location: string | null;
}

interface MatchedFlags {
  person: boolean;
  company: boolean;
}

interface EnrichResult {
  input: { name: string; email: string; domain: string };
  person: PersonData | null;
  company: CompanyData | null;
  matched: MatchedFlags;
}

// ─── Apollo API helpers (via CORS proxy) ─────────────────────────────────────
async function apolloFetch(url: string, options: RequestInit) {
  // Try backend first (if server.js is running)
  try {
    const backendUrl = url.replace('https://api.apollo.io', '/api/apollo-proxy');
    const res = await fetch(backendUrl, {
      ...options,
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok || res.status === 404 || res.status === 429) {
      return res;
    }
  } catch {
    // Backend not available, use CORS proxy
  }

  // Fallback: use CORS proxy
  const proxyUrl = CORS_PROXY + encodeURIComponent(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(proxyUrl, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('TIMEOUT');
    }
    throw new Error('NETWORK_ERROR');
  }
}

async function lookupPerson(name: string, email: string) {
  const url = 'https://api.apollo.io/api/v1/people/match';

  try {
    const response = await apolloFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': APOLLO_API_KEY,
      },
      body: JSON.stringify({ name, email }),
    });

    if (response.status === 429) {
      throw new Error('RATE_LIMIT');
    }

    if (!response.ok) {
      if (response.status === 404) return null;
      const text = await response.text().catch(() => '');
      console.error('Apollo person error:', response.status, text);
      throw new Error('APOLLO_ERROR');
    }

    const data = await response.json();
    return data.person || null;
  } catch (err: any) {
    if (err.message === 'RATE_LIMIT') throw err;
    if (err.message === 'TIMEOUT' || err.message === 'NETWORK_ERROR') throw err;
    return null;
  }
}

async function lookupCompany(domain: string) {
  const url = `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`;

  try {
    const response = await apolloFetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': APOLLO_API_KEY,
      },
    });

    if (response.status === 429) {
      throw new Error('RATE_LIMIT');
    }

    if (!response.ok) {
      if (response.status === 404) return null;
      const text = await response.text().catch(() => '');
      console.error('Apollo company error:', response.status, text);
      return null; // failure-tolerant
    }

    const data = await response.json();
    return data.organization || null;
  } catch (err: any) {
    if (err.message === 'RATE_LIMIT') throw err;
    if (err.message === 'TIMEOUT' || err.message === 'NETWORK_ERROR') throw err;
    return null; // failure-tolerant
  }
}

function joinLocation(city: string, state: string, country: string) {
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ─── Login View ──────────────────────────────────────────────────────────────
function LoginView({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        onLogin();
        return;
      }
      const data = await res.json();
      setError(data.error || 'Invalid password');
    } catch {
      // No backend — check password client-side
      if (password === TEAM_PASSWORD) {
        onLogin();
      } else {
        setError('Invalid password');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white border border-[--color-border] rounded-lg p-8">
          <h1 className="text-xl font-semibold text-center mb-1 text-[--color-teal]">
            Lead lookup
          </h1>
          <p className="text-xs text-center text-[--color-muted] mb-6">Sales lead enrichment tool</p>
          <form onSubmit={handleSubmit}>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Team password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-[--color-border] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[--color-teal] focus:border-transparent"
              placeholder="Enter team password"
              autoFocus
              required
            />
            {error && (
              <p className="mt-2 text-sm text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 px-4 py-2 bg-[--color-teal] text-white text-sm font-medium rounded-md hover:bg-[--color-teal-light] focus:outline-none focus:ring-2 focus:ring-[--color-teal] focus:ring-offset-2 disabled:opacity-60 cursor-pointer"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Result field component ──────────────────────────────────────────────────
function FieldRow({ label, value, link }: { label: string; value: string | null; link?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline py-2 border-b border-gray-100 last:border-b-0">
      <span className="text-xs font-medium text-[--color-muted] uppercase tracking-wide sm:w-28 shrink-0">
        {label}
      </span>
      <span className="text-sm text-gray-900 mt-0.5 sm:mt-0">
        {value ? (
          link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[--color-teal] hover:underline focus:outline-none focus:ring-2 focus:ring-[--color-teal] rounded"
            >
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="italic text-[--color-muted]">Not found</span>
        )}
      </span>
    </div>
  );
}

// ─── App View ────────────────────────────────────────────────────────────────
function AppView({ onLogout }: { onLogout: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setDebugInfo('');
    setLoading(true);
    setResult(null);

    // Validate input
    if (!name.trim()) {
      setError('Name is required');
      setLoading(false);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('A valid email address is required');
      setLoading(false);
      return;
    }

    const domain = email.split('@')[1].toLowerCase();

    // Check personal domain
    if (PERSONAL_DOMAINS.has(domain)) {
      setError('Personal email addresses (Gmail, Yahoo, etc.) are not supported. Please provide a work email address.');
      setLoading(false);
      return;
    }

    try {
      setDebugInfo('Connecting to Apollo API…');

      // Check cache
      const cachedCompany = getCachedCompany(domain);

      // Parallel lookups
      const personPromise = lookupPerson(name.trim(), email.trim());
      const companyPromise = cachedCompany !== undefined
        ? Promise.resolve(cachedCompany)
        : lookupCompany(domain);

      setDebugInfo('Fetching person and company data…');

      const [personResult, companyResult] = await Promise.all([
        personPromise,
        companyPromise,
      ]);

      // Cache company result
      if (cachedCompany === undefined && companyResult !== null) {
        setCachedCompany(domain, companyResult);
      }

      let person = personResult;
      let company = companyResult;

      // Fallback: use person.organization if company lookup returned nothing
      if (!company && person && person.organization) {
        company = person.organization;
      }

      setDebugInfo('');

      // Build response
      const response: EnrichResult = {
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

      setResult(response);
    } catch (err: any) {
      setDebugInfo('');
      if (err.message === 'RATE_LIMIT') {
        setError('Rate limit reached on Apollo API. Please wait a moment and try again.');
      } else if (err.message === 'TIMEOUT') {
        setError('Request timed out. The enrichment service may be slow. Please try again.');
      } else if (err.message === 'NETWORK_ERROR') {
        setError('Network error — could not reach the enrichment service. Please check your connection and try again.');
      } else {
        setError('Could not retrieve data. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = useCallback(() => {
    if (!result) return;
    const lines: string[] = [];
    lines.push(`Name: ${result.input.name}`);
    lines.push(`Email: ${result.input.email}`);
    if (result.person) {
      if (result.person.title) lines.push(`Title: ${result.person.title}`);
      if (result.person.linkedin) lines.push(`LinkedIn: ${result.person.linkedin}`);
    }
    if (result.company) {
      if (result.company.name) lines.push(`Company: ${result.company.name}`);
      if (result.company.employees) lines.push(`Employees: ${result.company.employees}`);
      if (result.company.revenue) lines.push(`Revenue: ${result.company.revenue} (est.)`);
    }
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch { /* ignore */ }
    onLogout();
  };

  const getWarning = () => {
    if (!result) return null;
    if (!result.matched.person && !result.matched.company) {
      return 'No match found for this lead.';
    }
    if (result.matched.company && !result.matched.person) {
      return 'Company found, but no person match.';
    }
    if (result.matched.person && !result.matched.company) {
      return 'Person found, but no company data.';
    }
    return null;
  };

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-[--color-border] px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold text-[--color-teal]">Lead lookup</h1>
          <button
            onClick={handleLogout}
            className="text-sm text-[--color-muted] hover:text-[--color-teal] focus:outline-none focus:ring-2 focus:ring-[--color-teal] rounded px-2 py-1 cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-80 shrink-0">
            <div className="bg-white border border-[--color-border] rounded-lg p-5">
              <form onSubmit={handleLookup}>
                <div className="mb-4">
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                    Full name
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-[--color-border] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[--color-teal] focus:border-transparent"
                    placeholder="e.g. Satya Nadella"
                    required
                  />
                </div>
                <div className="mb-4">
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                    Work email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-[--color-border] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[--color-teal] focus:border-transparent"
                    placeholder="e.g. satya@microsoft.com"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-[--color-teal] text-white text-sm font-medium rounded-md hover:bg-[--color-teal-light] focus:outline-none focus:ring-2 focus:ring-[--color-teal] focus:ring-offset-2 disabled:opacity-60 cursor-pointer"
                >
                  {loading ? 'Looking up…' : 'Look up lead'}
                </button>
                <p className="mt-3 text-xs text-[--color-muted]">
                  Personal addresses like Gmail are skipped to save credits.
                </p>
              </form>
            </div>
          </div>

          <div className={`flex-1 ${loading ? 'opacity-50' : ''}`}>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-700 font-medium">Error</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            )}

            {debugInfo && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-700">{debugInfo}</p>
              </div>
            )}

            {result && (
              <div className="bg-white border border-[--color-border] rounded-lg">
                <div className="px-5 py-4 border-b border-[--color-border] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {result.input.name}
                    </h2>
                    <p className="text-sm text-[--color-muted]">{result.input.email}</p>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="text-xs font-medium text-[--color-teal] hover:text-[--color-teal-light] border border-[--color-teal] rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[--color-teal] cursor-pointer self-start sm:self-auto"
                  >
                    {copied ? 'Copied' : 'Copy as text'}
                  </button>
                </div>

                {getWarning() && (
                  <div className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-md px-4 py-2.5">
                    <p className="text-sm text-amber-800">{getWarning()}</p>
                  </div>
                )}

                <div className="px-5 py-4">
                  <h3 className="text-xs font-semibold text-[--color-muted] uppercase tracking-wider mb-2">
                    Person
                  </h3>
                  <FieldRow label="Title" value={result.person?.title || null} />
                  <FieldRow label="Seniority" value={result.person?.seniority || null} />
                  <FieldRow
                    label="LinkedIn"
                    value={result.person?.linkedin ? 'View profile' : null}
                    link={result.person?.linkedin || undefined}
                  />
                  <FieldRow label="Location" value={result.person?.location || null} />
                </div>

                <div className="px-5 py-4 border-t border-[--color-border]">
                  <h3 className="text-xs font-semibold text-[--color-muted] uppercase tracking-wider mb-2">
                    Company
                  </h3>
                  <FieldRow label="Name" value={result.company?.name || null} />
                  <FieldRow
                    label="Website"
                    value={result.company?.website ? result.company.website : null}
                    link={result.company?.website || undefined}
                  />
                  <FieldRow label="Industry" value={result.company?.industry || null} />
                  <FieldRow
                    label="Employees"
                    value={result.company?.employees || null}
                  />
                  <FieldRow
                    label="Revenue (est.)"
                    value={result.company?.revenue || null}
                  />
                  <FieldRow label="Location" value={result.company?.location || null} />
                </div>
              </div>
            )}

            {!result && !loading && !error && (
              <div className="bg-white border border-[--color-border] rounded-lg p-8 text-center">
                <p className="text-sm text-[--color-muted]">
                  Enter a lead's name and work email to look up their information.
                </p>
              </div>
            )}

            {loading && !result && (
              <div className="bg-white border border-[--color-border] rounded-lg p-8 text-center">
                <p className="text-sm text-[--color-muted]">Looking up lead information…</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/session', { signal: AbortSignal.timeout(3000) })
      .then(res => res.json())
      .then(data => setAuthed(data.authed === true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-[--color-muted]">Loading…</p>
      </div>
    );
  }

  if (!authed) {
    return <LoginView onLogin={() => setAuthed(true)} />;
  }

  return <AppView onLogout={() => setAuthed(false)} />;
}
