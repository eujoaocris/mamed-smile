import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
    PricingConfigSnapshot,
    PricingDiseaseRule,
    PricingDiscountPresetRule,
    PricingHourRule,
    PricingMiniCostRule,
    PricingPaymentFeeRule,
    PricingCommissionPercentRule,
} from './enterprise-engine';

const DEFAULT_UNIT_CODE = 'MATRIZ';

const DEFAULT_HOUR_FACTORS: Array<{ hora: number; fatorPercent: number }> = [
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

const DEFAULT_PAYMENT_FEES = [
    { metodo: 'PIX', periodo: 'SEMANAL', taxaPercent: 0 },
    { metodo: 'PIX', periodo: 'MENSAL', taxaPercent: 0 },
    { metodo: 'BOLETO', periodo: 'MENSAL', taxaPercent: 1.99 },
    { metodo: 'CARTAO_CREDITO', periodo: 'MENSAL', taxaPercent: 4.0 },
    { metodo: 'CARTAO_CREDITO', periodo: 'SEMANAL', taxaPercent: 4.0 },
];

const DEFAULT_MINI_COSTS = [
    { tipo: 'VISITA_SUPERVISAO', nome: 'Visita de supervisao', valor: 35, escalaHoras: false, ativoPadrao: true, opcionalNoFechamento: true },
    { tipo: 'RESERVA_TECNICA', nome: 'Reserva tecnica', valor: 22, escalaHoras: false, ativoPadrao: true, opcionalNoFechamento: true },
    { tipo: 'ENFERMEIRO_EMERGENCIAL', nome: 'Enfermeiro emergencial', valor: 18, escalaHoras: true, ativoPadrao: false, opcionalNoFechamento: true },
    { tipo: 'OUTROS', nome: 'Outros minicustos', valor: 12, escalaHoras: false, ativoPadrao: false, opcionalNoFechamento: true },
];

const DEFAULT_COMMISSION_PERCENTS = [
    { tipo: 'MARKETING', nome: 'Marketing', percentual: 3.5 },
    { tipo: 'REINVESTIMENTO', nome: 'Reinvestimento', percentual: 2.0 },
    { tipo: 'RESERVA', nome: 'Reserva', percentual: 1.5 },
    { tipo: 'RC', nome: 'Responsabilidade civil', percentual: 1.0 },
];

const DEFAULT_DISCOUNTS = [
    { nome: 'SEMANAL_2', etiqueta: 'Semanal', percentual: 2 },
    { nome: 'MENSAL_5', etiqueta: 'Mensal', percentual: 5 },
    { nome: 'TRIMESTRAL_10', etiqueta: 'Trimestral', percentual: 10 },
    { nome: 'SEMESTRAL_12', etiqueta: 'Semestral', percentual: 12 },
];

const DEFAULT_DISEASES = [
    { codigo: 'ALZHEIMER', nome: 'Alzheimer', complexidade: 'MEDIA', profissionalMinimo: 'AUXILIAR_ENF', adicionalPercent: 8 },
    { codigo: 'PARKINSON', nome: 'Parkinson', complexidade: 'MEDIA', profissionalMinimo: 'AUXILIAR_ENF', adicionalPercent: 7 },
    { codigo: 'AVC_SEQUELA', nome: 'AVC com sequela', complexidade: 'ALTA', profissionalMinimo: 'TECNICO_ENF', adicionalPercent: 12 },
    { codigo: 'DEMENCIA', nome: 'Demencia', complexidade: 'MEDIA', profissionalMinimo: 'AUXILIAR_ENF', adicionalPercent: 6 },
];

const DEFAULT_SERVICOS_AVULSOS = [
    { codigo: 'BANHO_ASSISTIDO', nome: 'Banho assistido', valorCuidador: 80, valorAuxiliarEnf: 100, valorTecnicoEnf: 120, valorEnfermeiro: 150, aplicarMargem: true, aplicarMinicustos: false, aplicarImpostos: true },
    { codigo: 'ACOMPANHAMENTO_CONSULTA', nome: 'Acompanhamento em consulta', valorCuidador: 120, valorAuxiliarEnf: 150, valorTecnicoEnf: 180, valorEnfermeiro: 220, aplicarMargem: true, aplicarMinicustos: false, aplicarImpostos: true },
    { codigo: 'TROCA_FRALDA', nome: 'Troca de fralda', valorCuidador: 50, valorAuxiliarEnf: 60, valorTecnicoEnf: 70, valorEnfermeiro: 90, aplicarMargem: true, aplicarMinicustos: false, aplicarImpostos: true },
    { codigo: 'APLICACAO_MEDICACAO', nome: 'Aplicação de medicação', valorCuidador: 0, valorAuxiliarEnf: 80, valorTecnicoEnf: 100, valorEnfermeiro: 130, aplicarMargem: true, aplicarMinicustos: false, aplicarImpostos: true },
    { codigo: 'CURATIVOS', nome: 'Curativos', valorCuidador: 0, valorAuxiliarEnf: 90, valorTecnicoEnf: 110, valorEnfermeiro: 140, aplicarMargem: true, aplicarMinicustos: false, aplicarImpostos: true },
];

async function ensureDefaultRows(configVersionId: string, unidadeId: string) {
    for (const item of DEFAULT_HOUR_FACTORS) {
        await prisma.unidadeRegraHora.upsert({
            where: { configVersionId_hora: { configVersionId, hora: item.hora } },
            create: {
                unidadeId,
                configVersionId,
                hora: item.hora,
                fatorPercent: item.fatorPercent,
                ativa: true,
            },
            update: {},
        });
    }

    for (const item of DEFAULT_PAYMENT_FEES) {
        await prisma.unidadeTaxaPagamento.upsert({
            where: {
                configVersionId_metodo_periodo: {
                    configVersionId,
                    metodo: item.metodo,
                    periodo: item.periodo,
                },
            },
            create: {
                unidadeId,
                configVersionId,
                metodo: item.metodo,
                periodo: item.periodo,
                taxaPercent: item.taxaPercent,
                ativa: true,
            },
            update: {},
        });
    }

    for (const item of DEFAULT_MINI_COSTS) {
        await prisma.unidadeMinicusto.upsert({
            where: { configVersionId_tipo: { configVersionId, tipo: item.tipo } },
            create: {
                unidadeId,
                configVersionId,
                tipo: item.tipo,
                nome: item.nome,
                valor: item.valor,
                escalaHoras: item.escalaHoras,
                ativoPadrao: item.ativoPadrao,
                opcionalNoFechamento: item.opcionalNoFechamento,
            },
            update: {},
        });
    }

    for (const item of DEFAULT_COMMISSION_PERCENTS) {
        await prisma.unidadePercentualComissao.upsert({
            where: { configVersionId_tipo: { configVersionId, tipo: item.tipo } },
            create: {
                unidadeId,
                configVersionId,
                tipo: item.tipo,
                nome: item.nome,
                percentual: item.percentual,
                ativo: true,
            },
            update: {},
        });
    }

    for (const item of DEFAULT_DISCOUNTS) {
        await prisma.unidadeDescontoPreset.upsert({
            where: { configVersionId_nome: { configVersionId, nome: item.nome } },
            create: {
                unidadeId,
                configVersionId,
                nome: item.nome,
                etiqueta: item.etiqueta,
                percentual: item.percentual,
                ativo: true,
            },
            update: {},
        });
    }

    for (const item of DEFAULT_DISEASES) {
        await prisma.unidadeDoencaRegra.upsert({
            where: { configVersionId_codigo: { configVersionId, codigo: item.codigo } },
            create: {
                unidadeId,
                configVersionId,
                codigo: item.codigo,
                nome: item.nome,
                complexidade: item.complexidade,
                profissionalMinimo: item.profissionalMinimo,
                adicionalPercent: item.adicionalPercent,
                ativa: true,
            },
            update: {},
        });
    }

    for (const item of DEFAULT_SERVICOS_AVULSOS) {
        await prisma.unidadeServicoAvulso.upsert({
            where: { configVersionId_codigo: { configVersionId, codigo: item.codigo } },
            create: {
                unidadeId,
                configVersionId,
                codigo: item.codigo,
                nome: item.nome,
                valorCuidador: item.valorCuidador,
                valorAuxiliarEnf: item.valorAuxiliarEnf,
                valorTecnicoEnf: item.valorTecnicoEnf,
                valorEnfermeiro: item.valorEnfermeiro,
                aplicarMargem: item.aplicarMargem,
                aplicarMinicustos: item.aplicarMinicustos,
                aplicarImpostos: item.aplicarImpostos,
                ativo: true,
            },
            update: {},
        });
    }
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function ensureDefaultPricingConfig() {
    const unidade = await prisma.unidade.upsert({
        where: { codigo: DEFAULT_UNIT_CODE },
        create: {
            codigo: DEFAULT_UNIT_CODE,
            nome: 'Mãos Amigas — Toledo PR',
            cidade: 'Toledo',
            estado: 'PR',
            timezone: 'America/Sao_Paulo',
            moeda: 'BRL',
            ativa: true,
        },
        update: {},
    });

    let activeVersion = await prisma.unidadeConfiguracaoVersao.findFirst({
        where: {
            unidadeId: unidade.id,
            isActive: true,
        },
        orderBy: { version: 'desc' },
    });

    if (!activeVersion) {
        try {
            activeVersion = await prisma.unidadeConfiguracaoVersao.upsert({
                where: {
                    unidadeId_version: {
                        unidadeId: unidade.id,
                        version: 1,
                    },
                },
                create: {
                    unidadeId: unidade.id,
                    version: 1,
                    isActive: true,
                    isDraft: false,
                    nome: 'Configuracao Inicial',
                    descricao: 'Versao inicial padrao da matriz',
                    baseCuidador12h: 180,
                    baseAuxiliarEnf12h: 240,
                    baseTecnicoEnf12h: 300,
                    baseEnfermeiro12h: 360,
                    margemPercent: 32,
                    lucroFixo: 0,
                    lucroFixoEscalaHoras: false,
                    adicionalSegundoPacientePercent: 50,
                    adicionalNoturnoPercent: 20,
                    adicionalFimSemanaPercent: 20,
                    adicionalFeriadoPercent: 20,
                    adicionalAltoRiscoPercent: 15,
                    adicionalAtPercent: 0,
                    adicionalAaPercent: 0,
                    adicionalAtEscalaHoras: true,
                    adicionalAaEscalaHoras: true,
                    impostoSobreComissaoPercent: 6,
                    aplicarTaxaAntesDesconto: false,
                },
                update: {
                    isActive: true,
                    isDraft: false,
                },
            });
        } catch (error) {
            // Corrida de inicializacao em requests paralelos: buscar a versao criada pela outra request.
            if (!isUniqueConstraintError(error)) {
                throw error;
            }
            activeVersion = await prisma.unidadeConfiguracaoVersao.findFirst({
                where: {
                    unidadeId: unidade.id,
                    version: 1,
                },
            });
        }
    }

    if (!activeVersion) {
        throw new Error('Falha ao inicializar configuracao padrao da unidade');
    }

    await ensureDefaultRows(activeVersion.id, unidade.id);
    return { unidadeId: unidade.id, configVersionId: activeVersion.id };
}

function toHourRules(rows: Array<{ hora: number; fatorPercent: number }>): PricingHourRule[] {
    return rows
        .map((row) => ({ hora: row.hora, fatorPercent: row.fatorPercent }))
        .sort((a, b) => a.hora - b.hora);
}

function toPaymentFeeRules(rows: Array<{ metodo: string; periodo: string; taxaPercent: number; ativa: boolean }>): PricingPaymentFeeRule[] {
    return rows.map((row) => ({
        metodo: row.metodo,
        periodo: row.periodo,
        taxaPercent: row.taxaPercent,
        ativa: row.ativa,
    }));
}

function toMiniCostRules(rows: Array<{
    tipo: string;
    nome: string;
    valor: number;
    escalaHoras: boolean;
    ativoPadrao: boolean;
    opcionalNoFechamento: boolean;
}>): PricingMiniCostRule[] {
    return rows.map((row) => ({
        tipo: row.tipo,
        nome: row.nome,
        valor: row.valor,
        escalaHoras: row.escalaHoras,
        ativoPadrao: row.ativoPadrao,
        opcionalNoFechamento: row.opcionalNoFechamento,
    }));
}

function toCommissionRules(rows: Array<{ tipo: string; nome: string; percentual: number; ativo: boolean }>): PricingCommissionPercentRule[] {
    return rows.map((row) => ({
        tipo: row.tipo,
        nome: row.nome,
        percentual: row.percentual,
        ativo: row.ativo,
    }));
}

function toDiseaseRules(rows: Array<{
    codigo: string;
    nome: string;
    complexidade: string;
    profissionalMinimo: string;
    adicionalPercent: number;
    ativa: boolean;
}>): PricingDiseaseRule[] {
    return rows.map((row) => ({
        codigo: row.codigo,
        nome: row.nome,
        complexidade: row.complexidade,
        profissionalMinimo: row.profissionalMinimo,
        adicionalPercent: row.adicionalPercent,
        ativa: row.ativa,
    }));
}

function toDiscountRules(rows: Array<{ nome: string; percentual: number; ativo: boolean }>): PricingDiscountPresetRule[] {
    return rows.map((row) => ({
        nome: row.nome,
        percentual: row.percentual,
        ativo: row.ativo,
    }));
}

export async function getPricingConfigSnapshot(options?: {
    unidadeId?: string;
    unidadeCodigo?: string;
    configVersionId?: string;
}): Promise<PricingConfigSnapshot> {
    await ensureDefaultPricingConfig();

    let configVersionById: Awaited<ReturnType<typeof prisma.unidadeConfiguracaoVersao.findUnique>> | null = null;
    if (options?.configVersionId) {
        configVersionById = await prisma.unidadeConfiguracaoVersao.findUnique({
            where: { id: options.configVersionId },
        });
        if (!configVersionById) {
            throw new Error('Configuracao solicitada nao encontrada');
        }
    }

    const unidadeWhere = configVersionById
        ? { id: configVersionById.unidadeId }
        : options?.unidadeId
            ? { id: options.unidadeId }
            : options?.unidadeCodigo
                ? { codigo: options.unidadeCodigo }
                : { codigo: DEFAULT_UNIT_CODE };

    const unidade = await prisma.unidade.findUnique({
        where: unidadeWhere,
    });
    if (!unidade) {
        throw new Error('Unidade não encontrada');
    }

    const configVersion = configVersionById ?? await prisma.unidadeConfiguracaoVersao.findFirst({
        where: {
            unidadeId: unidade.id,
            isActive: true,
        },
        orderBy: { version: 'desc' },
    });
    if (!configVersion) {
        throw new Error('Configuração ativa não encontrada para a unidade');
    }

    const [hourRules, paymentFeeRules, miniCostRules, commissionPercentRules, diseaseRules, discountPresets] = await Promise.all([
        prisma.unidadeRegraHora.findMany({ where: { configVersionId: configVersion.id, ativa: true } }),
        prisma.unidadeTaxaPagamento.findMany({ where: { configVersionId: configVersion.id } }),
        prisma.unidadeMinicusto.findMany({ where: { configVersionId: configVersion.id } }),
        prisma.unidadePercentualComissao.findMany({ where: { configVersionId: configVersion.id } }),
        prisma.unidadeDoencaRegra.findMany({ where: { configVersionId: configVersion.id } }),
        prisma.unidadeDescontoPreset.findMany({ where: { configVersionId: configVersion.id } }),
    ]);

    return {
        unidadeId: unidade.id,
        unidadeCodigo: unidade.codigo,
        unidadeNome: unidade.nome,
        currency: unidade.moeda || 'BRL',
        configVersionId: configVersion.id,
        configVersion: configVersion.version,
        aplicarTaxaAntesDesconto: configVersion.aplicarTaxaAntesDesconto,
        base12h: {
            CUIDADOR: configVersion.baseCuidador12h,
            AUXILIAR_ENF: configVersion.baseAuxiliarEnf12h,
            TECNICO_ENF: configVersion.baseTecnicoEnf12h,
            ENFERMEIRO: configVersion.baseEnfermeiro12h ?? configVersion.baseTecnicoEnf12h,
        },
        adicionaisPercent: {
            segundoPaciente: configVersion.adicionalSegundoPacientePercent,
            noturno: configVersion.adicionalNoturnoPercent,
            fimSemana: configVersion.adicionalFimSemanaPercent,
            feriado: configVersion.adicionalFeriadoPercent,
            altoRisco: configVersion.adicionalAltoRiscoPercent,
            at: configVersion.adicionalAtPercent,
            aa: configVersion.adicionalAaPercent,
        },
        adicionaisEscalaHoras: {
            at: configVersion.adicionalAtEscalaHoras,
            aa: configVersion.adicionalAaEscalaHoras,
        },
        margemPercent: configVersion.margemPercent,
        lucroFixo: configVersion.lucroFixo,
        lucroFixoEscalaHoras: configVersion.lucroFixoEscalaHoras,
        impostoSobreComissaoPercent: configVersion.impostoSobreComissaoPercent,
        hourRules: toHourRules(hourRules),
        paymentFeeRules: toPaymentFeeRules(paymentFeeRules),
        miniCostRules: toMiniCostRules(miniCostRules),
        commissionPercentRules: toCommissionRules(commissionPercentRules),
        diseaseRules: toDiseaseRules(diseaseRules),
        discountPresets: toDiscountRules(discountPresets),
    };
}
