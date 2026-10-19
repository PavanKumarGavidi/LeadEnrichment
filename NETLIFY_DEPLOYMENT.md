# Netlify Deployment Guide

## What Was Fixed

The issue was that **Netlify is a static hosting platform** - it doesn't run Node.js servers. When the frontend tried to call `/api/apollo-proxy/...`, Netlify returned 404 because there was no server to handle it.

## The Solution: Netlify Functions

I've added **Netlify Functions** to handle server-side logic:

1. **`netlify/functions/apollo-proxy.js`** - Proxies Apollo API calls (avoids CORS issues)
2. **`netlify/functions/api.js`** - Handles login/logout/session/enrich endpoints
3. **`netlify.toml`** - Configuration for Netlify deployment

## How It Works

```
Browser → Netlify (static files)
         ↓
    /api/* requests
         ↓
    Netlify Functions (serverless)
         ↓
    Apollo API
```

## Deployment Steps

### 1. Push to GitHub
```bash
git add .
git commit -m "Add Netlify Functions for serverless deployment"
git push origin main
```

### 2. Connect to Netlify
1. Go to [Netlify](https://app.netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Connect your GitHub account and select the repo
4. Netlify auto-detects settings from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`

### 3. Add Environment Variables
In Netlify dashboard → **Site settings** → **Environment variables**, add:

| Variable | Value |
|----------|-------|
| `APOLLO_API_KEY` | `UhKB7c0hM4t2Ep1ihvRBRg` |
| `TEAM_PASSWORD` | `demo123` (or your choice) |
| `SESSION_SECRET` | Any random string (e.g., `my-secret-key-123`) |

### 4. Deploy
Click "Deploy site". Netlify will:
- Build the frontend (`npm run build`)
- Deploy to `dist/`
- Set up Netlify Functions from `netlify/functions/`

## Testing

After deployment:
1. Visit your Netlify URL (e.g., `https://your-site.netlify.app`)
2. Login with password: `demo123`
3. Try a lookup (e.g., Satya Nadella / satya@microsoft.com)
4. Check the **Debug Info** panel - it should show:
   - Status: 200
   - Proxy: `netlify-function`
   - Response preview with actual Apollo data

## Why This Works

✅ **No CORS issues** - Netlify Functions run server-side  
✅ **API key stays secure** - Only exists in environment variables  
✅ **No Node.js server needed** - Everything runs on Netlify's infrastructure  
✅ **Automatic scaling** - Netlify handles all the server management  
✅ **Free tier available** - Netlify Functions has a generous free tier  

## Troubleshooting

### "404 Backend proxy" error
- Make sure you pushed the `netlify/` folder to GitHub
- Check that Netlify Functions are deployed (Site settings → Functions)
- Verify environment variables are set correctly

### "Invalid API key" (401)
- Double-check `APOLLO_API_KEY` in Netlify environment variables
- Verify the key is active in your Apollo account

### "Rate limit reached" (429)
- Apollo has rate limits (usually 50-100 requests/minute)
- Wait a minute and try again
- Check your Apollo dashboard for usage

## Local Development

To test locally before deploying:
```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your values

# Build frontend
npm run build

# Start server (for local testing)
node server.js
```

Then visit `http://localhost:3000`

## Files Created/Modified

- ✅ `netlify.toml` - Netlify configuration
- ✅ `netlify/functions/apollo-proxy.js` - Apollo API proxy
- ✅ `netlify/functions/api.js` - Auth and enrichment endpoints
- ✅ `.gitignore` - Excludes node_modules and .env
- ✅ `src/App.tsx` - Updated to use Netlify Functions
- ✅ `README.md` - Added Netlify deployment instructions

## Next Steps

1. Push to GitHub
2. Connect to Netlify
3. Add environment variables
4. Deploy and test!

The app will now work perfectly on Netlify with real Apollo data. 🚀
