'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Calculator,
    Loader2,
    AlertTriangle,
    User,
    Clock,
    CreditCard,
    Shield,
    Tag,
    Percent,
    ChevronDown,
    ChevronUp,
    Users,
    Moon,
    CalendarDays,
    Star,
    Zap,
    Building2,
    RefreshCw,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types (mirror from pricing-config API + enterprise-engine)          */
/* ------------------------------------------------------------------ */

type Professional = 'CUIDADOR' | 'AUXILIAR_ENF' | 'TECNICO_ENF' | 'ENFERMEIRO';

interface HourRule { hora: number; fatorPercent: number; ativa: boolean }
interface PaymentFee { metodo: string; periodo: string; taxaPercent: number; ativa: boolean }
interface MiniCost { tipo: string; nome: string; valor: number; escalaHoras: boolean; ativoPadrao: boolean }
interface CommissionPercent { tipo: string; nome: string; percentual: number; ativo: boolean }
interface Disease { codigo: string; nome: string; complexidade: string; profissionalMinimo: string; adicionalPercent: number; ativa: boolean }
interface Discount { nome: string; etiqueta?: string; percentual: number; ativo: boolean }
interface ServicoAvulso { id?: string; codigo: string; nome: string; descricao?: string; valorCuidador: number; valorAuxiliarEnf: number; valorTecnicoEnf: number; valorEnfermeiro: number; aplicarMargem: boolean; aplicarMinicustos: boolean; aplicarImpostos: boolean; ativo: boolean }

interface PricingConfig {
    unidadeId: string;
    configVersionId: string;
    configVersion: number;
    base12h: Record<Professional, number>;
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

interface Unidade { id: string; codigo: string; nome: string }

/* ------------------------------------------------------------------ */
/* Calculation Engine (client-side mirror of enterprise-engine.ts)     */
/* ------------------------------------------------------------------ */

const PROF_RANK: Record<Professional, number> = { CUIDADOR: 1, AUXILIAR_ENF: 2, TECNICO_ENF: 3, ENFERMEIRO: 4 };
const PROF_LABELS: Record<Professional, string> = { CUIDADOR: 'Cuidador', AUXILIAR_ENF: 'Auxiliar Enf.', TECNICO_ENF: 'Técnico Enf.', ENFERMEIRO: 'Enfermeiro' };

function round2(v: number): number { return Math.round((v + Number.EPSILON) * 100) / 100; }

function getHourFactor(hours: number, rules: HourRule[]): number {
    const map = new Map<number, number>();
    for (const r of rules) if (r.hora >= 1 && r.hora <= 12) map.set(r.hora, r.fatorPercent);
    const fallback = (h: number) => round2(Math.max(0.01, h / 12));
    const segFactor = (h: number) => map.get(h) ?? fallback(h);
    let rem = Math.round(hours);
    let total = 0;
    while (rem > 0) { const seg = Math.min(12, rem); total += segFactor(seg); rem -= seg; }
    return round2(total);
}

interface SimInput {
    profissional: Professional;
    horas: number;
    qtdPacientes: number;
    metodoPagamento: string;
    periodoPagamento: string;
    diseaseCodes: Set<string>;
    descontoPresetPercent: number;
    descontoManualPercent: number;
    minicustosOverrides: Record<string, boolean>;
    flags: { noturno: boolean; fimSemana: boolean; feriado: boolean; altoRisco: boolean; at: boolean; aa: boolean };
    tipoSimulacao?: 'PLANTAO' | 'SERVICO';
    servicoAvulsoId?: string;
}

interface BreakdownLine { label: string; value: number; meta?: string; type: 'add' | 'sub' | 'total' | 'info' | 'section' }

interface SimResult {
    lines: BreakdownLine[];
    totalFinal: number;
    profEfetivo: Professional;
    // Summary values for quick cards
    pagoProfissional: number;
    lucroLiquido: number;
    custosOperacionais: number;
}

function simulate(cfg: PricingConfig, inp: SimInput): SimResult {
    let factorHours = 1;
    let baseProfissional = 0;
    let base12h = 0;
    let profEfetivo = inp.profissional;
    let isServico = inp.tipoSimulacao === 'SERVICO' && !!inp.servicoAvulsoId;
    let servico: ServicoAvulso | undefined;
    let servicoNome = '';

    if (isServico) {
        servico = cfg.servicosAvulsos?.find(s => s.id === inp.servicoAvulsoId || s.codigo === inp.servicoAvulsoId);
        if (servico) {
            servicoNome = servico.nome;
            // Get value based on professional type
            if (profEfetivo === 'CUIDADOR') baseProfissional = servico.valorCuidador;
            else if (profEfetivo === 'AUXILIAR_ENF') baseProfissional = servico.valorAuxiliarEnf;
            else if (profEfetivo === 'TECNICO_ENF') baseProfissional = servico.valorTecnicoEnf;
            else if (profEfetivo === 'ENFERMEIRO') baseProfissional = servico.valorEnfermeiro;
        } else {
            isServico = false;
        }
    }

    if (!isServico) {
        factorHours = getHourFactor(inp.horas, cfg.hourRules);

        // Disease → upgrades professional
        const selectedDiseases = cfg.diseases.filter(d => d.ativa && inp.diseaseCodes.has(d.codigo));
        for (const d of selectedDiseases) {
            const p = d.profissionalMinimo as Professional;
            if (PROF_RANK[p] > PROF_RANK[profEfetivo]) profEfetivo = p;
        }

        base12h = round2(cfg.base12h[profEfetivo]);
        baseProfissional = round2(base12h * factorHours);
    }

    // Adicionais
    const secondPat = (!isServico && inp.qtdPacientes > 1) ? cfg.adicionais.segundoPaciente : 0;
    const selectedDiseases = isServico ? [] : cfg.diseases.filter(d => d.ativa && inp.diseaseCodes.has(d.codigo));
    const diseasePercTotal = round2(selectedDiseases.reduce((a, d) => a + Math.max(0, d.adicionalPercent), 0));
    const notPercent = (!isServico && inp.flags.noturno) ? cfg.adicionais.noturno : 0;
    const fdsPercent = inp.flags.fimSemana ? cfg.adicionais.fimSemana : 0;
    const ferPercent = inp.flags.feriado ? cfg.adicionais.feriado : 0;
    const arPercent = (!isServico && inp.flags.altoRisco) ? cfg.adicionais.altoRisco : 0;
    const atRaw = (!isServico && inp.flags.at) ? cfg.adicionais.at : 0;
    const aaRaw = (!isServico && inp.flags.aa) ? cfg.adicionais.aa : 0;
    const atApplied = cfg.adicionais.atEscalaHoras ? atRaw * factorHours : atRaw;
    const aaApplied = cfg.adicionais.aaEscalaHoras ? aaRaw * factorHours : aaRaw;

    const adicPercTotal = round2(secondPat + diseasePercTotal + notPercent + fdsPercent + ferPercent + arPercent + atApplied + aaApplied);
    const adicVal = round2(baseProfissional * (adicPercTotal / 100));
    const profTotal = round2(baseProfissional + adicVal);

    // Margem & lucro
    let lucroMargem = 0;
    let lucroFixo = 0;
    let comissaoBruta = 0;

    if (!isServico || (isServico && servico?.aplicarMargem)) {
        lucroMargem = round2(profTotal * (Math.max(0, cfg.margem.margemPercent) / 100));
        lucroFixo = round2(cfg.margem.lucroFixoEscalaHoras ? cfg.margem.lucroFixo * factorHours : cfg.margem.lucroFixo);
        comissaoBruta = round2(lucroMargem + lucroFixo);
    }

    // Comissão gastos
    const commPercTotal = (!isServico || (isServico && servico?.aplicarImpostos)) ? round2(cfg.commissionPercents.filter(c => c.ativo).reduce((a, c) => a + Math.max(0, c.percentual), 0)) : 0;
    const gastosComissao = round2(comissaoBruta * (commPercTotal / 100));
    const impostoPerc = (!isServico || (isServico && servico?.aplicarImpostos)) ? Math.max(0, cfg.impostoSobreComissaoPercent) : 0;
    const impostoVal = round2(comissaoBruta * (impostoPerc / 100));

    // Minicustos
    const miniAtivos: { nome: string; val: number }[] = [];
    if (!isServico || (isServico && servico?.aplicarMinicustos)) {
        for (const mc of cfg.miniCosts) {
            const active = inp.minicustosOverrides[mc.tipo] ?? mc.ativoPadrao;
            if (!active) continue;
            const v = round2(mc.escalaHoras ? mc.valor * factorHours : mc.valor);
            miniAtivos.push({ nome: mc.nome, val: v });
        }
    }
    const miniTotal = round2(miniAtivos.reduce((a, m) => a + m.val, 0));

    const subtotal = round2(profTotal + comissaoBruta + gastosComissao + impostoVal + miniTotal);

    // Taxa & desconto
    const fee = cfg.paymentFees.find(f => f.ativa && f.metodo === inp.metodoPagamento && f.periodo === inp.periodoPagamento);
    const feePerc = fee ? Math.max(0, fee.taxaPercent) : 0;
    const discPerc = Math.min(100, Math.max(0, (inp.descontoPresetPercent || 0) + (inp.descontoManualPercent || 0)));

    let taxaVal = 0, descVal = 0, totalFinal = subtotal;
    if (cfg.aplicarTaxaAntesDesconto) {
        taxaVal = round2(subtotal * (feePerc / 100));
        const baseComTaxa = round2(subtotal + taxaVal);
        descVal = round2(baseComTaxa * (discPerc / 100));
        totalFinal = round2(baseComTaxa - descVal);
    } else {
        descVal = round2(subtotal * (discPerc / 100));
        const baseComDesc = round2(subtotal - descVal);
        taxaVal = round2(baseComDesc * (feePerc / 100));
        totalFinal = round2(baseComDesc + taxaVal);
    }

    // Summary values
    const custosOperacionais = round2(gastosComissao + impostoVal + miniTotal);
    const lucroLiquido = round2(comissaoBruta - gastosComissao - impostoVal);

    // Build grouped breakdown
    const lines: BreakdownLine[] = [];

    // Section 1: Profissional
    lines.push({ label: '👷 PAGO AO PROFISSIONAL', value: 0, type: 'section' });
    if (isServico) {
        lines.push({ label: `Serviço Fixo: ${servicoNome} — ${PROF_LABELS[profEfetivo]}`, value: baseProfissional, type: 'info' });
    } else {
        lines.push({ label: `Base 12h — ${PROF_LABELS[profEfetivo]}`, value: base12h, type: 'info' });
        lines.push({ label: `Proporcional ${inp.horas}h (${Math.round(factorHours * 100)}%)`, value: baseProfissional, type: 'add' });
    }
    if (adicPercTotal > 0) lines.push({ label: `Adicionais`, value: adicVal, type: 'add', meta: `${adicPercTotal}%` });
    lines.push({ label: 'Total profissional', value: profTotal, type: 'info' });

    // Section 2: Lucro empresa
    lines.push({ label: '💰 LUCRO DA EMPRESA', value: 0, type: 'section' });
    if (lucroMargem > 0) lines.push({ label: `Margem`, value: lucroMargem, type: 'add', meta: `${cfg.margem.margemPercent}%` });
    if (lucroFixo > 0) lines.push({ label: `Lucro fixo`, value: lucroFixo, type: 'add' });
    lines.push({ label: 'Comissão bruta', value: comissaoBruta, type: 'info' });
    if (gastosComissao > 0) lines.push({ label: `Retenções da Matriz / Franquia`, value: -gastosComissao, type: 'sub', meta: `${commPercTotal}%` });
    if (impostoVal > 0) lines.push({ label: 'ISS (Imposto sobre Serviço)', value: -impostoVal, type: 'sub', meta: `${impostoPerc}%` });
    lines.push({ label: '✅ Lucro líquido', value: lucroLiquido, type: 'info' });

    // Section 3: Custos operacionais
    if (miniAtivos.length > 0) {
        lines.push({ label: '📦 CUSTOS OPERACIONAIS', value: 0, type: 'section' });
        for (const m of miniAtivos) lines.push({ label: m.nome, value: m.val, type: 'add' });
        lines.push({ label: 'Total minicustos', value: miniTotal, type: 'info' });
    }

    // Section 4: Taxas e descontos
    if (taxaVal > 0 || descVal > 0) {
        lines.push({ label: '💳 TAXAS E DESCONTOS', value: 0, type: 'section' });
        if (taxaVal > 0) lines.push({ label: `Taxa ${inp.metodoPagamento}`, value: taxaVal, type: 'add', meta: `${feePerc}%` });
        if (descVal > 0) lines.push({ label: `Desconto`, value: -descVal, type: 'sub', meta: `${discPerc}%` });
    }

    // Total final
    lines.push({ label: 'VALOR FINAL POR PLANTÃO', value: totalFinal, type: 'total' });

    return { lines, totalFinal, profEfetivo, pagoProfissional: profTotal, lucroLiquido, custosOperacionais };
}

/* ------------------------------------------------------------------ */
/* Currency formatter                                                  */
/* ------------------------------------------------------------------ */

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ------------------------------------------------------------------ */
/* Brazilian Holiday Detection                                         */
/* ------------------------------------------------------------------ */

function getEasterDate(year: number): Date {
    // Meeus/Jones/Butcher algorithm for Gregorian Easter
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function formatDateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getBrazilianHolidays(year: number): Map<string, string> {
    const holidays = new Map<string, string>();
    const easter = getEasterDate(year);

    // Fixed holidays
    holidays.set(`${year}-01-01`, 'Confraternização Universal');
    holidays.set(`${year}-04-21`, 'Tiradentes');
    holidays.set(`${year}-05-01`, 'Dia do Trabalho');
    holidays.set(`${year}-09-07`, 'Independência do Brasil');
    holidays.set(`${year}-10-12`, 'Nossa Senhora Aparecida');
    holidays.set(`${year}-11-02`, 'Finados');
    holidays.set(`${year}-11-15`, 'Proclamação da República');
    holidays.set(`${year}-12-25`, 'Natal');

    // Variable holidays (based on Easter)
    const carnaval = addDays(easter, -47);
    const sextaSanta = addDays(easter, -2);
    const corpusChristi = addDays(easter, 60);
    holidays.set(formatDateKey(carnaval), 'Carnaval');
    holidays.set(formatDateKey(addDays(carnaval, -1)), 'Carnaval (segunda)');
    holidays.set(formatDateKey(sextaSanta), 'Sexta-feira Santa');
    holidays.set(formatDateKey(corpusChristi), 'Corpus Christi');

    return holidays;
}

function isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
}

function getHolidayName(date: Date): string | null {
    const holidays = getBrazilianHolidays(date.getFullYear());
    return holidays.get(formatDateKey(date)) || null;
}

const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

export default function SimuladorPage() {
    const [unidades, setUnidades] = useState<Unidade[]>([]);
    const [selectedUnidadeId, setSelectedUnidadeId] = useState('');
    const [config, setConfig] = useState<PricingConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Simulation inputs
    const [tipoSimulacao, setTipoSimulacao] = useState<'PLANTAO' | 'SERVICO'>('PLANTAO');
    const [servicoAvulsoId, setServicoAvulsoId] = useState<string>('');
    const [profissional, setProfissional] = useState<Professional>('CUIDADOR');
    const [horas, setHoras] = useState(12);
    const [qtdPacientes, setQtdPacientes] = useState(1);
    const [metodo, setMetodo] = useState('PIX');
    const [periodo, setPeriodo] = useState('MENSAL');
    const [selectedDiseases, setSelectedDiseases] = useState<Set<string>>(new Set());
    const [descontoPreset, setDescontoPreset] = useState(0);
    const [descontoManual, setDescontoManual] = useState(0);
    const [minicustosOverrides, setMinicustosOverrides] = useState<Record<string, boolean>>({});
    const [flags, setFlags] = useState({ noturno: false, fimSemana: false, feriado: false, altoRisco: false, at: false, aa: false });
    const [showBreakdown, setShowBreakdown] = useState(false);
    const [showAggregatedBreakdown, setShowAggregatedBreakdown] = useState(true);
    const [simMode, setSimMode] = useState<'single' | 'range'>('single');
    // Single mode
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [detectedInfo, setDetectedInfo] = useState<{ isWeekend: boolean; holiday: string | null }>({ isWeekend: false, holiday: null });
    const [plantoesMes, setPlantoesMes] = useState(15);
    // Range mode
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');

    // Calendar auto-detect (single mode)
    const handleDateChange = useCallback((dateStr: string) => {
        setSelectedDate(dateStr);
        if (!dateStr) {
            setDetectedInfo({ isWeekend: false, holiday: null });
            return;
        }
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        const weekend = isWeekend(date);
        const holiday = getHolidayName(date);
        setDetectedInfo({ isWeekend: weekend, holiday });
        setFlags(prev => ({ ...prev, fimSemana: weekend, feriado: !!holiday }));
    }, []);

    // Load unidades
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/admin/pricing-config');
                const data = await res.json();
                if (data.unidades?.length) { setUnidades(data.unidades); setSelectedUnidadeId(data.unidades[0].id); }
            } catch (e: any) { setError(e.message); }
            finally { setLoading(false); }
        })();
    }, []);

    // Load config
    const loadConfig = useCallback(async (uid: string) => {
        if (!uid) return;
        setLoading(true); setError('');
        try {
            const res = await fetch(`/api/admin/pricing-config?unidadeId=${uid}`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setConfig(data);
            // Initialize minicusto overrides from ativoPadrao
            const overrides: Record<string, boolean> = {};
            for (const mc of data.miniCosts) overrides[mc.tipo] = mc.ativoPadrao;
            setMinicustosOverrides(overrides);
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { if (selectedUnidadeId) loadConfig(selectedUnidadeId); }, [selectedUnidadeId, loadConfig]);

    // Calculate
    const result = useMemo(() => {
        if (!config) return null;
        try {
            return simulate(config, {
                profissional, horas, qtdPacientes, metodoPagamento: metodo, periodoPagamento: periodo,
                diseaseCodes: selectedDiseases, descontoPresetPercent: descontoPreset,
                descontoManualPercent: descontoManual, minicustosOverrides, flags,
                tipoSimulacao, servicoAvulsoId
            });
        } catch { return null; }
    }, [config, profissional, horas, qtdPacientes, metodo, periodo, selectedDiseases, descontoPreset, descontoManual, minicustosOverrides, flags, tipoSimulacao, servicoAvulsoId]);

    const valorMensal = result ? round2(result.totalFinal * plantoesMes) : 0;

    // Range mode calculation: calculate each day in range
    interface RangeDayResult {
        date: Date;
        dateStr: string;
        dayName: string;
        isWeekend: boolean;
        holiday: string | null;
        valor: number;
        lucro: number;
        lines: BreakdownLine[];
    }
    const rangeResults = useMemo(() => {
        if (simMode !== 'range' || !dateFrom || !dateTo || !config) return [];
        const [fy, fm, fd] = dateFrom.split('-').map(Number);
        const [ty, tm, td] = dateTo.split('-').map(Number);
        const start = new Date(fy, fm - 1, fd);
        const end = new Date(ty, tm - 1, td);
        if (start > end) return [];
        const days: RangeDayResult[] = [];
        const current = new Date(start);
        while (current <= end) {
            const wknd = isWeekend(current);
            const hol = getHolidayName(current);
            const dayFlags = { ...flags, fimSemana: wknd, feriado: !!hol };
            const r = simulate(config, {
                profissional, horas, qtdPacientes, metodoPagamento: metodo, periodoPagamento: periodo,
                diseaseCodes: selectedDiseases, descontoPresetPercent: descontoPreset,
                descontoManualPercent: descontoManual, minicustosOverrides, flags: dayFlags,
                tipoSimulacao, servicoAvulsoId
            });
            days.push({
                date: new Date(current),
                dateStr: formatDateKey(current),
                dayName: WEEKDAY_NAMES[current.getDay()],
                isWeekend: wknd,
                holiday: hol,
                valor: r.totalFinal,
                lucro: r.lucroLiquido,
                lines: r.lines,
            });
            current.setDate(current.getDate() + 1);
        }
        return days;
    }, [simMode, dateFrom, dateTo, config, profissional, horas, qtdPacientes, metodo, periodo, selectedDiseases, descontoPreset, descontoManual, minicustosOverrides, flags, tipoSimulacao, servicoAvulsoId]);

    const aggregatedLines = useMemo(() => {
        if (simMode === 'single') {
            if (!result) return [];
            return result.lines.map(l => ({
                ...l,
                label: l.type === 'total' ? 'VALOR TOTAL FINAL' : l.label,
                value: l.value * plantoesMes
            }));
        } else {
            if (!rangeResults.length) return [];
            const resultList: BreakdownLine[] = [];
            const map = new Map<string, number>();
            rangeResults.forEach(day => {
                day.lines.forEach(l => {
                    if (!map.has(l.label)) {
                        map.set(l.label, l.value);
                        resultList.push({ ...l });
                    } else {
                        map.set(l.label, map.get(l.label)! + l.value);
                    }
                });
            });
            return resultList.map(l => ({
                ...l,
                label: l.type === 'total' ? 'VALOR TOTAL FINAL' : l.label,
                value: round2(map.get(l.label)!)
            }));
        }
    }, [simMode, result, plantoesMes, rangeResults]);

    const rangeTotalValor = round2(rangeResults.reduce((a, d) => a + d.valor, 0));
    const rangeTotalLucro = round2(rangeResults.reduce((a, d) => a + d.lucro, 0));
    const rangeDiasUteis = rangeResults.filter(d => !d.isWeekend && !d.holiday).length;
    const rangeDiasFds = rangeResults.filter(d => d.isWeekend).length;
    const rangeDiasFeriado = rangeResults.filter(d => d.holiday).length;

    const toggleDisease = (code: string) => {
        setSelectedDiseases(prev => {
            const n = new Set(prev);
            if (n.has(code)) n.delete(code); else n.add(code);
            return n;
        });
    };

    const toggleFlag = (key: keyof typeof flags) => setFlags(prev => ({ ...prev, [key]: !prev[key] }));
    const toggleMiniCost = (tipo: string) => setMinicustosOverrides(prev => ({ ...prev, [tipo]: !prev[tipo] }));

    /* ----- Render ----- */

    if (loading && !config) {
        return (<div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>);
    }

    return (
        <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <Calculator className="h-6 w-6 text-primary" />
                        Simulador de Cenários
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Simule valores por plantão usando a configuração da unidade
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <select value={selectedUnidadeId} onChange={(e) => setSelectedUnidadeId(e.target.value)}
                        className="h-9 rounded-lg border border-border bg-input px-3 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring transition-all">
                        {unidades.map(u => <option key={u.id} value={u.id}>{u.nome} ({u.codigo})</option>)}
                    </select>
                    <button onClick={() => loadConfig(selectedUnidadeId)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-surface-subtle transition-colors" title="Recarregar">
                        <RefreshCw className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
                </div>
            )}

            {config && (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    {/* ── Left: Inputs ── */}
                    <div className="lg:col-span-3 space-y-5">

                        {/* Plantão ou Serviço Avulso? */}
                        <div className="p-4 rounded-xl border border-border bg-card space-y-4">
                            <div className="flex gap-2">
                                <button onClick={() => setTipoSimulacao('PLANTAO')}
                                    className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-all ${tipoSimulacao === 'PLANTAO'
                                        ? 'bg-primary text-primary-foreground border-primary' : 'bg-input border-border text-foreground hover:border-primary/30'}`}>
                                    Plantão (por hora)
                                </button>
                                <button onClick={() => setTipoSimulacao('SERVICO')}
                                    className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-all ${tipoSimulacao === 'SERVICO'
                                        ? 'bg-primary text-primary-foreground border-primary' : 'bg-input border-border text-foreground hover:border-primary/30'}`}>
                                    Serviço Avulso (Fixo)
                                </button>
                            </div>

                            {tipoSimulacao === 'SERVICO' && config.servicosAvulsos?.length > 0 && (
                                <div className="space-y-1.5 mt-2">
                                    <label className="block text-xs font-medium text-muted-foreground">Selecione o serviço:</label>
                                    <select value={servicoAvulsoId} onChange={e => setServicoAvulsoId(e.target.value)}
                                        className="w-full h-10 rounded-lg border border-border bg-input px-3 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring transition-all">
                                        <option value="">Selecione...</option>
                                        {config.servicosAvulsos.filter(s => s.ativo).map(svc => (
                                            <option key={svc.id || svc.codigo} value={svc.id || svc.codigo}>{svc.nome}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {/* Modo de simulação */}
                        <div className="p-4 rounded-xl border border-border bg-card space-y-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <CalendarDays className="h-4 w-4 text-primary" /> Modo de Simulação
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setSimMode('single')}
                                    className={`flex-1 h-9 rounded-lg border text-sm font-medium transition-all ${simMode === 'single'
                                        ? 'bg-primary text-primary-foreground border-primary' : 'bg-input border-border text-foreground hover:border-primary/30'}`}>
                                    Plantão único / mês
                                </button>
                                <button onClick={() => setSimMode('range')}
                                    className={`flex-1 h-9 rounded-lg border text-sm font-medium transition-all ${simMode === 'range'
                                        ? 'bg-primary text-primary-foreground border-primary' : 'bg-input border-border text-foreground hover:border-primary/30'}`}>
                                    Período (de → até)
                                </button>
                            </div>

                            {simMode === 'single' ? (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-4">
                                        <input type="date" value={selectedDate} onChange={(e) => handleDateChange(e.target.value)}
                                            className="h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring transition-all" />
                                        {selectedDate && (() => {
                                            const [y, m, d] = selectedDate.split('-').map(Number);
                                            const dt = new Date(y, m - 1, d);
                                            return (
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm text-foreground">{WEEKDAY_NAMES[dt.getDay()]}, {d} de {MONTH_NAMES[dt.getMonth()]}</span>
                                                    {detectedInfo.isWeekend && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">📅 Fim de semana</span>}
                                                    {detectedInfo.holiday && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-medium">🎉 {detectedInfo.holiday}</span>}
                                                    {!detectedInfo.isWeekend && !detectedInfo.holiday && <span className="text-xs px-2 py-0.5 rounded-full bg-surface-subtle text-muted-foreground">Dia útil</span>}
                                                </div>
                                            );
                                        })()}
                                        {!selectedDate && <span className="text-xs text-muted-foreground">Selecione data (opcional) para auto-detectar fds/feriado</span>}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <label className="text-xs font-medium text-muted-foreground">Plantões / mês:</label>
                                        <input type="number" value={plantoesMes} onChange={e => setPlantoesMes(parseInt(e.target.value) || 1)} min={1} max={60}
                                            className="w-20 h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <div className="space-y-1">
                                            <label className="block text-xs font-medium text-muted-foreground">De</label>
                                            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                                                className="h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring transition-all" />
                                        </div>
                                        <span className="text-muted-foreground mt-5">→</span>
                                        <div className="space-y-1">
                                            <label className="block text-xs font-medium text-muted-foreground">Até</label>
                                            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                                                className="h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring transition-all" />
                                        </div>
                                    </div>
                                    {rangeResults.length > 0 && (
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className="font-medium">{rangeResults.length} dias</span>
                                            <span>•</span>
                                            <span>{rangeDiasUteis} úteis</span>
                                            {rangeDiasFds > 0 && <><span>•</span><span className="text-blue-600 dark:text-blue-400">{rangeDiasFds} fds</span></>}
                                            {rangeDiasFeriado > 0 && <><span>•</span><span className="text-red-600 dark:text-red-400">{rangeDiasFeriado} feriados</span></>}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Profissional & Horas */}
                        <div className="p-4 rounded-xl border border-border bg-card space-y-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <User className="h-4 w-4 text-primary" /> {tipoSimulacao === 'SERVICO' ? 'Profissional Executante' : 'Profissional e Horas'}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {(['CUIDADOR', 'AUXILIAR_ENF', 'TECNICO_ENF', 'ENFERMEIRO'] as Professional[]).map(p => (
                                    <button key={p} onClick={() => setProfissional(p)}
                                        className={`h-10 rounded-lg border text-sm font-medium transition-all ${profissional === p
                                            ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                            : 'bg-input border-border text-foreground hover:border-primary/30'}`}>
                                        {PROF_LABELS[p]}
                                    </button>
                                ))}
                            </div>
                            {tipoSimulacao === 'PLANTAO' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-medium text-muted-foreground">Horas por plantão</label>
                                        <div className="flex items-center gap-1">
                                            <input type="range" min={1} max={24} value={horas} onChange={e => setHoras(parseInt(e.target.value))}
                                                className="flex-1 accent-primary" />
                                            <span className="w-8 text-center font-mono text-sm font-bold text-foreground">{horas}h</span>
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-medium text-muted-foreground">Pacientes simultâneos</label>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setQtdPacientes(Math.max(1, qtdPacientes - 1))} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-foreground hover:bg-surface-subtle">−</button>
                                            <span className="font-mono font-bold text-foreground">{qtdPacientes}</span>
                                            <button onClick={() => setQtdPacientes(qtdPacientes + 1)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-foreground hover:bg-surface-subtle">+</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Flags / Adicionais */}
                        {tipoSimulacao === 'PLANTAO' && (
                            <div className="p-4 rounded-xl border border-border bg-card space-y-3">
                                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                    <Zap className="h-4 w-4 text-primary" /> Adicionais
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {([
                                        { key: 'noturno' as const, label: 'Noturno', icon: Moon, perc: config.adicionais.noturno },
                                        { key: 'fimSemana' as const, label: 'Fim de Semana', icon: CalendarDays, perc: config.adicionais.fimSemana },
                                        { key: 'feriado' as const, label: 'Feriado', icon: Star, perc: config.adicionais.feriado },
                                        { key: 'altoRisco' as const, label: 'Alto Risco', icon: Shield, perc: config.adicionais.altoRisco },
                                        { key: 'at' as const, label: 'AT', icon: AlertTriangle, perc: config.adicionais.at },
                                        { key: 'aa' as const, label: 'AA', icon: Percent, perc: config.adicionais.aa },
                                    ]).map(f => (
                                        <button key={f.key}
                                            onClick={() => setFlags({ ...flags, [f.key]: !flags[f.key] })}
                                            className={`flex items-center gap-2 h-9 px-3 rounded-full border text-xs font-medium transition-all ${flags[f.key]
                                                ? 'bg-primary/10 border-primary text-primary' : 'bg-surface hover:bg-surface-subtle border-border text-muted-foreground'}`}>
                                            <f.icon className="h-3.5 w-3.5" />
                                            {f.label} <span>+{f.perc}%</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Doenças */}
                        {config.diseases.length > 0 && (
                            <div className="p-4 rounded-xl border border-border bg-card space-y-3">
                                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                    <Shield className="h-4 w-4 text-primary" /> Doenças / Condições
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {config.diseases.filter(d => d.ativa).map(d => (
                                        <button key={d.codigo} onClick={() => toggleDisease(d.codigo)}
                                            className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-all ${selectedDiseases.has(d.codigo)
                                                ? 'bg-amber-500 text-white shadow-sm'
                                                : 'bg-surface-subtle border border-border text-muted-foreground hover:border-amber-300'}`}>
                                            {d.nome} <span className="opacity-70">+{d.adicionalPercent}%</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Minicustos */}
                        <div className="p-4 rounded-xl border border-border bg-card space-y-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Tag className="h-4 w-4 text-primary" /> Minicustos
                            </div>
                            <div className="space-y-1">
                                {config.miniCosts.map(mc => (
                                    <label key={mc.tipo} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-surface-subtle cursor-pointer transition-colors">
                                        <input type="checkbox" checked={minicustosOverrides[mc.tipo] ?? mc.ativoPadrao}
                                            onChange={() => toggleMiniCost(mc.tipo)}
                                            className="h-4 w-4 rounded border-border accent-primary" />
                                        <span className="text-sm text-foreground flex-1">{mc.nome}</span>
                                        <span className="text-xs text-muted-foreground font-mono">{BRL(mc.valor)}{mc.escalaHoras ? '/fator' : ''}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Pagamento & Desconto */}
                        <div className="p-4 rounded-xl border border-border bg-card space-y-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <CreditCard className="h-4 w-4 text-primary" /> Pagamento & Desconto
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-muted-foreground">Método</label>
                                    <select value={metodo} onChange={e => setMetodo(e.target.value)}
                                        className="w-full h-9 rounded-lg border border-border bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                                        <option value="PIX">PIX</option>
                                        <option value="BOLETO">Boleto</option>
                                        <option value="CARTAO_CREDITO">Cartão Crédito</option>
                                        <option value="LINK_PAGAMENTO">Link Pagamento</option>
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-muted-foreground">Período</label>
                                    <select value={periodo} onChange={e => setPeriodo(e.target.value)}
                                        className="w-full h-9 rounded-lg border border-border bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                                        <option value="DIARIO">Diário</option>
                                        <option value="SEMANAL">Semanal</option>
                                        <option value="QUINZENAL">Quinzenal</option>
                                        <option value="MENSAL">Mensal</option>
                                    </select>
                                </div>
                            </div>
                            {/* Desconto presets */}
                            <div className="space-y-1.5">
                                <label className="block text-xs font-medium text-muted-foreground">Desconto</label>
                                <div className="flex flex-wrap gap-2">
                                    <button onClick={() => { setDescontoPreset(0); setDescontoManual(0); }}
                                        className={`h-8 px-3 rounded-full text-xs font-medium transition-all ${descontoPreset === 0 && descontoManual === 0
                                            ? 'bg-primary text-primary-foreground' : 'bg-surface-subtle border border-border text-muted-foreground'}`}>
                                        Sem desconto
                                    </button>
                                    {config.discounts.filter(d => d.ativo).map(d => (
                                        <button key={d.nome} onClick={() => { setDescontoPreset(d.percentual); setDescontoManual(0); }}
                                            className={`h-8 px-3 rounded-full text-xs font-medium transition-all ${descontoPreset === d.percentual
                                                ? 'bg-green-500 text-white shadow-sm' : 'bg-surface-subtle border border-border text-muted-foreground hover:border-green-300'}`}>
                                            {d.etiqueta || d.nome} ({d.percentual}%)
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="block text-xs font-medium text-muted-foreground">Desconto manual extra (%)</label>
                                <input type="number" value={descontoManual} onChange={e => setDescontoManual(parseFloat(e.target.value) || 0)}
                                    min={0} max={50} step={0.5}
                                    className="w-32 h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                            </div>
                        </div>
                    </div>

                    {/* ── Right: Result ── */}
                    <div className="lg:col-span-2 space-y-4">
                        {/* Big number */}
                        <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 text-center space-y-2">
                            <div className="text-xs font-medium text-primary uppercase tracking-wider">Valor por {tipoSimulacao === 'SERVICO' ? 'serviço' : 'plantão'}</div>
                            <div className="text-4xl font-black text-foreground tracking-tight">
                                {result ? BRL(result.totalFinal) : '—'}
                            </div>
                            {result && result.profEfetivo !== profissional && (
                                <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                    ⬆ Upgrade: {PROF_LABELS[result.profEfetivo]} (exigido por doença)
                                </div>
                            )}
                        </div>

                        {/* Summary cards */}
                        {result && (
                            <div className="grid grid-cols-3 gap-2">
                                <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-center">
                                    <div className="text-[10px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">👷 Profissional</div>
                                    <div className="text-lg font-bold text-blue-700 dark:text-blue-300 mt-0.5">{BRL(result.pagoProfissional)}</div>
                                </div>
                                <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-center">
                                    <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">💰 Lucro líq.</div>
                                    <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">{BRL(result.lucroLiquido)}</div>
                                </div>
                                <div className="p-3 rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 text-center">
                                    <div className="text-[10px] font-medium text-orange-600 dark:text-orange-400 uppercase tracking-wider">📦 Custos op.</div>
                                    <div className="text-lg font-bold text-orange-700 dark:text-orange-300 mt-0.5">{BRL(result.custosOperacionais)}</div>
                                </div>
                            </div>
                        )}

                        {/* Estimate - mode dependent */}
                        {simMode === 'single' ? (
                            <div className="p-4 rounded-xl border border-border bg-card flex items-center justify-between">
                                <div>
                                    <div className="text-xs text-muted-foreground">Estimativa mensal</div>
                                    <div className="text-xs text-muted-foreground">({plantoesMes} {tipoSimulacao === 'SERVICO' ? 'serviços' : `${plantoesMes} plantões × ${horas}h`})</div>
                                </div>
                                <div className="text-2xl font-bold text-foreground">{BRL(valorMensal)}</div>
                            </div>
                        ) : rangeResults.length > 0 ? (
                            <>
                                {/* Range totals */}
                                <div className="p-4 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs text-muted-foreground">Total do período ({rangeResults.length} dias)</div>
                                        <div className="text-2xl font-bold text-foreground">{BRL(rangeTotalValor)}</div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs text-muted-foreground">Lucro líquido no período</div>
                                        <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{BRL(rangeTotalLucro)}</div>
                                    </div>
                                </div>
                                {/* Day-by-day list */}
                                <div className="rounded-xl border border-border bg-card overflow-hidden">
                                    <div className="p-3 border-b border-border bg-surface-subtle">
                                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dia a dia</div>
                                    </div>
                                    <div className="max-h-[320px] overflow-y-auto">
                                        {rangeResults.map((day) => (
                                            <div key={day.dateStr} className={`flex items-center justify-between px-4 py-2 text-sm border-b border-border/50 last:border-0 ${day.holiday ? 'bg-red-50/50 dark:bg-red-900/10' : day.isWeekend ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                                                }`}>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-muted-foreground w-16">{day.dateStr.slice(5)}</span>
                                                    <span className={`text-xs w-10 ${day.isWeekend || day.holiday ? 'font-semibold' : 'text-muted-foreground'}`}>
                                                        {day.dayName.slice(0, 3)}
                                                    </span>
                                                    {day.holiday && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">{day.holiday}</span>}
                                                    {day.isWeekend && !day.holiday && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">FDS</span>}
                                                </div>
                                                <span className="font-mono text-sm font-medium">{BRL(day.valor)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : null}

                        {/* Breakdown Aggregated */}
                        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                            <button onClick={() => setShowAggregatedBreakdown(!showAggregatedBreakdown)}
                                className="w-full flex items-center justify-between p-4 text-sm font-semibold text-foreground hover:bg-surface-subtle transition-colors">
                                <span>Detalhamento do Período ({simMode === 'single' ? `${plantoesMes} ${tipoSimulacao === 'SERVICO' ? 'serviços' : 'plantões'}` : `${rangeResults.length} dias`})</span>
                                {showAggregatedBreakdown ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            {showAggregatedBreakdown && aggregatedLines.length > 0 && (
                                <div className="border-t border-border">
                                    {aggregatedLines.map((line, i) => (
                                        <div key={i} className={`flex items-center justify-between px-4 py-2 text-sm ${line.type === 'section'
                                            ? 'bg-surface-subtle border-t border-border pt-3 pb-1'
                                            : line.type === 'total'
                                                ? 'bg-primary/5 border-t-2 border-primary/30 font-bold text-foreground py-3'
                                                : line.type === 'info'
                                                    ? 'bg-surface-subtle/30 font-medium text-foreground'
                                                    : 'text-muted-foreground'
                                            }`}>
                                            {line.type === 'section' ? (
                                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{line.label}</span>
                                            ) : (
                                                <>
                                                    <div className="flex items-center gap-2">
                                                        <span>{line.label}</span>
                                                        {line.meta && <span className="text-xs px-1.5 py-0.5 rounded bg-surface-subtle text-muted-foreground">{line.meta}</span>}
                                                    </div>
                                                    <span className={`font-mono text-sm ${line.type === 'sub' ? 'text-red-500'
                                                        : line.type === 'total' ? 'text-primary font-bold text-base'
                                                            : ''
                                                        }`}>
                                                        {line.value < 0 ? `- ${BRL(Math.abs(line.value))}` : BRL(line.value)}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Breakdown Unit */}
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <button onClick={() => setShowBreakdown(!showBreakdown)}
                                className="w-full flex items-center justify-between p-4 text-sm font-semibold text-foreground hover:bg-surface-subtle transition-colors">
                                <span className="text-muted-foreground">Detalhamento unitário (1 {tipoSimulacao === 'SERVICO' ? 'serviço' : 'plantão'})</span>
                                {showBreakdown ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            {showBreakdown && result && (
                                <div className="border-t border-border">
                                    {result.lines.map((line, i) => (
                                        <div key={i} className={`flex items-center justify-between px-4 py-2 text-sm ${line.type === 'section'
                                            ? 'bg-surface-subtle border-t border-border pt-3 pb-1'
                                            : line.type === 'total'
                                                ? 'bg-primary/5 border-t-2 border-primary/30 font-bold text-foreground py-3'
                                                : line.type === 'info'
                                                    ? 'bg-surface-subtle/30 font-medium text-foreground'
                                                    : 'text-muted-foreground'
                                            }`}>
                                            {line.type === 'section' ? (
                                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{line.label}</span>
                                            ) : (
                                                <>
                                                    <div className="flex items-center gap-2">
                                                        <span>{line.label}</span>
                                                        {line.meta && <span className="text-xs px-1.5 py-0.5 rounded bg-surface-subtle text-muted-foreground">{line.meta}</span>}
                                                    </div>
                                                    <span className={`font-mono text-sm ${line.type === 'sub' ? 'text-red-500'
                                                        : line.type === 'total' ? 'text-primary font-bold text-base'
                                                            : ''
                                                        }`}>
                                                        {line.value < 0 ? `- ${BRL(Math.abs(line.value))}` : BRL(line.value)}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Quick compare: all professionals */}
                        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Comparação rápida — {horas}h</div>
                            <div className="space-y-2">
                                {(['CUIDADOR', 'AUXILIAR_ENF', 'TECNICO_ENF', 'ENFERMEIRO'] as Professional[]).map(p => {
                                    const r = config ? simulate(config, {
                                        ...{
                                            profissional: p, horas, qtdPacientes, metodoPagamento: metodo, periodoPagamento: periodo,
                                            diseaseCodes: selectedDiseases, descontoPresetPercent: descontoPreset,
                                            descontoManualPercent: descontoManual, minicustosOverrides, flags,
                                        }
                                    }) : null;
                                    return (
                                        <div key={p} className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${p === profissional ? 'bg-primary/10 border border-primary/20' : 'hover:bg-surface-subtle'}`}>
                                            <span className={`text-sm ${p === profissional ? 'font-semibold text-primary' : 'text-foreground'}`}>{PROF_LABELS[p]}</span>
                                            <div className="text-right">
                                                <div className="text-sm font-mono font-medium">{r ? BRL(r.totalFinal) : '—'}</div>
                                                <div className="text-xs text-muted-foreground">{r ? `${BRL(r.totalFinal * plantoesMes)}/mês` : ''}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
