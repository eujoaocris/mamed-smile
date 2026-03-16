'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { BreakdownTable } from '@/components/pricing/BreakdownTable';
import type { PricingBreakdownItem } from '@/lib/pricing/enterprise-engine';

interface PacienteOption {
    id: string;
    nome?: string | null;
    telefone: string;
}

interface PreviewData {
    avaliacaoId: string;
    pacienteId: string;
    pacienteNome: string;
    unidadeId?: string;
    configVersionId?: string;
    moeda?: string;
    cenarioEconomico: string;
    cenarioRecomendado: string;
    cenarioPremium: string;
    valorFinal: number;
    snapshotsByScenario?: Record<CenarioSelecionado, ScenarioSnapshot>;
    metadados: {
        complexidadeInferida: string;
        tipoProfissionalInferido: string;
        horasDiariasInferidas: number;
        quantidadePacientesInferida?: number;
        doencasInferidas?: string[];
        avisos: string[];
    };
}

interface CenarioSummary {
    nome?: string;
    totalSemanal?: number;
    estimativaMensal?: number;
    plantoes?: unknown[];
}

interface ScenarioSnapshot {
    input: unknown;
    output: unknown;
    unidadeId?: string;
    configVersionId?: string;
    moeda?: string;
}

interface Planejamento360 {
    dataInicioCuidado?: string;
    dataFimCuidado?: string;
    diasAtendimento?: string[];
    periodicidade?: 'DIARIO' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
    semanasPlanejadas?: number;
    mesesPlanejados?: number;
    horasCuidadoDia?: number;
    tempoCuidadoDescricao?: string;
    alocacaoResumo?: string;
}

type CenarioField = 'cenarioEconomico' | 'cenarioRecomendado' | 'cenarioPremium';
type CenarioSelecionado = 'economico' | 'recomendado' | 'premium';

const CENARIO_CONFIG: Array<{ key: CenarioField; label: string; selected: CenarioSelecionado; tone: string }> = [
    { key: 'cenarioEconomico', label: 'Economico', selected: 'economico', tone: 'text-primary' },
    { key: 'cenarioRecomendado', label: 'Recomendado', selected: 'recomendado', tone: 'text-secondary-700' },
    { key: 'cenarioPremium', label: 'Premium', selected: 'premium', tone: 'text-violet-700' },
];

function parseCenario(json: string): CenarioSummary | null {
    if (!json) return null;
    try {
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed === 'object') return parsed as CenarioSummary;
        return null;
    } catch {
        return null;
    }
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

async function parseResponsePayload(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function extractErrorMessage(payload: Record<string, unknown>, fallback: string): string {
    const error = payload.error;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
        return String((error as { message?: unknown }).message);
    }
    return fallback;
}

function extractCreatedId(payload: Record<string, unknown>): string | null {
    const data = payload.data;
    if (data && typeof data === 'object' && typeof (data as { id?: unknown }).id === 'string') {
        return String((data as { id?: unknown }).id);
    }
    const orcamento = payload.orcamento;
    if (orcamento && typeof orcamento === 'object' && typeof (orcamento as { id?: unknown }).id === 'string') {
        return String((orcamento as { id?: unknown }).id);
    }
    return null;
}

function NovoOrcamentoContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const avaliacaoId = searchParams.get('avaliacaoId');

    const [pacientes, setPacientes] = useState<PacienteOption[]>([]);
    const [search, setSearch] = useState('');
    const [preview, setPreview] = useState<PreviewData | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [form, setForm] = useState({
        pacienteId: '',
        cenarioEconomico: '',
        cenarioRecomendado: '',
        cenarioPremium: '',
        cenarioSelecionado: 'recomendado' as CenarioSelecionado,
        valorFinal: '',
        snapshotsByScenario: undefined as Record<CenarioSelecionado, ScenarioSnapshot> | undefined,
        unidadeId: '',
        configVersionId: '',
        moeda: 'BRL',
        planejamento360: {
            dataInicioCuidado: '',
            dataFimCuidado: '',
            diasAtendimento: ['seg', 'ter', 'qua', 'qui', 'sex'],
            periodicidade: 'SEMANAL' as Planejamento360['periodicidade'],
            semanasPlanejadas: 4,
            mesesPlanejados: 1,
            horasCuidadoDia: 12,
            tempoCuidadoDescricao: '',
            alocacaoResumo: '',
        },
    });

    useEffect(() => {
        async function loadPacientes() {
            const response = await fetch('/api/admin/pacientes');
            if (!response.ok) return;
            const payload = await response.json().catch(() => ({}));
            setPacientes(payload.pacientes || payload.data || []);
        }
        loadPacientes();
    }, []);

    useEffect(() => {
        if (!avaliacaoId) return;

        setLoadingPreview(true);
        setError(null);

        fetch(`/api/admin/avaliacoes/${avaliacaoId}/orcamento-preview`, { cache: 'no-store' })
            .then(async (response) => ({ response, payload: await parseResponsePayload(response) }))
            .then(({ response, payload }) => {
                if (!response.ok || !payload?.success) {
                    throw new Error(extractErrorMessage(payload, 'Erro ao carregar preview'));
                }

                const data = payload.data as PreviewData;
                setPreview(data);
                setForm((prev) => ({
                    ...prev,
                    pacienteId: data.pacienteId,
                    cenarioEconomico: data.cenarioEconomico,
                    cenarioRecomendado: data.cenarioRecomendado,
                    cenarioPremium: data.cenarioPremium,
                    cenarioSelecionado: 'recomendado',
                    valorFinal: String(data.valorFinal ?? ''),
                    snapshotsByScenario: data.snapshotsByScenario,
                    unidadeId: data.unidadeId || '',
                    configVersionId: data.configVersionId || '',
                    moeda: data.moeda || 'BRL',
                    planejamento360: {
                        ...prev.planejamento360,
                        horasCuidadoDia: data.metadados?.horasDiariasInferidas || prev.planejamento360.horasCuidadoDia,
                        tempoCuidadoDescricao: `Plano ${data.metadados?.complexidadeInferida || 'PADRAO'} - ${data.metadados?.tipoProfissionalInferido || 'CUIDADOR'}`,
                    },
                }));
                setError(null);
            })
            .catch((requestError) => {
                setError(requestError instanceof Error ? requestError.message : 'Erro ao calcular cenarios');
            })
            .finally(() => {
                setLoadingPreview(false);
            });
    }, [avaliacaoId]);

    const filteredPacientes = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return pacientes;
        return pacientes.filter((paciente) => (
            String(paciente.nome || '').toLowerCase().includes(query)
            || String(paciente.telefone || '').includes(query)
        ));
    }, [pacientes, search]);

    const setSelectedScenario = (selected: CenarioSelecionado, valueFromScenario?: number) => {
        setForm((prev) => ({
            ...prev,
            cenarioSelecionado: selected,
            valorFinal: valueFromScenario !== undefined ? String(valueFromScenario) : prev.valorFinal,
        }));
    };

    const onSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        if (!form.pacienteId) {
            setError('Selecione um paciente.');
            return;
        }

        setSubmitting(true);
        try {
            const response = await fetch('/api/admin/orcamentos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pacienteId: form.pacienteId,
                    cenarioEconomico: form.cenarioEconomico || null,
                    cenarioRecomendado: form.cenarioRecomendado || null,
                    cenarioPremium: form.cenarioPremium || null,
                    cenarioSelecionado: form.cenarioSelecionado,
                    valorFinal: form.valorFinal ? Number(form.valorFinal) : null,
                    avaliacaoId: avaliacaoId || undefined,
                    status: 'RASCUNHO',
                    snapshotsByScenario: form.snapshotsByScenario,
                    unidadeId: form.unidadeId || undefined,
                    configVersionId: form.configVersionId || undefined,
                    moeda: form.moeda || 'BRL',
                    snapshotInput: JSON.stringify({
                        source: avaliacaoId ? 'avaliacao_preview' : 'manual',
                        planejamento360: form.planejamento360,
                    }),
                }),
            });

            const payload = await parseResponsePayload(response);
            if (!response.ok || payload?.success === false) {
                setError(extractErrorMessage(payload, 'Falha ao criar orcamento.'));
                return;
            }

            const createdId = extractCreatedId(payload);
            if (createdId) {
                router.push(`/admin/orcamentos/${createdId}`);
                return;
            }

            router.push('/admin/orcamentos');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-6 lg:p-8">
            <PageHeader
                title="Novo Orcamento"
                description={preview
                    ? `Cenarios calculados automaticamente da avaliacao de ${preview.pacienteNome}.`
                    : 'Crie um orcamento e salve os cenarios para envio posterior.'}
                breadcrumbs={[
                    { label: 'Dashboard', href: '/admin/dashboard' },
                    { label: 'Orcamentos', href: '/admin/orcamentos' },
                    { label: 'Novo' },
                ]}
            />

            <Card>
                {preview ? (
                    <div className="mb-5 rounded-md border border-emerald-200 bg-secondary-400/10 px-4 py-3">
                        <p className="text-sm font-semibold text-secondary-700">
                            Dados calculados da avaliacao - {preview.pacienteNome}
                        </p>
                        <p className="mt-1 text-xs text-secondary-700">
                            Complexidade: <strong>{preview.metadados.complexidadeInferida}</strong>
                            {' | '}
                            Profissional: <strong>{preview.metadados.tipoProfissionalInferido}</strong>
                            {' | '}
                            Horas/dia: <strong>{preview.metadados.horasDiariasInferidas}</strong>
                            {typeof preview.metadados.quantidadePacientesInferida === 'number' ? (
                                <>
                                    {' | '}
                                    Pacientes: <strong>{preview.metadados.quantidadePacientesInferida}</strong>
                                </>
                            ) : null}
                        </p>
                        {preview.metadados.doencasInferidas?.length ? (
                            <p className="mt-1 text-xs text-secondary-700">
                                Doencas inferidas: <strong>{preview.metadados.doencasInferidas.join(', ')}</strong>
                            </p>
                        ) : null}
                        {preview.metadados.avisos?.length ? (
                            <ul className="mt-2 space-y-1 text-xs text-warning-600">
                                {preview.metadados.avisos.map((aviso, index) => (
                                    <li key={`${aviso}-${index}`}>- {aviso}</li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                ) : null}

                {loadingPreview ? (
                    <div className="mb-4 rounded-md border border-primary-200 bg-info-50 px-3 py-2 text-sm text-primary">
                        Calculando cenarios a partir da avaliacao...
                    </div>
                ) : null}

                {error ? (
                    <div className="mb-4 rounded-md border border-error-100 bg-error-50 px-3 py-2 text-sm text-error-700">
                        {error}
                    </div>
                ) : null}

                <form className="space-y-5" onSubmit={onSubmit}>
                    {!preview ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            <div>
                                <Input
                                    label="Buscar paciente"
                                    placeholder="Nome ou telefone"
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-foreground">Paciente</label>
                                <select
                                    value={form.pacienteId}
                                    onChange={(event) => setForm((prev) => ({ ...prev, pacienteId: event.target.value }))}
                                    className="w-full rounded-lg border border-border-hover px-3 py-2"
                                >
                                    <option value="">Selecione...</option>
                                    {filteredPacientes.map((paciente) => (
                                        <option key={paciente.id} value={paciente.id}>
                                            {(paciente.nome || 'Sem nome')} - {paciente.telefone}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground">
                            <p className="font-semibold text-foreground">{preview.pacienteNome}</p>
                            <p className="text-xs text-muted-foreground">Paciente ID: {preview.pacienteId}</p>
                        </div>
                    )}

                    <div>
                        <p className="mb-2 text-sm font-medium text-foreground">Cenarios de Orcamento</p>
                        <div className="grid gap-3 md:grid-cols-3">
                            {CENARIO_CONFIG.map((scenario) => {
                                const parsed = parseCenario(form[scenario.key]);
                                const selected = form.cenarioSelecionado === scenario.selected;
                                return (
                                    <button
                                        key={scenario.key}
                                        type="button"
                                        className={`rounded-lg border-2 p-3 text-left transition ${
                                            selected
                                                ? 'border-emerald-500 bg-secondary-400/10'
                                                : 'border-border bg-card hover:border-border-hover'
                                        }`}
                                        onClick={() => setSelectedScenario(scenario.selected, parsed?.totalSemanal)}
                                    >
                                        <p className={`text-xs font-semibold uppercase tracking-wide ${scenario.tone}`}>
                                            {scenario.label} {selected ? 'OK' : ''}
                                        </p>
                                        {parsed ? (
                                            <div className="mt-2">
                                                <p className={`text-lg font-semibold ${scenario.tone}`}>
                                                    {formatCurrency(parsed.totalSemanal || 0)}
                                                    <span className="ml-1 text-xs font-normal text-muted-foreground">/sem</span>
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatCurrency(parsed.estimativaMensal || 0)}/mes
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {parsed.plantoes?.length || 0} plantoes
                                                </p>
                                            </div>
                                        ) : (
                                            <textarea
                                                className="mt-2 h-20 w-full resize-none rounded border border-border p-2 text-xs"
                                                value={form[scenario.key]}
                                                placeholder="JSON do cenario"
                                                onClick={(event) => event.stopPropagation()}
                                                onChange={(event) => setForm((prev) => ({ ...prev, [scenario.key]: event.target.value }))}
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {form.snapshotsByScenario?.[form.cenarioSelecionado] && (() => {
                            const snapshot = form.snapshotsByScenario[form.cenarioSelecionado];
                            const output = snapshot?.output as { breakdown?: PricingBreakdownItem[] } | undefined;
                            const breakdown = output?.breakdown;
                            if (!breakdown?.length) return null;
                            return (
                                <div className="mt-3">
                                    <BreakdownTable
                                        lines={breakdown}
                                        title={`Detalhamento — ${form.cenarioSelecionado.charAt(0).toUpperCase() + form.cenarioSelecionado.slice(1)}`}
                                    />
                                </div>
                            );
                        })()}
                    </div>

                    <div>
                        <Input
                            label="Valor Final (R$/semana)"
                            type="number"
                            step="0.01"
                            placeholder="Ex: 3909.67"
                            value={form.valorFinal}
                            onChange={(event) => setForm((prev) => ({ ...prev, valorFinal: event.target.value }))}
                        />
                        {form.valorFinal ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                                Estimativa mensal: {formatCurrency((Number(form.valorFinal) || 0) * 4.33)}
                            </p>
                        ) : null}
                    </div>

                    <div className="rounded-lg border border-border bg-background p-4">
                        <p className="mb-3 text-sm font-semibold text-foreground">Planejamento 360 (pre-proposta)</p>
                        <div className="grid gap-3 md:grid-cols-3">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-foreground">Inicio do cuidado</label>
                                <input
                                    type="date"
                                    value={form.planejamento360.dataInicioCuidado || ''}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        planejamento360: {
                                            ...prev.planejamento360,
                                            dataInicioCuidado: event.target.value,
                                        },
                                    }))}
                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-foreground">Fim do cuidado</label>
                                <input
                                    type="date"
                                    value={form.planejamento360.dataFimCuidado || ''}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        planejamento360: {
                                            ...prev.planejamento360,
                                            dataFimCuidado: event.target.value,
                                        },
                                    }))}
                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-foreground">Horas de cuidado/dia</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={24}
                                    value={form.planejamento360.horasCuidadoDia || 12}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        planejamento360: {
                                            ...prev.planejamento360,
                                            horasCuidadoDia: Number(event.target.value) || 12,
                                        },
                                    }))}
                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-foreground">Periodicidade</label>
                                <select
                                    value={form.planejamento360.periodicidade || 'SEMANAL'}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        planejamento360: {
                                            ...prev.planejamento360,
                                            periodicidade: event.target.value as Planejamento360['periodicidade'],
                                        },
                                    }))}
                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                >
                                    <option value="DIARIO">Diario</option>
                                    <option value="SEMANAL">Semanal</option>
                                    <option value="QUINZENAL">Quinzenal</option>
                                    <option value="MENSAL">Mensal</option>
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-foreground">Semanas planejadas</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={form.planejamento360.semanasPlanejadas || 4}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        planejamento360: {
                                            ...prev.planejamento360,
                                            semanasPlanejadas: Number(event.target.value) || 4,
                                        },
                                    }))}
                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-foreground">Meses planejados</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={form.planejamento360.mesesPlanejados || 1}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        planejamento360: {
                                            ...prev.planejamento360,
                                            mesesPlanejados: Number(event.target.value) || 1,
                                        },
                                    }))}
                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-foreground">Dias de atendimento (csv)</label>
                                <input
                                    value={(form.planejamento360.diasAtendimento || []).join(',')}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        planejamento360: {
                                            ...prev.planejamento360,
                                            diasAtendimento: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                                        },
                                    }))}
                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                    placeholder="seg,ter,qua,qui,sex"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-foreground">Tempo de cuidado</label>
                                <input
                                    value={form.planejamento360.tempoCuidadoDescricao || ''}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        planejamento360: {
                                            ...prev.planejamento360,
                                            tempoCuidadoDescricao: event.target.value,
                                        },
                                    }))}
                                    className="w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                    placeholder="Ex.: 12h/dia por 3 meses"
                                />
                            </div>
                        </div>

                        <div className="mt-3">
                            <label className="mb-1 block text-xs font-medium text-foreground">Resumo de alocacao/escala</label>
                            <textarea
                                value={form.planejamento360.alocacaoResumo || ''}
                                onChange={(event) => setForm((prev) => ({
                                    ...prev,
                                    planejamento360: {
                                        ...prev.planejamento360,
                                        alocacaoResumo: event.target.value,
                                    },
                                }))}
                                className="h-20 w-full rounded-lg border border-border-hover px-3 py-2 text-sm"
                                placeholder="Ex.: 2 cuidadoras fixas + 1 folguista, troca semanal..."
                            />
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button type="submit" isLoading={submitting} disabled={loadingPreview}>
                            Criar Orcamento
                        </Button>
                        <Button type="button" variant="outline" onClick={() => router.back()}>
                            Cancelar
                        </Button>
                    </div>
                </form>
            </Card>
        </div>
    );
}

export default function NovoOrcamentoPage() {
    return (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando...</div>}>
            <NovoOrcamentoContent />
        </Suspense>
    );
}
