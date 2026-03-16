import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/capability-guard', () => ({
    guardCapability: vi.fn(),
}));

vi.mock('@/lib/observability/metrics', () => ({
    metrics: {
        snapshot: vi.fn().mockReturnValue({
            uptimeSeconds: 100,
            memory: { heapUsedMB: 50, heapTotalMB: 100, rssMB: 120 },
            counters: {
                http_requests_total: { value: 100, labels: {} },
                http_errors_total: { value: 2, labels: {} },
            },
            histograms: {
                http_request_duration_ms: { count: 100, sum: 5000, avg: 50 },
            },
        }),
        increment: vi.fn(),
        observe: vi.fn(),
    },
}));

vi.mock('@/lib/observability/request-context', () => ({
    RequestContext: {
        run: (_ctx: any, fn: any) => fn(),
        get: () => null,
        getRequestId: () => 'test-req',
        getDurationMs: () => 10,
    },
}));

vi.mock('@/lib/observability/logger', () => ({
    default: {
        info: vi.fn().mockResolvedValue(undefined),
        error: vi.fn().mockResolvedValue(undefined),
        warning: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    },
}));

vi.mock('@/lib/redis/client', () => ({
    getRedis: vi.fn().mockResolvedValue(null),
}));

import { guardCapability } from '@/lib/auth/capability-guard';
import { metrics } from '@/lib/observability/metrics';

const mockGuard = vi.mocked(guardCapability);

function makeRequest() {
    return new Request('http://localhost/api/admin/system/status', {
        method: 'GET',
        headers: { 'x-request-id': 'test-123' },
    }) as any;
}

describe('GET /api/admin/system/status', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGuard.mockResolvedValue({ role: 'ADMIN' as any, userId: 'admin@test.com', isGlobal: true, unidades: [], activeUnidadeId: null });
    });

    it('returns 200 with correct structure', async () => {
        const { GET } = await import('./route');
        const res = await GET(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.system).toBeDefined();
        expect(body.data.system.status).toBe('healthy');
        expect(body.data.system.nodeVersion).toBeDefined();
        expect(body.data.services).toBeDefined();
        expect(body.data.metrics).toBeDefined();
        expect(body.data.alerts).toBeDefined();
        expect(Array.isArray(body.data.alerts)).toBe(true);
    });

    it('generates alert when errorRate > 5%', async () => {
        vi.mocked(metrics.snapshot).mockReturnValue({
            uptimeSeconds: 100,
            memory: { heapUsedMB: 50, heapTotalMB: 100, rssMB: 120 },
            counters: {
                http_requests_total: { value: 100, labels: {} },
                http_errors_total: { value: 10, labels: {} },
            },
            histograms: {
                http_request_duration_ms: { count: 100, sum: 5000, avg: 50 },
            },
        } as any);

        const { GET } = await import('./route');
        const res = await GET(makeRequest());
        const body = await res.json();

        expect(body.data.alerts.length).toBeGreaterThan(0);
        expect(body.data.alerts.some((a: any) => a.message.includes('Error rate'))).toBe(true);
    });

    it('returns degraded when Redis is down', async () => {
        const { getRedis } = await import('@/lib/redis/client');
        vi.mocked(getRedis).mockRejectedValue(new Error('connection refused'));

        vi.mocked(metrics.snapshot).mockReturnValue({
            uptimeSeconds: 100,
            memory: { heapUsedMB: 50, heapTotalMB: 100, rssMB: 120 },
            counters: {},
            histograms: {},
        } as any);

        const { GET } = await import('./route');
        const res = await GET(makeRequest());
        const body = await res.json();

        expect(body.data.services.redis.status).toBe('error');
        expect(body.data.alerts.some((a: any) => a.message.includes('Redis'))).toBe(true);
    });

    it('generates critical alert when heap > 80%', async () => {
        const originalMemoryUsage = process.memoryUsage;
        process.memoryUsage = (() => ({
            heapUsed: 900 * 1024 * 1024,
            heapTotal: 1000 * 1024 * 1024,
            rss: 1100 * 1024 * 1024,
            external: 0,
            arrayBuffers: 0,
        })) as any;

        vi.mocked(metrics.snapshot).mockReturnValue({
            uptimeSeconds: 100,
            memory: { heapUsedMB: 900, heapTotalMB: 1000, rssMB: 1100 },
            counters: {},
            histograms: {},
        } as any);

        const { GET } = await import('./route');
        const res = await GET(makeRequest());
        const body = await res.json();

        expect(body.data.alerts.some((a: any) => a.level === 'critical' && a.message.includes('Heap'))).toBe(true);
        expect(body.data.system.status).toBe('unhealthy');

        process.memoryUsage = originalMemoryUsage;
    });
});
