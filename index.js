const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// In-memory store for the local tunnel URL.
// Warning: On Vercel (serverless), this may reset on cold starts.
// For production stability, consider using @vercel/kv.
let localTunnelUrl = "";
let lastRegistered = null;

// SECURE REGISTRATION: Update the local tunnel URL
// In your local .env, set PROXY_AUTH_TOKEN=some_secret_key
app.post('/_proxy/register', (req, res) => {
    const { url, token } = req.body;
    const SECRET_TOKEN = process.env.PROXY_AUTH_TOKEN || "azmew_dev_secret";

    if (token !== SECRET_TOKEN) {
        return res.status(401).json({ error: "Unauthorized registration" });
    }

    if (!url || !url.startsWith("http")) {
        return res.status(400).json({ error: "Invalid tunnel URL" });
    }

    localTunnelUrl = url;
    lastRegistered = new Date().toISOString();
    console.log(`📡 Registered local tunnel: ${url} at ${lastRegistered}`);

    res.json({
        status: "success",
        registeredUrl: localTunnelUrl,
        timestamp: lastRegistered
    });
});

// Status Page
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Azmew Meta Proxy</title></head>
            <body style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: white;">
                <h1>📱 Azmew Meta Proxy</h1>
                <p>Status: <span style="color: ${localTunnelUrl ? '#10b981' : '#ef4444'}">${localTunnelUrl ? 'ACTIVE' : 'IDLE (Waiting for local connection)'}</span></p>
                <p>Target: <code>${localTunnelUrl || 'none'}</code></p>
                <p>Last Activity: ${lastRegistered || 'never'}</p>
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
    // Handle this directly in the proxy to ensure Meta verification always works 
    // even if the local tunnel is waking up or temporarily lost in memory.
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

    if (!localTunnelUrl) {
        return res.status(503).json({
            error: "No local development tunnel is currently registered.",
            help: "Run your local backend tunnel script (run.sh) to register.",
            lastActivity: lastRegistered || "none"
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
