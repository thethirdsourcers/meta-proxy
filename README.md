# 📱 Azmew Meta Proxy

This is a lightweight Node.js proxy designed to provide a **stable URL** for Facebook and Instagram integrations while developing on `localhost`.

## 🌟 Why do I need this?
Meta (Facebook) requires a fixed URL for Webhooks and OAuth Redirects. When developing locally using tunnels (Pinggy, Ngrok), the URL changes every time you restart. This proxy allows you to:
1. Configure your Facebook App **once** using the Proxy's stable URL (e.g., Vercel).
2. Start your local environment, which automatically "registers" its current tunnel with the proxy.
3. Receive webhooks and redirects seamlessly on your local machine.

## 🚀 Deployment (Vercel)

1. **Push to GitHub**: Create a new repo and push this folder.
2. **Deploy to Vercel**: Connect your repo to Vercel.
3. **Environment Variables**:
   - `PROXY_AUTH_TOKEN`: Set a secret key (default used in BE is `azmew_dev_secret`).

## ⚙️ Local Configuration

Update your `azmew-be/.env`:
```text
PROXY_URL=https://your-proxy-app.vercel.app
PROXY_AUTH_TOKEN=your_secret_key
```

## 🔄 Meta Configuration
In the **Meta Developer Portal**, use your Proxy URL for:
- **App Domains**: `your-proxy-app.vercel.app`
- **Valid OAuth Redirect URIs**: `https://your-proxy-app.vercel.app/api/social/auth/facebook/callback`
- **Webhook Callback URL**: `https://your-proxy-app.vercel.app/api/social/webhook`
