/**
 * Contract tests: verify all API routes follow the {success, data/error} shape.
 *
 * Uses the response utilities directly to ensure contract compliance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Common mocks ----
vi.mock('@/lib/observability/request-context', () => ({
    RequestContext: {
        run: (_ctx: any, fn: any) => fn(),
        get: () => null,
        getRequestId: () => 'contract-test-req',
        getDurationMs: () => 5,
    },
}));

vi.mock('@/lib/observability/logger', () => ({
    default: {
        info: vi.fn().mockResolvedValue(undefined),
        error: vi.fn().mockResolvedValue(undefined),
        warning: vi.fn().mockResolvedValue(undefined),
        whatsapp: vi.fn().mockResolvedValue(undefined),
        debug: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/lib/observability/metrics', () => ({
    metrics: {
        increment: vi.fn(),
        observe: vi.fn(),
        snapshot: vi.fn().mockReturnValue({
            uptimeSeconds: 100,
            memory: { heapUsedMB: 50, heapTotalMB: 100, rssMB: 120 },
            counters: {},
            histograms: {},
        }),
    },
}));

// ---- Auth mock: authenticate all requests ----
vi.mock('@/lib/auth/capability-guard', () => ({
    guardCapability: vi.fn().mockResolvedValue({ role: 'ADMIN', userId: 'admin@test.com', isGlobal: true, unidades: [], activeUnidadeId: null }),
}));

vi.mock('@/auth', () => ({
    auth: vi.fn().mockResolvedValue({
        user: { email: 'admin@test.com' },
    }),
}));

vi.mock('@/lib/auth/roles', () => ({
    resolveUserRole: vi.fn().mockReturnValue('ADMIN'),
    getCapabilities: vi.fn().mockReturnValue(['VIEW_PACIENTES', 'MANAGE_SETTINGS']),
    hasCapability: vi.fn().mockReturnValue(true),
}));

// ---- Prisma mock ----
vi.mock('@/lib/prisma', () => ({
    prisma: {
        $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
        systemLog: {
            findMany: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue({ id: '1' }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        consentRecord: {
            findMany: vi.fn().mockResolvedValue([]),
            create: vi.fn().mockResolvedValue({ id: '1' }),
        },
        cuidador: {
            findMany: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
        },
        paciente: {
            findMany: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
        },
    },
}));

vi.mock('@/lib/redis/client', () => ({
    getRedis: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/whatsapp/circuit-breaker', () => ({
    whatsappCircuitBreaker: {
        toJSON: vi.fn().mockReturnValue({
            state: 'CLOSED',
            failureCount: 0,
            lastFailureAt: null,
            openUntil: null,
        }),
        isOpen: vi.fn().mockReturnValue(false),
        recordSuccess: vi.fn(),
        recordFailure: vi.fn(),
    },
}));

vi.mock('@/lib/lgpd/service', () => ({
    getConsentHistory: vi.fn().mockResolvedValue([]),
    getActiveConsents: vi.fn().mockResolvedValue([]),
    exportPersonalData: vi.fn().mockResolvedValue({ phone: '+5511999999999', data: {} }),
    anonymizePersonalData: vi.fn().mockResolvedValue({ anonymized: true }),
    recordConsent: vi.fn().mockResolvedValue({ id: '1' }),
}));

function makeRequest(path: string, method = 'GET') {
    const url = new URL(`http://localhost${path}`);
    const req = new Request(url, {
        method,
        headers: { 'x-request-id': 'contract-test' },
    }) as any;
    req.nextUrl = url;
    return req;
}

// ---- Shape validators ----
function expectSuccessShape(body: any) {
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('meta');
    expect(body.meta).toHaveProperty('requestId');
    expect(body.meta).toHaveProperty('timestamp');
}

function expectErrorShape(body: any) {
    expect(body).toHaveProperty('success', false);
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    expect(body).toHaveProperty('meta');
}

function expectPaginatedShape(body: any) {
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('pagination');
    expect(body.pagination).toHaveProperty('page');
    expect(body.pagination).toHaveProperty('pageSize');
    expect(body.pagination).toHaveProperty('total');
    expect(body.pagination).toHaveProperty('totalPages');
    expect(body.pagination).toHaveProperty('hasNext');
    expect(body.pagination).toHaveProperty('hasPrev');
}

describe('API Response Contract Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Auth domain — /api/admin/auth/me', () => {
        it('GET returns success shape', async () => {
            const { GET } = await import('@/app/api/admin/auth/me/route');
            const res = await GET(makeRequest('/api/admin/auth/me'));
            const body = await res.json();
            expectSuccessShape(body);
            expect(body.data).toHaveProperty('role');
        });
    });

    describe('WhatsApp domain — /api/admin/whatsapp/circuit-status', () => {
        it('GET returns success shape', async () => {
            const { GET } = await import('@/app/api/admin/whatsapp/circuit-status/route');
            const res = await GET(makeRequest('/api/admin/whatsapp/circuit-status'));
            const body = await res.json();
            expectSuccessShape(body);
            expect(body.data).toHaveProperty('state');
        });
    });

    describe('Observability domain — /api/admin/logs', () => {
        it('GET returns paginated shape', async () => {
            const { GET } = await import('@/app/api/admin/logs/route');
            const res = await GET(makeRequest('/api/admin/logs?page=1&pageSize=10'));
            const body = await res.json();
            expectPaginatedShape(body);
        });
    });

    describe('LGPD domain — /api/admin/lgpd', () => {
        it('GET returns success shape for export', async () => {
            const { GET } = await import('@/app/api/admin/lgpd/route');
            const res = await GET(makeRequest('/api/admin/lgpd?phone=5511999999999&action=export'));
            const body = await res.json();
            expectSuccessShape(body);
        });

        it('GET returns error shape when phone missing', async () => {
            const { GET } = await import('@/app/api/admin/lgpd/route');
            const res = await GET(makeRequest('/api/admin/lgpd'));
            const body = await res.json();
            expectErrorShape(body);
            expect(body.error.code).toBeDefined();
        });
    });

    describe('System domain — /api/admin/system/status', () => {
        it('GET returns success shape', async () => {
            const { GET } = await import('@/app/api/admin/system/status/route');
            const res = await GET(makeRequest('/api/admin/system/status'));
            const body = await res.json();
            expectSuccessShape(body);
            expect(body.data).toHaveProperty('system');
            expect(body.data).toHaveProperty('services');
            expect(body.data).toHaveProperty('alerts');
        });
    });

    describe('Response utilities contract', () => {
        it('ok() produces {success: true, data, meta}', async () => {
            const { ok } = await import('@/lib/api/response');
            const res = ok({ foo: 'bar' });
            const body = await res.json();
            expectSuccessShape(body);
            expect(body.data.foo).toBe('bar');
        });

        it('fail() produces {success: false, error: {code, message}, meta}', async () => {
            const { fail, E } = await import('@/lib/api/response');
            const res = fail(E.VALIDATION_ERROR, 'test error');
            const body = await res.json();
            expectErrorShape(body);
            expect(body.error.message).toBe('test error');
        });

        it('serverError() produces {success: false} with status 500', async () => {
            const { serverError } = await import('@/lib/api/response');
            const res = serverError(new Error('boom'));
            expect(res.status).toBe(500);
            const body = await res.json();
            expectErrorShape(body);
        });

        it('paginated() produces correct shape', async () => {
            const { paginated } = await import('@/lib/api/response');
            const res = paginated([{ id: 1 }], { page: 1, pageSize: 10, total: 1 });
            const body = await res.json();
            expectPaginatedShape(body);
            expect(body.data).toHaveLength(1);
        });

        it('2xx responses have success: true', async () => {
            const { ok } = await import('@/lib/api/response');
            const res = ok('data', 201);
            expect(res.status).toBe(201);
            const body = await res.json();
            expect(body.success).toBe(true);
        });

        it('4xx responses have success: false', async () => {
            const { fail, E } = await import('@/lib/api/response');
            const res = fail(E.NOT_FOUND, 'not found', { status: 404 });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.success).toBe(false);
        });
    });
});
