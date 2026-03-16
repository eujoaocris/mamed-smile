'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ChevronDown, ChevronUp } from 'lucide-react';

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

type ScenarioKey = 'economico' | 'recomendado' | 'premium';
type TipoProfissional = 'CUIDADOR' | 'AUXILIAR_ENF' | 'TECNICO_ENF';
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
    economico: OrcamentoScenario;
    recomendado: OrcamentoScenario;
    premium: OrcamentoScenario;
    selecionado: ScenarioKey;
}

interface Planejamento360 {
    dataInicioCuidado: string;
    dataFimCuidado: string;
    modeloEscala: 'CONTINUO' | 'DIAS_ESPECIFICOS' | 'BLOCO_DIAS';
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
    if (tipoProfissional === 'AUXILIAR_ENF') return 240;
    return 180;
}

const PLANNING_PRESETS: PlanningPreset[] = [
    { id: 'UNICO_12H', label: '1 dia (12h)' },
    { id: 'UNICO_24H', label: '1 dia (24h)' },
    { id: 'DOIS_DIAS_24H', label: '2 dias (24h)' },
    { id: 'INTERCALADO_4S', label: 'Intercalado 4 semanas' },
    { id: 'FDS_24H_4S', label: 'FDS 24h (4 semanas)' },
    { id: 'CONTINUO_24H_30D', label: '24x7 por 30 dias' },
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
    const [advancedOpen, setAdvancedOpen] = useState(false);
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
    const hydrated = useRef(false);

    // Restore state from sessionStorage on mount
    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return;
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
        hydrated.current = true;
    }, []);

    // Save state to sessionStorage on changes (debounced)
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistState = useCallback(() => {
        if (!hydrated.current) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
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
    }, [step, selectedPatient, hospitalDetails, selectedNivel, discoveryData, patientData, clinicalData, abemidData, katzData, lawtonData, responsibilitiesData, evaluatorData, orcamentos, planoResumoOverrides, proposal, planejamento360]);

    useEffect(() => { persistState(); }, [persistState]);

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
        return Math.max(1, planejamentoCalculo.diasAtivos);
    }, [planejamento360.modeloEscala, planejamento360.quantidadeDiasCuidado, planejamentoCalculo.diasAtivos, planejamentoCalculo.diasCorridos]);

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

    const moveProfissionalDown = (tipo: TipoProfissional): TipoProfissional => {
        if (tipo === 'TECNICO_ENF') return 'AUXILIAR_ENF';
        if (tipo === 'AUXILIAR_ENF') return 'CUIDADOR';
        return 'CUIDADOR';
    };

    const moveProfissionalUp = (tipo: TipoProfissional): TipoProfissional => {
        if (tipo === 'CUIDADOR') return 'AUXILIAR_ENF';
        if (tipo === 'AUXILIAR_ENF') return 'TECNICO_ENF';
        return 'TECNICO_ENF';
    };

    const moveComplexidadeDown = (complexidade: Complexidade): Complexidade => {
        if (complexidade === 'ALTA') return 'MEDIA';
        if (complexidade === 'MEDIA') return 'BAIXA';
        return 'BAIXA';
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
        if (complexidade === 'MEDIA') return 'AUXILIAR_ENF';
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
        const recurrenceType = planejamento360.modeloEscala === 'BLOCO_DIAS'
            ? 'PACKAGE'
            : planejamento360.recurrenceType;
        const holidaysFromCsv = parseCsv(planejamento360.feriadosDatasCsv);
        const holidaysFallback = Array.from({ length: Math.max(0, planejamento360.feriadosNoPeriodo) })
            .map((_, index) => toLocalISODate(addDays(new Date(startDate), index)));
        const holidays = holidaysFromCsv.length ? holidaysFromCsv : holidaysFallback;
        const interval = Math.max(1, Math.round(planejamento360.intervaloRecorrencia || 1));

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
            const adicionalEconomico = Math.max(0, adicionalPercentual - 8);
            const adicionalPremium = adicionalPercentual + 8;

            const [economico, recomendado, premium] = await Promise.all([
                runScenarioCalculation(
                    'economico',
                    'Economico',
                    moveProfissionalDown(tipoRecomendado),
                    moveComplexidadeDown(complexidadeRecomendada),
                    horasDiarias,
                    duracaoDias,
                    diasAtivos,
                    feriadosNoPeriodo,
                    quantidadePacientes,
                    adicionalEconomico,
                ),
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
                economico,
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
                cenarioEconomico: orcamentos?.economico || null,
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
        };
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
                    {/* ── Header ── */}
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-foreground">Proposta de Cuidados</h1>
                            <p className="text-sm text-muted-foreground">
                                {selectedPatient?.nome || 'Paciente'} — {complexidadeResumoAtiva} / {tipoProfissionalResumoAtivo}
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Investimento</div>
                            <div className="text-3xl font-black text-secondary-600">{formatCurrency(totalFinal)}</div>
                            <div className="text-xs text-muted-foreground">
                                {selectedScenarioDays} dias · {selectedScenarioHours}h · Mensal: {formatCurrency((totalFinal / Math.max(1, selectedScenarioDays)) * 30)}
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-3">
                        {/* ════════════════ LEFT COLUMN ════════════════ */}
                        <div className="space-y-6 lg:col-span-2">

                            {/* ── SECTION 1: Planejamento do Cuidado ── */}
                            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                                <h3 className="mb-4 font-bold text-foreground">Como vai ser o cuidado?</h3>

                                {/* Presets — visual cards */}
                                <div className="mb-5 grid grid-cols-3 gap-2 md:grid-cols-6">
                                    {PLANNING_PRESETS.map((preset) => (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => { applyPlanningPreset(preset.id); queueAutoRecalculate(); }}
                                            className="rounded-lg border-2 border-border px-2 py-3 text-center text-xs font-semibold text-foreground transition hover:border-primary hover:bg-primary/5 active:scale-95"
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Summary banner */}
                                <div className="mb-5 flex items-center justify-between rounded-lg bg-primary/5 px-4 py-3">
                                    <div className="text-sm font-medium text-foreground">
                                        <span className="font-bold text-primary">{selectedScenarioDays}</span> dia(s) de cuidado ·{' '}
                                        <span className="font-bold text-primary">{selectedScenarioHours}h</span> totais
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => recalculateScenarios(false)}
                                        className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white transition hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
                                        disabled={loadingOrcamento}
                                    >
                                        {loadingOrcamento ? 'Calculando...' : 'Recalcular'}
                                    </button>
                                </div>

                                {/* Essential fields */}
                                <div className="grid gap-4 md:grid-cols-4">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Inicio</label>
                                        <input type="date" value={planejamento360.dataInicioCuidado} onChange={(e) => setPlanejamento360((p) => ({ ...p, dataInicioCuidado: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Fim</label>
                                        <input type="date" value={planejamento360.dataFimCuidado} onChange={(e) => setPlanejamento360((p) => ({ ...p, dataFimCuidado: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Horas/dia</label>
                                        <input type="number" min={1} max={24} value={planejamento360.horasCuidadoDia} onChange={(e) => { setPlanejamento360((p) => ({ ...p, horasCuidadoDia: Math.min(24, Math.max(1, num(e.target.value, p.horasCuidadoDia))) })); queueAutoRecalculate(); }} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Modelo</label>
                                        <select
                                            value={planejamento360.modeloEscala}
                                            onChange={(e) => {
                                                setPlanejamento360((p) => {
                                                    const nextModel = e.target.value as Planejamento360['modeloEscala'];
                                                    if (nextModel === 'CONTINUO') return { ...p, modeloEscala: nextModel, recurrenceType: 'PACKAGE', diasAtendimento: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] };
                                                    if (nextModel === 'BLOCO_DIAS') return { ...p, modeloEscala: nextModel, recurrenceType: 'PACKAGE', diasAtendimento: [], periodicidade: 'DIARIO' };
                                                    return { ...p, modeloEscala: nextModel, recurrenceType: p.periodicidade === 'QUINZENAL' ? 'BIWEEKLY' : p.periodicidade === 'MENSAL' ? 'MONTHLY' : 'WEEKLY', diasAtendimento: p.diasAtendimento.length ? p.diasAtendimento : ['seg', 'ter', 'qua', 'qui', 'sex'] };
                                                });
                                                queueAutoRecalculate();
                                            }}
                                            className="w-full rounded-lg border px-3 py-2 text-sm"
                                        >
                                            <option value="DIAS_ESPECIFICOS">Dias especificos</option>
                                            <option value="CONTINUO">Continuo</option>
                                            <option value="BLOCO_DIAS">Bloco fechado</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Days of week toggles */}
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

                                {/* Block days count */}
                                {planejamento360.modeloEscala === 'BLOCO_DIAS' && (
                                    <div className="mt-4 max-w-[200px]">
                                        <label className="mb-1 block text-xs font-medium text-foreground">Quantidade de dias</label>
                                        <input type="number" min={1} value={planejamento360.quantidadeDiasCuidado} onChange={(e) => { setPlanejamento360((p) => ({ ...p, quantidadeDiasCuidado: Math.max(1, num(e.target.value, p.quantidadeDiasCuidado)) })); queueAutoRecalculate(); }} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                )}

                                {/* Turno quick select */}
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
                                        <label className="mb-1 block text-xs font-medium text-foreground">Feriados no periodo</label>
                                        <input type="number" min={0} value={planejamento360.feriadosNoPeriodo} onChange={(e) => setPlanejamento360((p) => ({ ...p, feriadosNoPeriodo: Math.max(0, num(e.target.value, p.feriadosNoPeriodo)) }))} className="w-full rounded-lg border px-3 py-2 text-sm" />
                                    </div>
                                </div>

                                {/* Profissional + Complexidade */}
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Profissional</label>
                                        <select value={planoResumoOverrides.tipoProfissional || 'AUTO'} onChange={(e) => applyResumoTipoProfissional(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
                                            <option value="AUTO">AUTO ({tipoProfissionalResumoAtivo})</option>
                                            <option value="CUIDADOR">Cuidador</option>
                                            <option value="AUXILIAR_ENF">Auxiliar Enf.</option>
                                            <option value="TECNICO_ENF">Tecnico Enf.</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Complexidade</label>
                                        <select value={planoResumoOverrides.complexidade || 'AUTO'} onChange={(e) => applyResumoComplexidade(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
                                            <option value="AUTO">AUTO ({inferirComplexidade()})</option>
                                            <option value="BAIXA">Baixa</option>
                                            <option value="MEDIA">Media</option>
                                            <option value="ALTA">Alta</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Resumo matematico */}
                                <div className="mt-4 rounded-lg border border-border bg-surface-subtle/30 p-3 text-xs text-muted-foreground">
                                    <p>{planejamentoCalculo.recorrenciaDescricao}</p>
                                    <p>Periodo: {planejamentoCalculo.inicioISO} a {planejamentoCalculo.fimISO} ({planejamentoCalculo.diasCorridos} dia(s) corridos)</p>
                                </div>
                            </div>

                            {/* ── SECTION 2: Cenarios e Preco ── */}
                            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                                <h3 className="mb-4 font-bold text-foreground">Cenarios de preco</h3>
                                <div className="grid gap-3 md:grid-cols-3">
                                    {(['economico', 'recomendado', 'premium'] as ScenarioKey[]).map((key) => {
                                        const scenario = orcamentos?.[key];
                                        const selected = orcamentos?.selecionado === key;
                                        const cardDays = scenarioActiveDays(scenario, diasCuidadoEfetivos);
                                        const cardMonthly = scenarioMonthlyEquivalent(scenario, diasCuidadoEfetivos);
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => selectScenario(key)}
                                                className={`rounded-xl border-2 p-4 text-left transition ${selected ? 'border-emerald-500 bg-secondary-400/10' : 'border-border bg-card hover:border-border-hover'}`}
                                            >
                                                <p className="text-xs font-bold uppercase tracking-wide text-foreground">
                                                    {scenario?.label || key} {selected ? 'OK' : ''}
                                                </p>
                                                <p className="mt-1 text-xl font-bold text-foreground">
                                                    {formatCurrency(num(scenario?.data?.total, 0))}
                                                    <span className="ml-1 text-xs font-normal text-muted-foreground">/periodo</span>
                                                </p>
                                                <p className="text-xs text-muted-foreground">Mensal: {formatCurrency(cardMonthly)}</p>
                                                <p className="text-xs text-muted-foreground">{cardDays}d · {scenario?.horasDiarias || 0}h/dia · {scenario?.tipoProfissional || '-'}</p>
                                            </button>
                                        );
                                    })}
                                </div>
                                {loadingOrcamento && <p className="mt-3 text-sm text-primary">Calculando cenarios...</p>}
                                {orcamentoError && <p className="mt-3 text-sm text-error-600">{orcamentoError}</p>}

                                {/* Breakdown */}
                                {(() => {
                                    const sel = orcamentos?.selecionado;
                                    const scenario = sel ? orcamentos?.[sel] : undefined;
                                    const pb = scenario?.meta?.pricingBreakdown as Record<string, unknown> | undefined;
                                    const bd = (pb?.breakdown ?? pb) as Record<string, unknown> | undefined;
                                    const lines = calculatorBreakdownToLines(bd && typeof bd === 'object' && 'custo_profissional' in bd ? bd : undefined);
                                    if (!lines.length) return null;
                                    return (
                                        <div className="mt-4">
                                            <BreakdownTable lines={lines} title={`Detalhamento — ${scenario?.label || sel}`} />
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* ── SECTION 3: Comercial ── */}
                            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                                <h3 className="mb-4 font-bold text-foreground">Configuracao comercial</h3>

                                <div className="grid gap-4 md:grid-cols-3">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Valor do periodo (R$)</label>
                                        <input type="number" value={proposal.valorTotal} onChange={(e) => setProposal((prev) => ({ ...prev, valorTotal: num(e.target.value, 0) }))} className="w-full rounded-lg border p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-ring" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Vencimento</label>
                                        <input type="date" value={proposal.vencimento} onChange={(e) => setProposal((prev) => ({ ...prev, vencimento: e.target.value }))} className="w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Acrescimos (R$)</label>
                                        <input type="number" value={proposal.acrescimos} onChange={(e) => setProposal((prev) => ({ ...prev, acrescimos: num(e.target.value, 0) }))} className="w-full rounded-lg border p-2.5 text-sm" placeholder="0" />
                                    </div>
                                </div>

                                {/* Descontos */}
                                <div className="mt-4 grid gap-4 md:grid-cols-3">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Desconto (%)</label>
                                        <input type="number" value={proposal.descontoPercent} onChange={(e) => setProposal((prev) => ({ ...prev, descontoPercent: Math.max(0, Math.min(100, num(e.target.value, 0))) }))} className="w-full rounded-lg border p-2.5 text-sm" min={0} max={100} step="0.01" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Desconto (R$)</label>
                                        <input type="number" value={proposal.descontos} onChange={(e) => setProposal((prev) => ({ ...prev, descontos: num(e.target.value, 0) }))} className="w-full rounded-lg border p-2.5 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Desconto engine (%)</label>
                                        <input type="number" min={0} max={100} value={planejamento360.descontoManualPercent} onChange={(e) => setPlanejamento360((p) => ({ ...p, descontoManualPercent: Math.max(0, Math.min(100, num(e.target.value, p.descontoManualPercent))) }))} className="w-full rounded-lg border p-2.5 text-sm" />
                                    </div>
                                </div>

                                {/* Pagamento */}
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-2 block text-xs font-medium text-foreground">Metodo</label>
                                        <div className="flex gap-2">
                                            {[{ key: 'PIX', label: 'PIX' }, { key: 'CARTAO DE CREDITO', label: 'Cartao' }].map((method) => {
                                                const sel = proposal.metodosPagamento.includes(method.key);
                                                return (
                                                    <button key={method.key} type="button" onClick={() => setProposal((prev) => { const cur = prev.metodosPagamento; const next = sel ? cur.filter((i) => i !== method.key) : [...cur, method.key]; return { ...prev, metodosPagamento: next.length ? next : ['PIX'] }; })} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${sel ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-background'}`}>
                                                        {method.label}
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

                                {/* Margem + Imposto */}
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Margem desejada (%)</label>
                                        <input type="number" min={0} value={planejamento360.margemDesejadaPercent} onChange={(e) => setPlanejamento360((p) => ({ ...p, margemDesejadaPercent: Math.max(0, num(e.target.value, p.margemDesejadaPercent)) }))} className="w-full rounded-lg border p-2.5 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Imposto (%)</label>
                                        <input type="number" min={0} value={planejamento360.impostoPercent} onChange={(e) => setPlanejamento360((p) => ({ ...p, impostoPercent: Math.max(0, num(e.target.value, p.impostoPercent)) }))} className="w-full rounded-lg border p-2.5 text-sm" />
                                    </div>
                                </div>

                                {/* Minicustos toggles */}
                                <div className="mt-4">
                                    <label className="mb-2 block text-xs font-medium text-foreground">Minicustos operacionais</label>
                                    <div className="flex flex-wrap gap-2">
                                        {MINICUSTO_OPTIONS.map((mc) => {
                                            const active = !disabledMinicustos.has(mc.tipo);
                                            return (
                                                <button key={mc.tipo} type="button" onClick={() => toggleMinicusto(mc.tipo)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground line-through opacity-60 hover:opacity-100'}`}>
                                                    {mc.nome}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {/* ── SECTION 4: Avancado (collapsed) ── */}
                            <div className="rounded-xl border border-border bg-card shadow-sm">
                                <button type="button" onClick={() => setAdvancedOpen(!advancedOpen)} className="flex w-full items-center justify-between p-4 text-sm font-semibold text-foreground hover:bg-surface-subtle/30 transition">
                                    <span>Ajustes avancados</span>
                                    {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                                {advancedOpen && (
                                    <div className="border-t border-border p-6 space-y-4">
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

                            {/* ── Dados do contratante ── */}
                            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                                <h3 className="mb-4 font-bold text-foreground">Dados do contratante</h3>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">Nome responsavel</label>
                                        <input value={proposal.nome} onChange={(e) => setProposal((p) => ({ ...p, nome: e.target.value }))} className="w-full rounded-lg border bg-background p-2.5 text-sm transition focus:bg-card" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-foreground">WhatsApp / Email</label>
                                        <input value={proposal.phone} onChange={(e) => setProposal((p) => ({ ...p, phone: e.target.value }))} className="w-full rounded-lg border bg-background p-2.5 text-sm transition focus:bg-card" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ════════════════ RIGHT COLUMN (sticky sidebar) ════════════════ */}
                        <div className="space-y-4">
                            <div className="sticky top-4 space-y-4">
                                {/* Price summary */}
                                <div className="rounded-xl bg-gradient-to-br from-gray-900 to-gray-800 p-5 text-white shadow-lg">
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

                                    <button
                                        onClick={handleSendProposal}
                                        disabled={sending || !selectedScenario}
                                        className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-bold shadow-lg transition active:scale-95 ${sending ? 'cursor-wait bg-gray-600' : 'bg-secondary-500 text-white hover:bg-secondary-400'}`}
                                    >
                                        {sending ? 'Enviando...' : 'Enviar via WhatsApp'}
                                    </button>
                                    <div className="mt-3 text-center">
                                        <button onClick={() => setStep('responsibilities')} className="text-xs text-gray-500 underline hover:text-white">
                                            Voltar para revisao
                                        </button>
                                    </div>
                                </div>

                                {/* Quick info */}
                                <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground space-y-1">
                                    <p><span className="font-medium text-foreground">Paciente:</span> {selectedPatient?.nome || '-'}</p>
                                    <p><span className="font-medium text-foreground">Profissional:</span> {tipoProfissionalResumoAtivo}</p>
                                    <p><span className="font-medium text-foreground">Complexidade:</span> {complexidadeResumoAtiva}</p>
                                    <p><span className="font-medium text-foreground">Modelo:</span> {planejamento360.modeloEscala}</p>
                                    <p><span className="font-medium text-foreground">Periodo:</span> {planejamento360.dataInicioCuidado || '-'} a {planejamento360.dataFimCuidado || '-'}</p>
                                    <p><span className="font-medium text-foreground">Cobertura:</span> {selectedScenarioDays}d · {selectedScenarioHours}h · {planejamento360.horasCuidadoDia}h/dia</p>
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
