import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateEnterprisePricing } from './calculator';
import type { PricingConfigSnapshot } from './enterprise-engine';
import type { NormalizedSchedule } from '@/lib/scheduling/recurrence-engine';

const { getPricingConfigSnapshotMock } = vi.hoisted(() => ({
    getPricingConfigSnapshotMock: vi.fn<() => Promise<PricingConfigSnapshot>>(),
}));

vi.mock('./config-service', () => ({
    getPricingConfigSnapshot: getPricingConfigSnapshotMock,
}));

function createConfig(overrides?: Partial<PricingConfigSnapshot>): PricingConfigSnapshot {
    return {
        unidadeId: 'unit-1',
        unidadeCodigo: 'MATRIZ',
        unidadeNome: 'Matriz',
        currency: 'BRL',
        configVersionId: 'cfg-1',
        configVersion: 1,
        aplicarTaxaAntesDesconto: false,
        base12h: {
            CUIDADOR: 180,
            TECNICO_ENF: 300,
            ENFERMEIRO: 360,
        },
        adicionaisPercent: {
            segundoPaciente: 50,
            noturno: 20,
            fimSemana: 20,
            feriado: 20,
            altoRisco: 16,
            at: 0,
            aa: 0,
        },
        adicionaisEscalaHoras: { at: true, aa: true },
        margemPercent: 30,
        lucroFixo: 0,
        lucroFixoEscalaHoras: false,
        impostoSobreComissaoPercent: 6,
        hourRules: [
            { hora: 1, fatorPercent: 0.2 },
            { hora: 2, fatorPercent: 0.28 },
            { hora: 3, fatorPercent: 0.36 },
            { hora: 4, fatorPercent: 0.44 },
            { hora: 5, fatorPercent: 0.52 },
            { hora: 6, fatorPercent: 0.6 },
            { hora: 7, fatorPercent: 0.67 },
            { hora: 8, fatorPercent: 0.74 },
            { hora: 9, fatorPercent: 0.8 },
            { hora: 10, fatorPercent: 0.86 },
            { hora: 11, fatorPercent: 0.93 },
            { hora: 12, fatorPercent: 1.0 },
        ],
        paymentFeeRules: [
            { metodo: 'PIX', periodo: 'SEMANAL', taxaPercent: 0, ativa: true },
            { metodo: 'BOLETO', periodo: 'MENSAL', taxaPercent: 2.1, ativa: true },
            { metodo: 'CARTAO_CREDITO', periodo: 'MENSAL', taxaPercent: 4.0, ativa: true },
        ],
        miniCostRules: [
            {
                tipo: 'VISITA_SUPERVISAO',
                nome: 'Visita supervisao',
                valor: 20,
                escalaHoras: false,
                cobrancaUnica: false,
                ativoPadrao: true,
                opcionalNoFechamento: true,
            },
            {
                tipo: 'RESERVA_TECNICA',
                nome: 'Reserva tecnica',
                valor: 10,
                escalaHoras: false,
                cobrancaUnica: false,
                ativoPadrao: true,
                opcionalNoFechamento: true,
            },
        ],
        commissionPercentRules: [
            { tipo: 'MARKETING', nome: 'Marketing', percentual: 3, ativo: true },
            { tipo: 'REINVESTIMENTO', nome: 'Reinvestimento', percentual: 2, ativo: true },
        ],
        diseaseRules: [],
        discountPresets: [],
        ...overrides,
    };
}

function createSchedule(params?: Partial<NormalizedSchedule>): NormalizedSchedule {
    return {
        occurrences: [
            { date: '2026-02-02', hours: 12, isHoliday: false },
            { date: '2026-02-04', hours: 12, isHoliday: false },
            { date: '2026-02-09', hours: 12, isHoliday: false },
            { date: '2026-02-11', hours: 12, isHoliday: false },
            { date: '2026-02-16', hours: 12, isHoliday: false },
            { date: '2026-02-18', hours: 12, isHoliday: false },
            { date: '2026-02-23', hours: 12, isHoliday: false },
            { date: '2026-02-25', hours: 12, isHoliday: false },
        ],
        totalHours: 96,
        totalDays: 8,
        ...params,
    };
}

describe('calculateEnterprisePricing', () => {
    beforeEach(() => {
        getPricingConfigSnapshotMock.mockReset();
        getPricingConfigSnapshotMock.mockResolvedValue(createConfig());
    });

    it('calcula recorrencia semanal', async () => {
        const result = await calculateEnterprisePricing({
            schedule: createSchedule(),
            baseProfessionalValue: 180,
            paymentMethod: 'PIX',
            diseaseComplexity: 'MEDIUM',
            unitConfigId: 'cfg-1',
            quantityPatients: 1,
            shiftType: 'DIURNO',
        });

        expect(result.totalOccurrences).toBe(8);
        expect(result.totalHours).toBe(96);
        expect(result.costProfessional).toBeGreaterThan(0);
        expect(result.finalPrice).toBeGreaterThan(result.costProfessional);
    });

    it('calcula pacote mensal de 240h', async () => {
        const occurrences = Array.from({ length: 20 }).map((_, index) => ({
            date: `2026-03-${String(index + 1).padStart(2, '0')}`,
            hours: 12,
            isHoliday: false,
        }));
        const schedule = createSchedule({
            occurrences,
            totalDays: occurrences.length,
            totalHours: occurrences.length * 12,
        });
        const result = await calculateEnterprisePricing({
            schedule,
            baseProfessionalValue: 180,
            paymentMethod: 'BOLETO',
            paymentPeriod: 'MENSAL',
            diseaseComplexity: 'LOW',
            unitConfigId: 'cfg-1',
            quantityPatients: 1,
            shiftType: 'DIURNO',
        });

        expect(result.totalHours).toBe(240);
        expect(result.paymentFee).toBeGreaterThan(0);
    });

    it('aplica desconto manual', async () => {
        const base = await calculateEnterprisePricing({
            schedule: createSchedule(),
            baseProfessionalValue: 180,
            paymentMethod: 'PIX',
            diseaseComplexity: 'LOW',
            unitConfigId: 'cfg-1',
        });
        const discounted = await calculateEnterprisePricing({
            schedule: createSchedule(),
            baseProfessionalValue: 180,
            paymentMethod: 'PIX',
            diseaseComplexity: 'LOW',
            unitConfigId: 'cfg-1',
            manualDiscount: 10,
        });

        expect(discounted.discount).toBeGreaterThan(0);
        expect(discounted.finalPrice).toBeLessThan(base.finalPrice);
    });

    it('remove minicusto desativado', async () => {
        const withAll = await calculateEnterprisePricing({
            schedule: createSchedule(),
            baseProfessionalValue: 180,
            paymentMethod: 'PIX',
            diseaseComplexity: 'LOW',
            unitConfigId: 'cfg-1',
        });
        const withoutReserva = await calculateEnterprisePricing({
            schedule: createSchedule(),
            baseProfessionalValue: 180,
            paymentMethod: 'PIX',
            diseaseComplexity: 'LOW',
            unitConfigId: 'cfg-1',
            disableMinicosts: ['RESERVA_TECNICA'],
        });

        expect(withAll.minicosts.RESERVA_TECNICA).toBeGreaterThan(0);
        expect(withoutReserva.minicosts.RESERVA_TECNICA || 0).toBe(0);
        expect(withoutReserva.finalPrice).toBeLessThan(withAll.finalPrice);
    });

    it('calcula imposto sobre margem', async () => {
        const result = await calculateEnterprisePricing({
            schedule: createSchedule({
                occurrences: [
                    { date: '2026-02-02', hours: 12, isHoliday: true },
                    { date: '2026-02-04', hours: 12, isHoliday: false },
                ],
                totalHours: 24,
                totalDays: 2,
            }),
            baseProfessionalValue: 180,
            paymentMethod: 'PIX',
            diseaseComplexity: 'HIGH',
            unitConfigId: 'cfg-1',
            quantityPatients: 2,
            shiftType: 'NOTURNO',
        });

        expect(result.grossMargin).toBeGreaterThan(0);
        expect(result.taxOverMargin).toBeGreaterThan(0);
        expect(result.taxOverMargin).toBeCloseTo(Number((result.grossMargin * 0.06).toFixed(2)), 2);
    });
});
