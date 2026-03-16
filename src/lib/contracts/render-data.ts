type JsonLike = Record<string, unknown>;

function parseJson<T = JsonLike>(value: string | null | undefined): T | null {
    if (!value) return null;
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

function round2(value: number): number {
    return Number(value.toFixed(2));
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function safeNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function defaultContractTemplate(): string {
    return [
        'CONTRATO DE PRESTACAO DE SERVICOS - MAOS AMIGAS',
        '',
        'Contrato: <<orcamento.id>>',
        'Paciente: <<paciente.nome>>',
        'Unidade: <<unidade.nome>> (<<unidade.codigo>>)',
        'Tipo de contrato: <<contrato.tipo>>',
        '',
        'Resumo de escala: <<escala.resumo>>',
        'Periodo: <<datas.inicio>> a <<datas.fim>>',
        '',
        'Composicao de preco',
        '- Valor do Prestador: <<preco.prestador>>',
        '- Taxa Maos Amigas: <<preco.taxa_maos_amigas>>',
        '- Total: <<preco.total>>',
        '',
        'Pagamento: <<pagamento.metodo>>',
        'Vencimento: <<pagamento.vencimento>>',
        '',
        'Politica de cancelamento/reagendamento',
        '<<politica.cancelamento>>',
        '',
        'Politica de falecimento',
        '<<politica.falecimento>>',
    ].join('\n');
}

export function buildContractRenderData(
    orcamento: {
        id: string;
        valorFinal: number | null;
        normalizedSchedule: string | null;
        pricingBreakdown: string | null;
        paciente?: {
            nome: string | null;
            telefone: string | null;
        } | null;
        unidade?: {
            nome: string;
            codigo: string;
        } | null;
    },
    options?: {
        contractType?: string;
        paymentMethod?: string;
        dueDate?: string;
        cancellationPolicy?: string;
    },
): JsonLike {
    const schedule = parseJson<{
        totalHours?: number;
        totalDays?: number;
        totalDaysActive?: number;
        totalOccurrences?: number;
        windowStart?: string;
        windowEnd?: string;
    }>(orcamento.normalizedSchedule);

    const pricing = parseJson<{
        finalPrice?: number;
        costProfessional?: number;
        breakdown?: {
            custo_profissional?: number;
            final_cliente?: number;
        };
    }>(orcamento.pricingBreakdown);

    const total = round2(
        safeNumber(orcamento.valorFinal)
        || safeNumber(pricing?.finalPrice)
        || safeNumber(pricing?.breakdown?.final_cliente),
    );
    const prestador = round2(
        safeNumber(pricing?.costProfessional)
        || safeNumber(pricing?.breakdown?.custo_profissional),
    );
    const taxa = round2(Math.max(0, total - prestador));

    const totalDays = safeNumber(schedule?.totalDaysActive) || safeNumber(schedule?.totalDays);
    const totalOccurrences = safeNumber(schedule?.totalOccurrences) || totalDays;
    const totalHours = safeNumber(schedule?.totalHours);
    const escalaResumo = `${totalOccurrences} ocorrencia(s), ${totalDays} dia(s) ativo(s), ${totalHours}h`;

    return {
        orcamento: {
            id: orcamento.id,
        },
        paciente: {
            nome: orcamento.paciente?.nome || '',
            telefone: orcamento.paciente?.telefone || '',
        },
        unidade: {
            nome: orcamento.unidade?.nome || 'Unidade padrao',
            codigo: orcamento.unidade?.codigo || 'MATRIZ',
        },
        contrato: {
            tipo: options?.contractType || 'MENSAL',
        },
        escala: {
            resumo: escalaResumo,
        },
        datas: {
            inicio: schedule?.windowStart || todayIso(),
            fim: schedule?.windowEnd || todayIso(),
        },
        preco: {
            prestador: prestador.toFixed(2),
            taxa_maos_amigas: taxa.toFixed(2),
            total: total.toFixed(2),
        },
        pagamento: {
            metodo: options?.paymentMethod || 'PIX',
            vencimento: options?.dueDate || todayIso(),
        },
        politica: {
            cancelamento: options?.cancellationPolicy || 'Cancelamentos com menos de 24h podem gerar custos proporcionais.',
            falecimento: 'Em caso de obito do paciente, o contrato sera automaticamente cancelado mediante apresentacao da Certidao de Obito. O ultimo dia de cobranca sera o ultimo plantao efetivo, incluindo o dia do falecimento caso o profissional ja estivesse em atendimento. Valores pagos antecipadamente serao devolvidos proporcionalmente em ate 15 (quinze) dias uteis, via PIX, transferencia bancaria ou dinheiro em especie.',
        },
    };
}
