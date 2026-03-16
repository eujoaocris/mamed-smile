'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import StepDiscovery, { DiscoveryData } from './steps/StepDiscovery';
import StepPatientInfo, { PatientInfoData } from './steps/StepPatientInfo';
import StepClinical, { ClinicalData } from './steps/StepClinical';
import StepABEMID, { AbemidData } from './steps/StepABEMID';
import StepKatz from './steps/StepKatz';
import StepLawton from './steps/StepLawton';
import StepResponsibilities, { ResponsibilitiesData } from './steps/StepResponsibilities';
import StepEvaluator, { EvaluatorData } from './steps/StepEvaluator';
import { KATZEvaluation, LawtonEvaluation } from '@/types/evaluation';
import { estimatePlanning, type PlanningEstimateOutput } from '@/lib/pricing/planning-estimator';
import type { PlanningInput as RecurrencePlanningInput, RecurrenceType } from '@/lib/scheduling/recurrence-engine';
import { BreakdownTable, calculatorBreakdownToLines } from '@/components/pricing/BreakdownTable';
import { ChevronDown, ChevronUp, Moon, CalendarDays, Star, Shield, FileText, Clock, User, CreditCard, Zap, Settings2 } from 'lucide-react';

type StepKey =
    | 'selector'
    | 'discovery'
    | 'patient'
    | 'clinical'
    | 'abemid'
    | 'katz'
    | 'lawton'
    | 'responsibilities'
    | 'evaluator'
    | 'proposal'
    | 'hospital';

type ScenarioKey = 'recomendado' | 'premium';
type TipoProfissional = 'CUIDADOR' | 'TECNICO_ENF';
type Complexidade = 'BAIXA' | 'MEDIA' | 'ALTA';

interface OrcamentoOutput {
    total: number;
    parcelamento?: {
        entrada?: number;
        quantidadeParcelas?: number;
        valorParcela?: number;
    };
}

interface OrcamentoScenario {
    key: ScenarioKey;
    label: string;
    tipoProfissional: TipoProfissional;
    complexidade: Complexidade;
    horasDiarias: number;
    duracaoDias: number;
    data: OrcamentoOutput;
    meta?: {
        inputHash?: string;
        configVersionId?: string;
        engineVersion?: string;
        normalizedSchedule?: {
            totalHours?: number;
            totalDays?: number;
            totalDaysActive?: number;
            totalOccurrences?: number;
        };
        pricingBreakdown?: {
            breakdown?: {
                custo_profissional?: number;
                margem_bruta?: number;
                imposto_sobre_comissao?: number;
                taxa_pagamento?: number;
                final_cliente?: number;
            };
            explain?: string;
        };
    };
}

interface OrcamentosState {
    recomendado: OrcamentoScenario;
    premium: OrcamentoScenario;
    selecionado: ScenarioKey;
}

interface Planejamento360 {
    dataInicioCuidado: string;
    dataFimCuidado: string;
    modeloEscala: 'CONTINUO' | 'DIAS_ESPECIFICOS' | 'BLOCO_DIAS' | 'ALTERNADO' | 'DATAS_AVULSAS';
    recurrenceType: RecurrenceType;
    periodicidade: 'DIARIO' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
    intervaloRecorrencia: number;
    semanasPlanejadas: number;
    mesesPlanejados: number;
    horasCuidadoDia: number;
    turno: 'DIURNO' | 'NOTURNO' | '24H' | 'CUSTOM';
    horarioInicio: string;
    horarioFim: string;
    quantidadeDiasCuidado: number;
    feriadosNoPeriodo: number;
    feriadosDatasCsv: string;
    quantidadePacientes: number;
    adicionalPercentual: number;
    diasAtendimento: string[];
    datasExcluidasCsv: string;
    datasIncluidasCsv: string;
    margemDesejadaPercent: number;
    impostoPercent: number;
    minicustosDesativadosCsv: string;
    descontoManualPercent: number;
    tempoCuidadoDescricao: string;
    alocacaoResumo: string;
}

interface PlanningPreset {
    id: 'UNICO_12H' | 'UNICO_24H' | 'DOIS_DIAS_24H' | 'INTERCALADO_4S' | 'FDS_24H_4S' | 'CONTINUO_24H_30D';
    label: string;
    sub: string;
}

interface SearchPatient {
    id: string;
    nome: string;
    telefone: string;
    hospital?: string;
    email?: string;
}

interface PlanoResumoOverrides {
    complexidade: Complexidade | null;
    tipoProfissional: TipoProfissional | null;
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function num(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function scenarioActiveDays(scenario: OrcamentoScenario | null | undefined, fallback: number): number {
    const normalized = scenario?.meta?.normalizedSchedule;
    const fromSchedule = num(
        normalized?.totalDaysActive
        ?? normalized?.totalOccurrences
        ?? scenario?.duracaoDias,
        fallback,
    );
    return Math.max(1, Math.round(fromSchedule));
}

function scenarioTotalHours(
    scenario: OrcamentoScenario | null | undefined,
    fallbackDays: number,
    fallbackHoursPerDay: number,
): number {
    const normalized = scenario?.meta?.normalizedSchedule;
    const fromSchedule = num(normalized?.totalHours, 0);
    if (fromSchedule > 0) return fromSchedule;

    const days = scenarioActiveDays(scenario, fallbackDays);
    const hoursPerDay = num(scenario?.horasDiarias, fallbackHoursPerDay);
    return Math.max(1, days * Math.max(1, hoursPerDay));
}

function scenarioMonthlyEquivalent(
    scenario: OrcamentoScenario | null | undefined,
    fallbackDays: number,
): number {
    const total = num(scenario?.data?.total, 0);
    const days = scenarioActiveDays(scenario, fallbackDays);
    return (total / Math.max(1, days)) * 30;
}

function toLocalISODate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number): Date {
    const output = new Date(base);
    output.setDate(output.getDate() + days);
    return output;
}

function parseCsv(value: string): string[] {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

const WEEKDAY_MAP: Record<string, number> = {
    dom: 0,
    domingo: 0,
    seg: 1,
    segunda: 1,
    ter: 2,
    terca: 2,
    terça: 2,
    qua: 3,
    quarta: 3,
    qui: 4,
    quinta: 4,
    sex: 5,
    sexta: 5,
    sab: 6,
    sabado: 6,
    sábado: 6,
};

function toDaysOfWeek(tokens: string[]): number[] {
    const days = tokens
        .map((item) => WEEKDAY_MAP[item.toLowerCase()])
        .filter((item): item is number => typeof item === 'number');
    return [...new Set(days)].sort((a, b) => a - b);
}

function toEnterpriseComplexity(complexidade: Complexidade): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (complexidade === 'ALTA') return 'HIGH';
    if (complexidade === 'MEDIA') return 'MEDIUM';
    return 'LOW';
}

function baseProfessionalValue(tipoProfissional: TipoProfissional): number {
    if (tipoProfissional === 'TECNICO_ENF') return 300;
    return 180;
}

const PLANNING_PRESETS: PlanningPreset[] = [
    { id: 'UNICO_12H', label: '1 dia', sub: '12h' },
    { id: 'UNICO_24H', label: '1 dia', sub: '24h' },
    { id: 'DOIS_DIAS_24H', label: '2 dias', sub: '24h' },
    { id: 'INTERCALADO_4S', label: 'Intercalado', sub: '4 sem' },
    { id: 'FDS_24H_4S', label: 'FDS 24h', sub: '4 sem' },
    { id: 'CONTINUO_24H_30D', label: '24x7', sub: '30 dias' },
];

const WEEKDAYS = [
    { key: 'dom', label: 'D' },
    { key: 'seg', label: 'S' },
    { key: 'ter', label: 'T' },
    { key: 'qua', label: 'Q' },
    { key: 'qui', label: 'Q' },
    { key: 'sex', label: 'S' },
    { key: 'sab', label: 'S' },
] as const;

const MINICUSTO_OPTIONS = [
    { tipo: 'RESERVA_TECNICA', nome: 'Reserva tecnica' },
    { tipo: 'VISITA_SUPERVISAO', nome: 'Visita supervisao' },
    { tipo: 'UNIFORME', nome: 'Uniforme' },
    { tipo: 'TREINAMENTO', nome: 'Treinamento' },
    { tipo: 'SEGURO', nome: 'Seguro' },
    { tipo: 'TRANSPORTE', nome: 'Transporte' },
] as const;

/* ── Pricing Config types (mirrors /api/admin/pricing-config response) ── */
interface ProposalPricingConfig {
    adicionais: {
        segundoPaciente: number; noturno: number; fimSemana: number; feriado: number;
        altoRisco: number; at: number; aa: number;
    };
    miniCosts: { tipo: string; nome: string; valor: number; escalaHoras: boolean; cobrancaUnica: boolean; ativoPadrao: boolean }[];
    discounts: { nome: string; etiqueta?: string; percentual: number; ativo: boolean }[];
    paymentFees: { metodo: string; periodo: string; taxaPercent: number; ativa: boolean }[];
}

/* ── Brazilian holiday detection (mirrors simulador) ── */
function getEasterDate(year: number): Date {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

function fmtDateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getBrazilianHolidays(year: number): Set<string> {
    const h = new Set<string>();
    const easter = getEasterDate(year);
    const add = (base: Date, days: number) => { const o = new Date(base); o.setDate(o.getDate() + days); return o; };
    h.add(`${year}-01-01`); h.add(`${year}-04-21`); h.add(`${year}-05-01`);
    h.add(`${year}-09-07`); h.add(`${year}-10-12`); h.add(`${year}-11-02`);
    h.add(`${year}-11-15`); h.add(`${year}-12-25`);
    h.add(fmtDateKey(add(easter, -47))); h.add(fmtDateKey(add(easter, -48)));
    h.add(fmtDateKey(add(easter, -2))); h.add(fmtDateKey(add(easter, 60)));
    return h;
}

function countHolidaysInRange(start: string, end: string): number {
    if (!start || !end) return 0;
    const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return 0;
    const years = new Set<number>();
    for (let y = s.getFullYear(); y <= e.getFullYear(); y++) years.add(y);
    const allHolidays = new Set<string>();
    years.forEach(y => getBrazilianHolidays(y).forEach(h => allHolidays.add(h)));
    let count = 0;
    const cur = new Date(s);
    while (cur <= e) {
        if (allHolidays.has(fmtDateKey(cur))) count++;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

export default function NewEvaluationPage() {
    const [step, setStep] = useState<StepKey>('selector');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchPatient[]>([]);
    const [selectedPatient, setSelectedPatient] = useState<SearchPatient | null>(null);
    const [hospitalDetails, setHospitalDetails] = useState({ hospital: '', quarto: '' });
    const [selectedNivel, setSelectedNivel] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    const [discoveryData, setDiscoveryData] = useState<DiscoveryData>({
        gatilho: '',
        gatilhoDescricao: '',
        urgencia: 'BAIXA',
        motivoUrgencia: '',
        situacaoAtual: '',
        sobrecargaFamiliar: 5,
        oQueTiraOSono: '',
        preocupacoes: [],
        experienciaAnterior: '',
    });

    const [patientData, setPatientData] = useState<PatientInfoData>({
        nome: '',
        dataNascimento: '',
        cpf: '',
        telefone: '',
        sexo: '',
        peso: '',
        altura: '',
        estadoCivil: '',
        religiao: '',
        endereco: '',
        profissaoAnterior: '',
        hobbies: '',
        temperamento: [],
        exigenciasPreferencias: '',
        tracosEvitar: '',
        motivoSubstituicao: '',
        rotina: {
            acorda: '07:00',
            cafe: '08:00',
            lancheManha: '',
            almoco: '12:00',
            lancheTarde: '',
            jantar: '19:00',
            ceia: '',
            dormir: '21:00',
        },
        sono: '',
        preferenciasAlimentares: '',
    });

    const [clinicalData, setClinicalData] = useState<ClinicalData>({
        condicoes: {
            neurologico: [],
            cardiovascular: [],
            respiratorio: [],
            mobilidade: [],
            endocrino: [],
            psiquiatrico: [],
            gastro: [],
            outros: '',
        },
        quedas: 'Nenhuma',
        medicamentos: { total: '1-3', lista: '', alergias: '', restricoes: '' },
        dispositivos: [],
    });

    const [abemidData, setAbemidData] = useState<AbemidData>({
        consciencia: '',
        respiracao: '',
        alimentacao: '',
        medicacao: '',
        pele: '',
        eliminacoes: '',
        observacoes: '',
    });

    const [katzData, setKatzData] = useState<KATZEvaluation>({
        banho: 'independente',
        vestir: 'independente',
        higiene: 'independente',
        transferencia: 'independente',
        continencia: 'independente',
        alimentacao: 'independente',
    });

    const [lawtonData, setLawtonData] = useState<LawtonEvaluation>({
        telefone: 3,
        compras: 3,
        cozinhar: 3,
        tarefasDomesticas: 3,
        lavanderia: 3,
        transporte: 3,
        medicacao: 3,
        financas: 3,
    });

    const [responsibilitiesData, setResponsibilitiesData] = useState<ResponsibilitiesData>({
        medicamentos: { separacao: 'Familia', administracao: 'Paciente' },
        sinaisVitais: '',
        estimulacao: '',
        banhoHigiene: '',
        roupas: '',
        acompanhamentoExterno: '',
        insumos: 'Familia',
        alimentacao: 'FamiliaPronta',
        limpeza: 'QuartoBanheiro',
        checklistAmbiente: {
            iluminacaoCorredor: false,
            iluminacaoQuarto: false,
            iluminacaoBanheiro: false,
            tapetesSala: false,
            tapetesQuarto: false,
            tapetesBanheiro: false,
            barrasBox: false,
            barrasVaso: false,
            pisoBox: false,
            degrausEntrada: false,
            escadasInternas: false,
            corrimadaoEscada: false,
            espacoCadeira: false,
            interruptoresAcesso: false,
            alturaCama: false,
            campainhaEmergencia: false,
            detectoresFumaca: false,
            fiosSoltos: false,
        },
        observacoes: '',
    });

    const [evaluatorData, setEvaluatorData] = useState<EvaluatorData>({
        resumoVaga: '',
        restricoesAbsolutas: '',
        perfilIdeal: '',
        complexidade: 'BAIXA',
        setupAmbiente: '',
    });

    const [orcamentos, setOrcamentos] = useState<OrcamentosState | null>(null);
    const [loadingOrcamento, setLoadingOrcamento] = useState(false);
    const [orcamentoError, setOrcamentoError] = useState<string | null>(null);
    const [autoRecalculateNonce, setAutoRecalculateNonce] = useState(0);
    const [planoResumoOverrides, setPlanoResumoOverrides] = useState<PlanoResumoOverrides>({
        complexidade: null,
        tipoProfissional: null,
    });
    const [sending, setSending] = useState(false);
    const [generatingContract, setGeneratingContract] = useState(false);
    const [activePreset, setActivePreset] = useState<PlanningPreset['id'] | null>(null);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [breakdownOpen, setBreakdownOpen] = useState(false);
    const [ajustesValorOpen, setAjustesValorOpen] = useState(false);
    const [pricingConfig, setPricingConfig] = useState<ProposalPricingConfig | null>(null);
    const [proposal, setProposal] = useState({
        valorTotal: 0,
        entrada: 0,
        parcelas: 1,
        valorParcela: 0,
        vencimento: new Date().toISOString().split('T')[0],
        descontoPercent: 0,
        descontos: 0,
        acrescimos: 0,
        metodosPagamento: ['PIX', 'CARTAO DE CREDITO'],
        opcoesParcelamento: ['1x sem juros', '2x sem juros', '3x sem juros', '4x sem juros'],
        nome: '',
        phone: '',
        email: '',
    });
    const [planejamento360, setPlanejamento360] = useState<Planejamento360>({
        dataInicioCuidado: '',
        dataFimCuidado: '',
        modeloEscala: 'DIAS_ESPECIFICOS',
        recurrenceType: 'WEEKLY',
        periodicidade: 'SEMANAL',
        intervaloRecorrencia: 1,
        semanasPlanejadas: 4,
        mesesPlanejados: 1,
        horasCuidadoDia: 12,
        turno: 'DIURNO',
        horarioInicio: '07:00',
        horarioFim: '19:00',
        quantidadeDiasCuidado: 1,
        feriadosNoPeriodo: 0,
        feriadosDatasCsv: '',
        quantidadePacientes: 1,
        adicionalPercentual: 0,
        diasAtendimento: ['seg', 'ter', 'qua', 'qui', 'sex'],
        datasExcluidasCsv: '',
        datasIncluidasCsv: '',
        margemDesejadaPercent: 32,
        impostoPercent: 6,
        minicustosDesativadosCsv: '',
        descontoManualPercent: 0,
        tempoCuidadoDescricao: '',
        alocacaoResumo: '',
    });

    // ── Session persistence (survives reload, clears on tab close) ──
    const STORAGE_KEY = 'avaliacao_nova_draft';
    const [hydrated, setHydrated] = useState(false);

    // Restore state from sessionStorage on mount
    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) { setHydrated(true); return; }
            const saved = JSON.parse(raw);
            if (saved.step) setStep(saved.step);
            if (saved.selectedPatient) setSelectedPatient(saved.selectedPatient);
            if (saved.hospitalDetails) setHospitalDetails(saved.hospitalDetails);
            if (saved.selectedNivel) setSelectedNivel(saved.selectedNivel);
            if (saved.discoveryData) setDiscoveryData(saved.discoveryData);
            if (saved.patientData) setPatientData(saved.patientData);
            if (saved.clinicalData) setClinicalData(saved.clinicalData);
            if (saved.abemidData) setAbemidData(saved.abemidData);
            if (saved.katzData) setKatzData(saved.katzData);
            if (saved.lawtonData) setLawtonData(saved.lawtonData);
            if (saved.responsibilitiesData) setResponsibilitiesData(saved.responsibilitiesData);
            if (saved.evaluatorData) setEvaluatorData(saved.evaluatorData);
            if (saved.orcamentos) setOrcamentos(saved.orcamentos);
            if (saved.planoResumoOverrides) setPlanoResumoOverrides(saved.planoResumoOverrides);
            if (saved.proposal) setProposal(saved.proposal);
            if (saved.planejamento360) setPlanejamento360(saved.planejamento360);
        } catch { /* corrupt data — start fresh */ }
        // Delay hydrated flag so React commits all restored state before persist kicks in
        const timer = setTimeout(() => setHydrated(true), 150);
        return () => clearTimeout(timer);
    }, []);

    // Save state to sessionStorage on changes (debounced) — only after hydration
    useEffect(() => {
        if (!hydrated) return;
        const timer = setTimeout(() => {
            try {
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                    step,
                    selectedPatient,
                    hospitalDetails,
                    selectedNivel,
                    discoveryData,
                    patientData,
                    clinicalData,
                    abemidData,
                    katzData,
                    lawtonData,
                    responsibilitiesData,
                    evaluatorData,
                    orcamentos,
                    planoResumoOverrides,
                    proposal,
                    planejamento360,
                }));
            } catch { /* storage full — ignore */ }
        }, 500);
        return () => clearTimeout(timer);
    }, [hydrated, step, selectedPatient, hospitalDetails, selectedNivel, discoveryData, patientData, clinicalData, abemidData, katzData, lawtonData, responsibilitiesData, evaluatorData, orcamentos, planoResumoOverrides, proposal, planejamento360]);

    // ── Load pricing config for display enrichment (adicionais %, minicusto values, discount presets) ──
    useEffect(() => {
        if (step !== 'proposal' || pricingConfig) return;
        (async () => {
            try {
                // First get unidades to find the first one
                const listRes = await fetch('/api/admin/pricing-config');
                const listData = await listRes.json();
                const uid = listData?.unidades?.[0]?.id;
                if (!uid) return;
                const cfgRes = await fetch(`/api/admin/pricing-config?unidadeId=${uid}`);
                const cfgData = await cfgRes.json();
                if (cfgData?.success) {
                    setPricingConfig({
                        adicionais: cfgData.adicionais,
                        miniCosts: cfgData.miniCosts || [],
                        discounts: cfgData.discounts || [],
                        paymentFees: cfgData.paymentFees || [],
                    });
                }
            } catch { /* non-critical — display enrichment only */ }
        })();
    }, [step, pricingConfig]);

    // ── Auto-detect holidays when dates change ──
    const autoDetectedHolidays = useMemo(
        () => countHolidaysInRange(planejamento360.dataInicioCuidado, planejamento360.dataFimCuidado),
        [planejamento360.dataInicioCuidado, planejamento360.dataFimCuidado],
    );

    const selectedScenario = useMemo(() => {
        if (!orcamentos) return null;
        return orcamentos[orcamentos.selecionado];
    }, [orcamentos]);


    const planejamentoCalculo = useMemo<PlanningEstimateOutput>(() => (
        estimatePlanning({
            dataInicioCuidado: planejamento360.dataInicioCuidado,
            dataFimCuidado: planejamento360.dataFimCuidado,
            periodicidade: planejamento360.periodicidade,
            semanasPlanejadas: planejamento360.semanasPlanejadas,
            mesesPlanejados: planejamento360.mesesPlanejados,
            horasCuidadoDia: planejamento360.horasCuidadoDia,
            diasAtendimento: planejamento360.diasAtendimento,
        })
    ), [planejamento360]);

    const diasCuidadoEfetivos = useMemo(() => {
        if (planejamento360.modeloEscala === 'BLOCO_DIAS') {
            return Math.max(1, Math.round(planejamento360.quantidadeDiasCuidado || 1));
        }
        if (planejamento360.modeloEscala === 'CONTINUO') {
            return Math.max(1, planejamentoCalculo.diasCorridos);
        }
        if (planejamento360.modeloEscala === 'ALTERNADO') {
            // Dia sim dia não = ~metade dos dias corridos
            return Math.max(1, Math.ceil(planejamentoCalculo.diasCorridos / 2));
        }
        if (planejamento360.modeloEscala === 'DATAS_AVULSAS') {
            const datas = parseCsv(planejamento360.datasIncluidasCsv);
            return Math.max(1, datas.length);
        }
        return Math.max(1, planejamentoCalculo.diasAtivos);
    }, [planejamento360.modeloEscala, planejamento360.quantidadeDiasCuidado, planejamento360.datasIncluidasCsv, planejamentoCalculo.diasAtivos, planejamentoCalculo.diasCorridos]);

    const totalFinal = useMemo(() => {
        const descontoPercentualValor = num(proposal.valorTotal) * (num(proposal.descontoPercent) / 100);
        return Math.max(0, num(proposal.valorTotal) - descontoPercentualValor - num(proposal.descontos) + num(proposal.acrescimos));
    }, [proposal.valorTotal, proposal.descontoPercent, proposal.descontos, proposal.acrescimos]);

    const selectedScenarioDays = useMemo(
        () => scenarioActiveDays(selectedScenario, diasCuidadoEfetivos),
        [selectedScenario, diasCuidadoEfetivos],
    );

    const selectedScenarioHours = useMemo(
        () => scenarioTotalHours(selectedScenario, diasCuidadoEfetivos, planejamentoCalculo.horasDiarias),
        [selectedScenario, diasCuidadoEfetivos, planejamentoCalculo.horasDiarias],
    );

    // ── Summary breakdown extraction for sidebar cards ──
    const scenarioSummary = useMemo(() => {
        if (!selectedScenario) return null;
        const pb = selectedScenario.meta?.pricingBreakdown as Record<string, unknown> | undefined;
        const bd = (pb?.breakdown ?? pb) as Record<string, unknown> | undefined;
        if (!bd) return null;
        const n = (v: unknown) => (typeof v === 'number' ? v : 0);
        const custoProfissional = n(bd.custo_profissional);
        const margemBruta = n(bd.margem_bruta);
        const impostoComissao = n(bd.imposto_sobre_comissao);
        const taxaPagamento = n(bd.taxa_pagamento);
        const minicustos = Array.isArray(bd.minicustos_ativos)
            ? (bd.minicustos_ativos as { valor?: number }[]).reduce((a, m) => a + n(m.valor), 0)
            : 0;
        return {
            profissional: custoProfissional,
            lucroLiquido: margemBruta - impostoComissao,
            custosOperacionais: impostoComissao + taxaPagamento + minicustos,
        };
    }, [selectedScenario]);

    const moveProfissionalUp = (tipo: TipoProfissional): TipoProfissional => {
        if (tipo === 'CUIDADOR') return 'TECNICO_ENF';
        return 'TECNICO_ENF';
    };

    const moveComplexidadeUp = (complexidade: Complexidade): Complexidade => {
        if (complexidade === 'BAIXA') return 'MEDIA';
        if (complexidade === 'MEDIA') return 'ALTA';
        return 'ALTA';
    };

    const inferirComplexidade = (): Complexidade => {
        const altaComplexidade =
            abemidData.respiracao === 'Ventilacao' ||
            abemidData.medicacao === 'IV' ||
            abemidData.pele === 'LPP 3' || abemidData.pele === 'LPP 4';

        const mediaComplexidade =
            !altaComplexidade && (
                abemidData.consciencia === 'Agressivo' ||
                abemidData.alimentacao === 'SNE' || abemidData.alimentacao === 'GTT' ||
                abemidData.medicacao === 'IM' || abemidData.medicacao === 'Subcutanea' ||
                katzData.transferencia === 'dependente'
            );

        if (altaComplexidade) return 'ALTA';
        if (mediaComplexidade) return 'MEDIA';
        return 'BAIXA';
    };

    const inferirTipoProfissional = (complexidade: Complexidade): TipoProfissional => {
        if (complexidade === 'ALTA') return 'TECNICO_ENF';
        if (complexidade === 'MEDIA') return 'TECNICO_ENF';
        return 'CUIDADOR';
    };

    const complexidadeResumoAtiva = planoResumoOverrides.complexidade ?? inferirComplexidade();
    const tipoProfissionalResumoAtivo = planoResumoOverrides.tipoProfissional ?? inferirTipoProfissional(complexidadeResumoAtiva);

    const queueAutoRecalculate = () => {
        setAutoRecalculateNonce((prev) => prev + 1);
    };

    const applyResumoComplexidade = (value: string) => {
        const normalized = value.trim().toUpperCase();
        setPlanoResumoOverrides((prev) => ({
            ...prev,
            complexidade: normalized === 'AUTO' ? null : normalized as Complexidade,
        }));
        queueAutoRecalculate();
    };

    const applyResumoTipoProfissional = (value: string) => {
        const normalized = value.trim().toUpperCase();
        setPlanoResumoOverrides((prev) => ({
            ...prev,
            tipoProfissional: normalized === 'AUTO' ? null : normalized as TipoProfissional,
        }));
        queueAutoRecalculate();
    };

    const buildRecurrencePlanningInput = (
        horasDiarias: number,
        diasAtivos: number,
        quantidadePacientes: number,
        adicionalPercentual: number,
    ): RecurrencePlanningInput => {
        const startDate = planejamento360.dataInicioCuidado || planejamentoCalculo.inicioISO;
        const endDate = planejamento360.dataFimCuidado || planejamentoCalculo.fimISO;
        const recurrenceType = planejamento360.modeloEscala === 'BLOCO_DIAS' || planejamento360.modeloEscala === 'ALTERNADO'
            ? 'PACKAGE'
            : planejamento360.modeloEscala === 'DATAS_AVULSAS'
                ? 'CUSTOM_DATES' as RecurrenceType
                : planejamento360.recurrenceType;
        const holidaysFromCsv = parseCsv(planejamento360.feriadosDatasCsv);
        const holidaysFallback = Array.from({ length: Math.max(0, planejamento360.feriadosNoPeriodo) })
            .map((_, index) => toLocalISODate(addDays(new Date(startDate), index)));
        const holidays = holidaysFromCsv.length ? holidaysFromCsv : holidaysFallback;
        const interval = planejamento360.modeloEscala === 'ALTERNADO'
            ? 2
            : Math.max(1, Math.round(planejamento360.intervaloRecorrencia || 1));

        return {
            recurrenceType,
            startDate,
            endDate: recurrenceType === 'PACKAGE' || recurrenceType === 'NONE' ? undefined : endDate,
            occurrences: recurrenceType === 'NONE'
                ? 1
                : recurrenceType === 'PACKAGE'
                    ? Math.max(1, Math.round(planejamento360.quantidadeDiasCuidado || diasAtivos))
                    : Math.max(1, Math.round(diasAtivos)),
            daysOfWeek: toDaysOfWeek(planejamento360.diasAtendimento),
            interval,
            shiftType: planejamento360.turno,
            shiftStart: planejamento360.turno === 'CUSTOM' || planejamento360.turno === 'NOTURNO'
                ? planejamento360.horarioInicio || undefined
                : undefined,
            shiftEnd: planejamento360.turno === 'CUSTOM' || planejamento360.turno === 'NOTURNO'
                ? planejamento360.horarioFim || undefined
                : undefined,
            hoursPerOccurrence: Math.max(1, horasDiarias),
            holidays,
            excludedDates: parseCsv(planejamento360.datasExcluidasCsv),
            includedDates: parseCsv(planejamento360.datasIncluidasCsv),
            customDates: planejamento360.modeloEscala === 'DATAS_AVULSAS' ? parseCsv(planejamento360.datasIncluidasCsv) : undefined,
            quantityPatients: Math.max(1, quantidadePacientes),
            additionalPercent: Math.max(0, adicionalPercentual),
        };
    };

    const runScenarioCalculation = async (
        key: ScenarioKey,
        label: string,
        tipoProfissional: TipoProfissional,
        complexidade: Complexidade,
        horasDiarias: number,
        duracaoDias: number,
        diasAtivos: number,
        feriadosNoPeriodo: number,
        quantidadePacientes: number,
        adicionalPercentual: number,
    ): Promise<OrcamentoScenario> => {
        const planningInput = buildRecurrencePlanningInput(
            horasDiarias,
            diasAtivos,
            quantidadePacientes,
            adicionalPercentual,
        );
        const res = await fetch('/api/orcamento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planningInput,
                baseProfessionalValue: baseProfessionalValue(tipoProfissional),
                paymentMethod: proposal.metodosPagamento.includes('CARTAO DE CREDITO') && !proposal.metodosPagamento.includes('PIX')
                    ? 'CARTAO'
                    : proposal.parcelas > 1
                        ? 'CARTAO'
                        : 'PIX',
                diseaseComplexity: toEnterpriseComplexity(complexidade),
                unitCode: 'MATRIZ',
                manualDiscount: Math.max(0, num(planejamento360.descontoManualPercent, 0)),
                disableMinicosts: parseCsv(planejamento360.minicustosDesativadosCsv),
                paymentPeriod: planejamento360.periodicidade,
            }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success || !payload?.data) {
            throw new Error(payload?.error || `Falha ao calcular cenario ${label}`);
        }

        return {
            key,
            label,
            tipoProfissional,
            complexidade,
            horasDiarias,
            duracaoDias,
            data: payload.data as OrcamentoOutput,
            meta: {
                inputHash: payload?.inputHash,
                configVersionId: payload?.configVersionId,
                engineVersion: payload?.engineVersion,
                normalizedSchedule: payload?.normalizedSchedule,
                pricingBreakdown: payload?.pricingBreakdown,
            },
        };
    };

    const applyPlanningPreset = (presetId: PlanningPreset['id']) => {
        const today = new Date();
        const inicio = toLocalISODate(today);
        const fim30 = toLocalISODate(addDays(today, 29));
        const fim28 = toLocalISODate(addDays(today, 27));

        setPlanejamento360((current) => {
            if (presetId === 'UNICO_12H') {
                return {
                    ...current,
                    dataInicioCuidado: inicio,
                    dataFimCuidado: inicio,
                    modeloEscala: 'BLOCO_DIAS',
                    recurrenceType: 'NONE',
                    periodicidade: 'DIARIO',
                    intervaloRecorrencia: 1,
                    semanasPlanejadas: 1,
                    mesesPlanejados: 1,
                    horasCuidadoDia: 12,
                    turno: 'DIURNO',
                    horarioInicio: '07:00',
                    horarioFim: '19:00',
                    quantidadeDiasCuidado: 1,
                    diasAtendimento: [],
                    tempoCuidadoDescricao: 'Atendimento pontual de 1 dia (12h).',
                };
            }
            if (presetId === 'UNICO_24H') {
                return {
                    ...current,
                    dataInicioCuidado: inicio,
                    dataFimCuidado: inicio,
                    modeloEscala: 'BLOCO_DIAS',
                    recurrenceType: 'NONE',
                    periodicidade: 'DIARIO',
                    intervaloRecorrencia: 1,
                    semanasPlanejadas: 1,
                    mesesPlanejados: 1,
                    horasCuidadoDia: 24,
                    turno: '24H',
                    horarioInicio: '00:00',
                    horarioFim: '23:59',
                    quantidadeDiasCuidado: 1,
                    diasAtendimento: [],
                    tempoCuidadoDescricao: 'Atendimento pontual de 1 dia (24h).',
                };
            }
            if (presetId === 'DOIS_DIAS_24H') {
                return {
                    ...current,
                    dataInicioCuidado: inicio,
                    dataFimCuidado: toLocalISODate(addDays(today, 1)),
                    modeloEscala: 'BLOCO_DIAS',
                    recurrenceType: 'PACKAGE',
                    periodicidade: 'DIARIO',
                    intervaloRecorrencia: 1,
                    semanasPlanejadas: 1,
                    mesesPlanejados: 1,
                    horasCuidadoDia: 24,
                    turno: '24H',
                    horarioInicio: '00:00',
                    horarioFim: '23:59',
                    quantidadeDiasCuidado: 2,
                    diasAtendimento: [],
                    tempoCuidadoDescricao: 'Atendimento intensivo de 2 dias (24h).',
                };
            }
            if (presetId === 'INTERCALADO_4S') {
                return {
                    ...current,
                    dataInicioCuidado: inicio,
                    dataFimCuidado: fim28,
                    modeloEscala: 'DIAS_ESPECIFICOS',
                    recurrenceType: 'WEEKLY',
                    periodicidade: 'SEMANAL',
                    intervaloRecorrencia: 1,
                    semanasPlanejadas: 4,
                    mesesPlanejados: 1,
                    horasCuidadoDia: 12,
                    turno: 'DIURNO',
                    horarioInicio: '07:00',
                    horarioFim: '19:00',
                    diasAtendimento: ['seg', 'qua', 'sex'],
                    tempoCuidadoDescricao: 'Atendimento intercalado (seg/qua/sex) por 4 semanas.',
                };
            }
            if (presetId === 'FDS_24H_4S') {
                return {
                    ...current,
                    dataInicioCuidado: inicio,
                    dataFimCuidado: fim28,
                    modeloEscala: 'DIAS_ESPECIFICOS',
                    recurrenceType: 'WEEKLY',
                    periodicidade: 'SEMANAL',
                    intervaloRecorrencia: 1,
                    semanasPlanejadas: 4,
                    mesesPlanejados: 1,
                    horasCuidadoDia: 24,
                    turno: '24H',
                    horarioInicio: '00:00',
                    horarioFim: '23:59',
                    diasAtendimento: ['sab', 'dom'],
                    tempoCuidadoDescricao: 'Cobertura de fim de semana (24h) por 4 semanas.',
                };
            }
            return {
                ...current,
                dataInicioCuidado: inicio,
                dataFimCuidado: fim30,
                modeloEscala: 'CONTINUO',
                recurrenceType: 'PACKAGE',
                periodicidade: 'DIARIO',
                intervaloRecorrencia: 1,
                semanasPlanejadas: 4,
                mesesPlanejados: 1,
                horasCuidadoDia: 24,
                turno: '24H',
                horarioInicio: '00:00',
                horarioFim: '23:59',
                quantidadeDiasCuidado: 30,
                diasAtendimento: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'],
                tempoCuidadoDescricao: 'Cobertura continua 24x7 por 30 dias.',
            };
        });
    };

    const recalculateScenarios = async (advanceToProposal = false) => {
        setLoadingOrcamento(true);
        setOrcamentoError(null);
        try {
            const complexidadeRecomendada = planoResumoOverrides.complexidade ?? inferirComplexidade();
            const tipoRecomendado = planoResumoOverrides.tipoProfissional ?? inferirTipoProfissional(complexidadeRecomendada);
            const horasDiarias = planejamentoCalculo.horasDiarias;
            const duracaoDias = Math.max(1, planejamentoCalculo.diasCorridos);
            const diasAtivos = Math.max(1, diasCuidadoEfetivos);
            const feriadosNoPeriodo = Math.max(0, num(planejamento360.feriadosNoPeriodo, 0));
            const quantidadePacientes = Math.max(1, num(planejamento360.quantidadePacientes, 1));
            const adicionalPercentual = Math.max(0, num(planejamento360.adicionalPercentual, 0));
            const adicionalPremium = adicionalPercentual + 8;

            const [recomendado, premium] = await Promise.all([
                runScenarioCalculation(
                    'recomendado',
                    'Recomendado',
                    tipoRecomendado,
                    complexidadeRecomendada,
                    horasDiarias,
                    duracaoDias,
                    diasAtivos,
                    feriadosNoPeriodo,
                    quantidadePacientes,
                    adicionalPercentual,
                ),
                runScenarioCalculation(
                    'premium',
                    'Premium',
                    moveProfissionalUp(tipoRecomendado),
                    moveComplexidadeUp(complexidadeRecomendada),
                    horasDiarias,
                    duracaoDias,
                    diasAtivos,
                    feriadosNoPeriodo,
                    quantidadePacientes,
                    adicionalPremium,
                ),
            ]);

            const nextState: OrcamentosState = {
                recomendado,
                premium,
                selecionado: orcamentos?.selecionado || 'recomendado',
            };
            setOrcamentos(nextState);

            const chosen = nextState[nextState.selecionado];
            const parc = chosen.data?.parcelamento || {};
            setProposal((prev) => ({
                ...prev,
                valorTotal: num(chosen.data?.total, prev.valorTotal),
                entrada: num(parc.entrada, prev.entrada),
                parcelas: Math.max(1, num(parc.quantidadeParcelas, prev.parcelas || 1)),
                valorParcela: num(
                    parc.valorParcela,
                    (num(chosen.data?.total, prev.valorTotal) - num(parc.entrada, prev.entrada)) / Math.max(1, num(parc.quantidadeParcelas, prev.parcelas || 1)),
                ),
                nome: prev.nome || patientData.nome || selectedPatient?.nome || '',
                phone: prev.phone || patientData.telefone || selectedPatient?.telefone || '',
                email: prev.email || selectedPatient?.email || '',
            }));

            setPlanejamento360((prev) => ({
                ...prev,
                dataInicioCuidado: planejamentoCalculo.inicioISO,
                dataFimCuidado: planejamentoCalculo.fimISO,
                horasCuidadoDia: horasDiarias,
                diasAtendimento: planejamentoCalculo.diasAtendimentoNormalizados.length
                    ? planejamentoCalculo.diasAtendimentoNormalizados
                    : prev.diasAtendimento,
                quantidadeDiasCuidado: diasAtivos,
                tempoCuidadoDescricao: prev.tempoCuidadoDescricao.trim()
                    ? prev.tempoCuidadoDescricao
                    : `${horasDiarias}h/dia em ${diasAtivos} dia(s) de cuidado`,
            }));

            if (advanceToProposal) {
                setStep('proposal');
            }
        } catch (error) {
            console.error('Erro orcamento', error);
            setOrcamentoError('Falha ao recalcular cenarios com o planejamento informado.');
        } finally {
            setLoadingOrcamento(false);
        }
    };

    const selectScenario = (key: ScenarioKey) => {
        setOrcamentos((prev) => {
            if (!prev) return prev;
            const scenario = prev[key];
            const parcelamento = scenario.data?.parcelamento || {};
            const scenarioDays = scenarioActiveDays(scenario, diasCuidadoEfetivos);
            setProposal((current) => ({
                ...current,
                valorTotal: num(scenario.data?.total, current.valorTotal),
                entrada: num(parcelamento.entrada, current.entrada),
                parcelas: Math.max(1, num(parcelamento.quantidadeParcelas, current.parcelas)),
                valorParcela: num(
                    parcelamento.valorParcela,
                    (num(scenario.data?.total, current.valorTotal) - num(parcelamento.entrada, current.entrada)) / Math.max(1, num(parcelamento.quantidadeParcelas, current.parcelas)),
                ),
            }));
            setPlanejamento360((current) => ({
                ...current,
                horasCuidadoDia: scenario.horasDiarias,
                quantidadeDiasCuidado: scenarioDays,
                tempoCuidadoDescricao: `${scenario.horasDiarias}h/dia em ${scenarioDays} dia(s) de cuidado (${scenario.label})`,
            }));
            return { ...prev, selecionado: key };
        });
    };

    const handleCalcularOrcamento = async () => {
        await recalculateScenarios(true);
    };

    useEffect(() => {
        if (step !== 'proposal' || autoRecalculateNonce === 0) return;

        const timer = setTimeout(() => {
            void recalculateScenarios(false);
        }, 450);

        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRecalculateNonce, step]);

    const handleSendProposal = async () => {
        if (!selectedScenario) {
            alert('Calcule o orcamento antes de enviar a proposta.');
            return;
        }

        setSending(true);
        try {
            const selectedDays = scenarioActiveDays(selectedScenario, diasCuidadoEfetivos);
            const selectedHours = scenarioTotalHours(
                selectedScenario,
                diasCuidadoEfetivos,
                planejamentoCalculo.horasDiarias,
            );
            const scenarioPayload = {
                cenarioSelecionado: selectedScenario.key,
                cenarioRecomendado: orcamentos?.recomendado || null,
                cenarioPremium: orcamentos?.premium || null,
                resumoSelecionado: selectedScenario || null,
                complexidade: selectedScenario.complexidade,
                tipoProfissional: selectedScenario.tipoProfissional,
                cargaHoraria: `${selectedScenario.horasDiarias}h`,
                duracaoDias: selectedDays,
                valorBase: num(proposal.valorTotal),
                valorFinal: totalFinal,
                descontoPercent: num(proposal.descontoPercent),
                descontos: num(proposal.descontos),
                acrescimos: num(proposal.acrescimos),
                entrada: num(proposal.entrada),
                parcelas: Math.max(1, num(proposal.parcelas, 1)),
                valorParcela: num(proposal.valorParcela),
                vencimento: proposal.vencimento,
                metodosPagamento: proposal.metodosPagamento,
                opcoesParcelamento: proposal.opcoesParcelamento,
                planejamento360: {
                    ...planejamento360,
                    descontoManualPercent: num(proposal.descontoPercent),
                    dataInicioCuidado: planejamentoCalculo.inicioISO,
                    dataFimCuidado: planejamentoCalculo.fimISO,
                    diasAtendimento: planejamentoCalculo.diasAtendimentoNormalizados.length
                        ? planejamentoCalculo.diasAtendimentoNormalizados
                        : planejamento360.diasAtendimento,
                    horasCuidadoDia: planejamentoCalculo.horasDiarias,
                    quantidadeDiasCuidado: diasCuidadoEfetivos,
                },
                planejamentoResumoCalculo: {
                    recorrencia: planejamentoCalculo.recorrenciaDescricao,
                    periodicidade: planejamentoCalculo.periodicidade,
                    diasCorridos: planejamentoCalculo.diasCorridos,
                    diasAtivos: selectedDays,
                    horasTotais: selectedHours,
                    quantidadePacientes: planejamento360.quantidadePacientes,
                    feriadosNoPeriodo: planejamento360.feriadosNoPeriodo,
                    adicionalPercentual: planejamento360.adicionalPercentual,
                    estimativaMensal: scenarioMonthlyEquivalent(selectedScenario, diasCuidadoEfetivos),
                },
            };

            const fullPayload = {
                ...proposal,
                valorTotal: totalFinal,
                dadosDetalhados: {
                    discovery: discoveryData,
                    patient: patientData,
                    clinical: clinicalData,
                    abemid: abemidData,
                    katz: katzData,
                    lawton: lawtonData,
                    responsibilities: responsibilitiesData,
                    evaluator: evaluatorData,
                    orcamento: scenarioPayload,
                },
            };

            const res = await fetch('/api/propostas/enviar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fullPayload),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success) {
                alert('Proposta enviada e avaliacao salva com sucesso.');
                window.location.href = '/admin/avaliacoes';
            } else {
                alert(`Erro: ${data.error || 'Falha ao enviar proposta.'}`);
            }
        } catch {
            alert('Erro de conexao ao enviar proposta.');
        } finally {
            setSending(false);
        }
    };

    const handleGenerateContract = async () => {
        if (!selectedScenario) {
            alert('Calcule o orcamento antes de gerar o contrato.');
            return;
        }

        setGeneratingContract(true);
        try {
            const selectedDays = scenarioActiveDays(selectedScenario, diasCuidadoEfetivos);
            const selectedHours = scenarioTotalHours(
                selectedScenario,
                diasCuidadoEfetivos,
                planejamentoCalculo.horasDiarias,
            );
            const scenarioPayload = {
                cenarioSelecionado: selectedScenario.key,
                cenarioRecomendado: orcamentos?.recomendado || null,
                cenarioPremium: orcamentos?.premium || null,
                resumoSelecionado: selectedScenario || null,
                complexidade: selectedScenario.complexidade,
                tipoProfissional: selectedScenario.tipoProfissional,
                cargaHoraria: `${selectedScenario.horasDiarias}h`,
                duracaoDias: selectedDays,
                valorBase: num(proposal.valorTotal),
                valorFinal: totalFinal,
                descontoPercent: num(proposal.descontoPercent),
                descontos: num(proposal.descontos),
                acrescimos: num(proposal.acrescimos),
                entrada: num(proposal.entrada),
                parcelas: Math.max(1, num(proposal.parcelas, 1)),
                valorParcela: num(proposal.valorParcela),
                vencimento: proposal.vencimento,
                metodosPagamento: proposal.metodosPagamento,
                opcoesParcelamento: proposal.opcoesParcelamento,
                planejamento360: {
                    ...planejamento360,
                    descontoManualPercent: num(proposal.descontoPercent),
                    dataInicioCuidado: planejamentoCalculo.inicioISO,
                    dataFimCuidado: planejamentoCalculo.fimISO,
                    diasAtendimento: planejamentoCalculo.diasAtendimentoNormalizados.length
                        ? planejamentoCalculo.diasAtendimentoNormalizados
                        : planejamento360.diasAtendimento,
                    horasCuidadoDia: planejamentoCalculo.horasDiarias,
                    quantidadeDiasCuidado: diasCuidadoEfetivos,
                },
                planejamentoResumoCalculo: {
                    recorrencia: planejamentoCalculo.recorrenciaDescricao,
                    periodicidade: planejamentoCalculo.periodicidade,
                    diasCorridos: planejamentoCalculo.diasCorridos,
                    diasAtivos: selectedDays,
                    horasTotais: selectedHours,
                    quantidadePacientes: planejamento360.quantidadePacientes,
                    feriadosNoPeriodo: planejamento360.feriadosNoPeriodo,
                    adicionalPercentual: planejamento360.adicionalPercentual,
                    estimativaMensal: scenarioMonthlyEquivalent(selectedScenario, diasCuidadoEfetivos),
                },
            };

            const fullPayload = {
                ...proposal,
                valorTotal: totalFinal,
                dadosDetalhados: {
                    discovery: discoveryData,
                    patient: patientData,
                    clinical: clinicalData,
                    abemid: abemidData,
                    katz: katzData,
                    lawton: lawtonData,
                    responsibilities: responsibilitiesData,
                    evaluator: evaluatorData,
                    orcamento: scenarioPayload,
                },
            };

            const res = await fetch('/api/propostas/enviar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fullPayload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success || !data.orcamentoId) {
                alert(`Erro: ${data.error || 'Falha ao salvar proposta para gerar contrato.'}`);
                return;
            }

            const pdfRes = await fetch(`/api/admin/orcamentos/${data.orcamentoId}/gerar-contrato`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            if (!pdfRes.ok) {
                alert('Erro ao gerar PDF do contrato.');
                return;
            }

            const blob = await pdfRes.blob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        } catch {
            alert('Erro de conexao ao gerar contrato.');
        } finally {
            setGeneratingContract(false);
        }
    };

    const handleSearch = async (query: string) => {
        setSearchQuery(query);
        if (query.length < 3) {
            setSearchResults([]);
            return;
        }
        const res = await fetch(`/api/pacientes/search?q=${query}`);
        const data = await res.json().catch(() => []);
        setSearchResults(Array.isArray(data) ? data : []);
    };

    const selectPatient = (patient: SearchPatient) => {
        setSelectedPatient(patient);
        setSearchQuery(patient.nome);
        setSearchResults([]);
        if (patient.hospital) setHospitalDetails((prev) => ({ ...prev, hospital: patient.hospital || prev.hospital }));
    };

    const handleSubmitHospital = async (event: React.FormEvent) => {
        event.preventDefault();
        setLoading(true);
        try {
            const res = await fetch('/api/avaliacoes/hospital', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nome: searchQuery,
                    hospital: hospitalDetails.hospital,
                    quarto: hospitalDetails.quarto,
                    nivel: selectedNivel,
                    phone: selectedPatient?.telefone,
                }),
            });
            if (res.ok) {
                setSuccess(true);
                try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
                setTimeout(() => {
                    window.location.href = '/admin/avaliacoes';
                }, 2000);
            }
        } catch {
            alert('Falha ao acionar plantao hospitalar.');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="mt-20 p-8 text-center">
                <div className="mb-4 text-6xl">OK</div>
                <h2 className="text-2xl font-bold text-secondary-600">Plantao acionado com sucesso</h2>
                <p className="mt-2 text-foreground">Redirecionando...</p>
            </div>
        );
    }

    if (step === 'selector') {
        return (
            <div className="mx-auto max-w-4xl p-8 text-center pt-16">
                <h1 className="mb-8 text-3xl font-bold text-foreground">Nova Avaliação</h1>
                <p className="text-foreground mb-12">Escolha o fluxo adequado para o contexto atual do paciente.</p>
                <div className="grid gap-8 md:grid-cols-2">
                    <button onClick={() => setStep('discovery')} className="group rounded-xl border border-border bg-card p-8 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.98]">
                        <div className="mb-4 text-4xl transition-transform group-hover:scale-110"></div>
                        <h2 className="mb-2 text-2xl font-bold text-primary">Avaliação Completa</h2>
                        <p className="text-foreground">Fluxo detalhado com etapas clínicas, sociais e escopo de responsabilidades.</p>
                        <div className="mt-6 font-bold text-primary flex items-center gap-1 group-hover:gap-2 transition-all">Iniciar <span aria-hidden="true">&rarr;</span></div>
                    </button>
                    <button onClick={() => setStep('hospital')} className="group rounded-xl border border-border bg-card p-8 text-left shadow-sm transition-all hover:border-secondary-400 hover:shadow-md active:scale-[0.98]">
                        <div className="mb-4 text-4xl transition-transform group-hover:scale-110"></div>
                        <h2 className="mb-2 text-2xl font-bold text-secondary-700">Hospital Agile</h2>
                        <p className="text-foreground">Fluxo rápido para alocação emergencial de plantão e alta hospitalar.</p>
                        <div className="mt-6 font-bold text-secondary-600 flex items-center gap-1 group-hover:gap-2 transition-all">Selecionar <span aria-hidden="true">&rarr;</span></div>
                    </button>
                </div>
                <div className="mt-12 text-center">
                    <Link href="/admin/avaliacoes" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">← Voltar para listagem</Link>
                </div>
            </div>
        );
    }

    const WIZARD_STEPS = ['discovery', 'patient', 'clinical', 'abemid', 'katz', 'lawton', 'responsibilities', 'evaluator'];
    const currentStepIndex = WIZARD_STEPS.indexOf(step);
    const isWizardStep = currentStepIndex >= 0;

    const renderWizardStep = () => {
        if (step === 'discovery') return <StepDiscovery data={discoveryData} onUpdate={(d) => setDiscoveryData((p) => ({ ...p, ...d }))} onNext={() => setStep('patient')} onBack={() => setStep('selector')} />;
        if (step === 'patient') return <StepPatientInfo data={patientData} onUpdate={(d) => setPatientData((p) => ({ ...p, ...d }))} onNext={() => setStep('clinical')} onBack={() => setStep('discovery')} />;
        if (step === 'clinical') return <StepClinical data={clinicalData} onUpdate={(d) => setClinicalData((p) => ({ ...p, ...d }))} onNext={() => setStep('abemid')} onBack={() => setStep('patient')} />;
        if (step === 'abemid') return <StepABEMID data={abemidData} onUpdate={(d) => setAbemidData((p) => ({ ...p, ...d }))} onNext={() => setStep('katz')} onBack={() => setStep('clinical')} />;
        if (step === 'katz') return <StepKatz data={katzData} onUpdate={(f, v) => setKatzData((p) => ({ ...p, [f]: v }))} onNext={() => setStep('lawton')} onBack={() => setStep('abemid')} />;
        if (step === 'lawton') return <StepLawton data={lawtonData} onUpdate={(f, v) => setLawtonData((p) => ({ ...p, [f]: v }))} onNext={() => setStep('responsibilities')} onBack={() => setStep('katz')} />;
        if (step === 'responsibilities') return <StepResponsibilities data={responsibilitiesData} onUpdate={(d) => setResponsibilitiesData((p) => ({ ...p, ...d }))} onNext={() => setStep('evaluator')} onBack={() => setStep('lawton')} />;
        if (step === 'evaluator') return <StepEvaluator data={evaluatorData} onUpdate={(d) => setEvaluatorData((p) => ({ ...p, ...d }))} onNext={handleCalcularOrcamento} onBack={() => setStep('responsibilities')} />;
        return null;
    };

    if (isWizardStep) {
        const progressPercent = Math.max(5, ((currentStepIndex + 1) / WIZARD_STEPS.length) * 100);
        return (
            <div className="w-full">
                {/* Global Progress Bar for Wizard Steps */}
                <div className="sticky top-0 z-10 w-full bg-card border-b border-border shadow-sm">
                    <div className="h-1.5 w-full bg-surface-subtle">
                        <div
                            className="h-full bg-primary-500 transition-all duration-500 ease-out"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                </div>
                {renderWizardStep()}
            </div>
        );
    }

    if (step === 'proposal') {
        const disabledMinicustos = new Set(planejamento360.minicustosDesativadosCsv.split(',').map((s) => s.trim()).filter(Boolean));
        const toggleMinicusto = (tipo: string) => {
            setPlanejamento360((p) => {
                const current = new Set(p.minicustosDesativadosCsv.split(',').map((s) => s.trim()).filter(Boolean));
                if (current.has(tipo)) current.delete(tipo);
                else current.add(tipo);
                return { ...p, minicustosDesativadosCsv: Array.from(current).join(',') };
            });
            queueAutoRecalculate();
        };

        // Minicustos: prefer config-driven list, fallback to hardcoded
        const minicustoList = pricingConfig?.miniCosts && pricingConfig.miniCosts.length > 0
            ? pricingConfig.miniCosts.map((mc) => ({ tipo: mc.tipo, nome: mc.nome, valor: mc.valor, escalaHoras: mc.escalaHoras, cobrancaUnica: mc.cobrancaUnica }))
            : MINICUSTO_OPTIONS.map((mc) => ({ tipo: mc.tipo, nome: mc.nome, valor: 0, escalaHoras: false, cobrancaUnica: false }));

        // Payment fee lookup for current selection
        const currentPaymentFee = (() => {
            if (!pricingConfig?.paymentFees) return 0;
            const metodo = proposal.metodosPagamento.includes('CARTAO DE CREDITO') ? 'CARTAO_CREDITO'
                : proposal.metodosPagamento.includes('BOLETO') ? 'BOLETO' : 'PIX';
            const match = pricingConfig.paymentFees.find(
                (f) => f.ativa && f.metodo === metodo && f.periodo === planejamento360.periodicidade,
            ) ?? pricingConfig.paymentFees.find(
                (f) => f.ativa && f.metodo === metodo,
            );
            return match?.taxaPercent ?? 0;
        })();

        const toggleDia = (dia: string) => {
            setPlanejamento360((p) => {
                const current = new Set(p.diasAtendimento);
                if (current.has(dia)) current.delete(dia);
                else current.add(dia);
                return { ...p, diasAtendimento: Array.from(current) };
            });
        };

        return (
            <div className="min-h-screen bg-background px-4 py-8">
                <div className="mx-auto max-w-6xl">
                    {/* ── Header simplificado ── */}
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-foreground">Proposta de Cuidados</h1>
                            <p className="text-sm text-muted-foreground">
                                {selectedPatient?.nome || 'Paciente'} — {complexidadeResumoAtiva} / {tipoProfissionalResumoAtivo}
                            </p>
                        </div>
                        <button onClick={() => setStep('responsibilities')} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                            &larr; Voltar para revisao
                        </button>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-3">
                        {/* ════════ LEFT COLUMN ════════ */}
                        <div className="space-y-6 lg:col-span-2">

                            {/* ═══ ZONA 1: PLANO DE CUIDADO ═══ */}
                            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                                <h3 className="mb-4 flex items-center gap-2 font-bold text-foreground">
                                    <Clock className="h-4 w-4 text-primary" />
                                    Plano de cuidado
                                </h3>

                                {/* Presets removed — user configures dates/hours directly */}

                                {/* Periodo + Horas */}
                                <div className="grid gap-4 md:grid-cols-5">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">De</label>
                                        <input type="date" value={planejamento360.dataInicioCuidado} onChange={(e) => { setPlanejamento360((p) => ({ ...p, dataInicioCuidado: e.target.value })); setActivePreset(null); }} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Ate</label>
                                        <input type="date" value={planejamento360.dataFimCuidado} onChange={(e) => { setPlanejamento360((p) => ({ ...p, dataFimCuidado: e.target.value })); setActivePreset(null); }} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="mb-1 block text-xs font-medium text-foreground">Horas por dia</label>
                                        <div className="flex items-center gap-3">
                                            <input type="range" min={1} max={24} value={planejamento360.horasCuidadoDia} onChange={(e) => { setPlanejamento360((p) => ({ ...p, horasCuidadoDia: Math.min(24, Math.max(1, num(e.target.value, p.horasCuidadoDia))) })); setActivePreset(null); queueAutoRecalculate(); }} className="flex-1 accent-primary h-2" />
                                            <span className="flex h-9 w-12 items-center justify-center rounded-lg bg-primary/10 border border-primary/30 font-mono text-sm font-bold text-primary">{planejamento360.horasCuidadoDia}h</span>
                                        </div>
                                    </div>
                                </div>

                                {/* ── Tipo de escala (pills) ── */}
                                <div className="mt-4">
                                    <label className="mb-2 block text-xs font-medium text-foreground">Como sera a escala?</label>
                                    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                                        {([
                                            { key: 'DIAS_ESPECIFICOS', label: 'Dias da semana', desc: 'seg, qua, sex...' },
                                            { key: 'CONTINUO', label: 'Todos os dias', desc: '7 dias/semana' },
                                            { key: 'ALTERNADO', label: 'Dia sim, dia nao', desc: 'alternado' },
                                            { key: 'BLOCO_DIAS', label: 'Bloco fechado', desc: 'X dias corridos' },
                                            { key: 'DATAS_AVULSAS', label: 'Escolher datas', desc: 'datas especificas' },
                                        ] as { key: Planejamento360['modeloEscala']; label: string; desc: string }[]).map((opt) => {
                                            const active = planejamento360.modeloEscala === opt.key;
                                            return (
                                                <button
                                                    key={opt.key}
                                                    type="button"
                                                    onClick={() => {
                                                        setPlanejamento360((p) => {
                                                            if (opt.key === 'CONTINUO') return { ...p, modeloEscala: opt.key, recurrenceType: 'PACKAGE' as RecurrenceType, diasAtendimento: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] };
                                                            if (opt.key === 'BLOCO_DIAS') return { ...p, modeloEscala: opt.key, recurrenceType: 'PACKAGE' as RecurrenceType, diasAtendimento: [], periodicidade: 'DIARIO' as const };
                                                            if (opt.key === 'ALTERNADO') return { ...p, modeloEscala: opt.key, recurrenceType: 'PACKAGE' as RecurrenceType, diasAtendimento: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'], intervaloRecorrencia: 2 };
                                                            if (opt.key === 'DATAS_AVULSAS') return { ...p, modeloEscala: opt.key, recurrenceType: 'CUSTOM_DATES' as RecurrenceType, diasAtendimento: [] };
                                                            return { ...p, modeloEscala: opt.key, recurrenceType: p.periodicidade === 'QUINZENAL' ? 'BIWEEKLY' as RecurrenceType : p.periodicidade === 'MENSAL' ? 'MONTHLY' as RecurrenceType : 'WEEKLY' as RecurrenceType, diasAtendimento: p.diasAtendimento.length ? p.diasAtendimento : ['seg', 'ter', 'qua', 'qui', 'sex'] };
                                                        });
                                                        queueAutoRecalculate();
                                                    }}
                                                    className={`rounded-xl border-2 px-3 py-2.5 text-center transition active:scale-95 ${active ? 'border-primary bg-primary/10 shadow-sm' : 'border-border hover:border-primary/40 hover:bg-primary/5'}`}
                                                >
                                                    <span className={`block text-xs font-bold ${active ? 'text-primary' : 'text-foreground'}`}>{opt.label}</span>
                                                    <span className={`block text-[10px] mt-0.5 ${active ? 'text-primary/70' : 'text-muted-foreground'}`}>{opt.desc}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Turno + Pacientes + Feriados */}
                                <div className="mt-4 grid gap-4 md:grid-cols-3">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Turno</label>
                                        <div className="flex gap-1">
                                            {([['DIURNO', 'Diurno'], ['NOTURNO', 'Noturno'], ['24H', '24h']] as const).map(([val, lbl]) => (
                                                <button
                                                    key={val}
                                                    type="button"
                                                    onClick={() => setPlanejamento360((p) => ({ ...p, turno: val }))}
                                                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${planejamento360.turno === val ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary'}`}
                                                >
                                                    {lbl}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Pacientes</label>
                                        <input type="number" min={1} max={6} value={planejamento360.quantidadePacientes} onChange={(e) => { setPlanejamento360((p) => ({ ...p, quantidadePacientes: Math.max(1, Math.min(6, num(e.target.value, p.quantidadePacientes))) })); queueAutoRecalculate(); }} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">
                                            Feriados{' '}
                                            {autoDetectedHolidays > 0 && (
                                                <button type="button" onClick={() => setPlanejamento360((p) => ({ ...p, feriadosNoPeriodo: autoDetectedHolidays }))} className="text-primary hover:underline">
                                                    ({autoDetectedHolidays} detectados)
                                                </button>
                                            )}
                                        </label>
                                        <input type="number" min={0} value={planejamento360.feriadosNoPeriodo} onChange={(e) => setPlanejamento360((p) => ({ ...p, feriadosNoPeriodo: Math.max(0, num(e.target.value, p.feriadosNoPeriodo)) }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                </div>

                                {/* Dias da semana (condicional) */}
                                {planejamento360.modeloEscala === 'DIAS_ESPECIFICOS' && (
                                    <div className="mt-4">
                                        <label className="mb-2 block text-xs font-medium text-foreground">Dias da semana</label>
                                        <div className="flex gap-1">
                                            {WEEKDAYS.map((d) => {
                                                const active = planejamento360.diasAtendimento.includes(d.key);
                                                return (
                                                    <button
                                                        key={d.key}
                                                        type="button"
                                                        onClick={() => toggleDia(d.key)}
                                                        className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold transition ${active ? 'bg-primary text-white' : 'border border-border bg-card text-muted-foreground hover:border-primary'}`}
                                                    >
                                                        {d.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Bloco dias (condicional) */}
                                {planejamento360.modeloEscala === 'BLOCO_DIAS' && (
                                    <div className="mt-4 max-w-[200px]">
                                        <label className="mb-1 block text-xs font-medium text-foreground">Quantidade de dias</label>
                                        <input type="number" min={1} value={planejamento360.quantidadeDiasCuidado} onChange={(e) => { setPlanejamento360((p) => ({ ...p, quantidadeDiasCuidado: Math.max(1, num(e.target.value, p.quantidadeDiasCuidado)) })); queueAutoRecalculate(); }} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                )}

                                {/* Escolher datas avulsas */}
                                {planejamento360.modeloEscala === 'DATAS_AVULSAS' && (
                                    <div className="mt-4">
                                        <label className="mb-2 block text-xs font-medium text-foreground">Datas de atendimento</label>
                                        <div className="flex gap-2 items-end">
                                            <input
                                                type="date"
                                                id="add-date-picker"
                                                className="rounded-lg border px-3 py-2 text-sm"
                                                min={planejamento360.dataInicioCuidado || undefined}
                                                max={planejamento360.dataFimCuidado || undefined}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const picker = document.getElementById('add-date-picker') as HTMLInputElement;
                                                    if (!picker?.value) return;
                                                    const val = picker.value;
                                                    setPlanejamento360((p) => {
                                                        const existing = parseCsv(p.datasIncluidasCsv);
                                                        if (existing.includes(val)) return p;
                                                        const next = [...existing, val].sort();
                                                        return { ...p, datasIncluidasCsv: next.join(',') };
                                                    });
                                                    picker.value = '';
                                                    queueAutoRecalculate();
                                                }}
                                                className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90 transition"
                                            >
                                                + Adicionar
                                            </button>
                                        </div>
                                        {parseCsv(planejamento360.datasIncluidasCsv).length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {parseCsv(planejamento360.datasIncluidasCsv).map((dt) => (
                                                    <span key={dt} className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/30 px-2.5 py-1 text-xs font-medium text-primary">
                                                        {dt.split('-').reverse().join('/')}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setPlanejamento360((p) => ({
                                                                    ...p,
                                                                    datasIncluidasCsv: parseCsv(p.datasIncluidasCsv).filter((d) => d !== dt).join(','),
                                                                }));
                                                                queueAutoRecalculate();
                                                            }}
                                                            className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5"
                                                        >
                                                            ✕
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <p className="mt-2 text-xs text-muted-foreground">
                                            {parseCsv(planejamento360.datasIncluidasCsv).length} data(s) selecionada(s)
                                        </p>
                                    </div>
                                )}

                                {/* ── Excluir datas (todos os modos exceto DATAS_AVULSAS) ── */}
                                {planejamento360.modeloEscala !== 'DATAS_AVULSAS' && (
                                    <div className="mt-4">
                                        <label className="mb-2 block text-xs font-medium text-muted-foreground">Excluir datas especificas (opcional)</label>
                                        <div className="flex gap-2 items-end">
                                            <input
                                                type="date"
                                                id="exclude-date-picker"
                                                className="rounded-lg border px-3 py-2 text-sm"
                                                min={planejamento360.dataInicioCuidado || undefined}
                                                max={planejamento360.dataFimCuidado || undefined}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const picker = document.getElementById('exclude-date-picker') as HTMLInputElement;
                                                    if (!picker?.value) return;
                                                    const val = picker.value;
                                                    setPlanejamento360((p) => {
                                                        const existing = parseCsv(p.datasExcluidasCsv);
                                                        if (existing.includes(val)) return p;
                                                        const next = [...existing, val].sort();
                                                        return { ...p, datasExcluidasCsv: next.join(',') };
                                                    });
                                                    picker.value = '';
                                                    queueAutoRecalculate();
                                                }}
                                                className="rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition"
                                            >
                                                − Excluir
                                            </button>
                                        </div>
                                        {parseCsv(planejamento360.datasExcluidasCsv).length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {parseCsv(planejamento360.datasExcluidasCsv).map((dt) => (
                                                    <span key={dt} className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600">
                                                        {dt.split('-').reverse().join('/')}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setPlanejamento360((p) => ({
                                                                    ...p,
                                                                    datasExcluidasCsv: parseCsv(p.datasExcluidasCsv).filter((d) => d !== dt).join(','),
                                                                }));
                                                                queueAutoRecalculate();
                                                            }}
                                                            className="ml-0.5 rounded-full hover:bg-red-100 p-0.5"
                                                        >
                                                            ✕
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Adicionais informativos com % */}
                                {pricingConfig && (
                                    <div className="mt-4">
                                        <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                            <Zap className="h-3 w-3" />
                                            Adicionais que impactam o preco
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {([
                                                { label: 'Noturno', perc: pricingConfig.adicionais.noturno, icon: Moon, active: planejamento360.turno === 'NOTURNO' },
                                                { label: 'Fim de semana', perc: pricingConfig.adicionais.fimSemana, icon: CalendarDays, active: planejamento360.diasAtendimento.includes('sab') || planejamento360.diasAtendimento.includes('dom') },
                                                { label: 'Feriado', perc: pricingConfig.adicionais.feriado, icon: Star, active: planejamento360.feriadosNoPeriodo > 0 },
                                                { label: 'Alto Risco', perc: pricingConfig.adicionais.altoRisco, icon: Shield, active: complexidadeResumoAtiva === 'ALTA' },
                                                ...(planejamento360.quantidadePacientes > 1 ? [{ label: '2º paciente', perc: pricingConfig.adicionais.segundoPaciente, icon: Shield, active: true }] : []),
                                            ]).map((ad) => (
                                                <span
                                                    key={ad.label}
                                                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${ad.active ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground opacity-60'}`}
                                                >
                                                    <ad.icon className="h-3.5 w-3.5" />
                                                    {ad.label} <span className="opacity-70">+{ad.perc}%</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Profissional + Complexidade — pill buttons */}
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                            <User className="h-3.5 w-3.5" />
                                            Profissional
                                        </label>
                                        <div className="flex gap-1">
                                            {([['AUTO', `Auto (${tipoProfissionalResumoAtivo})`], ['CUIDADOR', 'Cuidador'], ['TECNICO_ENF', 'Tecnico Enf.']] as const).map(([val, lbl]) => (
                                                <button
                                                    key={val}
                                                    type="button"
                                                    onClick={() => applyResumoTipoProfissional(val)}
                                                    className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${(planoResumoOverrides.tipoProfissional || 'AUTO') === val ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary'}`}
                                                >
                                                    {lbl}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                            <Shield className="h-3.5 w-3.5" />
                                            Complexidade
                                        </label>
                                        <div className="flex gap-1">
                                            {([['AUTO', `Auto (${inferirComplexidade()})`], ['BAIXA', 'Baixa'], ['MEDIA', 'Media'], ['ALTA', 'Alta']] as const).map(([val, lbl]) => (
                                                <button
                                                    key={val}
                                                    type="button"
                                                    onClick={() => applyResumoComplexidade(val)}
                                                    className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${(planoResumoOverrides.complexidade || 'AUTO') === val ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary'}`}
                                                >
                                                    {lbl}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Resumo */}
                                <div className="mt-4 rounded-lg border border-border bg-surface-subtle/30 p-3 text-xs text-muted-foreground">
                                    <p>{planejamentoCalculo.recorrenciaDescricao}</p>
                                    <p>Periodo: {planejamentoCalculo.inicioISO} a {planejamentoCalculo.fimISO} ({planejamentoCalculo.diasCorridos} dia(s) corridos)</p>
                                </div>
                            </div>

                            {/* ═══ ZONA 2: CENARIOS ═══ */}
                            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h3 className="flex items-center gap-2 font-bold text-foreground">
                                        <Zap className="h-4 w-4 text-primary" />
                                        Escolha o cenario
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => recalculateScenarios(false)}
                                        className="rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/5 disabled:cursor-wait disabled:opacity-60"
                                        disabled={loadingOrcamento}
                                    >
                                        {loadingOrcamento ? 'Calculando...' : 'Recalcular'}
                                    </button>
                                </div>

                                <div className="grid gap-3 md:grid-cols-2">
                                    {(['recomendado', 'premium'] as ScenarioKey[]).map((key) => {
                                        const scenario = orcamentos?.[key];
                                        const selected = orcamentos?.selecionado === key;
                                        const cardDays = scenarioActiveDays(scenario, diasCuidadoEfetivos);
                                        const cardMonthly = scenarioMonthlyEquivalent(scenario, diasCuidadoEfetivos);
                                        const isRecomendado = key === 'recomendado';
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => selectScenario(key)}
                                                className={`relative rounded-xl border-2 p-5 text-left transition ${selected ? 'border-primary bg-primary/5 shadow-md ring-1 ring-primary/20' : 'border-border bg-card hover:border-primary/40 hover:shadow-sm'}`}
                                            >
                                                {isRecomendado && !selected && (
                                                    <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground uppercase tracking-wider">Sugerido</span>
                                                )}
                                                {selected && (
                                                    <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground uppercase tracking-wider">Selecionado</span>
                                                )}
                                                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mt-1">
                                                    {scenario?.label || key}
                                                </p>
                                                <p className="mt-2 text-2xl font-bold text-foreground">
                                                    {formatCurrency(num(scenario?.data?.total, 0))}
                                                    <span className="ml-1 text-xs font-normal text-muted-foreground">/periodo</span>
                                                </p>
                                                <div className="mt-2 space-y-0.5">
                                                    <p className="text-xs text-muted-foreground">Mensal eq.: {formatCurrency(cardMonthly)}</p>
                                                    <p className="text-xs text-muted-foreground">{cardDays}d · {scenario?.horasDiarias || 0}h/dia · {scenario?.tipoProfissional || '-'}</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                {loadingOrcamento && <p className="mt-3 text-sm text-primary">Calculando cenarios...</p>}
                                {orcamentoError && <p className="mt-3 text-sm text-error-600">{orcamentoError}</p>}

                                {/* Breakdown colapsavel */}
                                {(() => {
                                    const sel = orcamentos?.selecionado;
                                    const scenario = sel ? orcamentos?.[sel] : undefined;
                                    const pb = scenario?.meta?.pricingBreakdown as Record<string, unknown> | undefined;
                                    const bd = (pb?.breakdown ?? pb) as Record<string, unknown> | undefined;
                                    const lines = calculatorBreakdownToLines(bd && typeof bd === 'object' && 'custo_profissional' in bd ? bd : undefined);
                                    if (!lines.length) return null;
                                    return (
                                        <div className="mt-4">
                                            <button type="button" onClick={() => setBreakdownOpen(!breakdownOpen)} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition">
                                                {breakdownOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                                Ver detalhamento de custos
                                            </button>
                                            {breakdownOpen && (
                                                <div className="mt-2">
                                                    <BreakdownTable lines={lines} title={`Detalhamento — ${scenario?.label || sel}`} />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* ═══ ZONA 3: CONDICOES COMERCIAIS ═══ */}
                            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                                <h3 className="mb-4 flex items-center gap-2 font-bold text-foreground">
                                    <CreditCard className="h-4 w-4 text-primary" />
                                    Condicoes comerciais
                                </h3>

                                {/* Dados do contratante — primeiro, pois sao pre-requisito */}
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Nome responsavel</label>
                                        <input value={proposal.nome} onChange={(e) => setProposal((p) => ({ ...p, nome: e.target.value }))} className="w-full rounded-lg border bg-background p-2.5 text-sm transition focus:bg-card" placeholder="Nome do contratante" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">WhatsApp / Email</label>
                                        <input value={proposal.phone} onChange={(e) => setProposal((p) => ({ ...p, phone: e.target.value }))} className="w-full rounded-lg border bg-background p-2.5 text-sm transition focus:bg-card" placeholder="(11) 99999-9999" />
                                    </div>
                                </div>

                                {/* Vencimento + Metodo + Parcelas */}
                                <div className="mt-4 grid gap-4 md:grid-cols-3">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Vencimento</label>
                                        <input type="date" value={proposal.vencimento} onChange={(e) => setProposal((prev) => ({ ...prev, vencimento: e.target.value }))} className="w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-xs font-medium text-foreground">
                                            Metodo{currentPaymentFee > 0 && <span className="ml-1 text-[10px] text-amber-600 font-normal">(taxa {currentPaymentFee}%)</span>}
                                        </label>
                                        <div className="flex gap-2">
                                            {[{ key: 'PIX', label: 'PIX' }, { key: 'BOLETO', label: 'Boleto' }, { key: 'CARTAO DE CREDITO', label: 'Cartao' }].map((method) => {
                                                const sel = proposal.metodosPagamento.includes(method.key);
                                                const feeKey = method.key === 'CARTAO DE CREDITO' ? 'CARTAO_CREDITO' : method.key;
                                                const fee = pricingConfig?.paymentFees?.find((f) => f.ativa && f.metodo === feeKey);
                                                return (
                                                    <button key={method.key} type="button" onClick={() => { setProposal((prev) => ({ ...prev, metodosPagamento: [method.key] })); queueAutoRecalculate(); }} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${sel ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-background'}`}>
                                                        <span>{method.label}</span>
                                                        {fee && fee.taxaPercent > 0 && <span className="block text-[10px] opacity-70 mt-0.5">{fee.taxaPercent}%</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-xs font-medium text-foreground">Parcelas</label>
                                        <div className="flex gap-1">
                                            {[1, 2, 3, 4].map((p) => (
                                                <button key={p} type="button" onClick={() => setProposal((prev) => ({ ...prev, parcelas: p, opcoesParcelamento: ['1x sem juros', '2x sem juros', '3x sem juros', '4x sem juros'], valorParcela: (num(prev.valorTotal) - num(prev.entrada)) / p }))} className={`flex-1 rounded-lg border py-2 text-xs font-medium transition ${proposal.parcelas === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-background'}`}>
                                                    {p}x
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Ajustes de valor — colapsavel */}
                                <div className="mt-4 rounded-lg border border-border">
                                    <button type="button" onClick={() => setAjustesValorOpen(!ajustesValorOpen)} className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold text-foreground hover:bg-surface-subtle/30 transition">
                                        <span>Ajustes de valor (desconto, acrescimo)</span>
                                        {ajustesValorOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    </button>
                                    {ajustesValorOpen && (
                                        <div className="border-t border-border p-4 space-y-4">
                                            {/* Discount presets from config */}
                                            {pricingConfig && pricingConfig.discounts.filter(d => d.ativo).length > 0 && (
                                                <div>
                                                    <label className="mb-2 block text-xs font-medium text-muted-foreground">Descontos rapidos</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        <button type="button" onClick={() => setProposal((prev) => ({ ...prev, descontoPercent: 0 }))} className={`h-8 px-3 rounded-full text-xs font-medium transition-all ${proposal.descontoPercent === 0 ? 'bg-primary text-primary-foreground' : 'bg-surface-subtle border border-border text-muted-foreground'}`}>
                                                            Sem desconto
                                                        </button>
                                                        {pricingConfig.discounts.filter(d => d.ativo).map((d) => (
                                                            <button key={d.nome} type="button" onClick={() => setProposal((prev) => ({ ...prev, descontoPercent: d.percentual }))} className={`h-8 px-3 rounded-full text-xs font-medium transition-all ${proposal.descontoPercent === d.percentual ? 'bg-emerald-500 text-white shadow-sm' : 'bg-surface-subtle border border-border text-muted-foreground hover:border-emerald-300'}`}>
                                                                {d.etiqueta || d.nome} ({d.percentual}%)
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="grid gap-4 md:grid-cols-3">
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Valor do periodo (R$)</label>
                                                    <input type="number" value={proposal.valorTotal} onChange={(e) => setProposal((prev) => ({ ...prev, valorTotal: num(e.target.value, 0) }))} className="w-full rounded-lg border p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-ring" />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Desconto (%)</label>
                                                    <input type="number" value={proposal.descontoPercent} onChange={(e) => setProposal((prev) => ({ ...prev, descontoPercent: Math.max(0, Math.min(100, num(e.target.value, 0))) }))} className="w-full rounded-lg border p-2.5 text-sm" min={0} max={100} step="0.01" />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Desconto (R$)</label>
                                                    <input type="number" value={proposal.descontos} onChange={(e) => setProposal((prev) => ({ ...prev, descontos: num(e.target.value, 0) }))} className="w-full rounded-lg border p-2.5 text-sm" />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-medium text-foreground">Acrescimos (R$)</label>
                                                <input type="number" value={proposal.acrescimos} onChange={(e) => setProposal((prev) => ({ ...prev, acrescimos: num(e.target.value, 0) }))} className="w-full rounded-lg border p-2.5 text-sm" placeholder="0" />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Config avancada do engine — colapsavel */}
                                <div className="mt-3 rounded-lg border border-dashed border-border">
                                    <button type="button" onClick={() => setAdvancedOpen(!advancedOpen)} className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold text-muted-foreground hover:bg-surface-subtle/30 transition">
                                        <span className="flex items-center gap-1.5"><Settings2 className="h-3.5 w-3.5" /> Configuracao avancada do engine</span>
                                        {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    </button>
                                    {advancedOpen && (
                                        <div className="border-t border-border p-4 space-y-4">
                                            {/* Margem + Imposto + Desconto engine */}
                                            <div className="grid gap-4 md:grid-cols-3">
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Margem desejada (%)</label>
                                                    <input type="number" min={0} value={planejamento360.margemDesejadaPercent} onChange={(e) => setPlanejamento360((p) => ({ ...p, margemDesejadaPercent: Math.max(0, num(e.target.value, p.margemDesejadaPercent)) }))} className="w-full rounded-lg border p-2.5 text-sm" />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Imposto (%)</label>
                                                    <input type="number" min={0} value={planejamento360.impostoPercent} onChange={(e) => setPlanejamento360((p) => ({ ...p, impostoPercent: Math.max(0, num(e.target.value, p.impostoPercent)) }))} className="w-full rounded-lg border p-2.5 text-sm" />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Desconto engine (%)</label>
                                                    <input type="number" min={0} max={100} value={planejamento360.descontoManualPercent} onChange={(e) => setPlanejamento360((p) => ({ ...p, descontoManualPercent: Math.max(0, Math.min(100, num(e.target.value, p.descontoManualPercent))) }))} className="w-full rounded-lg border p-2.5 text-sm" />
                                                </div>
                                            </div>

                                            {/* Minicustos — config-driven */}
                                            <div>
                                                <label className="mb-2 block text-xs font-medium text-foreground">Minicustos operacionais</label>
                                                <div className="space-y-1">
                                                    {minicustoList.map((mc) => {
                                                        const active = !disabledMinicustos.has(mc.tipo);
                                                        return (
                                                            <label key={mc.tipo} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-surface-subtle cursor-pointer transition-colors">
                                                                <input type="checkbox" checked={active} onChange={() => toggleMinicusto(mc.tipo)} className="h-4 w-4 rounded border-border accent-primary" />
                                                                <span className={`text-sm flex-1 ${active ? 'text-foreground' : 'text-muted-foreground line-through'}`}>{mc.nome}</span>
                                                                {mc.valor > 0 && <span className="text-xs text-muted-foreground font-mono">{formatCurrency(mc.valor)}{mc.cobrancaUnica ? ' (1x)' : mc.escalaHoras ? '/fator' : ''}</span>}
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* Periodicidade / Recorrencia / Intervalo */}
                                            <div className="grid gap-4 md:grid-cols-3">
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Periodicidade</label>
                                                    <select value={planejamento360.periodicidade} onChange={(e) => { const periodicidade = e.target.value as Planejamento360['periodicidade']; const recurrenceType: RecurrenceType = periodicidade === 'QUINZENAL' ? 'BIWEEKLY' : periodicidade === 'MENSAL' ? 'MONTHLY' : periodicidade === 'DIARIO' ? (planejamento360.modeloEscala === 'BLOCO_DIAS' ? 'PACKAGE' : 'WEEKLY') : 'WEEKLY'; setPlanejamento360((p) => ({ ...p, periodicidade, recurrenceType })); }} className="w-full rounded-lg border px-3 py-2 text-sm">
                                                        <option value="DIARIO">Diario</option>
                                                        <option value="SEMANAL">Semanal</option>
                                                        <option value="QUINZENAL">Quinzenal</option>
                                                        <option value="MENSAL">Mensal</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Tipo de recorrencia</label>
                                                    <select value={planejamento360.recurrenceType} onChange={(e) => setPlanejamento360((p) => ({ ...p, recurrenceType: e.target.value as RecurrenceType }))} className="w-full rounded-lg border px-3 py-2 text-sm">
                                                        <option value="NONE">Unica</option>
                                                        <option value="WEEKLY">Semanal</option>
                                                        <option value="BIWEEKLY">Quinzenal</option>
                                                        <option value="MONTHLY">Mensal</option>
                                                        <option value="CUSTOM_DATES">Datas especificas</option>
                                                        <option value="PACKAGE">Pacote de dias</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Intervalo</label>
                                                    <input type="number" min={1} value={planejamento360.intervaloRecorrencia} onChange={(e) => setPlanejamento360((p) => ({ ...p, intervaloRecorrencia: Math.max(1, num(e.target.value, p.intervaloRecorrencia)) }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                                </div>
                                            </div>

                                            {/* Semanas / Meses / Acrescimo tecnico */}
                                            <div className="grid gap-4 md:grid-cols-3">
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Semanas</label>
                                                    <input type="number" min={1} value={planejamento360.semanasPlanejadas} onChange={(e) => setPlanejamento360((p) => ({ ...p, semanasPlanejadas: Math.max(1, num(e.target.value, p.semanasPlanejadas)) }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Meses</label>
                                                    <input type="number" min={1} value={planejamento360.mesesPlanejados} onChange={(e) => setPlanejamento360((p) => ({ ...p, mesesPlanejados: Math.max(1, num(e.target.value, p.mesesPlanejados)) }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Acrescimo tecnico (%)</label>
                                                    <input type="number" min={0} step="0.1" value={planejamento360.adicionalPercentual} onChange={(e) => setPlanejamento360((p) => ({ ...p, adicionalPercentual: Math.max(0, num(e.target.value, p.adicionalPercentual)) }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                                </div>
                                            </div>

                                            {/* Horarios */}
                                            <div className="grid gap-4 md:grid-cols-2">
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Horario inicio</label>
                                                    <input type="time" value={planejamento360.horarioInicio} onChange={(e) => setPlanejamento360((p) => ({ ...p, horarioInicio: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Horario fim</label>
                                                    <input type="time" value={planejamento360.horarioFim} onChange={(e) => setPlanejamento360((p) => ({ ...p, horarioFim: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                                </div>
                                            </div>

                                            {/* Feriados / Datas */}
                                            <div className="grid gap-4 md:grid-cols-2">
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Feriados (datas)</label>
                                                    <input value={planejamento360.feriadosDatasCsv} onChange={(e) => setPlanejamento360((p) => ({ ...p, feriadosDatasCsv: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="2026-03-01,2026-03-15" />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Tempo de cuidado (descricao)</label>
                                                    <input value={planejamento360.tempoCuidadoDescricao} onChange={(e) => setPlanejamento360((p) => ({ ...p, tempoCuidadoDescricao: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="12h/dia por 3 meses" />
                                                </div>
                                            </div>
                                            <div className="grid gap-4 md:grid-cols-2">
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Datas excluidas</label>
                                                    <input value={planejamento360.datasExcluidasCsv} onChange={(e) => setPlanejamento360((p) => ({ ...p, datasExcluidasCsv: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="2026-03-05,2026-03-12" />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-medium text-foreground">Datas incluidas</label>
                                                    <input value={planejamento360.datasIncluidasCsv} onChange={(e) => setPlanejamento360((p) => ({ ...p, datasIncluidasCsv: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="2026-03-07,2026-03-14" />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-medium text-foreground">Resumo de alocacao/escala</label>
                                                <textarea value={planejamento360.alocacaoResumo} onChange={(e) => setPlanejamento360((p) => ({ ...p, alocacaoResumo: e.target.value }))} className="h-16 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Escala, cobertura, troca de profissionais..." />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ════════ SIDEBAR (resumo unificado) ════════ */}
                        <div className="space-y-4">
                            <div className="sticky top-4">
                                <div className="rounded-xl bg-gradient-to-br from-gray-900 to-gray-800 text-white shadow-lg overflow-hidden">
                                    {/* VALOR POR PERÍODO — hero header like simulator */}
                                    <div className="bg-card border-b border-border p-5 text-center">
                                        <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-1">Valor por periodo</p>
                                        <p className="text-3xl font-extrabold text-foreground">{formatCurrency(totalFinal)}</p>
                                    </div>

                                    <div className="p-5">
                                    {/* Resumo do paciente */}
                                    <div className="mb-4 space-y-1 text-xs text-gray-400 border-b border-gray-700 pb-3">
                                        <p className="font-medium text-white text-sm">{selectedPatient?.nome || 'Paciente'}</p>
                                        <p>{tipoProfissionalResumoAtivo} · {complexidadeResumoAtiva}</p>
                                        <p>{{ DIAS_ESPECIFICOS: 'Dias da semana', CONTINUO: 'Todos os dias', ALTERNADO: 'Dia sim, dia nao', BLOCO_DIAS: 'Bloco fechado', DATAS_AVULSAS: 'Datas avulsas' }[planejamento360.modeloEscala]} · {planejamento360.horasCuidadoDia}h/dia</p>
                                        <p>{planejamento360.dataInicioCuidado || '-'} a {planejamento360.dataFimCuidado || '-'}</p>
                                        <p className="font-medium text-gray-300">{selectedScenarioDays}d · {selectedScenarioHours}h totais</p>
                                    </div>

                                    {/* Summary cards — composicao do valor */}
                                    {scenarioSummary && (
                                        <div className="grid grid-cols-3 gap-1.5 mb-4">
                                            <div className="rounded-lg bg-blue-900/30 border border-blue-800/50 p-2.5 text-center">
                                                <div className="text-[9px] font-medium text-blue-400 uppercase tracking-wider">Profissional</div>
                                                <div className="text-sm font-bold text-blue-300 mt-0.5">{formatCurrency(scenarioSummary.profissional)}</div>
                                            </div>
                                            <div className="rounded-lg bg-emerald-900/30 border border-emerald-800/50 p-2.5 text-center">
                                                <div className="text-[9px] font-medium text-emerald-400 uppercase tracking-wider">Lucro liq.</div>
                                                <div className="text-sm font-bold text-emerald-300 mt-0.5">{formatCurrency(scenarioSummary.lucroLiquido)}</div>
                                            </div>
                                            <div className="rounded-lg bg-orange-900/30 border border-orange-800/50 p-2.5 text-center">
                                                <div className="text-[9px] font-medium text-orange-400 uppercase tracking-wider">Custos op.</div>
                                                <div className="text-sm font-bold text-orange-300 mt-0.5">{formatCurrency(scenarioSummary.custosOperacionais)}</div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Preco */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-400">Total bruto</span>
                                            <span>{formatCurrency(num(proposal.valorTotal))}</span>
                                        </div>
                                        {num(proposal.descontoPercent) > 0 && (
                                            <div className="flex justify-between text-sm text-emerald-400">
                                                <span>Desconto</span>
                                                <span>- {num(proposal.descontoPercent).toFixed(1)}%</span>
                                            </div>
                                        )}
                                        {num(proposal.descontos) > 0 && (
                                            <div className="flex justify-between text-sm text-emerald-400">
                                                <span>Descontos</span>
                                                <span>- {formatCurrency(num(proposal.descontos))}</span>
                                            </div>
                                        )}
                                        {num(proposal.acrescimos) > 0 && (
                                            <div className="flex justify-between text-sm text-amber-400">
                                                <span>Acrescimos</span>
                                                <span>+ {formatCurrency(num(proposal.acrescimos))}</span>
                                            </div>
                                        )}
                                        {currentPaymentFee > 0 && (
                                            <div className="flex justify-between text-sm text-amber-400">
                                                <span>Taxa pagamento</span>
                                                <span>+{currentPaymentFee}%</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between border-t border-gray-600 pt-2 text-xl font-bold">
                                            <span>Total final</span>
                                            <span>{formatCurrency(totalFinal)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs text-gray-500">
                                            <span>Mensal eq.</span>
                                            <span>{formatCurrency((totalFinal / Math.max(1, selectedScenarioDays)) * 30)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs text-gray-500">
                                            <span>Semanal eq.</span>
                                            <span>{formatCurrency((totalFinal / Math.max(1, selectedScenarioDays)) * 7)}</span>
                                        </div>
                                        {proposal.parcelas > 1 && (
                                            <div className="flex justify-between text-xs text-gray-400 border-t border-gray-700 pt-1 mt-1">
                                                <span>{proposal.parcelas}x sem juros</span>
                                                <span>{formatCurrency(totalFinal / proposal.parcelas)}/parcela</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-5 flex flex-col gap-2">
                                        <button
                                            onClick={handleSendProposal}
                                            disabled={sending || generatingContract || !selectedScenario}
                                            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-bold shadow-lg transition active:scale-95 ${sending ? 'cursor-wait bg-gray-600' : 'bg-secondary-500 text-white hover:bg-secondary-400'}`}
                                        >
                                            {sending ? 'Enviando...' : 'Enviar via WhatsApp'}
                                        </button>
                                        <button
                                            onClick={handleGenerateContract}
                                            disabled={generatingContract || sending || !selectedScenario}
                                            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold border transition active:scale-95 ${generatingContract ? 'cursor-wait bg-gray-700 border-gray-600 text-gray-400' : 'border-gray-600 text-gray-300 hover:bg-gray-700 hover:border-gray-500'}`}
                                        >
                                            <FileText size={16} />
                                            {generatingContract ? 'Gerando contrato...' : 'Gerar Contrato (PDF)'}
                                        </button>
                                    </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'hospital') {
        return (
            <div className="mx-auto mt-12 max-w-2xl rounded-xl border-t-4 border-secondary-500 bg-card p-8 shadow-sm">
                <h1 className="mb-2 text-2xl font-bold text-secondary-700">Hospital Agile</h1>
                <p className="text-sm text-muted-foreground mb-6">Alocação emergencial de plantão hospitalar.</p>
                <form className="space-y-6" onSubmit={handleSubmitHospital}>
                    <div>
                        <label className="block text-sm font-bold text-foreground mb-2">Nome do paciente</label>
                        <input type="text" required value={searchQuery} onChange={(e) => handleSearch(e.target.value)} className="w-full rounded-lg border border-border-hover p-3 focus:outline-none focus:ring-2 focus:ring-secondary-500 bg-background focus:bg-card transition-all" placeholder="Busca rápida..." />
                        {searchResults.length > 0 && (
                            <div className="mt-2 border border-border rounded-lg shadow-sm bg-card overflow-hidden">
                                {searchResults.map((patient) => (
                                    <div key={patient.id} onClick={() => selectPatient(patient)} className="cursor-pointer border-b last:border-0 p-3 text-sm hover:bg-background flex items-center justify-between">
                                        <span className="font-medium text-foreground">{patient.nome}</span>
                                        <span className="text-muted-foreground">{patient.telefone}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-foreground mb-2">Hospital</label>
                            <input type="text" required value={hospitalDetails.hospital} onChange={(e) => setHospitalDetails({ ...hospitalDetails, hospital: e.target.value })} className="w-full rounded-lg border border-border-hover p-3 focus:outline-none focus:ring-2 focus:ring-secondary-500 bg-background focus:bg-card transition-all" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-foreground mb-2">Quarto</label>
                            <input type="text" value={hospitalDetails.quarto} onChange={(e) => setHospitalDetails({ ...hospitalDetails, quarto: e.target.value })} className="w-full rounded-lg border border-border-hover p-3 focus:outline-none focus:ring-2 focus:ring-secondary-500 bg-background focus:bg-card transition-all" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-foreground mb-2">Nível profissional requisitado</label>
                        <div className="mt-2 flex gap-2">
                            {['Cuidador', 'Tec. Enfermagem', 'Enfermeiro'].map((nivel) => (
                                <button type="button" key={nivel} onClick={() => setSelectedNivel(nivel)} className={`rounded-lg border p-3 text-sm font-medium transition-all flex-1 active:scale-[0.98] ${selectedNivel === nivel ? 'bg-secondary-50 border-secondary-500 text-secondary-700 shadow-sm' : 'border-border hover:bg-background text-foreground'}`}>
                                    {nivel}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-4 pt-4 border-t border-border">
                        <button type="button" onClick={() => setStep('selector')} className="text-sm font-medium text-muted-foreground hover:text-foreground">Cancelar</button>
                        <button type="submit" disabled={loading} className="flex-1 rounded-lg bg-secondary-600 py-3 font-bold text-white shadow-md hover:bg-secondary-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100">
                            {loading ? 'Enviando Solicitação...' : 'Acionar Plantão Imediato'}
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    return null;
}
