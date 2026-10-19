# Lead Lookup

Universal sales lead enrichment tool powered by **Enrichloops** + free APIs. Works on any static hosting platform.

## ✨ Features

### 🎯 Primary Data Source: Enrichloops
- **Person Enrichment** - Reverse email lookup to find LinkedIn profiles
- **Company Enrichment** - Domain to company data (name, industry, employees, HQ)
- **Real-time Resolution** - Live LinkedIn verification for email addresses
- **Task-based API** - Async processing with polling for results

### 🆓 Free Fallback Sources
- **Gravatar** - Profile pictures from email
- **GitHub** - Developer profiles and locations
- **Wikipedia** - Company descriptions
- **Clearbit** - Company logos

## 🚀 How It Works

1. **Submit enrichment request** to Enrichloops API
2. **Get task ID** back (async processing)
3. **Poll for results** every 2 seconds until complete
4. **Display enriched data** with fallbacks from free APIs

### Data Flow
```
User Input (name + email)
    ↓
Enrichloops API:
  • POST /v1/people/enrich (email → LinkedIn profile)
  • POST /v1/companies/enrich (domain → company data)
    ↓
Poll /v1/tasks/{id} until status = "succeeded"
    ↓
Free APIs (fallback):
  • Gravatar → Profile picture
  • GitHub → Person info
  • Wikipedia → Company description
  • Clearbit → Company logo
    ↓
Combine & Display Results
```

## 🔑 Login

**Password:** `demo123`

## 🧪 Try It

1. Login with `demo123`
2. Enter a lead:
   - Name: `Satya Nadella`
   - Email: `satya@microsoft.com`
3. Click "Look up lead"
4. Wait 5-10 seconds for Enrichloops to process
5. See real data!

## 📊 What You Get

### Person Data (from Enrichloops)
- Full name
- Current job title
- Headline
- LinkedIn profile URL
- Location
- Profile picture (Gravatar)
- GitHub profile (if found)

### Company Data (from Enrichloops)
- Company name
- Domain/website
- Primary industry
- Employee count
- Employee range (e.g., "5001-10000")
- LinkedIn company URL
- Headquarters location
- Company logo (Clearbit)
- Description (Wikipedia)

## 🔧 Configuration

Edit `src/App.tsx` to customize:

```typescript
// Line 3: Enrichloops API key
const ENRICHLOOPS_API_KEY = 'ek_8d4895a40ac852a80d4a511a2a9e8c3adffe7e8e4c62b964';

// Line 5: Team password
const TEAM_PASSWORD = 'demo123';
```

Then rebuild:
```bash
npm run build
```

## 🌐 Deployment

### Netlify (Easiest)
1. Go to [Netlify](https://app.netlify.com)
2. Drag and drop the `dist/` folder
3. Done!

### Vercel
```bash
vercel --prod
```

### GitHub Pages
Push `dist/` to `gh-pages` branch

### Any Static Host
Upload `dist/` folder contents

## 💰 Enrichloops Pricing

- **Company enrichment**: 1 credit per lookup
- **Person enrichment (email)**: 3 credits per lookup
- **Person enrichment (LinkedIn URL)**: 1 credit per lookup
- **Failed lookups**: 0 credits (refunded)

Check your Enrichloops dashboard for credit balance.

## ⚡ Performance

- **Cached companies**: Instant (24-hour cache)
- **Known companies**: 2-5 seconds
- **New companies**: 5-15 seconds
- **Email lookups**: 10-30 seconds (live LinkedIn resolution)

The app polls every 2 seconds and shows a loading state while waiting.

## 🔒 Security

- ✅ API key only in client code (acceptable for static sites)
- ✅ No backend server required
- ✅ No data stored (session-only cache)
- ✅ Personal email domains blocked
- ✅ HTTPS required for production

## 🛠️ Development

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Build for production
npm run preview      # Preview production build
```

## 📁 Project Structure

```
lead-lookup/
├── src/
│   ├── App.tsx          # Main app with Enrichloops integration
│   ├── main.tsx         # React entry point
│   └── index.css        # Tailwind styles
├── dist/                # Built files (deploy this!)
├── index.html           # HTML template
├── package.json         # Dependencies
├── vite.config.js       # Vite config
└── README.md            # Documentation
```

## 🎯 Key Advantages

✅ **Works everywhere** - Any static host, no backend needed  
✅ **Real data** - Enrichloops resolves emails against live LinkedIn  
✅ **Fast caching** - 24-hour company cache reduces API calls  
✅ **Graceful fallbacks** - Free APIs fill in gaps  
✅ **Production-ready** - Error handling, loading states, validation  

## ⚠️ Limitations

- Enrichloops API may have CORS restrictions (test in production)
- Email lookups take 10-30 seconds (live LinkedIn resolution)
- Credits consumed per lookup (check your balance)
- Personal emails blocked (Gmail, Yahoo, etc.)
- Cache resets on page reload

## 🔗 API Documentation

- [Enrichloops Docs](https://docs.enrichloops.com/)
- [Companies API](https://docs.enrichloops.com/companies)
- [People API](https://docs.enrichloops.com/people)
- [Reverse Email Lookup](https://docs.enrichloops.com/reverse-email-lookup)

## 📝 Example Results

**Input:** Satya Nadella / satya@microsoft.com

**Output:**
- 👤 **Person**: Satya Nadella
  - Title: Chairman and CEO
  - LinkedIn: https://www.linkedin.com/in/satyanadella/
  - Location: Redmond, Washington
  
- 🏢 **Company**: Microsoft Corporation
  - Industry: Software
  - Employees: 221,000
  - Range: 10001+
  - HQ: Redmond, United States
  - LinkedIn: https://www.linkedin.com/company/microsoft

## 🚀 Quick Start

1. Clone/download this repo
2. Run `npm install`
3. Run `npm run build`
4. Deploy `dist/` folder to any static host
5. Login with `demo123`
6. Start looking up leads!

## 📞 Support

For Enrichloops API issues:
- Check your API key is valid
- Verify you have credits available
- Review [Enrichloops docs](https://docs.enrichloops.com/)

For app issues:
- Check browser console for errors
- Verify Enrichloops API key in `src/App.tsx`
- Ensure you're using a work email (not Gmail/Yahoo)

---

**Built with Enrichloops + React + Tailwind CSS**
