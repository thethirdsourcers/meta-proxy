const express = require('express');
const axios = require('axios');
const { Redis } = require('@upstash/redis');
const app = express();

app.use(express.json());

// --- PERSISTENT STORAGE via Upstash Redis ---
// This replaces the in-memory variable that was lost on Vercel cold starts.
// Configure via Vercel Integration or environment variables:
//   UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const REDIS_KEY_TUNNEL_URL = 'azmew:tunnel_url';
const REDIS_KEY_LAST_REGISTERED = 'azmew:last_registered';

// Helper: Get tunnel URL from Redis
async function getTunnelUrl() {
    try {
        return await redis.get(REDIS_KEY_TUNNEL_URL) || "";
    } catch (err) {
        console.error("❌ Redis GET error:", err.message);
        return "";
    }
}

// Helper: Set tunnel URL in Redis (TTL: 1 hour to auto-expire stale tunnels)
async function setTunnelUrl(url) {
    try {
        await redis.set(REDIS_KEY_TUNNEL_URL, url, { ex: 3600 });
        await redis.set(REDIS_KEY_LAST_REGISTERED, new Date().toISOString());
        return true;
    } catch (err) {
        console.error("❌ Redis SET error:", err.message);
        return false;
    }
}

// Helper: Get last registered time
async function getLastRegistered() {
    try {
        return await redis.get(REDIS_KEY_LAST_REGISTERED) || null;
    } catch (err) {
        return null;
    }
}

// SECURE REGISTRATION: Update the local tunnel URL
app.post('/_proxy/register', async (req, res) => {
    const { url, token } = req.body;
    const SECRET_TOKEN = process.env.PROXY_AUTH_TOKEN || "azmew_token";

    if (token !== SECRET_TOKEN) {
        return res.status(401).json({ error: "Unauthorized registration" });
    }

    if (!url || !url.startsWith("http")) {
        return res.status(400).json({ error: "Invalid tunnel URL" });
    }

    const success = await setTunnelUrl(url);
    const timestamp = new Date().toISOString();

    if (!success) {
        return res.status(500).json({ error: "Failed to persist tunnel URL" });
    }

    console.log(`📡 Registered local tunnel: ${url} at ${timestamp}`);

    res.json({
        status: "success",
        registeredUrl: url,
        timestamp: timestamp
    });
});

// Status Page
app.get('/', async (req, res) => {
    const localTunnelUrl = await getTunnelUrl();
    const lastRegistered = await getLastRegistered();

    res.send(`
        <html>
            <head><title>Azmew Meta Proxy</title></head>
            <body style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: white;">
                <h1>📱 Azmew Meta Proxy</h1>
                <p>Status: <span style="color: ${localTunnelUrl ? '#10b981' : '#ef4444'}">${localTunnelUrl ? 'ACTIVE' : 'IDLE (Waiting for local connection)'}</span></p>
                <p>Target: <code>${localTunnelUrl || 'none'}</code></p>
                <p>Last Activity: ${lastRegistered || 'never'}</p>
                <p>Storage: <span style="color: #10b981">Redis (Persistent)</span></p>
                <hr style="border: 0; border-top: 1px solid #1e293b; margin: 2rem 0;">
                <h3>Meta Configuration:</h3>
                <ul>
                    <li><b>Callback URL:</b> <code>${req.protocol}://${req.get('host')}/api/social/webhook</code></li>
                    <li><b>Verify Token:</b> <code>azmew_token</code></li>
                </ul>
            </body>
        </html>
    `);
});

// PROXYING LOGIC: Forward all other requests to the local tunnel
app.all('*', async (req, res) => {
    if (req.path === '/_proxy/register' || req.path === '/') return;

    // --- WEBHOOK VERIFICATION HANDSHAKE (GET) ---
    if (req.method === 'GET' && req.path === '/api/social/webhook') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        const VERIFY_TOKEN = "azmew_token";

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log("✅ Proxy-level Webhook verification successful.");
            res.setHeader('Content-Type', 'text/plain');
            return res.status(200).send(challenge);
        }
    }

    const localTunnelUrl = await getTunnelUrl();

    if (!localTunnelUrl) {
        return res.status(503).json({
            error: "No local development tunnel is currently registered.",
            help: "Run your local backend tunnel script (run.sh) to register.",
            lastActivity: await getLastRegistered() || "none"
        });
    }

    try {
        const targetUrl = `${localTunnelUrl}${req.url}`;
        console.log(`🔀 Proxying ${req.method} ${req.url} -> ${targetUrl}`);

        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body,
            headers: {
                ...req.headers,
                host: new URL(localTunnelUrl).host // Crucial for tunnel providers like Pinggy/Ngrok
            },
            timeout: 30000, // 30s timeout to prevent hanging
            validateStatus: () => true // Forward all response codes
        });

        // Forward status and headers
        res.status(response.status);
        Object.keys(response.headers).forEach(key => {
            // Skip problematic headers
            if (['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) return;
            res.setHeader(key, response.headers[key]);
        });

        res.send(response.data);
    } catch (err) {
        console.error("❌ Proxy Error:", err.message);

        // If tunnel is unreachable, provide helpful error
        if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
            return res.status(502).json({
                error: "Local tunnel is unreachable. It may have expired or restarted.",
                message: err.message,
                help: "Restart your local backend (run.sh) to register a new tunnel URL.",
                registeredUrl: localTunnelUrl
            });
        }

        res.status(500).json({
            error: "Failed to forward request to local tunnel.",
            message: err.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Meta Proxy listening on port ${PORT}`);
});

module.exports = app; // For Vercel
