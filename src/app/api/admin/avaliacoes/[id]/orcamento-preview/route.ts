import { NextRequest, NextResponse } from 'next/server';
import { E, fail, ok } from '@/lib/api/response';
import { guardCapability } from '@/lib/auth/capability-guard';
import { withErrorBoundary } from '@/lib/api/with-error-boundary';
import { prisma } from '@/lib/prisma';
import {
    type PricingBreakdownItem,
    type PricingCalculationInput,
    type PricingCalculationOutput,
    type PricingConfigSnapshot,
    calculateEnterprisePrice,
} from '@/lib/pricing/enterprise-engine';
import { getPricingConfigSnapshot } from '@/lib/pricing/config-service';
import { avaliacaoToEnterprisePricingInputs } from '@/lib/pricing/avaliacao-to-orcamento';

interface CenarioData {
    nome: string;
    totalSemanal: number;
    estimativaMensal: number;
    plantoes: Array<{
        numero: number;
        dia: string;
        horario: string;
        turno: string;
        cuidador: string;
        valorCuidador: number;
        taxaMA: number;
        total: number;
    }>;
    parametros: {
        r0: number;
        a2p: number;
        an: number;
        afds: number;
        metodoPagamento: string;
        periodo: string;
    };
    descontos: Array<{ periodo: string; percentual: number }>;
    coberturaInicio: string;
    coberturaFim: string;
    breakdown: PricingBreakdownItem[];
}

const BASE_PLANTOES = [
    { dia: 'Domingo', horario: '19:00-07:00', turno: 'Noturno + FDS' },
    { dia: 'Segunda', horario: '07:00-19:00', turno: 'Diurno' },
    { dia: 'Segunda', horario: '19:00-07:00', turno: 'Noturno' },
    { dia: 'Terca', horario: '07:00-19:00', turno: 'Diurno' },
    { dia: 'Terca', horario: '19:00-07:00', turno: 'Noturno' },
    { dia: 'Quarta', horario: '07:00-19:00', turno: 'Diurno' },
    { dia: 'Quarta', horario: '19:00-07:00', turno: 'Noturno' },
    { dia: 'Quinta', horario: '07:00-19:00', turno: 'Diurno' },
    { dia: 'Quinta', horario: '19:00-07:00', turno: 'Noturno' },
    { dia: 'Sexta', horario: '07:00-19:00', turno: 'Diurno' },
    { dia: 'Sexta', horario: '19:00-07:00', turno: 'Noturno' },
] as const;

const BASE_TOTALS = [410.02, 329.95, 369.98, 329.95, 369.98, 329.95, 369.98, 329.95, 369.98, 329.95, 369.98];
const BASE_TOTAL_SUM = BASE_TOTALS.reduce((acc, value) => acc + value, 0);

function roundCurrency(value: number): number {
    return Number(value.toFixed(2));
}

function buildPlantoes(totalSemanal: number) {
    const scale = BASE_TOTAL_SUM > 0 ? totalSemanal / BASE_TOTAL_SUM : 1;

    return BASE_PLANTOES.map((base, index) => {
        const total = roundCurrency(BASE_TOTALS[index] * scale);
        const valorCuidador = roundCurrency(total * 0.833);
        const taxaMA = roundCurrency(total - valorCuidador);
        return {
            numero: index + 1,
            dia: base.dia,
            horario: base.horario,
            turno: base.turno,
            cuidador: `C${(index % 6) + 1}`,
            valorCuidador,
            taxaMA,
            total,
        };
    });
}

function toCenarioData(
    calc: PricingCalculationOutput,
    input: PricingCalculationInput,
    config: PricingConfigSnapshot,
    nome: string,
): CenarioData {
    const totalSemanal = roundCurrency(calc.totalFinal);
    const estimativaMensal = roundCurrency(totalSemanal * 4.33);
    const plantoes = buildPlantoes(totalSemanal);
    const r0 = roundCurrency(config.base12h[calc.profissionalEfetivo]);
    const an = input.flags?.noturno ? config.adicionaisPercent.noturno : 0;
    const coberturaInicio = input.horas >= 24 ? 'Dom 00h' : 'Dom 19h';
    const coberturaFim = input.horas >= 24 ? 'Sab 23h' : 'Sab 07h';

    return {
        nome,
        totalSemanal,
        estimativaMensal,
        plantoes,
        parametros: {
            r0,
            a2p: config.adicionaisPercent.segundoPaciente,
            an,
            afds: config.adicionaisPercent.fimSemana,
            metodoPagamento: input.metodoPagamento,
            periodo: input.periodoPagamento,
        },
        descontos: [
            { periodo: 'Semanal', percentual: 2 },
            { periodo: 'Mensal', percentual: 5 },
            { periodo: 'Trimestral', percentual: 10 },
            { periodo: 'Semestral', percentual: 12 },
        ],
        coberturaInicio,
        coberturaFim,
        breakdown: calc.breakdown,
    };
}

interface ScenarioSnapshot {
    input: PricingCalculationInput;
    output: PricingCalculationOutput;
    unidadeId: string;
    configVersionId: string;
    moeda: string;
}

async function handleGet(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const guard = await guardCapability('VIEW_AVALIACOES');
    if (guard instanceof NextResponse) return guard;

    const { id: avaliacaoId } = await params;

    const avaliacao = await prisma.avaliacao.findUnique({
        where: { id: avaliacaoId },
        include: { paciente: true },
    });

    if (!avaliacao) {
        return fail(E.NOT_FOUND, 'Avaliacao nao encontrada', { status: 404 });
    }

    const unidadeId = request.nextUrl.searchParams.get('unidadeId') || undefined;
    const config = await getPricingConfigSnapshot({
        unidadeId: unidadeId || undefined,
    });

    const {
        inputEconomico,
        inputRecomendado,
        inputPremium,
        metadados,
    } = avaliacaoToEnterprisePricingInputs(avaliacao as unknown as Record<string, unknown>);

    const economico = calculateEnterprisePrice(config, inputEconomico);
    const recomendado = calculateEnterprisePrice(config, inputRecomendado);
    const premium = calculateEnterprisePrice(config, inputPremium);

    const cenarioEconomico = toCenarioData(economico, inputEconomico, config, 'Economico');
    const cenarioRecomendado = toCenarioData(recomendado, inputRecomendado, config, 'Recomendado');
    const cenarioPremium = toCenarioData(premium, inputPremium, config, 'Premium');

    const snapshotsByScenario: Record<'economico' | 'recomendado' | 'premium', ScenarioSnapshot> = {
        economico: {
            input: inputEconomico,
            output: economico,
            unidadeId: config.unidadeId,
            configVersionId: config.configVersionId,
            moeda: config.currency,
        },
        recomendado: {
            input: inputRecomendado,
            output: recomendado,
            unidadeId: config.unidadeId,
            configVersionId: config.configVersionId,
            moeda: config.currency,
        },
        premium: {
            input: inputPremium,
            output: premium,
            unidadeId: config.unidadeId,
            configVersionId: config.configVersionId,
            moeda: config.currency,
        },
    };

    return ok({
        avaliacaoId,
        pacienteId: avaliacao.pacienteId,
        pacienteNome: avaliacao.paciente?.nome || 'Paciente',
        unidadeId: config.unidadeId,
        configVersionId: config.configVersionId,
        moeda: config.currency,
        cenarioEconomico: JSON.stringify(cenarioEconomico),
        cenarioRecomendado: JSON.stringify(cenarioRecomendado),
        cenarioPremium: JSON.stringify(cenarioPremium),
        valorFinal: cenarioRecomendado.totalSemanal,
        snapshotsByScenario,
        metadados,
    });
}

export const GET = withErrorBoundary(handleGet);
