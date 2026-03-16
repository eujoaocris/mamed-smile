'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    DollarSign,
    Save,
    Loader2,
    Check,
    AlertTriangle,
    Clock,
    CreditCard,
    Percent,
    Activity,
    Shield,
    Tag,
    Plus,
    Trash2,
    ChevronDown,
    ChevronRight,
    Building2,
    RefreshCw,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface HourRule { id?: string; hora: number; fatorPercent: number; ativa: boolean }
interface PaymentFee { id?: string; metodo: string; periodo: string; taxaPercent: number; ativa: boolean }
interface MiniCost { id?: string; tipo: string; nome: string; valor: number; escalaHoras: boolean; cobrancaUnica: boolean; ativoPadrao: boolean; opcionalNoFechamento: boolean }
interface CommissionPercent { id?: string; tipo: string; nome: string; percentual: number; ativo: boolean }
interface Disease { id?: string; codigo: string; nome: string; complexidade: string; profissionalMinimo: string; adicionalPercent: number; ativa: boolean }
interface Discount { id?: string; nome: string; etiqueta?: string; percentual: number; ativo: boolean }
interface ServicoAvulso { id?: string; codigo: string; nome: string; descricao?: string; valorCuidador: number; valorAuxiliarEnf: number; valorTecnicoEnf: number; valorEnfermeiro: number; aplicarMargem: boolean; aplicarMinicustos: boolean; aplicarImpostos: boolean; ativo: boolean }

interface Unidade { id: string; codigo: string; nome: string; cidade?: string; estado?: string; ativa: boolean }

interface PricingConfig {
    unidadeId: string;
    configVersionId: string;
    configVersion: number;
    base12h: { CUIDADOR: number; TECNICO_ENF: number; ENFERMEIRO: number };
    adicionais: {
        segundoPaciente: number; noturno: number; fimSemana: number; feriado: number;
        altoRisco: number; at: number; aa: number; atEscalaHoras: boolean; aaEscalaHoras: boolean;
    };
    margem: { margemPercent: number; lucroFixo: number; lucroFixoEscalaHoras: boolean };
    impostoSobreComissaoPercent: number;
    aplicarTaxaAntesDesconto: boolean;
    hourRules: HourRule[];
    paymentFees: PaymentFee[];
    miniCosts: MiniCost[];
    commissionPercents: CommissionPercent[];
    diseases: Disease[];
    discounts: Discount[];
    servicosAvulsos: ServicoAvulso[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function SectionHeader({ icon: Icon, title, subtitle, open, onToggle }: {
    icon: any; title: string; subtitle: string; open: boolean; onToggle: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className="w-full flex items-center gap-3 p-4 rounded-xl bg-card border border-border hover:border-primary/30 transition-all group"
        >
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 text-left">
                <h3 className="font-semibold text-foreground">{title}</h3>
                <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
            {open ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
        </button>
    );
}

function InputField({ label, value, onChange, type = 'number', prefix, suffix, min, step, disabled }: {
    label: string; value: number | string; onChange: (v: any) => void; type?: string;
    prefix?: string; suffix?: string; min?: number; step?: string; disabled?: boolean;
}) {
    return (
        <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">{label}</label>
            <div className="relative flex items-center">
                {prefix && (
                    <span className="absolute left-3 text-xs text-muted-foreground pointer-events-none">
                        {prefix}
                    </span>
                )}
                <input
                    type={type}
                    value={value}
                    onChange={(e) => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                    min={min}
                    step={step || '0.01'}
                    disabled={disabled}
                    className={`w-full h-9 rounded-lg border border-border bg-input ${prefix ? 'pl-8' : 'px-3'} ${suffix ? 'pr-8' : ''} text-sm text-foreground outline-none focus:ring-2 focus:ring-ring focus:border-primary transition-all disabled:opacity-50`}
                />
                {suffix && (
                    <span className="absolute right-3 text-xs text-muted-foreground pointer-events-none">
                        {suffix}
                    </span>
                )}
            </div>
        </div>
    );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-center gap-2 cursor-pointer">
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-border'}`}
            >
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : ''}`} />
            </button>
            <span className="text-xs text-muted-foreground">{label}</span>
        </label>
    );
}

/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

export default function PrecificacaoConfigPage() {
    const [unidades, setUnidades] = useState<Unidade[]>([]);
    const [selectedUnidadeId, setSelectedUnidadeId] = useState<string>('');
    const [config, setConfig] = useState<PricingConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [dirty, setDirty] = useState(false);

    // Sections open/close
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        base: true, adicionais: false, margem: false, horas: false,
        pagamento: false, minicustos: false, comissao: false, doencas: false, descontos: false, servicos: false,
    });
    const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

    // Load unidades
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/admin/pricing-config');
                const data = await res.json();
                if (data.unidades?.length) {
                    setUnidades(data.unidades);
                    setSelectedUnidadeId(data.unidades[0].id);
                }
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    // Load config for selected unit
    const loadConfig = useCallback(async (uid: string) => {
        if (!uid) return;
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/admin/pricing-config?unidadeId=${uid}`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Erro ao carregar');
            setConfig(data);
            setDirty(false);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (selectedUnidadeId) loadConfig(selectedUnidadeId);
    }, [selectedUnidadeId, loadConfig]);

    // Updaters
    const updateBase12h = (key: string, val: number) => {
        if (!config) return;
        setConfig({ ...config, base12h: { ...config.base12h, [key]: val } });
        setDirty(true);
    };
    const updateAdicionais = (key: string, val: any) => {
        if (!config) return;
        setConfig({ ...config, adicionais: { ...config.adicionais, [key]: val } });
        setDirty(true);
    };
    const updateMargem = (key: string, val: any) => {
        if (!config) return;
        setConfig({ ...config, margem: { ...config.margem, [key]: val } });
        setDirty(true);
    };
    const updateHourRule = (idx: number, field: string, val: any) => {
        if (!config) return;
        const updated = [...config.hourRules];
        (updated[idx] as any)[field] = val;
        setConfig({ ...config, hourRules: updated });
        setDirty(true);
    };
    const updatePaymentFee = (idx: number, field: string, val: any) => {
        if (!config) return;
        const updated = [...config.paymentFees];
        (updated[idx] as any)[field] = val;
        setConfig({ ...config, paymentFees: updated });
        setDirty(true);
    };
    const addPaymentFee = () => {
        if (!config) return;
        setConfig({ ...config, paymentFees: [...config.paymentFees, { metodo: 'PIX', periodo: 'MENSAL', taxaPercent: 0, ativa: true }] });
        setDirty(true);
    };
    const removePaymentFee = (idx: number) => {
        if (!config) return;
        setConfig({ ...config, paymentFees: config.paymentFees.filter((_, i) => i !== idx) });
        setDirty(true);
    };
    const updateMiniCost = (idx: number, field: string, val: any) => {
        if (!config) return;
        const updated = [...config.miniCosts];
        (updated[idx] as any)[field] = val;
        setConfig({ ...config, miniCosts: updated });
        setDirty(true);
    };
    const addMiniCost = () => {
        if (!config) return;
        setConfig({
            ...config, miniCosts: [...config.miniCosts, {
                tipo: `NOVO_${Date.now()}`, nome: 'Novo minicusto', valor: 0,
                escalaHoras: false, cobrancaUnica: false, ativoPadrao: true, opcionalNoFechamento: true,
            }],
        });
        setDirty(true);
    };
    const updateCommission = (idx: number, field: string, val: any) => {
        if (!config) return;
        const updated = [...config.commissionPercents];
        (updated[idx] as any)[field] = val;
        setConfig({ ...config, commissionPercents: updated });
        setDirty(true);
    };
    const addCommission = () => {
        if (!config) return;
        setConfig({
            ...config, commissionPercents: [...config.commissionPercents, {
                tipo: `NOVO_${Date.now()}`, nome: 'Novo percentual', percentual: 0, ativo: true,
            }],
        });
        setDirty(true);
    };
    const updateDisease = (idx: number, field: string, val: any) => {
        if (!config) return;
        const updated = [...config.diseases];
        (updated[idx] as any)[field] = val;
        setConfig({ ...config, diseases: updated });
        setDirty(true);
    };
    const addDisease = () => {
        if (!config) return;
        setConfig({
            ...config, diseases: [...config.diseases, {
                codigo: '', nome: '', complexidade: 'BAIXA', profissionalMinimo: 'CUIDADOR', adicionalPercent: 0, ativa: true,
            }],
        });
        setDirty(true);
    };
    const updateDiscount = (idx: number, field: string, val: any) => {
        if (!config) return;
        const updated = [...config.discounts];
        (updated[idx] as any)[field] = val;
        setConfig({ ...config, discounts: updated });
        setDirty(true);
    };
    const addDiscount = () => {
        if (!config) return;
        setConfig({
            ...config, discounts: [...config.discounts, {
                nome: `DESC_${Date.now()}`, etiqueta: 'Novo desconto', percentual: 0, ativo: true,
            }],
        });
        setDirty(true);
    };
    const updateServicoAvulso = (idx: number, field: string, val: any) => {
        if (!config) return;
        const updated = [...config.servicosAvulsos];
        (updated[idx] as any)[field] = val;
        setConfig({ ...config, servicosAvulsos: updated });
        setDirty(true);
    };
    const addServicoAvulso = () => {
        if (!config) return;
        setConfig({
            ...config, servicosAvulsos: [...config.servicosAvulsos, {
                codigo: `SVC_${Date.now()}`, nome: 'Novo serviço', valorCuidador: 0, valorAuxiliarEnf: 0, /* kept for DB compat */
                valorTecnicoEnf: 0, valorEnfermeiro: 0, aplicarMargem: true, aplicarMinicustos: false, aplicarImpostos: true, ativo: true,
            }],
        });
        setDirty(true);
    };

    // Save
    const handleSave = async () => {
        if (!config) return;
        setSaving(true);
        setSaved(false);
        setError('');
        try {
            const res = await fetch('/api/admin/pricing-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Erro ao salvar');
            setSaved(true);
            setDirty(false);
            setTimeout(() => setSaved(false), 3000);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    /* ----- Render ----- */

    if (loading && !config) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto pb-32">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <DollarSign className="h-6 w-6 text-primary" />
                        Configuração de Precificação
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Gerencie todos os valores, adicionais, taxas e regras por unidade
                    </p>
                </div>

                {/* Unit selector */}
                <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <select
                        value={selectedUnidadeId}
                        onChange={(e) => setSelectedUnidadeId(e.target.value)}
                        className="h-9 rounded-lg border border-border bg-input px-3 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring transition-all"
                    >
                        {unidades.map((u) => (
                            <option key={u.id} value={u.id}>{u.nome} ({u.codigo})</option>
                        ))}
                    </select>
                    <button onClick={() => loadConfig(selectedUnidadeId)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-surface-subtle transition-colors" title="Recarregar">
                        <RefreshCw className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Version badge */}
            {config && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-surface-subtle rounded-lg px-3 py-2 border border-border">
                    <Activity className="h-3.5 w-3.5" />
                    Versão ativa: <span className="font-mono font-bold text-foreground">v{config.configVersion}</span>
                    <span className="text-border mx-1">|</span>
                    ID: <span className="font-mono text-foreground">{config.configVersionId?.slice(0, 8)}...</span>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}

            {config && (
                <>
                    {/* ── SECTION: Base 12h ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={DollarSign}
                            title="Valores Base por Plantão de 12h"
                            subtitle="Valor pago ao profissional por um plantão completo de 12 horas"
                            open={openSections.base}
                            onToggle={() => toggleSection('base')}
                        />
                        {openSections.base && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50 space-y-4">
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <InputField label="Cuidador (12h)" value={config.base12h.CUIDADOR} onChange={(v) => updateBase12h('CUIDADOR', v)} suffix="R$" />
                                    <InputField label="Técnico Enf. (12h)" value={config.base12h.TECNICO_ENF} onChange={(v) => updateBase12h('TECNICO_ENF', v)} suffix="R$" />
                                    <InputField label="Enfermeiro (12h)" value={config.base12h.ENFERMEIRO} onChange={(v) => updateBase12h('ENFERMEIRO', v)} suffix="R$" />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    💡 Esses valores são multiplicados pelo fator de horas (seção abaixo) para calcular plantões menores ou maiores que 12h.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Adicionais ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={Percent}
                            title="Adicionais Percentuais"
                            subtitle="Percentuais aplicados sobre o valor base em situações especiais"
                            open={openSections.adicionais}
                            onToggle={() => toggleSection('adicionais')}
                        />
                        {openSections.adicionais && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50 space-y-4">
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                    <InputField label="2° Paciente (%)" value={config.adicionais.segundoPaciente} onChange={(v) => updateAdicionais('segundoPaciente', v)} suffix="%" />
                                    <InputField label="Noturno (%)" value={config.adicionais.noturno} onChange={(v) => updateAdicionais('noturno', v)} suffix="%" />
                                    <InputField label="Fim de Semana (%)" value={config.adicionais.fimSemana} onChange={(v) => updateAdicionais('fimSemana', v)} suffix="%" />
                                    <InputField label="Feriado (%)" value={config.adicionais.feriado} onChange={(v) => updateAdicionais('feriado', v)} suffix="%" />
                                    <InputField label="Alto Risco (%)" value={config.adicionais.altoRisco} onChange={(v) => updateAdicionais('altoRisco', v)} suffix="%" />
                                    <InputField label="AT - Acidente Trabalho (%)" value={config.adicionais.at} onChange={(v) => updateAdicionais('at', v)} suffix="%" />
                                    <InputField label="AA - Adicional Atividade (%)" value={config.adicionais.aa} onChange={(v) => updateAdicionais('aa', v)} suffix="%" />
                                </div>
                                <div className="flex flex-wrap gap-4 pt-2">
                                    <ToggleField label="AT escala com horas" checked={config.adicionais.atEscalaHoras} onChange={(v) => updateAdicionais('atEscalaHoras', v)} />
                                    <ToggleField label="AA escala com horas" checked={config.adicionais.aaEscalaHoras} onChange={(v) => updateAdicionais('aaEscalaHoras', v)} />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Margem & Lucro ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={Activity}
                            title="Margem e Lucro"
                            subtitle="Percentual de margem e lucro fixo da empresa sobre cada plantão"
                            open={openSections.margem}
                            onToggle={() => toggleSection('margem')}
                        />
                        {openSections.margem && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50 space-y-4">
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                    <InputField label="Margem (%)" value={config.margem.margemPercent} onChange={(v) => updateMargem('margemPercent', v)} suffix="%" />
                                    <InputField label="Lucro Fixo (R$)" value={config.margem.lucroFixo} onChange={(v) => updateMargem('lucroFixo', v)} suffix="R$" />
                                    <InputField label="ISS (Imposto sobre Serviço) (%)" value={config.impostoSobreComissaoPercent} onChange={(v) => { setConfig({ ...config, impostoSobreComissaoPercent: v }); setDirty(true); }} suffix="%" />
                                </div>
                                <div className="flex flex-wrap gap-4 pt-2">
                                    <ToggleField label="Lucro fixo escala com horas" checked={config.margem.lucroFixoEscalaHoras} onChange={(v) => updateMargem('lucroFixoEscalaHoras', v)} />
                                    <ToggleField label="Aplicar taxa antes do desconto" checked={config.aplicarTaxaAntesDesconto} onChange={(v) => { setConfig({ ...config, aplicarTaxaAntesDesconto: v }); setDirty(true); }} />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Hour Rules ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={Clock}
                            title="Fator por Hora"
                            subtitle="Fator multiplicador para calcular plantões de 1h a 12h — proporcional ao valor base"
                            open={openSections.horas}
                            onToggle={() => toggleSection('horas')}
                        />
                        {openSections.horas && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50">
                                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                                    {config.hourRules.map((rule, idx) => (
                                        <div key={rule.hora} className="space-y-1">
                                            <label className="block text-xs font-medium text-muted-foreground text-center">{rule.hora}h</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={Math.round(rule.fatorPercent * 100)}
                                                    onChange={(e) => updateHourRule(idx, 'fatorPercent', (parseFloat(e.target.value) || 0) / 100)}
                                                    step="1"
                                                    min="0"
                                                    max="200"
                                                    className="w-full h-9 rounded-lg border border-border bg-input px-2 pr-6 text-sm text-center text-foreground outline-none focus:ring-2 focus:ring-ring transition-all"
                                                />
                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-xs text-muted-foreground mt-3">
                                    💡 12h = 100% (valor cheio). 6h = 60% do valor. Os valores acima são percentuais sobre o plantão padrão de 12h.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Payment Fees ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={CreditCard}
                            title="Taxas de Pagamento"
                            subtitle="Taxa percentual cobrada do cliente por método e período de pagamento"
                            open={openSections.pagamento}
                            onToggle={() => toggleSection('pagamento')}
                        />
                        {openSections.pagamento && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50 space-y-3">
                                {config.paymentFees.map((fee, idx) => (
                                    <div key={idx} className="flex items-center gap-3 flex-wrap">
                                        <select
                                            value={fee.metodo}
                                            onChange={(e) => updatePaymentFee(idx, 'metodo', e.target.value)}
                                            className="h-9 rounded-lg border border-border bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                                        >
                                            <option value="PIX">PIX</option>
                                            <option value="BOLETO">Boleto</option>
                                            <option value="CARTAO_CREDITO">Cartão Crédito</option>
                                            <option value="LINK_PAGAMENTO">Link Pagamento</option>
                                        </select>
                                        <select
                                            value={fee.periodo}
                                            onChange={(e) => updatePaymentFee(idx, 'periodo', e.target.value)}
                                            className="h-9 rounded-lg border border-border bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                                        >
                                            <option value="DIARIO">Diário</option>
                                            <option value="SEMANAL">Semanal</option>
                                            <option value="QUINZENAL">Quinzenal</option>
                                            <option value="MENSAL">Mensal</option>
                                        </select>
                                        <InputField label="" value={fee.taxaPercent} onChange={(v) => updatePaymentFee(idx, 'taxaPercent', v)} suffix="%" />
                                        <ToggleField label="Ativa" checked={fee.ativa} onChange={(v) => updatePaymentFee(idx, 'ativa', v)} />
                                        <button onClick={() => removePaymentFee(idx)} className="h-8 w-8 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center transition-colors">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                                <button onClick={addPaymentFee} className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
                                    <Plus className="h-4 w-4" /> Adicionar taxa
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Mini Costs ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={Tag}
                            title="Minicustos"
                            subtitle="Custos operacionais extras adicionados ao valor do plantão (visita, reserva técnica, etc.)"
                            open={openSections.minicustos}
                            onToggle={() => toggleSection('minicustos')}
                        />
                        {openSections.minicustos && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50 space-y-3">
                                {config.miniCosts.map((mc, idx) => (
                                    <div key={idx} className="p-3 rounded-lg border border-border bg-background space-y-3">
                                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                            <InputField label="Tipo (código)" value={mc.tipo} onChange={(v) => updateMiniCost(idx, 'tipo', v)} type="text" />
                                            <InputField label="Nome" value={mc.nome} onChange={(v) => updateMiniCost(idx, 'nome', v)} type="text" />
                                            <InputField label="Valor (R$)" value={mc.valor} onChange={(v) => updateMiniCost(idx, 'valor', v)} suffix="R$" />
                                        </div>
                                        <div className="flex flex-wrap gap-4">
                                            <ToggleField label="Escala com horas" checked={mc.escalaHoras} onChange={(v) => updateMiniCost(idx, 'escalaHoras', v)} />
                                            <ToggleField label="Cobrança única" checked={mc.cobrancaUnica} onChange={(v) => updateMiniCost(idx, 'cobrancaUnica', v)} />
                                            <ToggleField label="Ativo por padrão" checked={mc.ativoPadrao} onChange={(v) => updateMiniCost(idx, 'ativoPadrao', v)} />
                                            <ToggleField label="Opcional no fechamento" checked={mc.opcionalNoFechamento} onChange={(v) => updateMiniCost(idx, 'opcionalNoFechamento', v)} />
                                        </div>
                                    </div>
                                ))}
                                <button onClick={addMiniCost} className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
                                    <Plus className="h-4 w-4" /> Adicionar minicusto
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Commission ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={Percent}
                            title="Retenções da Matriz / Franquia"
                            subtitle="Fundos retidos do lucro bruto da unidade (Marketing, Royalties, Reinvestimento, etc.)"
                            open={openSections.comissao}
                            onToggle={() => toggleSection('comissao')}
                        />
                        {openSections.comissao && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50 space-y-3">
                                {config.commissionPercents.map((cp, idx) => (
                                    <div key={idx} className="flex items-center gap-3 flex-wrap">
                                        <InputField label="Tipo" value={cp.tipo} onChange={(v) => updateCommission(idx, 'tipo', v)} type="text" />
                                        <InputField label="Nome" value={cp.nome} onChange={(v) => updateCommission(idx, 'nome', v)} type="text" />
                                        <InputField label="Percentual" value={cp.percentual} onChange={(v) => updateCommission(idx, 'percentual', v)} suffix="%" />
                                        <ToggleField label="Ativo" checked={cp.ativo} onChange={(v) => updateCommission(idx, 'ativo', v)} />
                                    </div>
                                ))}
                                <button onClick={addCommission} className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
                                    <Plus className="h-4 w-4" /> Adicionar percentual
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Diseases ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={Shield}
                            title="Regras por Doença"
                            subtitle="Adicionais automáticos e profissional mínimo baseado no diagnóstico do paciente"
                            open={openSections.doencas}
                            onToggle={() => toggleSection('doencas')}
                        />
                        {openSections.doencas && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50 space-y-3">
                                {config.diseases.map((d, idx) => (
                                    <div key={idx} className="p-3 rounded-lg border border-border bg-background space-y-3">
                                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                                            <InputField label="Código" value={d.codigo} onChange={(v) => updateDisease(idx, 'codigo', v)} type="text" />
                                            <InputField label="Nome" value={d.nome} onChange={(v) => updateDisease(idx, 'nome', v)} type="text" />
                                            <div className="space-y-1.5">
                                                <label className="block text-xs font-medium text-muted-foreground">Complexidade</label>
                                                <select
                                                    value={d.complexidade}
                                                    onChange={(e) => updateDisease(idx, 'complexidade', e.target.value)}
                                                    className="w-full h-9 rounded-lg border border-border bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                                                >
                                                    <option value="BAIXA">Baixa</option>
                                                    <option value="MEDIA">Média</option>
                                                    <option value="ALTA">Alta</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="block text-xs font-medium text-muted-foreground">Profissional Mínimo</label>
                                                <select
                                                    value={d.profissionalMinimo}
                                                    onChange={(e) => updateDisease(idx, 'profissionalMinimo', e.target.value)}
                                                    className="w-full h-9 rounded-lg border border-border bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                                                >
                                                    <option value="CUIDADOR">Cuidador</option>
                                                    <option value="TECNICO_ENF">Técnico Enf.</option>
                                                    <option value="ENFERMEIRO">Enfermeiro</option>
                                                </select>
                                            </div>
                                            <InputField label="Adicional (%)" value={d.adicionalPercent} onChange={(v) => updateDisease(idx, 'adicionalPercent', v)} suffix="%" />
                                        </div>
                                        <ToggleField label="Ativa" checked={d.ativa} onChange={(v) => updateDisease(idx, 'ativa', v)} />
                                    </div>
                                ))}
                                <button onClick={addDisease} className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
                                    <Plus className="h-4 w-4" /> Adicionar doença
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Discounts ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={Tag}
                            title="Presets de Desconto"
                            subtitle="Descontos pré-definidos que podem ser aplicados no fechamento da proposta"
                            open={openSections.descontos}
                            onToggle={() => toggleSection('descontos')}
                        />
                        {openSections.descontos && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50 space-y-3">
                                {config.discounts.map((disc, idx) => (
                                    <div key={idx} className="flex items-center gap-3 flex-wrap">
                                        <InputField label="Nome (código)" value={disc.nome} onChange={(v) => updateDiscount(idx, 'nome', v)} type="text" />
                                        <InputField label="Etiqueta" value={disc.etiqueta || ''} onChange={(v) => updateDiscount(idx, 'etiqueta', v)} type="text" />
                                        <InputField label="Percentual" value={disc.percentual} onChange={(v) => updateDiscount(idx, 'percentual', v)} suffix="%" />
                                        <ToggleField label="Ativo" checked={disc.ativo} onChange={(v) => updateDiscount(idx, 'ativo', v)} />
                                    </div>
                                ))}
                                <button onClick={addDiscount} className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
                                    <Plus className="h-4 w-4" /> Adicionar desconto
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Serviços Avulsos ── */}
                    <div className="space-y-3">
                        <SectionHeader
                            icon={Activity}
                            title="Serviços Avulsos"
                            subtitle="Serviços com valor fixo (banho, acompanhamento, curativos etc.) — valores pagos ao profissional"
                            open={openSections.servicos}
                            onToggle={() => toggleSection('servicos')}
                        />
                        {openSections.servicos && (
                            <div className="ml-2 p-4 rounded-xl border border-border bg-card/50 space-y-4">
                                {config.servicosAvulsos?.map((svc, idx) => (
                                    <div key={idx} className="p-3 rounded-lg border border-border/50 bg-card space-y-3">
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <InputField label="Código" value={svc.codigo} onChange={(v) => updateServicoAvulso(idx, 'codigo', v)} type="text" />
                                            <InputField label="Nome" value={svc.nome} onChange={(v) => updateServicoAvulso(idx, 'nome', v)} type="text" />
                                            <ToggleField label="Ativo" checked={svc.ativo} onChange={(v) => updateServicoAvulso(idx, 'ativo', v)} />
                                        </div>
                                        <div className="text-xs font-medium text-muted-foreground mb-1">Valor pago ao profissional (R$)</div>
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <InputField label="Cuidador" value={svc.valorCuidador} onChange={(v) => updateServicoAvulso(idx, 'valorCuidador', v)} prefix="R$" />
                                            <InputField label="Técnico Enf." value={svc.valorTecnicoEnf} onChange={(v) => updateServicoAvulso(idx, 'valorTecnicoEnf', v)} prefix="R$" />
                                            <InputField label="Enfermeiro" value={svc.valorEnfermeiro} onChange={(v) => updateServicoAvulso(idx, 'valorEnfermeiro', v)} prefix="R$" />
                                        </div>
                                        <div className="flex items-center gap-4 flex-wrap">
                                            <ToggleField label="Aplicar margem" checked={svc.aplicarMargem} onChange={(v) => updateServicoAvulso(idx, 'aplicarMargem', v)} />
                                            <ToggleField label="Aplicar minicustos" checked={svc.aplicarMinicustos} onChange={(v) => updateServicoAvulso(idx, 'aplicarMinicustos', v)} />
                                            <ToggleField label="Aplicar impostos" checked={svc.aplicarImpostos} onChange={(v) => updateServicoAvulso(idx, 'aplicarImpostos', v)} />
                                        </div>
                                    </div>
                                ))}
                                <button onClick={addServicoAvulso} className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
                                    <Plus className="h-4 w-4" /> Adicionar serviço
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ── Sticky Save Bar ── */}
            {config && (
                <div className="fixed bottom-0 left-0 right-0 lg:left-72 z-20">
                    <div className="max-w-5xl mx-auto px-4 lg:px-8 py-3">
                        <div className={`flex items-center justify-between rounded-xl border px-4 py-3 shadow-lg backdrop-blur transition-all ${dirty ? 'bg-amber-50/95 dark:bg-amber-950/95 border-amber-200 dark:border-amber-800' : 'bg-card/95 border-border'}`}>
                            <div className="flex items-center gap-2 text-sm">
                                {dirty ? (
                                    <>
                                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                                        <span className="text-amber-700 dark:text-amber-300 font-medium">Alterações não salvas</span>
                                    </>
                                ) : saved ? (
                                    <>
                                        <Check className="h-4 w-4 text-green-500" />
                                        <span className="text-green-700 dark:text-green-300 font-medium">Salvo com sucesso!</span>
                                    </>
                                ) : (
                                    <span className="text-muted-foreground">Nenhuma alteração</span>
                                )}
                            </div>
                            <button
                                onClick={handleSave}
                                disabled={!dirty || saving}
                                className="flex items-center gap-2 h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                {saving ? 'Salvando...' : 'Salvar Configuração'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
