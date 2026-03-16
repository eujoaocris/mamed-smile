'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, ChevronDown, ChevronUp, FileText, RefreshCw, Send, SlidersHorizontal, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BreakdownTable } from '@/components/pricing/BreakdownTable';
import type { PricingBreakdownItem } from '@/lib/pricing/enterprise-engine';
import {
    calculateCoveragePreset,
    COVERAGE_PRESET_KEYS,
    COVERAGE_PRESETS,
    type CoveragePresetKey,
    type CoverageCalcOutput,
    type HorasCobertura,
} from '@/lib/pricing/coverage-presets';

interface OrcamentoDetalhe {
    id: string;
    status: string;
    cenarioEconomico?: string | null;
    cenarioRecomendado?: string | null;
    cenarioPremium?: string | null;
    cenarioSelecionado?: string | null;
    valorFinal?: number | null;
    descontoManualPercent?: number | null;
    minicustosDesativados?: string | null;
    snapshotInput?: string | null;
    pricingBreakdown?: string | null;
    enviadoEm?: string | null;
    aceitoEm?: string | null;
    createdAt: string;
    paciente: {
        id: string;
        nome?: string | null;
        telefone: string;
        cidade?: string | null;
        bairro?: string | null;
    };
}

interface CenarioResumo {
    nome?: string;
    totalSemanal: number;
    estimativaMensal: number;
    plantoes?: unknown[];
    breakdown?: PricingBreakdownItem[];
}

interface ScenarioPricingPreview {
    baseTotalSemanal: number;
    baseEstimativaMensal: number;
    descontoPercentual: number;
    basePlantoes: number;
    targetPlantoes: number;
    baseHoras: number;
    targetHoras: number;
    planningFactor: number;
    totalSemanal: number;
    estimativaMensal: number;
}

type OrcamentoScenarioKey = 'economico' | 'recomendado' | 'premium';
type ConfiguredAction = 'preview-proposta' | 'preview-contrato' | 'send-proposta' | 'send-contrato';

interface SendOptionsFormState {
    cenarioSelecionado: OrcamentoScenarioKey;
    presetCobertura: CoveragePresetKey | '';
    horasCoberturaOverride: HorasCobertura;
    descontoManualPercent: string;
    valorFinal: string;
    minicustosDesativados: string;
    dataInicioCuidado: string;
    dataFimCuidado: string;
    periodicidade: string;
    semanasPlanejadas: string;
    mesesPlanejados: string;
    horasCuidadoDia: string;
    diasAtendimento: string;
    tempoCuidadoDescricao: string;
    alocacaoResumo: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'> = {
    RASCUNHO: 'default',
    APROVADO: 'info',
    ENVIADO: 'warning',
    PROPOSTA_ENVIADA: 'purple',
    CONTRATO_ENVIADO: 'purple',
    ACEITO: 'success',
    RECUSADO: 'error',
    CANCELADO: 'error',
};

const DEFAULT_HOURS_PER_OCCURRENCE = 12;
const APPROX_WEEKS_PER_MONTH = 4.33;
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

function formatCurrency(value?: number | null) {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(dateStr?: string | null) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('pt-BR');
}

function round2(value: number): number {
    return Number(value.toFixed(2));
}

function parsePositiveNumber(value: string): number | null {
    const normalized = value.replace(',', '.').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseNumberWithDefault(value: string, fallback = 0): number {
    const normalized = value.replace(',', '.').trim();
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function parseWeekdaysCsv(value: string): number[] {
    if (!value.trim()) return [];
    const days = value
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .map((item) => WEEKDAY_MAP[item])
        .filter((item): item is number => Number.isInteger(item));
    return [...new Set(days)];
}

function parseDateOnly(value: string): Date | null {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function countOccurrencesByDateRange(
    start: Date,
    end: Date,
    periodicidade: string,
    weekdays: number[],
): number {
    if (end < start) return 1;

    const msPerDay = 24 * 60 * 60 * 1000;
    const daysInRange = Math.max(1, Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1);

    if (weekdays.length > 0) {
        const weekdaySet = new Set(weekdays);
        let count = 0;
        for (let dayOffset = 0; dayOffset < daysInRange; dayOffset += 1) {
            const current = new Date(start.getTime() + (dayOffset * msPerDay));
            if (weekdaySet.has(current.getDay())) count += 1;
        }
        return Math.max(1, count);
    }

    if (periodicidade === 'SEMANAL') return Math.max(1, Math.ceil(daysInRange / 7));
    if (periodicidade === 'QUINZENAL') return Math.max(1, Math.ceil(daysInRange / 14));
    if (periodicidade === 'MENSAL') return Math.max(1, Math.ceil(daysInRange / 30));
    return daysInRange;
}

function inferDaysPerWeek(periodicidade: string, basePlantoes: number): number {
    if (periodicidade === 'DIARIO') return 7;
    if (periodicidade === 'SEMANAL') return Math.max(1, Math.min(7, basePlantoes));
    if (periodicidade === 'QUINZENAL') return Math.max(1, Math.min(4, Math.round(basePlantoes / 2)));
    if (periodicidade === 'MENSAL') return 1;
    return Math.max(1, Math.min(7, basePlantoes));
}

function estimateTargetPlantoes(form: SendOptionsFormState, basePlantoes: number): number {
    const weekdays = parseWeekdaysCsv(form.diasAtendimento);
    const periodicidade = (form.periodicidade || 'SEMANAL').trim().toUpperCase();
    const weeks = parsePositiveNumber(form.semanasPlanejadas);
    const months = parsePositiveNumber(form.mesesPlanejados);

    if (weeks) {
        const daysPerWeek = weekdays.length > 0 ? weekdays.length : inferDaysPerWeek(periodicidade, basePlantoes);
        return Math.max(1, Math.round(weeks * daysPerWeek));
    }

    if (months) {
        const daysPerWeek = weekdays.length > 0 ? weekdays.length : inferDaysPerWeek(periodicidade, basePlantoes);
        return Math.max(1, Math.round(months * APPROX_WEEKS_PER_MONTH * daysPerWeek));
    }

    const start = parseDateOnly(form.dataInicioCuidado);
    const end = parseDateOnly(form.dataFimCuidado);
    if (start && end) {
        return countOccurrencesByDateRange(start, end, periodicidade, weekdays);
    }

    return Math.max(1, basePlantoes);
}

function parseHoursFromHorario(value: string): number | null {
    const match = value.match(/(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const startMinutes = (Number(match[1]) * 60) + Number(match[2]);
    const endMinutes = (Number(match[3]) * 60) + Number(match[4]);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return null;
    let diff = endMinutes - startMinutes;
    if (diff <= 0) diff += 24 * 60;
    const hours = diff / 60;
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return hours;
}

function estimateBaseHours(plantoes?: unknown[]): number {
    if (!Array.isArray(plantoes) || plantoes.length === 0) return DEFAULT_HOURS_PER_OCCURRENCE;
    const parsed = plantoes
        .map((plantao) => {
            if (!plantao || typeof plantao !== 'object') return null;
            const horario = String((plantao as Record<string, unknown>).horario || '');
            return parseHoursFromHorario(horario);
        })
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

    if (parsed.length === 0) return DEFAULT_HOURS_PER_OCCURRENCE;
    const avg = parsed.reduce((acc, current) => acc + current, 0) / parsed.length;
    return Math.max(1, round2(avg));
}

function calculateScenarioPreview(
    scenario: CenarioResumo | null,
    form: SendOptionsFormState,
): ScenarioPricingPreview | null {
    if (!scenario) return null;

    const baseTotalSemanal = Math.max(0, Number(scenario.totalSemanal || 0));
    const baseEstimativaMensal = Math.max(0, Number(scenario.estimativaMensal || 0));
    const basePlantoes = Math.max(1, Array.isArray(scenario.plantoes) ? scenario.plantoes.length : 1);
    const baseHoras = estimateBaseHours(scenario.plantoes);
    const targetPlantoes = estimateTargetPlantoes(form, basePlantoes);
    const targetHoras = parsePositiveNumber(form.horasCuidadoDia) ?? baseHoras;
    const planningFactor = round2(
        Math.max(
            0.01,
            (targetPlantoes * targetHoras) / (basePlantoes * baseHoras),
        ),
    );

    const descontoPercentual = clamp(parseNumberWithDefault(form.descontoManualPercent, 0), 0, 100);
    const totalSemanal = round2(baseTotalSemanal * planningFactor * (1 - (descontoPercentual / 100)));
    const estimativaMensal = round2(totalSemanal * APPROX_WEEKS_PER_MONTH);

    return {
        baseTotalSemanal,
        baseEstimativaMensal,
        descontoPercentual,
        basePlantoes,
        targetPlantoes,
        baseHoras,
        targetHoras,
        planningFactor,
        totalSemanal,
        estimativaMensal,
    };
}

function sanitizeScenarioKey(value?: string | null): OrcamentoScenarioKey {
    const normalized = String(value || 'recomendado').trim().toLowerCase();
    if (normalized === 'economico') return 'economico';
    if (normalized === 'premium') return 'premium';
    return 'recomendado';
}

function parseCenario(json?: string | null): CenarioResumo | null {
    if (!json || !json.trim()) return null;
    try {
        const parsed = JSON.parse(json) as Record<string, unknown>;
        const totalSemanal = Number(parsed.totalSemanal);
        const estimativaMensal = Number(parsed.estimativaMensal);
        if (!Number.isFinite(totalSemanal) || !Number.isFinite(estimativaMensal)) return null;
        return {
            nome: typeof parsed.nome === 'string' ? parsed.nome : undefined,
            totalSemanal,
            estimativaMensal,
            plantoes: Array.isArray(parsed.plantoes) ? parsed.plantoes : undefined,
            breakdown: Array.isArray(parsed.breakdown) ? parsed.breakdown as PricingBreakdownItem[] : undefined,
        };
    } catch {
        return null;
    }
}

function parseMinicustosStored(raw?: string | null): string {
    if (!raw || !raw.trim()) return '';
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item || '').trim()).filter(Boolean).join(', ');
        }
    } catch {
        // ignore and fallback to raw string
    }
    return raw;
}

function parsePlanningFromSnapshot(raw?: string | null): Partial<SendOptionsFormState> {
    if (!raw || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const planning = (parsed.planejamento360 ?? parsed.sendOptions ?? {}) as Record<string, unknown>;
        const diasAtendimento = Array.isArray(planning.diasAtendimento)
            ? planning.diasAtendimento.map((item) => String(item || '').trim()).filter(Boolean).join(',')
            : '';
        return {
            dataInicioCuidado: String(planning.dataInicioCuidado ?? ''),
            dataFimCuidado: String(planning.dataFimCuidado ?? ''),
            periodicidade: String(planning.periodicidade ?? ''),
            semanasPlanejadas: planning.semanasPlanejadas !== undefined ? String(planning.semanasPlanejadas) : '',
            mesesPlanejados: planning.mesesPlanejados !== undefined ? String(planning.mesesPlanejados) : '',
            horasCuidadoDia: planning.horasCuidadoDia !== undefined ? String(planning.horasCuidadoDia) : '',
            diasAtendimento,
            tempoCuidadoDescricao: String(planning.tempoCuidadoDescricao ?? ''),
            alocacaoResumo: String(planning.alocacaoResumo ?? ''),
        };
    } catch {
        return {};
    }
}

function buildActionTitle(action: ConfiguredAction): string {
    if (action === 'preview-proposta') return 'Configurar Preview da Proposta';
    if (action === 'preview-contrato') return 'Configurar Preview do Contrato';
    if (action === 'send-proposta') return 'Configurar Envio da Proposta';
    return 'Configurar Envio do Contrato';
}

function loadingKeyFromAction(action: ConfiguredAction): 'gerar-proposta' | 'gerar-contrato' | 'enviar-proposta' | 'enviar-contrato' {
    if (action === 'preview-proposta') return 'gerar-proposta';
    if (action === 'preview-contrato') return 'gerar-contrato';
    if (action === 'send-proposta') return 'enviar-proposta';
    return 'enviar-contrato';
}

export default function OrcamentoDetalhePage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();

    const [orcamento, setOrcamento] = useState<OrcamentoDetalhe | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [configuredAction, setConfiguredAction] = useState<ConfiguredAction | null>(null);
    const [valorFinalManual, setValorFinalManual] = useState(false);
    const [optionsForm, setOptionsForm] = useState<SendOptionsFormState>({
        cenarioSelecionado: 'recomendado',
        presetCobertura: '',
        horasCoberturaOverride: 12,
        descontoManualPercent: '',
        valorFinal: '',
        minicustosDesativados: '',
        dataInicioCuidado: '',
        dataFimCuidado: '',
        periodicidade: 'SEMANAL',
        semanasPlanejadas: '',
        mesesPlanejados: '',
        horasCuidadoDia: '',
        diasAtendimento: '',
        tempoCuidadoDescricao: '',
        alocacaoResumo: '',
    });
    const [showAdvanced, setShowAdvanced] = useState(false);

    const scenarioSummaries = useMemo(() => ({
        economico: parseCenario(orcamento?.cenarioEconomico),
        recomendado: parseCenario(orcamento?.cenarioRecomendado),
        premium: parseCenario(orcamento?.cenarioPremium),
    }), [orcamento?.cenarioEconomico, orcamento?.cenarioRecomendado, orcamento?.cenarioPremium]);

    const scenarioPricingPreviews = useMemo<Record<OrcamentoScenarioKey, ScenarioPricingPreview | null>>(() => ({
        economico: calculateScenarioPreview(scenarioSummaries.economico, optionsForm),
        recomendado: calculateScenarioPreview(scenarioSummaries.recomendado, optionsForm),
        premium: calculateScenarioPreview(scenarioSummaries.premium, optionsForm),
    }), [
        scenarioSummaries.economico,
        scenarioSummaries.recomendado,
        scenarioSummaries.premium,
        optionsForm,
    ]);

    const selectedScenarioPreview = useMemo(
        () => scenarioPricingPreviews[optionsForm.cenarioSelecionado],
        [scenarioPricingPreviews, optionsForm.cenarioSelecionado],
    );

    const coveragePreview = useMemo<CoverageCalcOutput | null>(() => {
        if (!optionsForm.presetCobertura) return null;
        const scenario = scenarioSummaries[optionsForm.cenarioSelecionado];
        if (!scenario) return null;
        const basePlantoes = Array.isArray(scenario.plantoes) ? scenario.plantoes.length : 1;
        const baseHoras = estimateBaseHours(scenario.plantoes);
        try {
            return calculateCoveragePreset({
                preset: optionsForm.presetCobertura as CoveragePresetKey,
                horasOverride: optionsForm.horasCoberturaOverride,
                baseTotalSemanal: scenario.totalSemanal,
                basePlantoes: Math.max(1, basePlantoes),
                baseHorasPorPlantao: Math.max(1, baseHoras),
                descontoPercent: parseNumberWithDefault(optionsForm.descontoManualPercent, 0),
            });
        } catch {
            return null;
        }
    }, [
        optionsForm.presetCobertura,
        optionsForm.horasCoberturaOverride,
        optionsForm.cenarioSelecionado,
        optionsForm.descontoManualPercent,
        scenarioSummaries,
    ]);

    useEffect(() => {
        if (!configuredAction) return;
        if (valorFinalManual) return;

        // Use coverage preset value when active, otherwise use scenario preview
        if (coveragePreview) {
            const nextValue = coveragePreview.valorPeriodo.toFixed(2);
            setOptionsForm((prev) => (prev.valorFinal === nextValue ? prev : { ...prev, valorFinal: nextValue }));
            return;
        }

        if (!selectedScenarioPreview) return;
        const nextValue = selectedScenarioPreview.totalSemanal.toFixed(2);
        setOptionsForm((prev) => (prev.valorFinal === nextValue ? prev : { ...prev, valorFinal: nextValue }));
    }, [configuredAction, selectedScenarioPreview, coveragePreview, valorFinalManual]);

    function updateOptionField<K extends keyof SendOptionsFormState>(
        key: K,
        value: SendOptionsFormState[K],
        resetManualValue = true,
    ) {
        if (resetManualValue) setValorFinalManual(false);
        setOptionsForm((prev) => ({ ...prev, [key]: value }));
    }

    async function fetchOrcamento() {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/admin/orcamentos/${params.id}`);
            const payload = await response.json().catch(() => ({}));

            if (!response.ok || !payload?.success) {
                setError(payload?.error || 'Falha ao carregar orcamento.');
                setOrcamento(null);
                return;
            }

            setOrcamento(payload.orcamento || null);
        } catch {
            setError('Falha ao carregar orcamento.');
            setOrcamento(null);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchOrcamento();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id]);

    async function openPdf(
        endpoint: 'gerar-proposta' | 'gerar-contrato',
        payload?: Record<string, unknown>,
    ): Promise<boolean> {
        setActionLoading(endpoint);
        try {
            const response = await fetch(`/api/admin/orcamentos/${params.id}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
            });
            if (!response.ok) {
                const responsePayload = await response.json().catch(() => ({}));
                setError(responsePayload?.error || 'Falha ao gerar PDF.');
                return false;
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener,noreferrer');
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            return true;
        } finally {
            setActionLoading(null);
        }
    }

    async function runAction(
        action: 'enviar-proposta' | 'enviar-contrato' | 'aceitar' | 'cancelar',
        payload?: Record<string, unknown>,
    ): Promise<boolean> {
        setActionLoading(action);
        setError(null);

        try {
            let url = `/api/admin/orcamentos/${params.id}`;
            let method: 'PATCH' | 'POST' = 'PATCH';
            let body: Record<string, unknown> = {};

            if (action === 'enviar-proposta') {
                url = `/api/admin/orcamentos/${params.id}/enviar-proposta`;
                method = 'POST';
                body = payload || {};
            } else if (action === 'enviar-contrato') {
                url = `/api/admin/orcamentos/${params.id}/enviar-contrato`;
                method = 'POST';
                body = payload || {};
            } else {
                body = { action };
            }

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const responsePayload = await response.json().catch(() => ({}));
            if (!response.ok || responsePayload?.success === false) {
                setError(responsePayload?.error || 'Falha ao executar acao.');
                return false;
            }

            await fetchOrcamento();
            return true;
        } finally {
            setActionLoading(null);
        }
    }

    function openConfiguredAction(action: ConfiguredAction) {
        if (!orcamento) return;
        setError(null);
        setValorFinalManual(false);
        const planning = parsePlanningFromSnapshot(orcamento.snapshotInput);
        setOptionsForm({
            cenarioSelecionado: sanitizeScenarioKey(orcamento.cenarioSelecionado),
            presetCobertura: '',
            horasCoberturaOverride: 12,
            descontoManualPercent: orcamento.descontoManualPercent !== null && orcamento.descontoManualPercent !== undefined
                ? String(orcamento.descontoManualPercent)
                : '',
            valorFinal: orcamento.valorFinal !== null && orcamento.valorFinal !== undefined
                ? String(orcamento.valorFinal)
                : '',
            minicustosDesativados: parseMinicustosStored(orcamento.minicustosDesativados),
            dataInicioCuidado: planning.dataInicioCuidado || '',
            dataFimCuidado: planning.dataFimCuidado || '',
            periodicidade: planning.periodicidade || 'SEMANAL',
            semanasPlanejadas: planning.semanasPlanejadas || '',
            mesesPlanejados: planning.mesesPlanejados || '',
            horasCuidadoDia: planning.horasCuidadoDia || '',
            diasAtendimento: planning.diasAtendimento || '',
            tempoCuidadoDescricao: planning.tempoCuidadoDescricao || '',
            alocacaoResumo: planning.alocacaoResumo || '',
        });
        setShowAdvanced(false);
        setConfiguredAction(action);
    }

    function buildSendPayload(): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
        const payload: Record<string, unknown> = {
            cenarioSelecionado: optionsForm.cenarioSelecionado,
        };

        const descontoRaw = optionsForm.descontoManualPercent.trim();
        if (descontoRaw) {
            const desconto = Number(descontoRaw);
            if (!Number.isFinite(desconto) || desconto < 0 || desconto > 100) {
                return { ok: false, error: 'Desconto manual deve estar entre 0 e 100.' };
            }
            payload.descontoManualPercent = desconto;
        }

        const valorRaw = optionsForm.valorFinal.trim();
        if (valorRaw) {
            const valor = Number(valorRaw);
            if (!Number.isFinite(valor) || valor <= 0) {
                return { ok: false, error: 'Valor final deve ser maior que zero.' };
            }
            payload.valorFinal = valor;
        }

        const minicustos = optionsForm.minicustosDesativados
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        if (minicustos.length > 0) {
            payload.minicustosDesativados = [...new Set(minicustos)];
        }

        if (optionsForm.dataInicioCuidado.trim()) payload.dataInicioCuidado = optionsForm.dataInicioCuidado.trim();
        if (optionsForm.dataFimCuidado.trim()) payload.dataFimCuidado = optionsForm.dataFimCuidado.trim();
        if (optionsForm.periodicidade.trim()) payload.periodicidade = optionsForm.periodicidade.trim();
        if (optionsForm.tempoCuidadoDescricao.trim()) payload.tempoCuidadoDescricao = optionsForm.tempoCuidadoDescricao.trim();
        if (optionsForm.alocacaoResumo.trim()) payload.alocacaoResumo = optionsForm.alocacaoResumo.trim();

        const diasAtendimento = optionsForm.diasAtendimento
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        if (diasAtendimento.length > 0) {
            payload.diasAtendimento = [...new Set(diasAtendimento)];
        }

        if (optionsForm.semanasPlanejadas.trim()) {
            const semanas = Number(optionsForm.semanasPlanejadas);
            if (!Number.isFinite(semanas) || semanas <= 0) {
                return { ok: false, error: 'Semanas planejadas deve ser maior que zero.' };
            }
            payload.semanasPlanejadas = semanas;
        }

        if (optionsForm.mesesPlanejados.trim()) {
            const meses = Number(optionsForm.mesesPlanejados);
            if (!Number.isFinite(meses) || meses <= 0) {
                return { ok: false, error: 'Meses planejados deve ser maior que zero.' };
            }
            payload.mesesPlanejados = meses;
        }

        if (optionsForm.horasCuidadoDia.trim()) {
            const horas = Number(optionsForm.horasCuidadoDia);
            if (!Number.isFinite(horas) || horas < 1 || horas > 24) {
                return { ok: false, error: 'Horas de cuidado/dia deve estar entre 1 e 24.' };
            }
            payload.horasCuidadoDia = horas;
        }

        if (optionsForm.presetCobertura) {
            payload.presetCobertura = optionsForm.presetCobertura;
            payload.horasCoberturaOverride = optionsForm.horasCoberturaOverride;
        }

        return { ok: true, payload };
    }

    async function confirmConfiguredAction() {
        if (!configuredAction) return;

        const parsed = buildSendPayload();
        if (!parsed.ok) {
            setError(parsed.error);
            return;
        }

        const action = configuredAction;
        const payload = parsed.payload;
        let success = false;

        if (action === 'preview-proposta') {
            success = await openPdf('gerar-proposta', payload);
        } else if (action === 'preview-contrato') {
            success = await openPdf('gerar-contrato', payload);
        } else if (action === 'send-proposta') {
            success = await runAction('enviar-proposta', payload);
        } else if (action === 'send-contrato') {
            success = await runAction('enviar-contrato', payload);
        }

        if (success) {
            setConfiguredAction(null);
        }
    }

    if (loading) {
        return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;
    }

    if (!orcamento) {
        return (
            <div className="p-8">
                <Card>
                    <p className="text-error-600">{error || 'Orcamento nao encontrado.'}</p>
                    <div className="mt-4 flex gap-2">
                        <Button variant="outline" onClick={fetchOrcamento}>
                            <RefreshCw className="h-4 w-4" />
                            Tentar novamente
                        </Button>
                        <Link href="/admin/orcamentos">
                            <Button>Voltar</Button>
                        </Link>
                    </div>
                </Card>
            </div>
        );
    }

    const scenarioCards: Array<{ key: OrcamentoScenarioKey; label: string; data: CenarioResumo | null; preview: ScenarioPricingPreview | null }> = [
        { key: 'economico', label: 'Economico', data: scenarioSummaries.economico, preview: scenarioPricingPreviews.economico },
        { key: 'recomendado', label: 'Recomendado', data: scenarioSummaries.recomendado, preview: scenarioPricingPreviews.recomendado },
        { key: 'premium', label: 'Premium', data: scenarioSummaries.premium, preview: scenarioPricingPreviews.premium },
    ];

    return (
        <div className="p-6 lg:p-8">
            <PageHeader
                title={`Orcamento ${orcamento.id}`}
                description={`Paciente: ${orcamento.paciente?.nome || 'Sem nome'}`}
                breadcrumbs={[
                    { label: 'Dashboard', href: '/admin/dashboard' },
                    { label: 'Orcamentos', href: '/admin/orcamentos' },
                    { label: 'Detalhe' },
                ]}
                actions={(
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={fetchOrcamento} isLoading={loading}>
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Link href="/admin/orcamentos">
                            <Button variant="outline">
                                <ArrowLeft className="h-4 w-4" />
                                Voltar
                            </Button>
                        </Link>
                    </div>
                )}
            />

            {error && (
                <div className="mb-4 rounded-lg border border-error-100 bg-error-50 px-3 py-2 text-sm text-error-700">
                    {error}
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-3">
                <Card>
                    <h3 className="mb-3 font-semibold">Resumo</h3>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Status</span>
                            <Badge variant={STATUS_VARIANT[orcamento.status] || 'default'}>{orcamento.status}</Badge>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Valor Final</span>
                            <span className="font-medium">{formatCurrency(orcamento.valorFinal)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Desconto Manual</span>
                            <span>{orcamento.descontoManualPercent !== null && orcamento.descontoManualPercent !== undefined ? `${orcamento.descontoManualPercent}%` : '-'}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Cenario</span>
                            <span className="uppercase">{sanitizeScenarioKey(orcamento.cenarioSelecionado)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Criado em</span>
                            <span>{formatDate(orcamento.createdAt)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Enviado em</span>
                            <span>{formatDate(orcamento.enviadoEm)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Aceito em</span>
                            <span>{formatDate(orcamento.aceitoEm)}</span>
                        </div>
                    </div>
                </Card>

                <Card>
                    <h3 className="mb-3 font-semibold">Paciente</h3>
                    <div className="space-y-2 text-sm">
                        <p><strong>Nome:</strong> {orcamento.paciente?.nome || 'Sem nome'}</p>
                        <p><strong>Telefone:</strong> {orcamento.paciente?.telefone}</p>
                        <p><strong>Cidade:</strong> {orcamento.paciente?.cidade || '-'}</p>
                        <p><strong>Bairro:</strong> {orcamento.paciente?.bairro || '-'}</p>
                        <p><strong>Minicustos off:</strong> {parseMinicustosStored(orcamento.minicustosDesativados) || '-'}</p>
                    </div>
                </Card>

                <Card>
                    <h3 className="mb-3 font-semibold">Acoes</h3>
                    <div className="space-y-2">
                        <Button className="w-full justify-start" onClick={() => openConfiguredAction('preview-proposta')} isLoading={actionLoading === 'gerar-proposta'}>
                            <FileText className="h-4 w-4" />
                            Preview Proposta (configuravel)
                        </Button>
                        <Button className="w-full justify-start" variant="outline" onClick={() => openConfiguredAction('preview-contrato')} isLoading={actionLoading === 'gerar-contrato'}>
                            <FileText className="h-4 w-4" />
                            Preview Contrato (configuravel)
                        </Button>
                        <Button className="w-full justify-start bg-purple-600 hover:bg-purple-700" onClick={() => openConfiguredAction('send-proposta')} isLoading={actionLoading === 'enviar-proposta'}>
                            <Send className="h-4 w-4" />
                            Enviar Proposta (Outbox)
                        </Button>
                        <Button className="w-full justify-start bg-indigo-600 hover:bg-indigo-700" onClick={() => openConfiguredAction('send-contrato')} isLoading={actionLoading === 'enviar-contrato'}>
                            <Send className="h-4 w-4" />
                            Enviar Contrato (Outbox)
                        </Button>
                        <Button className="w-full justify-start bg-secondary-600 hover:bg-secondary-700" onClick={() => runAction('aceitar')} isLoading={actionLoading === 'aceitar'}>
                            <CheckCircle className="h-4 w-4" />
                            Marcar como Aceito
                        </Button>
                        <Button className="w-full justify-start" variant="danger" onClick={() => runAction('cancelar')} isLoading={actionLoading === 'cancelar'}>
                            <XCircle className="h-4 w-4" />
                            Cancelar Orcamento
                        </Button>
                    </div>
                </Card>
            </div>

            <Card className="mt-6">
                <h3 className="mb-3 font-semibold">Cenarios</h3>
                <div className="grid gap-3 text-sm md:grid-cols-3">
                    {scenarioCards.map((scenario) => {
                        const selected = sanitizeScenarioKey(orcamento.cenarioSelecionado) === scenario.key;
                        return (
                            <div
                                key={scenario.key}
                                className={`rounded-lg border p-3 ${selected ? 'border-emerald-500 bg-secondary-400/5' : 'border-border'}`}
                            >
                                <p className="mb-1 font-medium">
                                    {scenario.label} {selected ? '(selecionado)' : ''}
                                </p>
                                {scenario.data ? (
                                    <div>
                                        <p className="text-lg font-semibold text-foreground">
                                            {formatCurrency(scenario.data.totalSemanal)}<span className="ml-1 text-xs font-normal text-muted-foreground">/periodo</span>
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Mensal eq.: {formatCurrency(scenario.data.estimativaMensal)}
                                        </p>
                                        {scenario.data.breakdown && scenario.data.breakdown.length > 0 && (
                                            <div className="mt-2">
                                                <BreakdownTable
                                                    lines={scenario.data.breakdown}
                                                    title={`Detalhamento — ${scenario.label}`}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-foreground whitespace-pre-wrap">-</p>
                                )}
                            </div>
                        );
                    })}
                </div>
            </Card>

            {/* Fallback: show pricingBreakdown for older records without per-scenario breakdown */}
            {orcamento.pricingBreakdown && !scenarioCards.some((s) => s.data?.breakdown?.length) && (() => {
                try {
                    const parsed = JSON.parse(orcamento.pricingBreakdown) as PricingBreakdownItem[];
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return (
                            <div className="mt-4">
                                <BreakdownTable
                                    lines={parsed}
                                    title="Detalhamento de custos (cenario selecionado)"
                                    defaultOpen
                                />
                            </div>
                        );
                    }
                } catch { /* ignore invalid JSON */ }
                return null;
            })()}

            {configuredAction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/40"
                        onClick={() => setConfiguredAction(null)}
                        aria-label="Fechar configuracao"
                    />
                    <div className="relative z-10 w-full max-w-3xl rounded-xl border border-border bg-card p-6 shadow-2xl">
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-semibold text-foreground">{buildActionTitle(configuredAction)}</h3>
                                <p className="text-sm text-muted-foreground">
                                    Ajuste as opcoes antes de gerar ou enviar o documento.
                                </p>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => setConfiguredAction(null)}>
                                <XCircle className="h-4 w-4" />
                                Fechar
                            </Button>
                        </div>

                        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                            {/* Step 1: Coverage Preset */}
                            <div>
                                <p className="mb-2 text-sm font-medium text-foreground">1. Tipo de cobertura</p>
                                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                                    {COVERAGE_PRESET_KEYS.map((presetKey) => {
                                        const preset = COVERAGE_PRESETS[presetKey];
                                        const isSelected = optionsForm.presetCobertura === presetKey;
                                        return (
                                            <button
                                                key={presetKey}
                                                type="button"
                                                onClick={() => {
                                                    setValorFinalManual(false);
                                                    setOptionsForm((prev) => ({
                                                        ...prev,
                                                        presetCobertura: isSelected ? '' : presetKey,
                                                        horasCoberturaOverride: preset.horasPadrao,
                                                        horasCuidadoDia: String(preset.horasPadrao),
                                                        periodicidade: preset.periodicidade,
                                                        diasAtendimento: preset.diasAtendimentoPadrao.join(','),
                                                    }));
                                                }}
                                                className={`rounded-lg border p-3 text-left transition ${isSelected
                                                    ? 'border-emerald-500 bg-secondary-400/10 ring-1 ring-emerald-400'
                                                    : 'border-border bg-card hover:border-border-hover'
                                                    }`}
                                            >
                                                <p className="text-xs font-bold uppercase text-foreground">{preset.label}</p>
                                                <p className="mt-1 text-[11px] text-muted-foreground">{preset.descricao}</p>
                                                <p className="mt-1 text-[10px] text-muted-foreground">
                                                    {preset.diasAtivosPadrao} dia(s) &times; {preset.horasPadrao}h
                                                </p>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* 12h / 24h toggle */}
                                {optionsForm.presetCobertura && COVERAGE_PRESETS[optionsForm.presetCobertura as CoveragePresetKey]?.permitirAlternarHoras && (
                                    <div className="mt-3 flex items-center gap-3">
                                        <span className="text-sm text-muted-foreground">Horas por dia:</span>
                                        <div className="flex gap-1 rounded-lg border border-border p-0.5">
                                            {([12, 24] as const).map((h) => (
                                                <button
                                                    key={h}
                                                    type="button"
                                                    onClick={() => {
                                                        setValorFinalManual(false);
                                                        setOptionsForm((prev) => ({
                                                            ...prev,
                                                            horasCoberturaOverride: h,
                                                            horasCuidadoDia: String(h),
                                                        }));
                                                    }}
                                                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${optionsForm.horasCoberturaOverride === h
                                                        ? 'bg-emerald-600 text-white'
                                                        : 'bg-card text-foreground hover:bg-surface-subtle'
                                                        }`}
                                                >
                                                    {h}h
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Step 2: Scenario Selection */}
                            <div>
                                <p className="mb-2 text-sm font-medium text-foreground">2. Cenario para documento</p>
                                <div className="grid gap-3 md:grid-cols-3">
                                    {scenarioCards.map((scenario) => (
                                        <button
                                            key={scenario.key}
                                            type="button"
                                            onClick={() => updateOptionField('cenarioSelecionado', scenario.key)}
                                            className={`rounded-lg border p-3 text-left transition ${optionsForm.cenarioSelecionado === scenario.key
                                                ? 'border-emerald-500 bg-secondary-400/10'
                                                : 'border-border bg-card hover:border-border-hover'
                                            }`}
                                        >
                                            <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{scenario.label}</p>
                                            <p className="mt-2 text-sm font-semibold text-foreground">
                                                {scenario.preview ? formatCurrency(scenario.preview.totalSemanal) : 'Sem dados'}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {scenario.preview ? `${formatCurrency(scenario.preview.estimativaMensal)} / mes` : '-'}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Step 3: Discount + Final Value */}
                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="block text-sm">
                                    <span className="mb-1 block font-medium text-foreground">3. Desconto manual (%)</span>
                                    <input
                                        value={optionsForm.descontoManualPercent}
                                        onChange={(event) => updateOptionField('descontoManualPercent', event.target.value)}
                                        placeholder="Ex.: 5"
                                        type="number"
                                        min={0}
                                        max={100}
                                        step="0.01"
                                        className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                    />
                                </label>

                                <label className="block text-sm">
                                    <span className="mb-1 block font-medium text-foreground">
                                        4. Valor final {coveragePreview ? `(${coveragePreview.periodoLabel.split('(')[0].trim()})` : '(R$/periodo)'}
                                    </span>
                                    <input
                                        value={optionsForm.valorFinal}
                                        onChange={(event) => {
                                            setValorFinalManual(true);
                                            updateOptionField('valorFinal', event.target.value, false);
                                        }}
                                        placeholder="Ex.: 3909.67"
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                    />
                                    <span className="mt-1 block text-xs text-muted-foreground">
                                        {valorFinalManual
                                            ? 'Valor final em modo manual.'
                                            : coveragePreview
                                                ? `Calculado automaticamente pelo preset: ${coveragePreview.presetLabel}`
                                                : 'Valor final recalculado automaticamente pelas selecoes.'}
                                    </span>
                                    {valorFinalManual && (coveragePreview || selectedScenarioPreview) && (
                                        <button
                                            type="button"
                                            onClick={() => setValorFinalManual(false)}
                                            className="mt-1 text-xs font-medium text-secondary-700 hover:text-emerald-800"
                                        >
                                            Usar valor recalculado ({formatCurrency(coveragePreview?.valorPeriodo ?? selectedScenarioPreview?.totalSemanal ?? 0)})
                                        </button>
                                    )}
                                </label>
                            </div>

                            {/* Coverage Preview Summary */}
                            {coveragePreview && (
                                <div className="rounded-lg border border-emerald-200 bg-secondary-400/10 px-4 py-3">
                                    <p className="text-sm font-semibold text-emerald-900">Resumo da cobertura</p>
                                    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                                        <div>
                                            <span className="text-xs text-muted-foreground">Tipo</span>
                                            <p className="font-medium text-foreground">{coveragePreview.presetLabel}</p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-muted-foreground">Dias ativos</span>
                                            <p className="font-medium text-foreground">{coveragePreview.diasAtivos} dia(s)</p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-muted-foreground">Horas/dia</span>
                                            <p className="font-medium text-foreground">{coveragePreview.horasDia}h</p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-muted-foreground">Total horas</span>
                                            <p className="font-medium text-foreground">{coveragePreview.horasTotais}h</p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-muted-foreground">Valor do periodo</span>
                                            <p className="text-base font-bold text-emerald-700">{formatCurrency(coveragePreview.valorPeriodo)}</p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-muted-foreground">Valor por plantao</span>
                                            <p className="font-medium text-foreground">{formatCurrency(coveragePreview.valorPorPlantao)}</p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-muted-foreground">Estimativa mensal</span>
                                            <p className="font-medium text-foreground">{formatCurrency(coveragePreview.estimativaMensal)}</p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-muted-foreground">Fator de escala</span>
                                            <p className="font-medium text-foreground">x{coveragePreview.fatorEscala.toFixed(2)}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Fallback: legacy scenario preview */}
                            {!coveragePreview && selectedScenarioPreview && (
                                <div className="rounded-lg border border-emerald-200 bg-secondary-400/10 px-3 py-2 text-sm text-emerald-900">
                                    <p className="font-semibold">Resumo do recalculo automatico</p>
                                    <p>
                                        Base do cenario: {formatCurrency(selectedScenarioPreview.baseTotalSemanal)}
                                        {' '}| Planejamento: x{selectedScenarioPreview.planningFactor.toFixed(2)}
                                        {' '}({selectedScenarioPreview.basePlantoes} -&gt; {selectedScenarioPreview.targetPlantoes} plantoes, {selectedScenarioPreview.baseHoras}h -&gt; {selectedScenarioPreview.targetHoras}h)
                                    </p>
                                    <p>
                                        Desconto: {selectedScenarioPreview.descontoPercentual.toFixed(2)}%
                                        {' '}| Valor final sugerido: {formatCurrency(selectedScenarioPreview.totalSemanal)}
                                        {' '}| Estimativa mensal: {formatCurrency(selectedScenarioPreview.estimativaMensal)}
                                    </p>
                                </div>
                            )}

                            {/* Advanced Settings (collapsible) */}
                            <div className="rounded-lg border border-border">
                                <button
                                    type="button"
                                    onClick={() => setShowAdvanced((prev) => !prev)}
                                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-surface-subtle"
                                >
                                    <span>Configuracoes avancadas</span>
                                    {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>

                                {showAdvanced && (
                                    <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
                                        <label className="block text-sm">
                                            <span className="mb-1 block font-medium text-foreground">Minicustos desativados (separados por virgula)</span>
                                            <input
                                                value={optionsForm.minicustosDesativados}
                                                onChange={(event) => setOptionsForm((prev) => ({ ...prev, minicustosDesativados: event.target.value }))}
                                                placeholder="RESERVA_TECNICA, VISITA_SUPERVISAO"
                                                className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                            />
                                        </label>

                                        <p className="text-sm font-medium text-foreground">Planejamento 360 (datas e alocacao)</p>

                                        <div className="grid gap-3 md:grid-cols-3">
                                            <label className="block text-sm">
                                                <span className="mb-1 block font-medium text-foreground">Inicio</span>
                                                <input
                                                    type="date"
                                                    value={optionsForm.dataInicioCuidado}
                                                    onChange={(event) => updateOptionField('dataInicioCuidado', event.target.value)}
                                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block text-sm">
                                                <span className="mb-1 block font-medium text-foreground">Fim</span>
                                                <input
                                                    type="date"
                                                    value={optionsForm.dataFimCuidado}
                                                    onChange={(event) => updateOptionField('dataFimCuidado', event.target.value)}
                                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block text-sm">
                                                <span className="mb-1 block font-medium text-foreground">Periodicidade</span>
                                                <select
                                                    value={optionsForm.periodicidade}
                                                    onChange={(event) => updateOptionField('periodicidade', event.target.value)}
                                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                                >
                                                    <option value="DIARIO">Diario</option>
                                                    <option value="SEMANAL">Semanal</option>
                                                    <option value="QUINZENAL">Quinzenal</option>
                                                    <option value="MENSAL">Mensal</option>
                                                </select>
                                            </label>
                                        </div>

                                        <div className="grid gap-3 md:grid-cols-3">
                                            <label className="block text-sm">
                                                <span className="mb-1 block font-medium text-foreground">Semanas</span>
                                                <input
                                                    value={optionsForm.semanasPlanejadas}
                                                    onChange={(event) => updateOptionField('semanasPlanejadas', event.target.value)}
                                                    placeholder="4"
                                                    type="number"
                                                    min={1}
                                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block text-sm">
                                                <span className="mb-1 block font-medium text-foreground">Meses</span>
                                                <input
                                                    value={optionsForm.mesesPlanejados}
                                                    onChange={(event) => updateOptionField('mesesPlanejados', event.target.value)}
                                                    placeholder="1"
                                                    type="number"
                                                    min={1}
                                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block text-sm">
                                                <span className="mb-1 block font-medium text-foreground">Horas/dia</span>
                                                <input
                                                    value={optionsForm.horasCuidadoDia}
                                                    onChange={(event) => updateOptionField('horasCuidadoDia', event.target.value)}
                                                    placeholder="12"
                                                    type="number"
                                                    min={1}
                                                    max={24}
                                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                                />
                                            </label>
                                        </div>

                                        <div className="grid gap-3 md:grid-cols-2">
                                            <label className="block text-sm">
                                                <span className="mb-1 block font-medium text-foreground">Dias (csv)</span>
                                                <input
                                                    value={optionsForm.diasAtendimento}
                                                    onChange={(event) => updateOptionField('diasAtendimento', event.target.value)}
                                                    placeholder="seg,ter,qua,qui,sex"
                                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block text-sm">
                                                <span className="mb-1 block font-medium text-foreground">Tempo de cuidado</span>
                                                <input
                                                    value={optionsForm.tempoCuidadoDescricao}
                                                    onChange={(event) => setOptionsForm((prev) => ({ ...prev, tempoCuidadoDescricao: event.target.value }))}
                                                    placeholder="12h/dia por 3 meses"
                                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                                />
                                            </label>
                                        </div>

                                        <label className="block text-sm">
                                            <span className="mb-1 block font-medium text-foreground">Resumo de alocacao</span>
                                            <textarea
                                                value={optionsForm.alocacaoResumo}
                                                onChange={(event) => setOptionsForm((prev) => ({ ...prev, alocacaoResumo: event.target.value }))}
                                                placeholder="Escala, cobertura, troca de profissionais..."
                                                className="h-20 w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                            />
                                        </label>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary-100 bg-info-50 px-3 py-2 text-xs text-primary">
                                <span className="inline-flex items-center gap-2">
                                    <SlidersHorizontal className="h-4 w-4" />
                                    Essas opcoes sao usadas no preview e no envio para manter consistencia do documento final.
                                </span>
                                <span className="font-medium uppercase">{optionsForm.cenarioSelecionado}</span>
                            </div>

                            <div className="flex gap-2 pt-2">
                                <Button
                                    className="flex-1"
                                    onClick={confirmConfiguredAction}
                                    isLoading={actionLoading === loadingKeyFromAction(configuredAction)}
                                >
                                    Confirmar e executar
                                </Button>
                                <Button
                                    className="flex-1"
                                    variant="outline"
                                    onClick={() => setConfiguredAction(null)}
                                    disabled={actionLoading !== null}
                                >
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
