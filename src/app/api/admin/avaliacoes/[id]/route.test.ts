import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    guardCapability: vi.fn(),
    avaliacaoFindUnique: vi.fn(),
    loggerWarning: vi.fn(),
    getDbSchemaCapabilities: vi.fn(),
}));

vi.mock('@/lib/auth/capability-guard', () => ({
    guardCapability: mocks.guardCapability,
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        avaliacao: {
            findUnique: mocks.avaliacaoFindUnique,
            update: vi.fn(),
            delete: vi.fn(),
        },
    },
}));

vi.mock('@/lib/logger', () => ({
    default: {
        warning: mocks.loggerWarning,
    },
}));

vi.mock('@/lib/db/schema-capabilities', () => ({
    getDbSchemaCapabilities: mocks.getDbSchemaCapabilities,
}));

import { GET } from './route';

function req(): NextRequest {
    return new Request('https://example.com/api/admin/avaliacoes/av1', {
        method: 'GET',
    }) as unknown as NextRequest;
}

describe('GET /api/admin/avaliacoes/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.guardCapability.mockResolvedValue({ role: 'ADMIN', userId: 'admin@test.com', isGlobal: true, unidades: [], activeUnidadeId: null });
        mocks.getDbSchemaCapabilities.mockResolvedValue({
            dbSchemaOk: true,
            missingColumns: [],
            databaseProvider: 'sqlite',
            databaseTarget: 'prisma/dev.db',
            checkedAt: new Date().toISOString(),
        });
        mocks.avaliacaoFindUnique.mockResolvedValue({
            id: 'av1',
            paciente: { id: 'pac1', mensagens: [], orcamentos: [] },
        });
    });

    it('returns 200 when schema and query are healthy', async () => {
        const response = await GET(req(), { params: Promise.resolve({ id: 'av1' }) });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.avaliacao.id).toBe('av1');
    });

    it('returns 503 when schema guard detects drift', async () => {
        mocks.getDbSchemaCapabilities.mockResolvedValueOnce({
            dbSchemaOk: false,
            missingColumns: ['Orcamento.auditHash'],
            databaseProvider: 'sqlite',
            databaseTarget: 'prisma/dev.db',
            checkedAt: new Date().toISOString(),
        });

        const response = await GET(req(), { params: Promise.resolve({ id: 'av1' }) });
        const payload = await response.json();

        expect(response.status).toBe(503);
        expect(payload.success).toBe(false);
        expect(payload.error.details.action).toBe('db_schema_drift');
    });

    it('returns 503 when Prisma throws P2022', async () => {
        mocks.avaliacaoFindUnique.mockRejectedValueOnce({
            code: 'P2022',
            message: 'The column `main.Orcamento.auditHash` does not exist in the current database.',
        });

        const response = await GET(req(), { params: Promise.resolve({ id: 'av1' }) });
        const payload = await response.json();

        expect(response.status).toBe(503);
        expect(payload.success).toBe(false);
        expect(payload.error.details.column).toBe('auditHash');
    });
});
