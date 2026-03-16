const express = require('express');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
} = require('baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

function loadLocalEnvFile() {
    const cwd = process.cwd();
    const envFiles = [path.resolve(cwd, '.env'), path.resolve(cwd, '.env.local')];

    for (const envPath of envFiles) {
        if (!fs.existsSync(envPath)) continue;

        const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const separatorIndex = trimmed.indexOf('=');
            if (separatorIndex <= 0) continue;

            const key = trimmed.slice(0, separatorIndex).trim();
            if (!key || process.env[key] !== undefined) continue;

            let value = trimmed.slice(separatorIndex + 1).trim();
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith('\'') && value.endsWith('\''))
            ) {
                value = value.slice(1, -1);
            }

            process.env[key] = value;
        }
    }
}

loadLocalEnvFile();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PORT = Number(process.env.WA_BRIDGE_PORT || 4000);
const AUTH_DIR = path.resolve(__dirname, 'auth_info');
const SESSION_FILE = path.resolve(process.cwd(), process.env.WA_SESSION_FILE || '.wa-session.json');
const STATE_FILE = path.resolve(process.cwd(), process.env.WA_STATE_FILE || '.wa-state.json');
function resolveWebhookUrl() {
    if (process.env.WA_WEBHOOK_URL) return process.env.WA_WEBHOOK_URL;
    const appUrl =
        process.env.APP_URL ||
        process.env.NEXT_PUBLIC_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        process.env.WEB_URL ||
        '';
    if (!appUrl) return '';
    const base = appUrl.endsWith('/') ? appUrl : `${appUrl}/`;
    const pathValue = (process.env.WA_WEBHOOK_PATH || '/api/whatsapp/webhook').replace(/^\/+/, '');
    try {
        return new URL(pathValue, base).toString();
    } catch {
        return '';
    }
}
const WEBHOOK_URL = resolveWebhookUrl();
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || process.env.WA_WEBHOOK_SECRET || '';
const RECONNECT_MAX_ATTEMPTS = Number(process.env.WA_RECONNECT_MAX_ATTEMPTS || 10);
const RECONNECT_BASE_DELAY_MS = Number(process.env.WA_RECONNECT_BASE_DELAY_MS || 5000);
const RECONNECT_MAX_DELAY_MS = Number(process.env.WA_RECONNECT_MAX_DELAY_MS || 160000);
const RETRY_405_LIMIT = Number(process.env.WA_RETRY_405_LIMIT || 2);

let sock = null;
let qrCode = null;
let connectionStatus = 'DISCONNECTED';
let connectedPhone = null;
let isConnecting = false;
let retryCount = 0;
let consecutive405 = 0;
let reconnectTimer = null;
let lastError = null;
let lastStatusCode = null;
let pairingCode = null;
let pairingCodeIssuedAt = null;
let manualDisconnectRequested = false;
let lastIncomingMessageAt = null;
let lastOutgoingMessageAt = null;
let webhookLatencyAvgMs = 0;
let webhookLatencySamples = 0;
let bridgeErrorTimestamps = [];

function ensureAuthDir() {
    try {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
    } catch {
        // best effort
    }
}

function ensureJsonFileIntegrity(filePath, fallback = {}) {
    if (!fs.existsSync(filePath)) return;

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        if (!raw.trim()) {
            fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
            return;
        }

        JSON.parse(raw);
    } catch (error) {
        try {
            const backupPath = `${filePath}.corrupt-${Date.now()}`;
            fs.renameSync(filePath, backupPath);
            fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
            console.warn(`[bridge] recovered corrupted file: ${path.basename(filePath)}`);
        } catch (repairError) {
            console.error('[bridge] failed to repair file:', repairError.message);
        }
    }
}

function pruneErrorWindow() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    bridgeErrorTimestamps = bridgeErrorTimestamps.filter((value) => value >= cutoff);
    return bridgeErrorTimestamps.length;
}

function registerBridgeError(error) {
    bridgeErrorTimestamps.push(Date.now());
    pruneErrorWindow();
    if (error) {
        lastError = typeof error === 'string' ? error : String(error.message || error);
    }
}

function registerWebhookLatency(ms) {
    webhookLatencySamples += 1;
    webhookLatencyAvgMs = Math.round(
        ((webhookLatencyAvgMs * (webhookLatencySamples - 1)) + ms) / webhookLatencySamples
    );
}

function resolveBrowser() {
    const profile = String(process.env.WA_BROWSER_PROFILE || 'macos').toLowerCase();
    const deviceName = process.env.WA_BROWSER_DEVICE || 'Desktop';

    if (profile === 'ubuntu' || profile === 'linux') return Browsers.ubuntu(deviceName);
    if (profile === 'windows') return Browsers.windows(deviceName);
    return Browsers.macOS(deviceName);
}

function saveSession() {
    const errorCount24h = pruneErrorWindow();
    const data = {
        status: connectionStatus,
        connected: connectionStatus === 'CONNECTED',
        reconnecting: Boolean(reconnectTimer) || (retryCount > 0 && connectionStatus !== 'CONNECTED'),
        qrCode,
        connectedAt: connectionStatus === 'CONNECTED' ? new Date().toISOString() : null,
        phone: connectedPhone,
        retryCount,
        lastStatusCode,
        lastError,
        pairingCode,
        pairingCodeIssuedAt,
        isConnecting,
        lastIncomingMessageAt,
        lastOutgoingMessageAt,
        errorCount24h,
        webhookLatencyAvgMs,
    };

    try {
        ensureJsonFileIntegrity(SESSION_FILE, {});
        fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('[bridge] failed to save session:', error.message);
    }
}

function getStatusSnapshot() {
    return {
        status: connectionStatus,
        connected: connectionStatus === 'CONNECTED',
        reconnecting: Boolean(reconnectTimer) || (retryCount > 0 && connectionStatus !== 'CONNECTED'),
        qrCode,
        phone: connectedPhone,
        isConnecting,
        retryCount,
        lastStatusCode,
        lastError,
        pairingCode,
        pairingCodeIssuedAt,
        lastIncomingMessageAt,
        lastOutgoingMessageAt,
        errorCount24h: pruneErrorWindow(),
        webhookLatencyAvgMs,
    };
}

function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function shouldAutoReconnect(statusCode) {
    if (retryCount >= RECONNECT_MAX_ATTEMPTS) return false;
    if (statusCode === 401) return false;
    if (statusCode === DisconnectReason.loggedOut || statusCode === 403) return false;
    if (statusCode === 405 && consecutive405 > RETRY_405_LIMIT) return false;
    return true;
}

function scheduleReconnect() {
    if (reconnectTimer) return;

    retryCount += 1;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * (2 ** (retryCount - 1)), RECONNECT_MAX_DELAY_MS);
    console.log(`[bridge] reconnect in ${Math.round(delay / 1000)}s (attempt ${retryCount}/${RECONNECT_MAX_ATTEMPTS})`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWhatsApp({ resetRetry: false, source: 'auto-reconnect' }).catch((error) => {
            console.error('[bridge] reconnect attempt failed:', error.message);
        });
    }, delay);
}

async function sendToWebhook(data) {
    if (!WEBHOOK_URL) {
        return;
    }
    try {
        const body = JSON.stringify(data);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const headers = {
            'Content-Type': 'application/json',
            'x-webhook-timestamp': timestamp,
        };

        if (WEBHOOK_SECRET) {
            const signature = crypto
                .createHmac('sha256', WEBHOOK_SECRET)
                .update(`${timestamp}.${body}`)
                .digest('hex');
            headers['x-webhook-signature'] = `sha256=${signature}`;
        }

        const startedAt = Date.now();
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(8000),
        });

        registerWebhookLatency(Date.now() - startedAt);
        if (!response.ok) {
            registerBridgeError(`Webhook HTTP ${response.status}`);
            console.error(`[bridge] webhook delivery failed: HTTP ${response.status}`);
        }
    } catch (error) {
        registerBridgeError(error);
        console.error('[bridge] webhook delivery failed:', error.message);
    }
}

function normalizeStatusCode(lastDisconnect) {
    return Number(
        lastDisconnect?.error?.output?.statusCode ??
        lastDisconnect?.error?.statusCode ??
        0
    ) || null;
}

async function connectWhatsApp({ resetRetry = true, source = 'manual' } = {}) {
    if (isConnecting) return;
    if (sock && connectionStatus === 'CONNECTED') return;

    if (source === 'manual') clearReconnectTimer();
    if (resetRetry) {
        retryCount = 0;
        consecutive405 = 0;
    }
    manualDisconnectRequested = false;

    isConnecting = true;
    lastError = null;
    lastStatusCode = null;
    pairingCode = null;
    pairingCodeIssuedAt = null;
    connectionStatus = 'CONNECTING';
    saveSession();
    console.log(`[bridge] starting WhatsApp connection (${source})...`);

    try {
        ensureAuthDir();
        ensureJsonFileIntegrity(STATE_FILE, {});
        ensureJsonFileIntegrity(SESSION_FILE, {});
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        let waVersion;
        try {
            const vInfo = await fetchLatestBaileysVersion();
            waVersion = vInfo.version;
            console.log(`[bridge] using WA version: ${JSON.stringify(waVersion)}`);
        } catch (e) {
            console.warn(`[bridge] failed to fetch WA version: ${e.message}`);
        }

        sock = makeWASocket({
            auth: state,
            version: waVersion,
            printQRInTerminal: false,
            browser: resolveBrowser(),
            logger: pino({ level: process.env.WA_LOG_LEVEL || 'error' }),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (event) => {
            if (event.type !== 'notify') return;

            for (const msg of event.messages) {
                try {
                    if (msg.key?.fromMe) continue;

                    let replyJid = msg.key?.remoteJid;
                    if (replyJid && replyJid.includes('@lid') && msg.key?.participant && !msg.key.participant.includes('@lid')) {
                        replyJid = msg.key.participant;
                    }

                    lastIncomingMessageAt = new Date().toISOString();
                    saveSession();

                    await sendToWebhook({
                        ...msg,
                        _replyJid: replyJid,
                    });
                } catch (error) {
                    registerBridgeError(error);
                    const message = String(error?.message || error || '');
                    if (message.toLowerCase().includes('pkmsg')) {
                        console.warn('[bridge] decrypt failure (pkmsg). A new pairing may be required.');
                    }
                }
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    qrCode = await QRCode.toDataURL(qr);
                    pairingCode = null;
                    pairingCodeIssuedAt = null;
                    connectionStatus = 'QR_PENDING';
                    saveSession();
                    console.log('[bridge] QR generated');
                } catch (error) {
                    console.error('[bridge] failed to encode QR:', error.message);
                }
            }

            if (connection === 'open') {
                isConnecting = false;
                manualDisconnectRequested = false;
                retryCount = 0;
                consecutive405 = 0;
                lastError = null;
                lastStatusCode = null;
                qrCode = null;
                pairingCode = null;
                pairingCodeIssuedAt = null;
                connectionStatus = 'CONNECTED';
                connectedPhone = sock?.user?.id ? sock.user.id.split(':')[0] : null;
                saveSession();
                console.log('[bridge] WhatsApp connected');
                return;
            }

            if (connection !== 'close') return;

            isConnecting = false;
            qrCode = null;
            connectionStatus = 'DISCONNECTED';
            lastStatusCode = normalizeStatusCode(lastDisconnect);
            lastError = lastStatusCode
                ? `Connection closed (${lastStatusCode}).`
                : 'Connection closed.';
            registerBridgeError(lastError);

            if (manualDisconnectRequested) {
                manualDisconnectRequested = false;
                retryCount = 0;
                consecutive405 = 0;
                lastStatusCode = null;
                lastError = null;
                saveSession();
                console.log('[bridge] disconnected by request');
                return;
            }

            if (lastStatusCode === 405) consecutive405 += 1;
            else consecutive405 = 0;

            if (lastStatusCode === 515) {
                ensureJsonFileIntegrity(STATE_FILE, {});
                ensureJsonFileIntegrity(SESSION_FILE, {});
            }

            saveSession();
            console.warn(`[bridge] connection closed (code=${lastStatusCode ?? 'unknown'})`);

            if (shouldAutoReconnect(lastStatusCode)) {
                scheduleReconnect();
                return;
            }

            clearReconnectTimer();
            console.warn('[bridge] auto-reconnect stopped');
            if (lastStatusCode === 401) {
                console.warn('[bridge] credentials invalid/expired. Use POST /reset-auth and pair again.');
            }
            if (lastStatusCode === 405) {
                console.warn('[bridge] repeated 405 detected. Use POST /reset-auth and pair again.');
            }
        });
    } catch (error) {
        isConnecting = false;
        connectionStatus = 'DISCONNECTED';
        lastError = `Connection error: ${error.message}`;
        registerBridgeError(error);
        saveSession();
        console.error('[bridge] connection setup failed:', error.message);
    }
}

async function disconnectWhatsApp() {
    clearReconnectTimer();
    manualDisconnectRequested = true;

    const currentSocket = sock;
    sock = null;

    try {
        if (currentSocket) {
            if (typeof currentSocket.ws?.close === 'function') {
                currentSocket.ws.close();
            }
        }
    } catch {
        // ignore socket close failures
    }

    try {
        if (currentSocket && typeof currentSocket.end === 'function') {
            currentSocket.end(new Error('manual disconnect'));
        }
    } catch {
        // ignore end failures
    }

    isConnecting = false;
    retryCount = 0;
    consecutive405 = 0;
    qrCode = null;
    connectedPhone = null;
    connectionStatus = 'DISCONNECTED';
    lastError = null;
    lastStatusCode = null;
    pairingCode = null;
    pairingCodeIssuedAt = null;
    saveSession();
}

async function logoutWhatsApp() {
    clearReconnectTimer();
    manualDisconnectRequested = true;

    const currentSocket = sock;
    sock = null;

    try {
        if (currentSocket && typeof currentSocket.logout === 'function') {
            await currentSocket.logout();
        }
    } catch {
        // ignore logout failures
    }

    isConnecting = false;
    retryCount = 0;
    consecutive405 = 0;
    qrCode = null;
    connectedPhone = null;
    connectionStatus = 'DISCONNECTED';
    lastError = null;
    lastStatusCode = null;
    pairingCode = null;
    pairingCodeIssuedAt = null;
    saveSession();
}

function resetAuthState() {
    clearReconnectTimer();
    manualDisconnectRequested = false;

    try {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    } catch {
        // best effort
    }

    ensureAuthDir();
    sock = null;
    isConnecting = false;
    retryCount = 0;
    consecutive405 = 0;
    qrCode = null;
    connectedPhone = null;
    connectionStatus = 'DISCONNECTED';
    lastError = null;
    lastStatusCode = null;
    pairingCode = null;
    pairingCodeIssuedAt = null;
    saveSession();
}

app.get('/status', (_req, res) => {
    res.json(getStatusSnapshot());
});

app.get('/health', (_req, res) => {
    const status = getStatusSnapshot();
    const ok = status.connected || status.isConnecting || status.reconnecting || status.status === 'DISCONNECTED';
    res.status(ok ? 200 : 503).json({
        ok,
        bridge: status,
        timestamp: new Date().toISOString(),
    });
});

app.post('/connect', async (_req, res) => {
    if (connectionStatus === 'CONNECTED') {
        return res.json({ success: true, ...getStatusSnapshot() });
    }

    await connectWhatsApp({ resetRetry: true, source: 'manual' });
    return res.json({ success: true, ...getStatusSnapshot() });
});

app.post('/disconnect', async (_req, res) => {
    await disconnectWhatsApp();
    return res.json({ success: true, ...getStatusSnapshot() });
});

app.post('/reset-auth', async (_req, res) => {
    await logoutWhatsApp();
    resetAuthState();
    return res.json({ success: true, ...getStatusSnapshot() });
});

app.post('/pair', async (req, res) => {
    const rawPhone = String(req.body?.phone || '').trim();
    const sanitizedPhone = rawPhone.replace(/\D/g, '');

    if (!sanitizedPhone || sanitizedPhone.length < 10) {
        return res.status(400).json({ success: false, error: 'Invalid phone number.' });
    }

    await connectWhatsApp({ resetRetry: true, source: 'pairing' });

    if (!sock) {
        return res.status(500).json({ success: false, error: 'Bridge socket not ready.' });
    }

    if (sock.authState?.creds?.registered) {
        return res.json({ success: true, status: connectionStatus, alreadyRegistered: true });
    }

    try {
        let generatedCode = null;
        let lastPairingError = null;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                generatedCode = await sock.requestPairingCode(sanitizedPhone);
                break;
            } catch (error) {
                lastPairingError = error;
                const message = String(error?.message || '').toLowerCase();
                if (!message.includes('connection closed') || attempt === 3) break;
                await new Promise((resolve) => setTimeout(resolve, 1200));
            }
        }

        if (!generatedCode) {
            throw lastPairingError || new Error('Failed to generate pairing code.');
        }

        pairingCode = generatedCode;
        pairingCodeIssuedAt = new Date().toISOString();
        qrCode = null;
        connectionStatus = 'PAIRING_CODE';
        saveSession();

        return res.json({
            success: true,
            status: connectionStatus,
            pairingCode,
            phone: sanitizedPhone,
        });
    } catch (error) {
        lastError = error?.message || 'Failed to generate pairing code.';
        saveSession();
        return res.status(500).json({ success: false, error: lastError });
    }
});

function resolveTargetJid(target) {
    const raw = String(target || '').trim();
    if (!raw) return '';

    if (raw.includes('@lid') || raw.includes('@s.whatsapp.net')) {
        return raw;
    }

    let cleanNumber = raw.replace(/@.+$/, '').replace(/\D/g, '');
    if (cleanNumber.length === 10 || cleanNumber.length === 11) {
        cleanNumber = `55${cleanNumber}`;
    }
    return `${cleanNumber}@s.whatsapp.net`;
}

app.post('/send', async (req, res) => {
    if (!sock || connectionStatus !== 'CONNECTED') {
        return res.status(503).json({
            error: 'WhatsApp is not connected.',
            code: 'WHATSAPP_NOT_CONNECTED',
            context: {
                connected: connectionStatus === 'CONNECTED',
                status: connectionStatus,
            },
        });
    }

    const { phone, message, to } = req.body || {};
    const target = phone || to;

    if (!target || !message) {
        return res.status(400).json({
            error: 'Invalid payload.',
            code: 'SEND_PAYLOAD_INVALID',
            context: {
                hasTarget: Boolean(target),
                hasMessage: Boolean(message),
            },
        });
    }

    try {
        const jid = resolveTargetJid(target);

        const sent = await sock.sendMessage(jid, { text: String(message) });
        const providerMessageId = sent?.key?.id || null;
        lastOutgoingMessageAt = new Date().toISOString();
        saveSession();
        return res.json({
            success: true,
            id: providerMessageId,
            messageId: providerMessageId,
            providerMessageId,
        });
    } catch (error) {
        registerBridgeError(error);
        return res.status(500).json({
            error: error.message || 'Failed to send message.',
            code: 'SEND_MESSAGE_FAILED',
            context: {
                connected: connectionStatus === 'CONNECTED',
                status: connectionStatus,
            },
        });
    }
});

app.post('/send-document', async (req, res) => {
    if (!sock || connectionStatus !== 'CONNECTED') {
        return res.status(503).json({
            error: 'WhatsApp is not connected.',
            code: 'WHATSAPP_NOT_CONNECTED',
            context: {
                connected: connectionStatus === 'CONNECTED',
                status: connectionStatus,
            },
        });
    }

    const { to, phone, document, fileName, caption, mimetype } = req.body || {};
    const target = to || phone;
    if (!target || !document || !fileName) {
        return res.status(400).json({
            error: 'Invalid payload.',
            code: 'SEND_DOCUMENT_PAYLOAD_INVALID',
            context: {
                hasTarget: Boolean(target),
                hasDocument: Boolean(document),
                hasFileName: Boolean(fileName),
            },
        });
    }

    try {
        const jid = resolveTargetJid(target);
        const mediaBuffer = Buffer.from(String(document), 'base64');

        const sent = await sock.sendMessage(jid, {
            document: mediaBuffer,
            fileName: String(fileName),
            caption: caption ? String(caption) : '',
            mimetype: mimetype ? String(mimetype) : 'application/pdf',
        });
        const providerMessageId = sent?.key?.id || null;

        lastOutgoingMessageAt = new Date().toISOString();
        saveSession();
        return res.json({
            success: true,
            id: providerMessageId,
            messageId: providerMessageId,
            providerMessageId,
        });
    } catch (error) {
        registerBridgeError(error);
        return res.status(500).json({
            error: error.message || 'Failed to send document.',
            code: 'SEND_DOCUMENT_FAILED',
            context: {
                connected: connectionStatus === 'CONNECTED',
                status: connectionStatus,
            },
        });
    }
});

app.listen(PORT, () => {
    console.log(`Bridge running on ${PORT}`);
    ensureJsonFileIntegrity(SESSION_FILE, {});
    ensureJsonFileIntegrity(STATE_FILE, {});

    if (!WEBHOOK_SECRET) {
        console.warn('[bridge] WHATSAPP_WEBHOOK_SECRET not configured. Webhook signature is disabled.');
    }
    if (!WEBHOOK_URL) {
        console.warn('[bridge] WA_WEBHOOK_URL/APP_URL/NEXT_PUBLIC_APP_URL not configured. Webhook delivery is disabled.');
    } else {
        console.log(`[bridge] webhook enabled -> ${WEBHOOK_URL}`);
    }

    if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
        console.log('[bridge] existing credentials found, attempting reconnect...');
        connectWhatsApp({ resetRetry: true, source: 'startup' }).catch((error) => {
            console.error('[bridge] startup reconnect failed:', error.message);
        });
    }
});
