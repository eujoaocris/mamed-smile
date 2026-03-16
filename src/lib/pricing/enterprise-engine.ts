export type PricingProfessional = 'CUIDADOR' | 'TECNICO_ENF' | 'ENFERMEIRO';
export type PricingComplexity = 'BAIXA' | 'MEDIA' | 'ALTA';

export interface PricingHourRule {
    hora: number;
    fatorPercent: number;
}

export interface PricingPaymentFeeRule {
    metodo: string;
    periodo: string;
    taxaPercent: number;
    ativa: boolean;
}

export interface PricingMiniCostRule {
    tipo: string;
    nome: string;
    valor: number;
    escalaHoras: boolean;
    cobrancaUnica: boolean;
    ativoPadrao: boolean;
    opcionalNoFechamento: boolean;
}

export interface PricingCommissionPercentRule {
    tipo: string;
    nome: string;
    percentual: number;
    ativo: boolean;
}

export interface PricingDiseaseRule {
    codigo: string;
    nome: string;
    complexidade: PricingComplexity | string;
    profissionalMinimo: PricingProfessional | string;
    adicionalPercent: number;
    ativa: boolean;
}

export interface PricingDiscountPresetRule {
    nome: string;
    percentual: number;
    ativo: boolean;
}

export interface PricingConfigSnapshot {
    unidadeId: string;
    unidadeCodigo: string;
    unidadeNome: string;
    currency: string;
    configVersionId: string;
    configVersion: number;
    aplicarTaxaAntesDesconto: boolean;
    base12h: {
        CUIDADOR: number;
        TECNICO_ENF: number;
        ENFERMEIRO: number;
    };
    adicionaisPercent: {
        segundoPaciente: number;
        noturno: number;
        fimSemana: number;
        feriado: number;
        altoRisco: number;
        at: number;
        aa: number;
    };
    adicionaisEscalaHoras: {
        at: boolean;
        aa: boolean;
    };
    margemPercent: number;
    lucroFixo: number;
    lucroFixoEscalaHoras: boolean;
    impostoSobreComissaoPercent: number;
    hourRules: PricingHourRule[];
    paymentFeeRules: PricingPaymentFeeRule[];
    miniCostRules: PricingMiniCostRule[];
    commissionPercentRules: PricingCommissionPercentRule[];
    diseaseRules: PricingDiseaseRule[];
    discountPresets: PricingDiscountPresetRule[];
}

export interface PricingCalculationInput {
    profissional: PricingProfessional;
    horas: number;
    quantidadePacientes: number;
    metodoPagamento: string;
    periodoPagamento: string;
    diseaseCodes?: string[];
    descontoPresetPercent?: number;
    descontoManualPercent?: number;
    minicustosOverrides?: Record<string, boolean>;
    flags?: {
        noturno?: boolean;
        fimSemana?: boolean;
        feriado?: boolean;
        altoRisco?: boolean;
        adicionalAT?: boolean;
        adicionalAA?: boolean;
    };
}

export interface PricingBreakdownItem {
    key: string;
    label: string;
    value: number;
    meta?: string;
}

export interface PricingCalculationOutput {
    currency: string;
    unidadeId: string;
    configVersionId: string;
    configVersion: number;
    horas: number;
    fatorHoras: number;
    profissionalSolicitado: PricingProfessional;
    profissionalEfetivo: PricingProfessional;
    profissionalMinimoPorDoenca: PricingProfessional | null;
    doencasAplicadas: PricingDiseaseRule[];
    diseasePercentTotal: number;
    base12hProfissional: number;
    valorBaseProfissional: number;
    adicionaisPercentTotal: number;
    adicionaisValor: number;
    valorProfissionalTotal: number;
    lucroMargemValor: number;
    lucroFixoValor: number;
    comissaoBruta: number;
    gastosSobreComissaoPercentTotal: number;
    gastosSobreComissaoValor: number;
    impostoSobreComissaoPercent: number;
    impostoSobreComissaoValor: number;
    minicustosAtivos: Array<{
        tipo: string;
        nome: string;
        valorAplicado: number;
        escalaHoras: boolean;
        cobrancaUnica?: boolean;
    }>;
    minicustosTotal: number;
    subtotalSemTaxaSemDesconto: number;
    taxaPagamentoPercent: number;
    taxaPagamentoValor: number;
    descontoTotalPercent: number;
    descontoValor: number;
    totalFinal: number;
    breakdown: PricingBreakdownItem[];
}

const PROFESSIONAL_RANK: Record<PricingProfessional, number> = {
    CUIDADOR: 1,
    TECNICO_ENF: 2,
    ENFERMEIRO: 3,
};

function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
}

function normalizeProfessional(value: string): PricingProfessional | null {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'CUIDADOR') return 'CUIDADOR';
    if (normalized === 'AUXILIAR_ENF') return 'TECNICO_ENF';
    if (normalized === 'TECNICO_ENF') return 'TECNICO_ENF';
    if (normalized === 'ENFERMEIRO') return 'ENFERMEIRO';
    return null;
}

function normalizeMethod(value: string): string {
    return String(value || 'PIX').trim().toUpperCase();
}

function normalizePeriod(value: string): string {
    return String(value || 'SEMANAL').trim().toUpperCase();
}

function validateInput(input: PricingCalculationInput): void {
    if (!input.profissional) throw new Error('profissional é obrigatório');
    if (!Number.isFinite(input.horas) || input.horas <= 0) throw new Error('horas deve ser > 0');
    if (!Number.isFinite(input.quantidadePacientes) || input.quantidadePacientes <= 0) {
        throw new Error('quantidadePacientes deve ser > 0');
    }
}

function getHourFactor(hours: number, rules: PricingHourRule[]): number {
    const map = new Map<number, number>();
    for (const rule of rules) {
        if (rule.hora < 1 || rule.hora > 12) continue;
        map.set(rule.hora, rule.fatorPercent);
    }

    const fallback = (h: number) => round2(Math.max(0.01, h / 12));
    const segmentFactor = (h: number) => map.get(h) ?? fallback(h);

    let remaining = Math.round(hours);
    let totalFactor = 0;
    while (remaining > 0) {
        const segment = Math.min(12, remaining);
        totalFactor += segmentFactor(segment);
        remaining -= segment;
    }

    return round2(totalFactor);
}

function resolveRequiredProfessional(
    selectedDiseaseRules: PricingDiseaseRule[],
): PricingProfessional | null {
    let required: PricingProfessional | null = null;

    for (const rule of selectedDiseaseRules) {
        const candidate = normalizeProfessional(rule.profissionalMinimo);
        if (!candidate) continue;
        if (!required || PROFESSIONAL_RANK[candidate] > PROFESSIONAL_RANK[required]) {
            required = candidate;
        }
    }

    return required;
}

function resolvePaymentFeePercent(
    config: PricingConfigSnapshot,
    metodo: string,
    periodo: string,
): number {
    const normalizedMethod = normalizeMethod(metodo);
    const normalizedPeriod = normalizePeriod(periodo);
    const match = config.paymentFeeRules.find((rule) => (
        rule.ativa
        && normalizeMethod(rule.metodo) === normalizedMethod
        && normalizePeriod(rule.periodo) === normalizedPeriod
    ));
    return match ? Math.max(0, match.taxaPercent) : 0;
}

function resolveDiscountPercent(input: PricingCalculationInput): number {
    const preset = clampPercent(input.descontoPresetPercent ?? 0);
    const manual = clampPercent(input.descontoManualPercent ?? 0);
    return clampPercent(preset + manual);
}

function getBase12h(config: PricingConfigSnapshot, professional: PricingProfessional): number {
    return config.base12h[professional];
}

function pickDiseaseRules(config: PricingConfigSnapshot, diseaseCodes: string[] | undefined): PricingDiseaseRule[] {
    const selected = new Set((diseaseCodes || []).map((code) => String(code || '').trim().toUpperCase()).filter(Boolean));
    if (!selected.size) return [];
    return config.diseaseRules.filter((rule) => (
        rule.ativa && selected.has(String(rule.codigo || '').trim().toUpperCase())
    ));
}

export function calculateEnterprisePrice(
    config: PricingConfigSnapshot,
    input: PricingCalculationInput,
): PricingCalculationOutput {
    validateInput(input);

    const factorHours = getHourFactor(input.horas, config.hourRules);
    const selectedDiseaseRules = pickDiseaseRules(config, input.diseaseCodes);
    const professionalRequested = input.profissional;
    const requiredProfessional = resolveRequiredProfessional(selectedDiseaseRules);
    const professionalEffective = requiredProfessional
        && PROFESSIONAL_RANK[requiredProfessional] > PROFESSIONAL_RANK[professionalRequested]
        ? requiredProfessional
        : professionalRequested;

    const base12h = round2(getBase12h(config, professionalEffective));
    const baseProfessional = round2(base12h * factorHours);

    const secondPatientPercent = input.quantidadePacientes > 1 ? config.adicionaisPercent.segundoPaciente : 0;
    const diseasePercentTotal = round2(selectedDiseaseRules.reduce((acc, rule) => acc + Math.max(0, rule.adicionalPercent), 0));
    const noturnoPercent = input.flags?.noturno ? config.adicionaisPercent.noturno : 0;
    const fimSemanaPercent = input.flags?.fimSemana ? config.adicionaisPercent.fimSemana : 0;
    const feriadoPercent = input.flags?.feriado ? config.adicionaisPercent.feriado : 0;
    const altoRiscoPercent = input.flags?.altoRisco ? config.adicionaisPercent.altoRisco : 0;
    const atPercent = input.flags?.adicionalAT ? config.adicionaisPercent.at : 0;
    const aaPercent = input.flags?.adicionalAA ? config.adicionaisPercent.aa : 0;

    const atPercentApplied = config.adicionaisEscalaHoras.at ? atPercent * factorHours : atPercent;
    const aaPercentApplied = config.adicionaisEscalaHoras.aa ? aaPercent * factorHours : aaPercent;

    const adicionaisPercentTotal = round2(
        secondPatientPercent
        + diseasePercentTotal
        + noturnoPercent
        + fimSemanaPercent
        + feriadoPercent
        + altoRiscoPercent
        + atPercentApplied
        + aaPercentApplied
    );

    const adicionaisValue = round2(baseProfessional * (adicionaisPercentTotal / 100));
    const professionalTotal = round2(baseProfessional + adicionaisValue);

    const lucroMargemValue = round2(professionalTotal * (Math.max(0, config.margemPercent) / 100));
    const lucroFixoValue = round2(config.lucroFixoEscalaHoras ? config.lucroFixo * factorHours : config.lucroFixo);
    const comissaoBruta = round2(lucroMargemValue + lucroFixoValue);

    const commissionPercentTotal = round2(
        config.commissionPercentRules
            .filter((rule) => rule.ativo)
            .reduce((acc, rule) => acc + Math.max(0, rule.percentual), 0),
    );
    const gastosSobreComissaoValue = round2(comissaoBruta * (commissionPercentTotal / 100));
    const impostoPercent = Math.max(0, config.impostoSobreComissaoPercent);
    const impostoSobreComissaoValue = round2(comissaoBruta * (impostoPercent / 100));

    const minicustosAtivos = config.miniCostRules.flatMap((rule) => {
        const override = input.minicustosOverrides?.[rule.tipo];
        const active = typeof override === 'boolean' ? override : rule.ativoPadrao;
        if (!active) return [];
        // cobrancaUnica: valor fixo 1x no período, não multiplica por dias/horas
        const value = rule.cobrancaUnica
            ? round2(rule.valor)
            : round2(rule.escalaHoras ? rule.valor * factorHours : rule.valor);
        return [{
            tipo: rule.tipo,
            nome: rule.nome,
            valorAplicado: value,
            escalaHoras: rule.escalaHoras,
            cobrancaUnica: rule.cobrancaUnica,
        }];
    });
    const minicustosTotal = round2(minicustosAtivos.reduce((acc, item) => acc + item.valorAplicado, 0));

    const subtotalSemTaxaSemDesconto = round2(
        professionalTotal
        + comissaoBruta
        + gastosSobreComissaoValue
        + impostoSobreComissaoValue
        + minicustosTotal
    );

    const feePercent = resolvePaymentFeePercent(config, input.metodoPagamento, input.periodoPagamento);
    const discountPercent = resolveDiscountPercent(input);

    let taxaPagamentoValor = 0;
    let descontoValor = 0;
    let totalFinal = subtotalSemTaxaSemDesconto;

    if (config.aplicarTaxaAntesDesconto) {
        taxaPagamentoValor = round2(subtotalSemTaxaSemDesconto * (feePercent / 100));
        const baseComTaxa = round2(subtotalSemTaxaSemDesconto + taxaPagamentoValor);
        descontoValor = round2(baseComTaxa * (discountPercent / 100));
        totalFinal = round2(baseComTaxa - descontoValor);
    } else {
        descontoValor = round2(subtotalSemTaxaSemDesconto * (discountPercent / 100));
        const baseComDesconto = round2(subtotalSemTaxaSemDesconto - descontoValor);
        taxaPagamentoValor = round2(baseComDesconto * (feePercent / 100));
        totalFinal = round2(baseComDesconto + taxaPagamentoValor);
    }

    const breakdown: PricingBreakdownItem[] = [
        { key: 'valor_base_profissional', label: 'Valor base profissional', value: baseProfessional },
        { key: 'adicionais_profissional', label: 'Adicionais profissional', value: adicionaisValue, meta: `${adicionaisPercentTotal}%` },
        { key: 'valor_profissional_total', label: 'Valor profissional total', value: professionalTotal },
        { key: 'lucro_margem', label: 'Lucro por margem', value: lucroMargemValue, meta: `${config.margemPercent}%` },
        { key: 'lucro_fixo', label: 'Lucro fixo', value: lucroFixoValue },
        { key: 'comissao_bruta', label: 'Comissão bruta', value: comissaoBruta },
        { key: 'gastos_sobre_comissao', label: 'Gastos sobre comissão', value: gastosSobreComissaoValue, meta: `${commissionPercentTotal}%` },
        { key: 'imposto_sobre_comissao', label: 'Imposto sobre comissão', value: impostoSobreComissaoValue, meta: `${impostoPercent}%` },
        { key: 'minicustos', label: 'Minicustos', value: minicustosTotal },
        { key: 'subtotal_sem_taxa_sem_desconto', label: 'Subtotal', value: subtotalSemTaxaSemDesconto },
        { key: 'taxa_pagamento', label: 'Taxa de pagamento', value: taxaPagamentoValor, meta: `${feePercent}%` },
        { key: 'desconto', label: 'Desconto', value: -descontoValor, meta: `${discountPercent}%` },
        { key: 'total_final', label: 'Total final', value: totalFinal },
    ];

    return {
        currency: config.currency,
        unidadeId: config.unidadeId,
        configVersionId: config.configVersionId,
        configVersion: config.configVersion,
        horas: Math.round(input.horas),
        fatorHoras: factorHours,
        profissionalSolicitado: professionalRequested,
        profissionalEfetivo: professionalEffective,
        profissionalMinimoPorDoenca: requiredProfessional,
        doencasAplicadas: selectedDiseaseRules,
        diseasePercentTotal,
        base12hProfissional: base12h,
        valorBaseProfissional: baseProfessional,
        adicionaisPercentTotal,
        adicionaisValor: adicionaisValue,
        valorProfissionalTotal: professionalTotal,
        lucroMargemValor: lucroMargemValue,
        lucroFixoValor: lucroFixoValue,
        comissaoBruta,
        gastosSobreComissaoPercentTotal: commissionPercentTotal,
        gastosSobreComissaoValor: gastosSobreComissaoValue,
        impostoSobreComissaoPercent: impostoPercent,
        impostoSobreComissaoValor: impostoSobreComissaoValue,
        minicustosAtivos,
        minicustosTotal,
        subtotalSemTaxaSemDesconto,
        taxaPagamentoPercent: feePercent,
        taxaPagamentoValor,
        descontoTotalPercent: discountPercent,
        descontoValor,
        totalFinal,
        breakdown,
    };
}
