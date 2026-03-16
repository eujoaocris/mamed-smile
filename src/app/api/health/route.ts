import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveBridgeConfig } from '@/lib/whatsapp/bridge-config';
import { getDbSchemaCapabilities } from '@/lib/db/schema-capabilities';
import { resolveDatabaseTargetInfo } from '@/lib/db/database-target';
import { getRedis } from '@/lib/redis/client';

interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    uptime: number;
    version: string;
    dbSchemaOk: boolean;
    missingColumns: string[];
    databaseProvider: string;
    databaseTarget: string;
    checks: {
        database: { status: string; latency?: number };
        redis: { status: string; latencyMs?: number };
        fileSystem: { status: string; files?: string[] };
        whatsapp: {
            status: string;
            connected?: boolean;
            latency?: number;
            reconnecting?: boolean;
            retryCount?: number;
            lastStatusCode?: number | null;
            lastIncomingMessageAt?: string | null;
            lastOutgoingMessageAt?: string | null;
            errorCount24h?: number;
            webhookLatencyAvgMs?: number;
        };
        memory: { used: number; total: number; percentage: number };
    };
}

export async function GET() {
    const startTime = Date.now();
    const dbInfo = resolveDatabaseTargetInfo(process.env.DATABASE_URL);
    const checks: HealthStatus['checks'] = {
        database: { status: 'unknown' },
        redis: { status: 'unknown' },
        fileSystem: { status: 'unknown' },
        whatsapp: { status: 'unknown' },
        memory: { used: 0, total: 0, percentage: 0 },
    };
    let dbSchemaOk = false;
    let missingColumns: string[] = [];

    try {
        const dbStart = Date.now();
        if (process.env.USE_MOCK_DB === 'true') {
            dbSchemaOk = true;
            checks.database = { status: 'ok', latency: 0 };
        } else {
            const { prisma } = await import('@/lib/prisma');
            await prisma.$queryRaw`SELECT 1`;
            const schema = await getDbSchemaCapabilities();
            dbSchemaOk = schema.dbSchemaOk;
            missingColumns = schema.missingColumns;
            checks.database = {
                status: 'ok',
                latency: Date.now() - dbStart,
            };
        }
    } catch {
        checks.database = { status: 'error' };
    }

    try {
        const redisStart = Date.now();
        const redis = await getRedis();
        if (redis) {
            await redis.ping();
            checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
        } else {
            checks.redis = { status: 'not_configured' };
        }
    } catch {
        checks.redis = { status: 'error' };
    }

    try {
        const requiredFiles = ['.env.local', 'prisma/dev.db'];
        const existingFiles = requiredFiles.filter((value) => fs.existsSync(path.join(process.cwd(), value)));
        checks.fileSystem = {
            status: existingFiles.length === requiredFiles.length ? 'ok' : 'warning',
            files: existingFiles,
        };
    } catch {
        checks.fileSystem = { status: 'error' };
    }

    try {
        const bridgeConfig = resolveBridgeConfig();
        const waStart = Date.now();
        const response = await fetch(`${bridgeConfig.bridgeUrl}/status`, { signal: AbortSignal.timeout(2500) });

        if (response.ok) {
            const payload = await response.json();
            checks.whatsapp = {
                status: payload?.connected
                    ? 'ok'
                    : payload?.reconnecting
                        ? 'reconnecting'
                        : payload?.status === 'CONNECTING'
                            ? 'connecting'
                            : 'disconnected',
                connected: Boolean(payload?.connected),
                reconnecting: Boolean(payload?.reconnecting),
                retryCount: Number(payload?.retryCount || 0),
                lastStatusCode: payload?.lastStatusCode ?? null,
                lastIncomingMessageAt: payload?.lastIncomingMessageAt || null,
                lastOutgoingMessageAt: payload?.lastOutgoingMessageAt || null,
                errorCount24h: Number(payload?.errorCount24h || 0),
                webhookLatencyAvgMs: Number(payload?.webhookLatencyAvgMs || 0),
                latency: Date.now() - waStart,
            };
        } else {
            checks.whatsapp = { status: `http_${response.status}` };
        }
    } catch {
        try {
            const sessionFile = path.join(process.cwd(), '.wa-session.json');
            if (fs.existsSync(sessionFile)) {
                const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
                checks.whatsapp = {
                    status: session.status === 'CONNECTED' ? 'ok' : 'disconnected',
                    connected: session.status === 'CONNECTED',
                    reconnecting: Boolean(session.reconnecting),
                    retryCount: Number(session.retryCount || 0),
                    lastStatusCode: session.lastStatusCode ?? null,
                    lastIncomingMessageAt: session.lastIncomingMessageAt || null,
                    lastOutgoingMessageAt: session.lastOutgoingMessageAt || null,
                    errorCount24h: Number(session.errorCount24h || 0),
                    webhookLatencyAvgMs: Number(session.webhookLatencyAvgMs || 0),
                };
            } else {
                checks.whatsapp = { status: 'not_configured' };
            }
        } catch {
            checks.whatsapp = { status: 'error' };
        }
    }

    const memUsage = process.memoryUsage();
    checks.memory = {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
        percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
    };

    const hasErrors = Object.values(checks).some(
        (entry) => typeof entry === 'object' && 'status' in entry && entry.status === 'error'
    );
    const hasWarnings = Object.values(checks).some(
        (entry) =>
            typeof entry === 'object' &&
            'status' in entry &&
            ['warning', 'disconnected', 'http_503', 'http_500'].includes(entry.status)
    );

    const health: HealthStatus = {
        status: hasErrors ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '0.1.0',
        dbSchemaOk,
        missingColumns,
        databaseProvider: dbInfo.provider,
        databaseTarget: dbInfo.target,
        checks,
    };

    const statusCode = health.status === 'unhealthy' ? 503 : 200;

    return NextResponse.json(health, {
        status: statusCode,
        headers: {
            'Cache-Control': 'no-store',
            'X-Response-Time': `${Date.now() - startTime}ms`,
        },
    });
}
