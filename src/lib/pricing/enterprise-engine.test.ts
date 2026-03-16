import { describe, expect, it } from 'vitest';
import {
    calculateEnterprisePrice,
    type PricingCalculationInput,
    type PricingConfigSnapshot,
} from './enterprise-engine';

function createHourRules() {
    return [
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
    ];
}

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
            altoRisco: 15,
            at: 5,
            aa: 5,
        },
        adicionaisEscalaHoras: {
            at: true,
            aa: true,
        },
        margemPercent: 30,
        lucroFixo: 0,
        lucroFixoEscalaHoras: false,
        impostoSobreComissaoPercent: 6,
        hourRules: createHourRules(),
        paymentFeeRules: [
            { metodo: 'PIX', periodo: 'SEMANAL', taxaPercent: 0, ativa: true },
            { metodo: 'CARTAO_CREDITO', periodo: 'MENSAL', taxaPercent: 4, ativa: true },
        ],
        miniCostRules: [
            {
                tipo: 'VISITA_SUPERVISAO',
                nome: 'Visita de supervisao',
                valor: 35,
                escalaHoras: false,
                cobrancaUnica: false,
                ativoPadrao: true,
                opcionalNoFechamento: true,
            },
            {
                tipo: 'RESERVA_TECNICA',
                nome: 'Reserva tecnica',
                valor: 22,
                escalaHoras: false,
                cobrancaUnica: false,
                ativoPadrao: true,
                opcionalNoFechamento: true,
            },
        ],
        commissionPercentRules: [
            { tipo: 'MARKETING', nome: 'Marketing', percentual: 3.5, ativo: true },
            { tipo: 'REINVESTIMENTO', nome: 'Reinvestimento', percentual: 2, ativo: true },
        ],
        diseaseRules: [
            {
                codigo: 'ALZHEIMER',
                nome: 'Alzheimer',
                complexidade: 'MEDIA',
                profissionalMinimo: 'TECNICO_ENF',
                adicionalPercent: 8,
                ativa: true,
            },
            {
                codigo: 'AVC_SEQUELA',
                nome: 'AVC com sequela',
                complexidade: 'ALTA',
                profissionalMinimo: 'TECNICO_ENF',
                adicionalPercent: 12,
                ativa: true,
            },
        ],
        discountPresets: [
            { nome: 'MENSAL_5', percentual: 5, ativo: true },
        ],
        ...overrides,
    };
}

function createInput(overrides?: Partial<PricingCalculationInput>): PricingCalculationInput {
    return {
        profissional: 'CUIDADOR',
        horas: 12,
        quantidadePacientes: 1,
        metodoPagamento: 'PIX',
        periodoPagamento: 'SEMANAL',
        ...overrides,
    };
}

describe('enterprise pricing engine', () => {
    it('aplica fator nao linear de 10h como 0.86', () => {
        const config = createConfig();
        const output = calculateEnterprisePrice(config, createInput({ horas: 10 }));

        expect(output.fatorHoras).toBe(0.86);
        expect(output.valorBaseProfissional).toBe(154.8);
    });

    it('eleva profissional efetivo pelo minimo exigido em doenca', () => {
        const config = createConfig();
        const output = calculateEnterprisePrice(config, createInput({
            profissional: 'CUIDADOR',
            diseaseCodes: ['ALZHEIMER'],
        }));

        expect(output.profissionalSolicitado).toBe('CUIDADOR');
        expect(output.profissionalEfetivo).toBe('TECNICO_ENF');
        expect(output.profissionalMinimoPorDoenca).toBe('TECNICO_ENF');
        expect(output.diseasePercentTotal).toBe(8);
    });

    it('calcula imposto sobre comissao bruta', () => {
        const config = createConfig();
        const output = calculateEnterprisePrice(config, createInput());

        expect(output.impostoSobreComissaoPercent).toBe(6);
        expect(output.impostoSobreComissaoValor).toBeCloseTo(
            Number((output.comissaoBruta * 0.06).toFixed(2)),
            2
        );
    });

    it('permite desmarcar minicusto opcional por override', () => {
        const config = createConfig();
        const baseline = calculateEnterprisePrice(config, createInput());
        const withoutReserva = calculateEnterprisePrice(config, createInput({
            minicustosOverrides: { RESERVA_TECNICA: false },
        }));

        expect(baseline.minicustosAtivos.some((item) => item.tipo === 'RESERVA_TECNICA')).toBe(true);
        expect(withoutReserva.minicustosAtivos.some((item) => item.tipo === 'RESERVA_TECNICA')).toBe(false);
        expect(withoutReserva.minicustosTotal).toBeLessThan(baseline.minicustosTotal);
    });

    it('aplica desconto antes da taxa quando configurado como false', () => {
        const config = createConfig({ aplicarTaxaAntesDesconto: false });
        const output = calculateEnterprisePrice(config, createInput({
            metodoPagamento: 'CARTAO_CREDITO',
            periodoPagamento: 'MENSAL',
            descontoPresetPercent: 5,
            descontoManualPercent: 5,
        }));

        expect(output.taxaPagamentoPercent).toBe(4);
        expect(output.descontoTotalPercent).toBe(10);
        expect(output.taxaPagamentoValor).toBeGreaterThan(0);
        expect(output.descontoValor).toBeGreaterThan(0);
        expect(output.totalFinal).toBeCloseTo(
            Number((output.subtotalSemTaxaSemDesconto - output.descontoValor + output.taxaPagamentoValor).toFixed(2)),
            2
        );
    });
});
