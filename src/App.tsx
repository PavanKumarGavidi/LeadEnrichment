import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Configuration ───────────────────────────────────────────────────────────
const ENRICHLOOPS_API_KEY = 'ek_8d4895a40ac852a80d4a511a2a9e8c3adffe7e8e4c62b964';
const ENRICHLOOPS_BASE_URL = 'https://api.enrichloops.com/v1';
const TEAM_PASSWORD = 'demo123';

// CORS proxies to try (Enrichloops blocks direct browser requests)
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://cors.isomorphic-git.org/${url}`,
];

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
  avatar: string | null;
  github: string | null;
  headline: string | null;
}

interface CompanyData {
  name: string | null;
  website: string | null;
  industry: string | null;
  employees: string | null;
  employeeRange: string | null;
  linkedin: string | null;
  location: string | null;
  logo: string | null;
  description: string | null;
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
  sources: string[];
}

interface DebugLog {
  timestamp: string;
  message: string;
  details?: string;
}

// ─── CORS-friendly fetch ─────────────────────────────────────────────────────
async function fetchWithCorsProxy(
  url: string,
  options: RequestInit,
  addDebug: (log: DebugLog) => void
): Promise<Response> {
  // First try direct (in case CORS is allowed)
  try {
    const directRes = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(8000),
    });
    addDebug({ timestamp: new Date().toISOString(), message: 'Direct request succeeded', details: `Status: ${directRes.status}` });
    return directRes;
  } catch (err: any) {
    addDebug({ timestamp: new Date().toISOString(), message: 'Direct request failed (CORS?)', details: err.message });
  }

  // Try each CORS proxy
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyFn = CORS_PROXIES[i];
    const proxyUrl = proxyFn(url);
    addDebug({ timestamp: new Date().toISOString(), message: `Trying proxy ${i + 1}/${CORS_PROXIES.length}`, details: proxyUrl.substring(0, 100) });

    try {
      const res = await fetch(proxyUrl, {
        ...options,
        signal: AbortSignal.timeout(15000),
      });
      addDebug({ timestamp: new Date().toISOString(), message: `Proxy ${i + 1} responded`, details: `Status: ${res.status}` });
      return res;
    } catch (err: any) {
      addDebug({ timestamp: new Date().toISOString(), message: `Proxy ${i + 1} failed`, details: err.message });
      if (i === CORS_PROXIES.length - 1) {
        throw new Error('ALL_PROXIES_FAILED');
      }
    }
  }

  throw new Error('ALL_PROXIES_FAILED');
}

// ─── Enrichloops API helpers ─────────────────────────────────────────────────
async function enrichloopsRequest(
  endpoint: string,
  body: any,
  addDebug: (log: DebugLog) => void
): Promise<any> {
  const url = `${ENRICHLOOPS_BASE_URL}${endpoint}`;
  addDebug({ timestamp: new Date().toISOString(), message: `POST ${endpoint}`, details: JSON.stringify(body) });

  const res = await fetchWithCorsProxy(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ENRICHLOOPS_API_KEY}`,
    },
    body: JSON.stringify(body),
  }, addDebug);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    addDebug({ timestamp: new Date().toISOString(), message: `API error ${res.status}`, details: text.substring(0, 500) });
    throw new Error(`API error: ${res.status} - ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  addDebug({ timestamp: new Date().toISOString(), message: 'Response received', details: JSON.stringify(data).substring(0, 500) });
  return data;
}

async function pollTask(
  taskId: string,
  maxAttempts: number,
  addDebug: (log: DebugLog) => void
): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    addDebug({ timestamp: new Date().toISOString(), message: `Polling task (attempt ${i + 1}/${maxAttempts})` });

    try {
      const res = await fetchWithCorsProxy(`${ENRICHLOOPS_BASE_URL}/tasks/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${ENRICHLOOPS_API_KEY}`,
        },
      }, addDebug);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        addDebug({ timestamp: new Date().toISOString(), message: `Poll error ${res.status}`, details: text.substring(0, 300) });
        throw new Error(`Poll failed: ${res.status}`);
      }

      const data = await res.json();
      addDebug({ timestamp: new Date().toISOString(), message: `Task status: ${data.task?.status}` });

      if (data.task?.status === 'succeeded') {
        return data;
      }

      if (data.task?.status === 'failed') {
        throw new Error(data.error?.message || 'Enrichment failed');
      }

      // Still processing, wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err: any) {
      if (err.message === 'Enrichment failed' || err.message?.startsWith('Poll failed')) {
        throw err;
      }
      if (i === maxAttempts - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  throw new Error('Task polling timeout');
}

async function enrichCompany(domain: string, addDebug: (log: DebugLog) => void): Promise<any> {
  try {
    const response = await enrichloopsRequest('/companies/enrich', { domain }, addDebug);

    if (response.task?.status === 'succeeded') {
      return response.data;
    }

    if (response.task?.id) {
      const result = await pollTask(response.task.id, 15, addDebug);
      return result.data;
    }

    return null;
  } catch (err: any) {
    addDebug({ timestamp: new Date().toISOString(), message: 'Company enrichment error', details: err.message });
    return null;
  }
}

async function enrichPerson(email: string, fullName: string | undefined, addDebug: (log: DebugLog) => void): Promise<any> {
  try {
    const body: any = { email };
    if (fullName) body.fullName = fullName;

    const response = await enrichloopsRequest('/people/enrich', body, addDebug);

    if (response.task?.status === 'succeeded') {
      return response.data;
    }

    if (response.task?.id) {
      const result = await pollTask(response.task.id, 15, addDebug);
      return result.data;
    }

    return null;
  } catch (err: any) {
    addDebug({ timestamp: new Date().toISOString(), message: 'Person enrichment error', details: err.message });
    return null;
  }
}

// ─── FREE FALLBACK DATA SOURCES ──────────────────────────────────────────────
async function getGravatar(email: string): Promise<string | null> {
  try {
    // Use simple hash for Gravatar (MD5)
    const emailLower = email.trim().toLowerCase();
    // Simple MD5-like hash using SubtleCrypto (SHA-256 works as fallback)
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(emailLower));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `https://www.gravatar.com/avatar/${hashHex}?d=404`;
  } catch {
    return null;
  }
}

async function searchGitHub(name: string): Promise<any> {
  try {
    const res = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(name)}&per_page=1`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      const profileRes = await fetch(data.items[0].url, { signal: AbortSignal.timeout(5000) });
      if (profileRes.ok) return await profileRes.json();
    }
    return null;
  } catch {
    return null;
  }
}

async function searchWikipedia(companyName: string): Promise<any> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(companyName)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Main enrichment function ────────────────────────────────────────────────
async function enrichLead(
  name: string,
  email: string,
  addDebug: (log: DebugLog) => void
): Promise<EnrichResult> {
  const domain = email.split('@')[1].toLowerCase();
  const sources: string[] = [];

  addDebug({ timestamp: new Date().toISOString(), message: `Starting enrichment for ${name} <${email}>` });

  // Check cache
  const cachedCompany = getCachedCompany(domain);
  if (cachedCompany) {
    addDebug({ timestamp: new Date().toISOString(), message: 'Company found in cache' });
  }

  // Run all lookups in parallel
  const [enrichloopsPerson, enrichloopsCompany, gravatar, github, wikipedia] = await Promise.all([
    enrichPerson(email, name, addDebug),
    cachedCompany ? Promise.resolve(null) : enrichCompany(domain, addDebug),
    getGravatar(email),
    searchGitHub(name),
    cachedCompany ? Promise.resolve(null) : searchWikipedia(domain.split('.')[0]),
  ]);

  addDebug({
    timestamp: new Date().toISOString(),
    message: 'All lookups complete',
    details: `Person: ${!!enrichloopsPerson}, Company: ${!!enrichloopsCompany}, GitHub: ${!!github}, Wiki: ${!!wikipedia}`
  });

  // Build person data
  let person: PersonData | null = null;
  if (enrichloopsPerson || github) {
    sources.push(enrichloopsPerson ? 'Enrichloops' : 'GitHub');

    const currentPosition = enrichloopsPerson?.positions?.find((p: any) => p.is_current);

    person = {
      name: enrichloopsPerson?.full_name || github?.name || name,
      title: currentPosition?.title || enrichloopsPerson?.headline || github?.company || null,
      seniority: null,
      linkedin: enrichloopsPerson?.linkedin_url || null,
      location: currentPosition?.location || github?.location || null,
      avatar: gravatar || github?.avatar_url || null,
      github: github?.html_url || null,
      headline: enrichloopsPerson?.headline || null,
    };
  }

  // Build company data
  let company: CompanyData | null = null;
  if (enrichloopsCompany || wikipedia) {
    sources.push(enrichloopsCompany ? 'Enrichloops' : 'Wikipedia');

    const companyName = enrichloopsCompany?.name || domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);

    company = {
      name: companyName,
      website: enrichloopsCompany?.domain ? `https://${enrichloopsCompany.domain}` : `https://${domain}`,
      industry: enrichloopsCompany?.primary_industry || null,
      employees: enrichloopsCompany?.employee_count?.toLocaleString('en-US') || null,
      employeeRange: enrichloopsCompany?.employee_range || null,
      linkedin: enrichloopsCompany?.linkedin_url || null,
      location: enrichloopsCompany?.headquarters
        ? [enrichloopsCompany.headquarters.city, enrichloopsCompany.headquarters.country].filter(Boolean).join(', ')
        : null,
      logo: `https://logo.clearbit.com/${domain}`,
      description: wikipedia?.extract || null,
    };

    if (!cachedCompany) {
      setCachedCompany(domain, company);
    }
  }

  return {
    input: { name, email, domain },
    person,
    company,
    matched: {
      person: !!person,
      company: !!company,
    },
    sources,
  };
}

// ─── Login View ──────────────────────────────────────────────────────────────
function LoginView({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (password === TEAM_PASSWORD) {
      onLogin();
    } else {
      setError('Invalid password');
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white border border-[--color-border] rounded-lg p-8">
          <h1 className="text-xl font-semibold text-center mb-1 text-[--color-teal]">Lead lookup</h1>
          <p className="text-xs text-center text-[--color-muted] mb-6">Sales lead enrichment tool</p>
          <form onSubmit={handleSubmit}>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Team password</label>
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
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
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
      <span className="text-xs font-medium text-[--color-muted] uppercase tracking-wide sm:w-28 shrink-0">{label}</span>
      <span className="text-sm text-gray-900 mt-0.5 sm:mt-0">
        {value ? (
          link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className="text-[--color-teal] hover:underline focus:outline-none focus:ring-2 focus:ring-[--color-teal] rounded">
              {value}
            </a>
          ) : value
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
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addDebug = useCallback((log: DebugLog) => {
    setDebugLogs(prev => [...prev, log]);
  }, []);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setResult(null);
    setDebugLogs([]);

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
    if (PERSONAL_DOMAINS.has(domain)) {
      setError('Personal email addresses (Gmail, Yahoo, etc.) are not supported. Please provide a work email address.');
      setLoading(false);
      return;
    }

    try {
      const data = await enrichLead(name.trim(), email.trim(), addDebug);
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Could not retrieve data. Please try again.');
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
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  const getWarning = () => {
    if (!result) return null;
    if (!result.matched.person && !result.matched.company) return 'No match found for this lead.';
    if (result.matched.company && !result.matched.person) return 'Company found, but no person match.';
    if (result.matched.person && !result.matched.company) return 'Person found, but no company data.';
    return null;
  };

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-[--color-border] px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold text-[--color-teal]">Lead lookup</h1>
          <button onClick={onLogout} className="text-sm text-[--color-muted] hover:text-[--color-teal] focus:outline-none focus:ring-2 focus:ring-[--color-teal] rounded px-2 py-1 cursor-pointer">
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
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
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
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Work email</label>
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
                  Powered by Enrichloops + free APIs
                </p>
              </form>
            </div>

            {/* Debug panel */}
            {debugLogs.length > 0 && (
              <div className="mt-4 bg-white border border-[--color-border] rounded-lg p-4">
                <button
                  onClick={() => setShowDebug(!showDebug)}
                  className="text-xs font-medium text-[--color-teal] hover:underline cursor-pointer w-full text-left flex justify-between items-center"
                >
                  <span>Debug log ({debugLogs.length} entries)</span>
                  <span>{showDebug ? '▼' : '▶'}</span>
                </button>
                {showDebug && (
                  <div className="mt-2 max-h-64 overflow-y-auto">
                    {debugLogs.map((log, i) => (
                      <div key={i} className="text-xs font-mono py-1 border-b border-gray-100 last:border-0">
                        <span className="text-[--color-muted]">{log.timestamp.split('T')[1].split('.')[0]}</span>{' '}
                        <span className="text-gray-900">{log.message}</span>
                        {log.details && (
                          <div className="text-[--color-muted] mt-0.5 break-all">{log.details}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`flex-1 ${loading ? 'opacity-50' : ''}`}>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-700 font-medium">Error</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            )}

            {result && (
              <div className="bg-white border border-[--color-border] rounded-lg">
                <div className="px-5 py-4 border-b border-[--color-border] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {result.person?.avatar && (
                      <img src={result.person.avatar} alt="" className="w-12 h-12 rounded-full border border-gray-200" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    )}
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">{result.input.name}</h2>
                      <p className="text-sm text-[--color-muted]">{result.input.email}</p>
                    </div>
                  </div>
                  <button onClick={handleCopy} className="text-xs font-medium text-[--color-teal] hover:text-[--color-teal-light] border border-[--color-teal] rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[--color-teal] cursor-pointer self-start sm:self-auto">
                    {copied ? 'Copied' : 'Copy as text'}
                  </button>
                </div>

                {result.sources.length > 0 && (
                  <div className="px-5 pt-3">
                    <p className="text-xs text-[--color-muted]">Data sources: {result.sources.join(', ')}</p>
                  </div>
                )}

                {getWarning() && (
                  <div className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-md px-4 py-2.5">
                    <p className="text-sm text-amber-800">{getWarning()}</p>
                  </div>
                )}

                <div className="px-5 py-4">
                  <h3 className="text-xs font-semibold text-[--color-muted] uppercase tracking-wider mb-2">Person</h3>
                  <FieldRow label="Title" value={result.person?.title || null} />
                  {result.person?.headline && <FieldRow label="Headline" value={result.person.headline} />}
                  <FieldRow label="LinkedIn" value={result.person?.linkedin ? 'View profile' : null} link={result.person?.linkedin || undefined} />
                  <FieldRow label="GitHub" value={result.person?.github ? 'View profile' : null} link={result.person?.github || undefined} />
                  <FieldRow label="Location" value={result.person?.location || null} />
                </div>

                <div className="px-5 py-4 border-t border-[--color-border]">
                  <h3 className="text-xs font-semibold text-[--color-muted] uppercase tracking-wider mb-2">Company</h3>
                  {result.company?.logo && (
                    <div className="mb-3">
                      <img src={result.company.logo} alt="" className="h-10 w-auto" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                  )}
                  <FieldRow label="Name" value={result.company?.name || null} />
                  <FieldRow label="Website" value={result.company?.website ? result.company.website : null} link={result.company?.website || undefined} />
                  <FieldRow label="Industry" value={result.company?.industry || null} />
                  <FieldRow label="Employees" value={result.company?.employees || null} />
                  <FieldRow label="Size Range" value={result.company?.employeeRange || null} />
                  <FieldRow label="LinkedIn" value={result.company?.linkedin ? 'View company' : null} link={result.company?.linkedin || undefined} />
                  <FieldRow label="Location" value={result.company?.location || null} />
                  {result.company?.description && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs text-[--color-muted] mb-1">About</p>
                      <p className="text-sm text-gray-700">{result.company.description}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!result && !loading && !error && (
              <div className="bg-white border border-[--color-border] rounded-lg p-8 text-center">
                <p className="text-sm text-[--color-muted]">Enter a lead's name and work email to look up their information.</p>
              </div>
            )}

            {loading && !result && (
              <div className="bg-white border border-[--color-border] rounded-lg p-8 text-center">
                <p className="text-sm text-[--color-muted]">Looking up lead information…</p>
                <p className="text-xs text-[--color-muted] mt-2">This may take 10-30 seconds for Enrichloops to process</p>
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
  const [authed, setAuthed] = useState(false);

  if (!authed) {
    return <LoginView onLogin={() => setAuthed(true)} />;
  }

  return <AppView onLogout={() => setAuthed(false)} />;
}
