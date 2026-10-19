# Lead Lookup

Universal sales lead enrichment tool that works **everywhere** - any static host, no backend required.

## ✨ What's New

This version uses **multiple free data sources** that work from any browser:

- 📚 **Wikipedia** - Company descriptions and industry info
- 👨‍💻 **GitHub** - Developer profiles and locations
- 🖼️ **Gravatar** - Profile pictures from email
- 🎨 **Clearbit** - Company logos
- 🔍 **DuckDuckGo** - Company summaries
- 🚀 **Apollo** - Professional data (when available)

**No backend needed!** Works on Netlify, Vercel, GitHub Pages, Cloudflare Pages, or any static host.

## Features

- 🔍 Look up lead information by name and work email
- 👤 Get person details: title, location, GitHub, avatar
- 🏢 Get company details: name, website, industry, logo, description
- 🔒 Simple team password authentication
- 📋 Copy lead data as formatted text
- 🚫 Blocks personal email domains (Gmail, Yahoo, etc.)
- ⚡ 24-hour company cache to avoid duplicate lookups
- 🌐 Works on ANY static hosting platform
- 🆓 Uses free APIs - no backend costs

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Build the app
```bash
npm run build
```

### 3. Deploy anywhere!

**Netlify:**
```bash
# Just drag and drop the dist/ folder to Netlify
# Or connect your GitHub repo
```

**Vercel:**
```bash
vercel --prod
```

**GitHub Pages:**
```bash
# Push dist/ folder to gh-pages branch
```

**Any static host:**
```bash
# Upload dist/ folder contents
```

### 4. Login
Password: `demo123` (or change in src/App.tsx)

## How It Works

The app queries multiple free APIs in parallel:

1. **Gravatar** - Gets profile picture from email hash
2. **GitHub** - Searches for person by name, gets profile
3. **Wikipedia** - Gets company info from domain name
4. **DuckDuckGo** - Gets company summary
5. **Apollo** - Gets professional data (if API key configured)
6. **Clearbit** - Gets company logo

All APIs are CORS-friendly and work directly from the browser.

## Configuration

Edit `src/App.tsx` to change:
- `TEAM_PASSWORD` - Your team password (line 4)
- `APOLLO_API_KEY` - Your Apollo API key (line 3, optional)

## Data Sources

| Source | What it provides | CORS Support |
|--------|------------------|--------------|
| Wikipedia | Company descriptions, industry | ✅ Yes |
| GitHub | Person profiles, locations | ✅ Yes |
| Gravatar | Profile pictures | ✅ Yes |
| Clearbit | Company logos | ✅ Yes |
| DuckDuckGo | Company summaries | ✅ Yes |
| Apollo | Professional data | ❌ No (needs proxy) |

## Advantages

✅ **Works everywhere** - No backend, no server, no CORS issues  
✅ **Free** - Uses free APIs, no subscription required  
✅ **Fast** - Parallel API calls, instant results  
✅ **Reliable** - Multiple sources, graceful fallbacks  
✅ **Simple** - Single static site, easy to deploy  
✅ **Secure** - Client-side auth, no data stored  

## Limitations

- Apollo API requires a backend proxy (CORS blocked)
- Data quality depends on free API coverage
- No persistent storage (cache resets on page reload)
- Rate limits apply per API provider

## Development

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm run preview  # Preview production build
```

## License

MIT
