# 📱 Azmew Meta Proxy

A reverse proxy deployed on Vercel that forwards Meta (Facebook/Instagram) webhooks and OAuth callbacks to your local development tunnel (Pinggy).

## Why?
Meta (Facebook) requires a fixed URL for Webhooks and OAuth Redirects. When developing locally using tunnels (Pinggy, Ngrok), the URL changes every time you restart. This proxy allows you to:
- Register a **stable URL** in Meta Developer Portal (once!)
- Auto-update the target tunnel when you restart your backend (`run.sh` handles this)

## Architecture
```
Meta Servers → socialmedia-azmew-proxy.vercel.app → [Upstash Redis: tunnel URL] → Your Local Pinggy Tunnel → localhost:8081
```

## Setup

### 1. Create Upstash Redis (Free Tier)
1. Go to [upstash.com](https://upstash.com) and create a free account
2. Create a new Redis database (choose the region closest to your Vercel deployment)
3. Copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the dashboard

### 2. Add Environment Variables to Vercel
In your Vercel project settings, add these environment variables:

| Variable | Description |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Your Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Your Upstash Redis REST Token |
| `PROXY_AUTH_TOKEN` | Secret token for tunnel registration (must match `run.sh`) |

> 💡 **Tip:** You can also use the [Vercel Upstash Integration](https://vercel.com/integrations/upstash) which auto-configures the environment variables.

### 3. Deploy
```bash
cd meta-proxy
vercel deploy --prod
```

### 4. Usage
When you run `run.sh` in the backend, it automatically:
1. Starts a Pinggy tunnel
2. Registers the new tunnel URL with this proxy
3. Sends keep-alive pings every 5 minutes

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Status page showing current tunnel URL |
| `POST` | `/_proxy/register` | Register/update tunnel URL (requires auth token) |
| `*` | `/api/social/*` | Proxied to local tunnel |

## Key Improvement: Persistent Storage
Previous version stored the tunnel URL **in-memory**, which was lost on Vercel serverless cold starts (causing `ENOTFOUND` errors). Now uses **Upstash Redis** for persistence across all serverless function instances.
