import { useState, useEffect, useCallback, useRef } from 'react';

// Types
interface PersonData {
  name: string;
  title: string;
  seniority: string;
  linkedin: string;
  location: string;
}

interface CompanyData {
  name: string;
  website: string;
  industry: string;
  employees: string;
  revenue: string;
  revenueValue: number | null;
  linkedin: string;
  location: string;
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

// ─── Demo mode ───────────────────────────────────────────────────────────────
// When the Express server isn't running (e.g. static hosting), the app falls
// back to demo mode so you can explore the full UI.
const DEMO_PASSWORD = 'demo123';

const DEMO_DATA: Record<string, EnrichResult> = {
  default: {
    input: { name: '', email: '', domain: '' },
    person: {
      name: '',
      title: 'VP of Sales',
      seniority: 'VP',
      linkedin: 'https://www.linkedin.com/in/example',
      location: 'San Francisco, California, United States',
    },
    company: {
      name: 'Acme Corporation',
      website: 'https://www.acmecorp.com',
      industry: 'Software',
      employees: '250',
      revenue: '$50M',
      revenueValue: 50000000,
      linkedin: 'https://www.linkedin.com/company/acme-corp',
      location: 'San Francisco, California, United States',
    },
    matched: { person: true, company: true },
  },
};

function generateDemoResult(name: string, email: string): EnrichResult {
  const domain = email.split('@')[1] || 'example.com';
  const companyName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
  const firstName = name.split(' ')[0] || 'User';

  return {
    input: { name, email, domain },
    person: {
      name,
      title: 'Director of ' + ['Sales', 'Marketing', 'Engineering', 'Operations', 'Product'][Math.floor(Math.random() * 5)],
      seniority: ['Director', 'VP', 'Manager', 'Senior Manager'][Math.floor(Math.random() * 4)],
      linkedin: `https://www.linkedin.com/in/${firstName.toLowerCase()}-${domain.split('.')[0]}`,
      location: ['San Francisco, California, United States', 'New York, New York, United States', 'Austin, Texas, United States', 'London, England, United Kingdom', 'Berlin, Germany'][Math.floor(Math.random() * 5)],
    },
    company: {
      name: `${companyName.charAt(0).toUpperCase() + companyName.slice(1)} Inc.`,
      website: `https://www.${domain}`,
      industry: ['Software', 'Financial Services', 'Healthcare', 'Marketing', 'Manufacturing'][Math.floor(Math.random() * 5)],
      employees: String([50, 120, 500, 1200, 5000][Math.floor(Math.random() * 5)]),
      revenue: ['$10M', '$25M', '$50M', '$100M', '$250M'][Math.floor(Math.random() * 5)],
      revenueValue: [10000000, 25000000, 50000000, 100000000, 250000000][Math.floor(Math.random() * 5)],
      linkedin: `https://www.linkedin.com/company/${domain.split('.')[0]}`,
      location: ['San Francisco, California, United States', 'New York, New York, United States', 'Austin, Texas, United States'][Math.floor(Math.random() * 3)],
    },
    matched: { person: true, company: true },
  };
}

// ─── API helper (with demo fallback) ─────────────────────────────────────────
let isDemoMode = false;

async function apiCall(url: string, options?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, options);
    return res;
  } catch {
    // Server not available - switch to demo mode
    isDemoMode = true;
    throw new Error('DEMO_MODE');
  }
}

// Login View
function LoginView({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Try real API first
    try {
      const res = await apiCall('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onLogin();
        return;
      }
      const data = await res.json();
      setError(data.error || 'Invalid password');
    } catch {
      // Demo mode fallback
      if (password === DEMO_PASSWORD) {
        isDemoMode = true;
        onLogin();
      } else {
        setError('Invalid password. (Demo password: demo123)');
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
          <div className="mt-5 pt-4 border-t border-[--color-border]">
            <p className="text-xs text-[--color-muted] text-center">
              Demo mode — use password: <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[--color-teal]">demo123</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Result field component
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

// App View
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

    // Try real API
    try {
      const res = await apiCall('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (res.status === 401) {
        onLogout();
        return;
      }
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }
      setResult(data);
    } catch {
      // Demo mode fallback
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!name.trim()) {
        setError('Name is required');
        setLoading(false);
        return;
      }
      if (!emailRegex.test(email)) {
        setError('A valid email address is required');
        setLoading(false);
        return;
      }
      const domain = email.split('@')[1].toLowerCase();
      const personalDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
      if (personalDomains.includes(domain)) {
        setError('Personal email addresses (Gmail, Yahoo, etc.) are not supported. Please provide a work email address.');
        setLoading(false);
        return;
      }
      // Simulate API delay
      await new Promise(r => setTimeout(r, 800));
      setResult(generateDemoResult(name.trim(), email.trim()));
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
    } catch { /* demo mode - ignore */ }
    onLogout();
  };

  // Determine warning message
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
      {/* Header */}
      <header className="bg-white border-b border-[--color-border] px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold text-[--color-teal]">Lead lookup</h1>
          <div className="flex items-center gap-3">
            {isDemoMode && (
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded font-medium">
                Demo mode
              </span>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-[--color-muted] hover:text-[--color-teal] focus:outline-none focus:ring-2 focus:ring-[--color-teal] rounded px-2 py-1 cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        {isDemoMode && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <p className="text-sm text-blue-800">
              <strong>Demo mode active.</strong> The backend server isn't connected — results are simulated. To use with real data, run <code className="bg-blue-100 px-1 rounded font-mono text-xs">node server.js</code> with your Apollo API key configured.
            </p>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Form panel */}
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
                    placeholder="e.g. Jane Smith"
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
                    placeholder="e.g. jane@acme.com"
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

          {/* Results panel */}
          <div className={`flex-1 ${loading ? 'opacity-50' : ''}`}>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {result && (
              <div className="bg-white border border-[--color-border] rounded-lg">
                {/* Result header */}
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

                {/* Warning banner */}
                {getWarning() && (
                  <div className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-md px-4 py-2.5">
                    <p className="text-sm text-amber-800">{getWarning()}</p>
                  </div>
                )}

                {/* Person section */}
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

                {/* Company section */}
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

// Main App
export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    // Try to check session with real server
    fetch('/api/session')
      .then(res => res.json())
      .then(data => setAuthed(data.authed === true))
      .catch(() => {
        // Server not available - show login (will enter demo mode on login)
        setAuthed(false);
      });
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
