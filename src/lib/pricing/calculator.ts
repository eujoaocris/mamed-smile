import type { ComplexidadeNivel, TipoProfissional } from '@/types/evaluation';
import type { PricingConfigSnapshot, PricingHourRule } from './enterprise-engine';
import { getPricingConfigSnapshot } from './config-service';
import type { NormalizedSchedule } from '@/lib/scheduling/recurrence-engine';

/**
 * CALCULADORA DE ORÇAMENTOS - MÃOS AMIGAS
 * 
 * Este módulo implementa a lógica de precificação para serviços de cuidado domiciliar
 * e acompanhamento hospitalar. O sistema gera três cenários de orçamento:
 * - Econômico: Profissional de nível inferior ao solicitado
 * - Recomendado: Exatamente o que foi solicitado
 * - Premium: Profissional de nível superior + supervisão de enfermagem
 * 
 * A precificação considera:
 * - Tipo de profissional (Cuidador, Técnico de Enfermagem)
 * - Complexidade do caso (Baixa, Média, Alta)
 * - Horas diárias de atendimento
 * - Duração do serviço em dias
 * - Adicional noturno (plantões > 12h)
 * - Adicional de feriados
 * - Taxa administrativa (20%)
 */

/**
 * Tabela de preços por hora para cada tipo de profissional.
 * Valores em R$ por hora de trabalho.
 * - diurno: 6h às 22h
 * - noturno: 22h às 6h (adicional de 20%)
 * - feriado: adicional de 50% sobre o valor diurno
 */
const TABELA_PRECOS: Record<TipoProfissional, { diurno: number; noturno: number; feriado: number }> = {
    CUIDADOR: { diurno: 15.00, noturno: 18.00, feriado: 22.50 },
    TECNICO_ENF: { diurno: 30.00, noturno: 36.00, feriado: 45.00 },
};

/**
 * Multiplicadores de complexidade do caso.
 * Aplicados sobre o valor base para refletir a demanda de cuidado.
 * - NAO_ELEGIVEL: Paciente não elegível para atendimento domiciliar
 * - BAIXA: Cuidados básicos (AVDs, companhia)
 * - MEDIA: Cuidados intermediários (medicação, curativos simples)
 * - ALTA: Cuidados complexos (sondas, traqueostomia, etc)
 */
const MULTIPLICADOR_COMPLEXIDADE: Record<ComplexidadeNivel, number> = {
    NAO_ELEGIVEL: 0,
    BAIXA: 1.0,
    MEDIA: 1.25,
    ALTA: 1.50,
};

/**
 * Taxa administrativa cobrada sobre o valor total.
 * Cobre custos operacionais, gestão de equipe e suporte 24h.
 */
const TAXA_ADMINISTRATIVA = 0.20;

export interface OrcamentoInput {
    tipoProfissional: TipoProfissional;
    complexidade: ComplexidadeNivel;
    horasDiarias: number;
    duracaoDias: number;
    diasAtivos?: number; // dias efetivos de atendimento dentro da janela
    incluirNoturno?: boolean;
    feriados?: number; // quantidade de dias de feriado
    quantidadePacientes?: number;
    adicionalPercentual?: number; // adicional tecnico/manual acumulado (%)
}

export interface OrcamentoOutput {
    valorHora: number;
    horasTotais: number;
    diasAtivos: number;
    quantidadePacientes: number;
    subtotal: number;
    adicionalComplexidade: number;
    adicionalPacientes: number;
    adicionalVariaveis: number;
    adicionalNoturno: number;
    adicionalFeriado: number;
    taxaAdministrativa: number;
    total: number;
    demandaEquipe: boolean;
    quantidadeCuidadores: number;
    parcelamento: {
        entrada: number;
        quantidadeParcelas: number;
        valorParcela: number;
    };
    detalhamento: {
        descricao: string;
        valor: number;
    }[];
}

export interface OrcamentoCenarios {
    economico: OrcamentoOutput;
    recomendado: OrcamentoOutput;
    premium: OrcamentoOutput;
}

/**
 * Gera 3 cenários de orçamento para validação do avaliador
 */
export function calcularOrcamentoCenarios(input: OrcamentoInput): OrcamentoCenarios {
    // 1. Cenário Recomendado (Input Original)
    const recomendado = calcularOrcamento(input);

    // 2. Cenário Econômico
    // Reduz complexidade em 1 nível (se possível) ou usa profissional base
    // Exemplo: Se pediu TÉCNICO, tenta orçar com CUIDADOR + Supervisão (simulado)
    const inputEconomico = { ...input };
    if (input.tipoProfissional === 'TECNICO_ENF') inputEconomico.tipoProfissional = 'CUIDADOR';

    // Remove adicionais opcionais no econômico (simulação)
    const economico = calcularOrcamento(inputEconomico);


    // 3. Cenário Premium
    // Adiciona margem de supervisão e garante melhor profissional
    const inputPremium = { ...input };
    if (input.tipoProfissional === 'CUIDADOR') inputPremium.tipoProfissional = 'TECNICO_ENF';

    // No Premium, adicionamos uma taxa extra de "Supervisão Enfermagem Semanal"
    // Vamos injetar isso manipulando o resultado (ou criando suporte no input)
    const basePremium = calcularOrcamento(inputPremium);

    // Adicionar item manual ao detalhamento do Premium
    const taxaSupervisao = 600.00; // Valor fixo exemplo
    basePremium.total += taxaSupervisao;
    basePremium.detalhamento.push({
        descricao: 'Supervisão de Enfermagem Semanal (Premium)',
        valor: taxaSupervisao
    });
    // Recalcula parcelamento
    basePremium.parcelamento.entrada = basePremium.total * 0.30;
    basePremium.parcelamento.valorParcela = (basePremium.total - basePremium.parcelamento.entrada) / basePremium.parcelamento.quantidadeParcelas;

    return {
        economico,
        recomendado,
        premium: basePremium
    };
}

// Tornando a função base exportada como helper, mas o foco é a de cenários
export function calcularOrcamento(input: OrcamentoInput): OrcamentoOutput {
    // ... (rest of the existing function logic, no changes needed inside)
    const {
        tipoProfissional,
        complexidade,
        horasDiarias,
        duracaoDias,
        diasAtivos,
        incluirNoturno = false,
        feriados = 0,
        quantidadePacientes = 1,
        adicionalPercentual = 0,
    } = input;

    // Verificar elegibilidade
    if (complexidade === 'NAO_ELEGIVEL') {
        throw new Error('Paciente não elegível para atendimento domiciliar');
    }

    // 1. Valor hora base
    const precos = TABELA_PRECOS[tipoProfissional];
    const valorHoraBase = precos.diurno;

    // 2. Calcular horas por tipo
    const diasPlanejados = Math.max(1, Math.min(duracaoDias, diasAtivos ?? duracaoDias));
    const feriadosAplicados = Math.max(0, Math.min(feriados, diasPlanejados));
    const diasNormais = diasPlanejados - feriadosAplicados;
    let horasDiurnas = 0;
    let horasNoturnas = 0;
    let horasFeriado = 0;

    if (horasDiarias <= 12) {
        // Plantão diurno apenas
        horasDiurnas = horasDiarias * diasNormais;
        horasFeriado = horasDiarias * feriadosAplicados;
    } else {
        // Plantão 24h
        horasDiurnas = 12 * diasNormais;
        horasNoturnas = 12 * diasNormais;
        horasFeriado = 24 * feriadosAplicados;
    }

    // 3. Calcular valores
    const valorDiurno = horasDiurnas * precos.diurno;
    const valorNoturno = horasNoturnas * precos.noturno;
    const valorFeriado = horasFeriado * precos.feriado;

    const subtotal = valorDiurno + valorNoturno + valorFeriado;

    // 4. Aplicar multiplicador de complexidade
    const multiplicador = MULTIPLICADOR_COMPLEXIDADE[complexidade];
    const adicionalComplexidade = subtotal * (multiplicador - 1);
    const totalComComplexidade = subtotal + adicionalComplexidade;

    // 4.1 Adicional por paciente extra (50% por paciente extra)
    const pacientesExtras = Math.max(0, Math.round(quantidadePacientes) - 1);
    const adicionalPacientes = totalComComplexidade * (0.5 * pacientesExtras);

    // 4.2 Adicional tecnico/manual acumulado
    const adicionalVariaveis = (totalComComplexidade + adicionalPacientes) * (Math.max(0, adicionalPercentual) / 100);
    const totalComAdicionais = totalComComplexidade + adicionalPacientes + adicionalVariaveis;

    // 5. Verificar demanda de equipe (>4 dias)
    const demandaEquipe = diasPlanejados > 4;
    let quantidadeCuidadores = 1;
    let totalEquipe = totalComAdicionais;

    if (demandaEquipe) {
        // Calcular quantidade de cuidadores para cobertura
        if (horasDiarias === 24) {
            quantidadeCuidadores = 8; // 3 turnos x 7 dias + folguista
        } else if (horasDiarias === 12) {
            quantidadeCuidadores = 4;
        } else {
            quantidadeCuidadores = 2;
        }

        // Ajustar proporcionalmente (não multiplicar direto)
        // Cada cuidador cobre ~40h/semana
        const horasSemanaisTotais = horasDiarias * 7;
        const cuidadoresNecessarios = Math.ceil(horasSemanaisTotais / 40);
        totalEquipe = totalComAdicionais * (cuidadoresNecessarios / 1);
    }

    // 6. Taxa administrativa
    const taxaAdmin = totalEquipe * TAXA_ADMINISTRATIVA;

    // 7. Total final
    const total = totalEquipe + taxaAdmin;

    // 8. Parcelamento
    const entrada = total * 0.30;
    const restante = total - entrada;
    const quantidadeParcelas = Math.min(12, Math.max(1, Math.floor(duracaoDias / 5)));
    const valorParcela = restante / quantidadeParcelas;

    // 9. Detalhamento
    const detalhamento = [
        { descricao: `Horas diurnas (${horasDiurnas}h x R$${precos.diurno.toFixed(2)})`, valor: valorDiurno },
    ];

    if (horasNoturnas > 0) {
        detalhamento.push({
            descricao: `Horas noturnas (${horasNoturnas}h x R$${precos.noturno.toFixed(2)})`,
            valor: valorNoturno,
        });
    }

    if (horasFeriado > 0) {
        detalhamento.push({
            descricao: `Horas feriado (${horasFeriado}h x R$${precos.feriado.toFixed(2)})`,
            valor: valorFeriado,
        });
    }

    if (adicionalComplexidade > 0) {
        detalhamento.push({
            descricao: `Adicional complexidade ${complexidade} (+${((multiplicador - 1) * 100).toFixed(0)}%)`,
            valor: adicionalComplexidade,
        });
    }

    if (adicionalPacientes > 0) {
        detalhamento.push({
            descricao: `Adicional por paciente extra (${pacientesExtras} extra)`,
            valor: adicionalPacientes,
        });
    }

    if (adicionalVariaveis > 0) {
        detalhamento.push({
            descricao: `Adicionais tecnicos/manuais (+${Math.max(0, adicionalPercentual).toFixed(1)}%)`,
            valor: adicionalVariaveis,
        });
    }

    if (demandaEquipe) {
        detalhamento.push({
            descricao: `Equipe (${quantidadeCuidadores} profissionais em escala)`,
            valor: totalEquipe - totalComAdicionais,
        });
    }

    detalhamento.push({
        descricao: 'Taxa administrativa (20%)',
        valor: taxaAdmin,
    });

    return {
        valorHora: valorHoraBase * multiplicador,
        horasTotais: horasDiurnas + horasNoturnas + horasFeriado,
        diasAtivos: diasPlanejados,
        quantidadePacientes: Math.max(1, Math.round(quantidadePacientes)),
        subtotal,
        adicionalComplexidade,
        adicionalPacientes,
        adicionalVariaveis,
        adicionalNoturno: valorNoturno,
        adicionalFeriado: valorFeriado,
        taxaAdministrativa: taxaAdmin,
        total,
        demandaEquipe,
        quantidadeCuidadores,
        parcelamento: {
            entrada,
            quantidadeParcelas,
            valorParcela,
        },
        detalhamento,
    };
}

export interface EnterprisePricingParams {
    schedule: NormalizedSchedule;
    baseProfessionalValue: number;
    paymentMethod: 'PIX' | 'CARTAO' | 'BOLETO' | 'CARTAO_CREDITO' | 'LINK_PAGAMENTO';
    diseaseComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
    unitConfigId: string;
    manualDiscount?: number;
    disableMinicosts?: string[];
    paymentPeriod?: 'DIARIO' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
    quantityPatients?: number;
    additionalPercent?: number;
    shiftType?: 'DIURNO' | 'NOTURNO' | '24H' | 'CUSTOM';
    isEmergencyShift?: boolean;
    emergencySurchargePercent?: number;
    discountFixed?: number;
}

export interface EnterprisePricingResult {
    costProfessional: number;
    additions: {
        holiday: number;
        night: number;
        extraPatient: number;
        manual: number;
    };
    minicosts: Record<string, number>;
    grossMargin: number;
    taxOverMargin: number;
    paymentFee: number;
    discount: number;
    finalPrice: number;
    commissionOperationalCosts: number;
    subtotalBeforeFeeAndDiscount: number;
    totalOccurrences: number;
    totalHours: number;
    equivalentWeekly: number;
    equivalentMonthly: number;
    configVersionId: string;
    unidadeId: string;
    currency: string;
    breakdown: {
        custo_profissional: number;
        adicionais_por_evento: {
            night: number;
            weekend: number;
            holiday: number;
            disease_complexity_manual: number;
            patient_extra: number;
        };
        minicustos_ativos: Array<{
            tipo: string;
            valor: number;
        }>;
        minicustos_total: number;
        margem_bruta: number;
        imposto_sobre_comissao: number;
        taxa_pagamento: number;
        descontos: {
            percentual: number;
            valor_percentual: number;
            valor_fixo: number;
            total: number;
        };
        subtotal_antes_desconto: number;
        final_cliente: number;
    };
    explain: string;
    warnings: string[];
}

function roundCurrency(value: number): number {
    return Number(value.toFixed(2));
}

function safeCurrency(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return roundCurrency(Math.max(0, value));
}

function resolveComplexityPercent(
    config: PricingConfigSnapshot,
    complexity: EnterprisePricingParams['diseaseComplexity'],
): number {
    if (complexity === 'HIGH') return Math.max(0, config.adicionaisPercent.altoRisco);
    if (complexity === 'MEDIUM') return roundCurrency(Math.max(0, config.adicionaisPercent.altoRisco) / 2);
    return 0;
}

function resolvePaymentMethod(method: EnterprisePricingParams['paymentMethod']): string {
    if (method === 'CARTAO') return 'CARTAO_CREDITO';
    if (method === 'LINK_PAGAMENTO') return 'LINK_PAGAMENTO';
    if (method === 'BOLETO') return 'BOLETO';
    if (method === 'CARTAO_CREDITO') return 'CARTAO_CREDITO';
    return 'PIX';
}

function resolvePaymentPeriod(params: EnterprisePricingParams): string {
    if (params.paymentPeriod) return params.paymentPeriod;
    if (params.schedule.totalDays >= 28) return 'MENSAL';
    if (params.schedule.totalDays >= 14) return 'QUINZENAL';
    if (params.schedule.totalDays <= 1) return 'DIARIO';
    return 'SEMANAL';
}

function resolvePaymentFeePercent(
    config: PricingConfigSnapshot,
    paymentMethod: string,
    paymentPeriod: string,
): number {
    const rule = config.paymentFeeRules.find((item) => (
        item.ativa
        && item.metodo.toUpperCase() === paymentMethod.toUpperCase()
        && item.periodo.toUpperCase() === paymentPeriod.toUpperCase()
    ));
    return rule ? Math.max(0, Number(rule.taxaPercent) || 0) : 0;
}

function resolveHourFactor(hours: number, hourRules: PricingHourRule[]): number {
    const map = new Map<number, number>();
    for (const rule of hourRules) {
        if (rule.hora < 1 || rule.hora > 12) continue;
        map.set(rule.hora, Number(rule.fatorPercent));
    }

    const fallback = (h: number) => roundCurrency(Math.max(0.01, h / 12));
    let remaining = Math.max(1, Math.round(hours));
    let totalFactor = 0;
    while (remaining > 0) {
        const segment = Math.min(12, remaining);
        totalFactor += map.get(segment) ?? fallback(segment);
        remaining -= segment;
    }
    return roundCurrency(totalFactor);
}

async function resolveConfigByUnitConfigId(unitConfigId: string): Promise<PricingConfigSnapshot> {
    try {
        return await getPricingConfigSnapshot({ configVersionId: unitConfigId });
    } catch {
        try {
            return await getPricingConfigSnapshot({ unidadeId: unitConfigId });
        } catch {
            return getPricingConfigSnapshot({ unidadeCodigo: unitConfigId });
        }
    }
}

function isNightShift(shiftType?: EnterprisePricingParams['shiftType']): boolean {
    return shiftType === 'NOTURNO';
}

export async function calculateEnterprisePricing(params: EnterprisePricingParams): Promise<EnterprisePricingResult> {
    if (!params.schedule || !Array.isArray(params.schedule.occurrences) || params.schedule.occurrences.length === 0) {
        throw new Error('schedule deve conter ocorrencias validas');
    }
    if (!Number.isFinite(params.baseProfessionalValue) || params.baseProfessionalValue <= 0) {
        throw new Error('baseProfessionalValue deve ser maior que zero');
    }

    const config = await resolveConfigByUnitConfigId(params.unitConfigId);
    const quantityPatients = Math.max(1, Math.round(params.quantityPatients ?? 1));
    const additionalPercent = Math.max(0, Number(params.additionalPercent ?? 0));
    const complexityPercent = resolveComplexityPercent(config, params.diseaseComplexity);
    const manualDiscount = Math.max(0, Math.min(100, Number(params.manualDiscount ?? 0)));
    const discountFixed = Math.max(0, Number(params.discountFixed ?? 0));
    const emergencySurchargePercent = params.isEmergencyShift
        ? Math.max(0, Number(params.emergencySurchargePercent ?? 25))
        : 0;
    const minicostsDisabled = new Set((params.disableMinicosts || []).map((item) => item.toUpperCase()));
    const paymentMethod = resolvePaymentMethod(params.paymentMethod);
    const paymentPeriod = resolvePaymentPeriod(params);
    const paymentFeePercent = resolvePaymentFeePercent(config, paymentMethod, paymentPeriod);
    const activeCommissionPercent = config.commissionPercentRules
        .filter((item) => item.ativo)
        .reduce((acc, item) => acc + Math.max(0, Number(item.percentual) || 0), 0);

    let costProfessional = 0;
    let additionHoliday = 0;
    let additionNight = 0;
    let additionWeekend = 0;
    let additionExtraPatient = 0;
    let additionManual = 0;
    let grossMargin = 0;
    let taxOverMargin = 0;
    let commissionOperationalCosts = 0;
    const minicosts: Record<string, number> = {};

    const warnings: string[] = [];

    for (const occurrence of params.schedule.occurrences) {
        const factorHours = resolveHourFactor(occurrence.hours, config.hourRules);
        const base = safeCurrency(params.baseProfessionalValue * factorHours);
        const night = isNightShift(params.shiftType)
            ? safeCurrency(base * (Math.max(0, config.adicionaisPercent.noturno) / 100))
            : 0;
        const weekend = occurrence.dayType === 'WEEKEND'
            ? safeCurrency(base * (Math.max(0, config.adicionaisPercent.fimSemana) / 100))
            : 0;
        const holiday = occurrence.isHoliday
            ? safeCurrency(base * (Math.max(0, config.adicionaisPercent.feriado) / 100))
            : 0;
        const extraPatient = quantityPatients > 1
            ? safeCurrency(base * ((Math.max(0, config.adicionaisPercent.segundoPaciente) / 100) * (quantityPatients - 1)))
            : 0;
        const manual = safeCurrency(base * ((additionalPercent + complexityPercent + emergencySurchargePercent) / 100));
        const professionalOccurrence = safeCurrency(base + night + weekend + holiday + extraPatient + manual);
        const marginOccurrence = safeCurrency(
            (professionalOccurrence * (Math.max(0, config.margemPercent) / 100))
            + (config.lucroFixoEscalaHoras ? config.lucroFixo * factorHours : config.lucroFixo),
        );
        const taxOccurrence = safeCurrency(marginOccurrence * (Math.max(0, config.impostoSobreComissaoPercent) / 100));
        const commissionOccurrence = safeCurrency(marginOccurrence * (activeCommissionPercent / 100));

        costProfessional = safeCurrency(costProfessional + professionalOccurrence);
        additionHoliday = safeCurrency(additionHoliday + holiday);
        additionNight = safeCurrency(additionNight + night);
        additionWeekend = safeCurrency(additionWeekend + weekend);
        additionExtraPatient = safeCurrency(additionExtraPatient + extraPatient);
        additionManual = safeCurrency(additionManual + manual);
        grossMargin = safeCurrency(grossMargin + marginOccurrence);
        taxOverMargin = safeCurrency(taxOverMargin + taxOccurrence);
        commissionOperationalCosts = safeCurrency(commissionOperationalCosts + commissionOccurrence);

        for (const rule of config.miniCostRules) {
            if (minicostsDisabled.has(rule.tipo.toUpperCase())) continue;
            if (!rule.ativoPadrao && !minicostsDisabled.has(rule.tipo.toUpperCase())) {
                // Minicusto inativo por padrao so entra se nao estiver explicitamente desativado
                continue;
            }
            // cobrancaUnica: cobra apenas 1x no período inteiro (não por plantão)
            if (rule.cobrancaUnica) {
                if (!(rule.tipo in minicosts)) {
                    minicosts[rule.tipo] = safeCurrency(rule.valor);
                }
                continue;
            }
            const value = safeCurrency(rule.escalaHoras ? rule.valor * factorHours : rule.valor);
            minicosts[rule.tipo] = safeCurrency((minicosts[rule.tipo] || 0) + value);
        }
    }

    const minicostsTotal = safeCurrency(Object.values(minicosts).reduce((acc, value) => acc + value, 0));
    const subtotalBeforeFeeAndDiscount = safeCurrency(
        costProfessional + grossMargin + commissionOperationalCosts + taxOverMargin + minicostsTotal,
    );

    let paymentFee = 0;
    let discount = 0;
    let finalPrice = subtotalBeforeFeeAndDiscount;

    if (config.aplicarTaxaAntesDesconto) {
        paymentFee = safeCurrency(subtotalBeforeFeeAndDiscount * (paymentFeePercent / 100));
        const withFee = safeCurrency(subtotalBeforeFeeAndDiscount + paymentFee);
        discount = safeCurrency(withFee * (manualDiscount / 100));
        finalPrice = safeCurrency(withFee - discount - discountFixed);
    } else {
        discount = safeCurrency(subtotalBeforeFeeAndDiscount * (manualDiscount / 100));
        const withDiscount = safeCurrency(subtotalBeforeFeeAndDiscount - discount - discountFixed);
        paymentFee = safeCurrency(withDiscount * (paymentFeePercent / 100));
        finalPrice = safeCurrency(withDiscount + paymentFee);
    }

    if (finalPrice < costProfessional) {
        warnings.push('discount_below_cost_clamped');
        finalPrice = costProfessional;
    }

    const totalDays = Math.max(1, params.schedule.totalDaysActive ?? params.schedule.totalDays ?? params.schedule.occurrences.length);
    const equivalentWeekly = safeCurrency((finalPrice / totalDays) * 7);
    const equivalentMonthly = safeCurrency((finalPrice / totalDays) * 30);

    const breakdown = {
        custo_profissional: costProfessional,
        adicionais_por_evento: {
            night: additionNight,
            weekend: additionWeekend,
            holiday: additionHoliday,
            disease_complexity_manual: additionManual,
            patient_extra: additionExtraPatient,
        },
        minicustos_ativos: Object.entries(minicosts).map(([tipo, valor]) => ({
            tipo,
            valor: safeCurrency(valor),
        })),
        minicustos_total: minicostsTotal,
        margem_bruta: grossMargin,
        imposto_sobre_comissao: taxOverMargin,
        taxa_pagamento: paymentFee,
        descontos: {
            percentual: manualDiscount,
            valor_percentual: discount,
            valor_fixo: discountFixed,
            total: safeCurrency(discount + discountFixed),
        },
        subtotal_antes_desconto: subtotalBeforeFeeAndDiscount,
        final_cliente: finalPrice,
    };

    const explain = [
        `Custo profissional ${costProfessional.toFixed(2)}`,
        `margem ${grossMargin.toFixed(2)}`,
        `imposto ${taxOverMargin.toFixed(2)}`,
        `taxa ${paymentFee.toFixed(2)}`,
        `desconto ${breakdown.descontos.total.toFixed(2)}`,
    ].join(' | ');

    return {
        costProfessional,
        additions: {
            holiday: additionHoliday,
            night: additionNight,
            extraPatient: additionExtraPatient,
            manual: additionManual,
        },
        minicosts,
        grossMargin,
        taxOverMargin,
        paymentFee,
        discount,
        finalPrice,
        commissionOperationalCosts,
        subtotalBeforeFeeAndDiscount,
        totalOccurrences: params.schedule.totalOccurrences ?? params.schedule.totalDays ?? params.schedule.occurrences.length,
        totalHours: params.schedule.totalHours,
        equivalentWeekly,
        equivalentMonthly,
        configVersionId: config.configVersionId,
        unidadeId: config.unidadeId,
        currency: config.currency,
        breakdown,
        explain,
        warnings,
    };
}
