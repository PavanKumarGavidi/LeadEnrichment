import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Configuration ───────────────────────────────────────────────────────────
const ENRICHLOOPS_API_KEY = 'ek_8d4895a40ac852a80d4a511a2a9e8c3adffe7e8e4c62b964';
const ENRICHLOOPS_BASE_URL = 'https://api.enrichloops.com/v1';
const TEAM_PASSWORD = 'demo123';

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

// ─── Enrichloops API helpers ─────────────────────────────────────────────────

async function enrichloopsRequest(endpoint: string, body: any): Promise<any> {
  try {
    const res = await fetch(`${ENRICHLOOPS_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENRICHLOOPS_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || `API error: ${res.status}`);
    }
    
    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  }
}

async function pollTask(taskId: string, maxAttempts = 30): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${ENRICHLOOPS_BASE_URL}/tasks/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${ENRICHLOOPS_API_KEY}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      
      if (!res.ok) {
        throw new Error(`Task poll failed: ${res.status}`);
      }
      
      const data = await res.json();
      
      if (data.task?.status === 'succeeded') {
        return data;
      }
      
      if (data.task?.status === 'failed') {
        throw new Error(data.error?.message || 'Enrichment failed');
      }
      
      // Still processing, wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err: any) {
      if (i === maxAttempts - 1) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  throw new Error('Task polling timeout');
}

async function enrichCompany(domain: string): Promise<any> {
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
    console.error('Company enrichment error:', err);
    return null;
  }
}

async function enrichPerson(email: string, fullName?: string): Promise<any> {
  try {
    const body: any = { email };
    if (fullName) {
      body.fullName = fullName;
    }
    
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
    console.error('Person enrichment error:', err);
    return null;
  }
}

// ─── FREE FALLBACK DATA SOURCES ──────────────────────────────────────────────

async function getGravatar(email: string): Promise<string | null> {
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
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
      const user = data.items[0];
      const profileRes = await fetch(user.url, { signal: AbortSignal.timeout(5000) });
      if (profileRes.ok) {
        return await profileRes.json();
      }
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
async function enrichLead(name: string, email: string): Promise<EnrichResult> {
  const domain = email.split('@')[1].toLowerCase();
  const sources: string[] = [];
  
  // Check cache
  const cachedCompany = getCachedCompany(domain);
  
  // Run all lookups in parallel
  const [enrichloopsPerson, enrichloopsCompany, gravatar, github, wikipedia] = await Promise.all([
    enrichPerson(email, name),
    cachedCompany ? Promise.resolve(null) : enrichCompany(domain),
    getGravatar(email),
    searchGitHub(name),
    cachedCompany ? Promise.resolve(null) : searchWikipedia(domain.split('.')[0]),
  ]);
  
  // Build person data (prioritize Enrichloops)
  let person: PersonData | null = null;
  if (enrichloopsPerson || github) {
    sources.push(enrichloopsPerson ? 'Enrichloops' : 'GitHub');
    
    const currentPosition = enrichloopsPerson?.positions?.find((p: any) => p.is_current);
    
    person = {
      name: enrichloopsPerson?.full_name || github?.name || name,
      title: currentPosition?.title || enrichloopsPerson?.headline || github?.company || null,
      seniority: null, // Enrichloops doesn't provide this directly
      linkedin: enrichloopsPerson?.linkedin_url || null,
      location: currentPosition?.location || github?.location || null,
      avatar: gravatar || github?.avatar_url || null,
      github: github?.html_url || null,
      headline: enrichloopsPerson?.headline || null,
    };
  }
  
  // Build company data (prioritize Enrichloops)
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
        ? `${enrichloopsCompany.headquarters.city || ''}, ${enrichloopsCompany.headquarters.country || ''}`.replace(/^, |, $/g, '')
        : null,
      logo: `https://logo.clearbit.com/${domain}`,
      description: wikipedia?.extract || null,
    };
    
    // Cache company
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

  const handleSubmit = async (e: React.FormEvent) => {
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
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setResult(null);

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
      const data = await enrichLead(name.trim(), email.trim());
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
      if (result.person.github) lines.push(`GitHub: ${result.person.github}`);
    }
    if (result.company) {
      if (result.company.name) lines.push(`Company: ${result.company.name}`);
      if (result.company.employees) lines.push(`Employees: ${result.company.employees}`);
      if (result.company.employeeRange) lines.push(`Employee Range: ${result.company.employeeRange}`);
    }
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

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
            onClick={onLogout}
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
                  Powered by Enrichloops + free APIs (Wikipedia, GitHub, Gravatar, Clearbit)
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

            {result && (
              <div className="bg-white border border-[--color-border] rounded-lg">
                <div className="px-5 py-4 border-b border-[--color-border] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {result.person?.avatar && (
                      <img
                        src={result.person.avatar}
                        alt=""
                        className="w-12 h-12 rounded-full border border-gray-200"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">
                        {result.input.name}
                      </h2>
                      <p className="text-sm text-[--color-muted]">{result.input.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="text-xs font-medium text-[--color-teal] hover:text-[--color-teal-light] border border-[--color-teal] rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[--color-teal] cursor-pointer self-start sm:self-auto"
                  >
                    {copied ? 'Copied' : 'Copy as text'}
                  </button>
                </div>

                {result.sources.length > 0 && (
                  <div className="px-5 pt-3">
                    <p className="text-xs text-[--color-muted]">
                      Data sources: {result.sources.join(', ')}
                    </p>
                  </div>
                )}

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
                  {result.person?.headline && (
                    <FieldRow label="Headline" value={result.person.headline} />
                  )}
                  <FieldRow
                    label="LinkedIn"
                    value={result.person?.linkedin ? 'View profile' : null}
                    link={result.person?.linkedin || undefined}
                  />
                  <FieldRow
                    label="GitHub"
                    value={result.person?.github ? 'View profile' : null}
                    link={result.person?.github || undefined}
                  />
                  <FieldRow label="Location" value={result.person?.location || null} />
                </div>

                <div className="px-5 py-4 border-t border-[--color-border]">
                  <h3 className="text-xs font-semibold text-[--color-muted] uppercase tracking-wider mb-2">
                    Company
                  </h3>
                  {result.company?.logo && (
                    <div className="mb-3">
                      <img
                        src={result.company.logo}
                        alt=""
                        className="h-10 w-auto"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    </div>
                  )}
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
                    label="Size Range"
                    value={result.company?.employeeRange || null}
                  />
                  <FieldRow
                    label="LinkedIn"
                    value={result.company?.linkedin ? 'View company' : null}
                    link={result.company?.linkedin || undefined}
                  />
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
                <p className="text-sm text-[--color-muted]">
                  Enter a lead's name and work email to look up their information.
                </p>
              </div>
            )}

            {loading && !result && (
              <div className="bg-white border border-[--color-border] rounded-lg p-8 text-center">
                <p className="text-sm text-[--color-muted]">Looking up lead information…</p>
                <p className="text-xs text-[--color-muted] mt-2">This may take a few seconds for Enrichloops to process</p>
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
