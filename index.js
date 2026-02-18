const express = require('express');
const axios = require('axios');
const { Redis } = require('@upstash/redis');
const app = express();

app.use(express.json());

// --- REQUEST LOGGING MIDDLEWARE ---
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n============== [INCOMING REQUEST] ==============`);
    console.log(`🕒 TIMESTAMP: ${timestamp}`);
    console.log(`🚀 METHOD:    ${req.method}`);
    console.log(`🔗 URL:       ${req.url}`);

    const logEntry = {
        type: 'REQUEST',
        timestamp,
        method: req.method,
        url: req.url,
        query: Object.keys(req.query).length ? req.query : undefined,
        body: (req.body && Object.keys(req.body).length) ? req.body : undefined
    };

    // Fire and forget log storage
    addLog(logEntry);

    // Log Query Params if present
    if (Object.keys(req.query).length > 0) {
        console.log(`❓ QUERY:`, JSON.stringify(req.query, null, 2));
    }

    // Log Body if present (and parsed)
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`📦 BODY:`, JSON.stringify(req.body, null, 2));
    } else if (req.method === 'POST' || req.method === 'PUT') {
        console.log(`📦 BODY: (Empty or not parsed via express.json)`);
    }

    console.log(`================================================\n`);
    next();
});

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
const REDIS_KEY_LOGS = 'azmew:request_logs';

// Helper: Add log entry to Redis (Keep last 50)
async function addLog(entry) {
    try {
        const json = JSON.stringify(entry);
        await redis.lpush(REDIS_KEY_LOGS, json);
        await redis.ltrim(REDIS_KEY_LOGS, 0, 49);
    } catch (e) {
        console.error("Failed to add log:", e);
    }
}

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

    // SAFETY CHECK: Prevent registering localhost or 127.0.0.1
    if (url.includes("localhost") || url.includes("127.0.0.1")) {
        return res.status(400).json({
            error: "Cannot register localhost as a tunnel URL.",
            help: "The proxy runs on Vercel and cannot reach your computer via 'localhost'. Ensure Pinggy has provided a public .pinggy.link URL."
        });
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

app.get('/', async (req, res) => {
    const localTunnelUrl = await getTunnelUrl();
    const lastRegistered = await getLastRegistered();
    let logs = [];
    try {
        logs = await redis.lrange(REDIS_KEY_LOGS, 0, 49);
        logs = logs.map(l => JSON.parse(l));
    } catch (e) {
        console.error("Failed to fetch logs", e);
    }

    const logsHtml = logs.map(log => {
        const color = log.type === 'REQUEST' ? '#3b82f6' : (log.status >= 400 ? '#ef4444' : '#10b981');
        const icon = log.type === 'REQUEST' ? '📥' : '📤';
        return `
            <div style="background: #1e293b; padding: 10px; margin-bottom: 10px; border-left: 4px solid ${color}; font-family: monospace; font-size: 0.9rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="color: ${color}; font-weight: bold;">${icon} ${log.type}</span>
                    <span style="color: #94a3b8;">${log.timestamp}</span>
                </div>
                ${log.method ? `<div><span style="color: #cbd5e1;">${log.method}</span> <span style="color: #64748b;">${log.url}</span></div>` : ''}
                ${log.status ? `<div>Status: <span style="color: ${log.status >= 400 ? '#ef4444' : '#10b981'}">${log.status}</span></div>` : ''}
                ${log.query ? `<div style="margin-top:5px; color: #a1a1aa;">Query: ${JSON.stringify(log.query)}</div>` : ''}
                ${log.body ? `<pre style="background: #0f172a; padding: 5px; overflow-x: auto; color: #e2e8f0; margin: 5px 0 0 0;">${JSON.stringify(log.body, null, 2)}</pre>` : ''}
                ${log.data ? `<pre style="background: #0f172a; padding: 5px; overflow-x: auto; color: #e2e8f0; margin: 5px 0 0 0;">${JSON.stringify(log.data, null, 2)}</pre>` : ''}
            </div>
        `;
    }).join('');

    res.send(`
        <html>
            <head>
                <title>Azmew Meta Proxy</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
            </head>
            <body style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: white; max-width: 1000px; margin: 0 auto;">
                <h1>📱 Azmew Meta Proxy</h1>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 2rem;">
                    <div style="background: #1e293b; padding: 1.5rem; border-radius: 8px;">
                        <h3 style="margin-top: 0;">Status</h3>
                        <p>Status: <span style="color: ${localTunnelUrl ? '#10b981' : '#ef4444'}; font-weight: bold;">${localTunnelUrl ? 'ACTIVE' : 'IDLE'}</span></p>
                        <p>Target: <code>${localTunnelUrl || 'none'}</code></p>
                        <p>Last Activity: <span style="color: #94a3b8;">${lastRegistered || 'never'}</span></p>
                    </div>
                    <div style="background: #1e293b; padding: 1.5rem; border-radius: 8px;">
                        <h3 style="margin-top: 0;">Configuration</h3>
                        <p><b>Callback URL:</b><br><code style="word-break: break-all;">${req.protocol}://${req.get('host')}/api/social/webhook</code></p>
                        <p><b>Verify Token:</b><br><code>azmew_token</code></p>
                    </div>
                </div>

                <h3>📜 Recent Traffic Logs (Last 50)</h3>
                <div style="background: #020617; padding: 1rem; border-radius: 8px; border: 1px solid #1e293b;">
                    ${logsHtml || '<p style="color: #64748b; text-align: center;">No logs found yet.</p>'}
                </div>
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
            timeout: 30000,
            maxRedirects: 0,
            validateStatus: () => true
        });

        console.log(`\n============== [TUNNEL RESPONSE] ==============`);
        console.log(`🔢 STATUS: ${response.status}`);
        // Log response data (truncate if too long maybe? But user said log EVERYTHING)
        const responseData = response.data;

        addLog({
            type: 'RESPONSE',
            timestamp: new Date().toISOString(),
            status: response.status,
            data: responseData,
            relatedUrl: req.url
        });

        const isObj = typeof responseData === 'object';
        console.log(`📄 DATA:`, isObj ? JSON.stringify(responseData, null, 2) : responseData);
        console.log(`===============================================\n`);

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
