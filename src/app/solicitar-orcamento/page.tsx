'use client';

import { useState } from 'react';
import Link from 'next/link';

// ── Options matching WhatsApp bot flow ──
const RELACOES = [
    { value: 'PARENTE', label: 'Sou parente', icon: '❤️' },
    { value: 'PROPRIO', label: 'Eu preciso dos cuidados', icon: '🙋' },
    { value: 'AMIGO', label: 'Sou amigo/conhecido', icon: '🤝' },
    { value: 'PODER_PUBLICO', label: 'Poder público', icon: '🏛️' },
];

const CONDICOES = [
    { value: 'IDOSO_LOCOMOCAO', label: 'Idoso com dificuldade de locomoção' },
    { value: 'POS_OPERATORIO', label: 'Pós-operatório' },
    { value: 'DOENCA_CRONICA', label: 'Doença crônica (diabetes, hipertensão, etc)' },
    { value: 'DEMENCIA', label: 'Demência / Alzheimer' },
    { value: 'ACAMADO', label: 'Acamado' },
    { value: 'OUTRO', label: 'Outro' },
];

const TIPOS_CUIDADO = [
    { value: 'HOME_CARE', label: 'Cuidado Domiciliar (Home Care)', icon: '🏠' },
    { value: 'HOSPITAL', label: 'Acompanhamento Hospitalar', icon: '🏥' },
];

const PERIODOS = [
    { value: '6H', label: '6 horas (meio período)' },
    { value: '12H', label: '12 horas (período integral)' },
    { value: '24H', label: '24 horas (cuidado contínuo)' },
];

const URGENCIAS = [
    { value: 'NORMAL', label: 'Normal — tenho tempo para organizar', icon: '🟢' },
    { value: 'ALTA', label: 'Alta — preciso em poucos dias', icon: '🟡' },
    { value: 'URGENTE', label: 'Urgente — preciso nas próximas 24h', icon: '🔴' },
];

const STEPS = [
    { key: 'relacao', label: 'Relação', icon: '👥' },
    { key: 'dados', label: 'Seus Dados', icon: '👤' },
    { key: 'paciente', label: 'Paciente', icon: '🩺' },
    { key: 'cuidado', label: 'Cuidado', icon: '🏠' },
    { key: 'detalhes', label: 'Detalhes', icon: '📋' },
];

interface FormData {
    relacao: string;
    nome: string;
    telefone: string;
    email: string;
    idadePaciente: string;
    cidade: string;
    condicao: string;
    tipoCuidado: string;
    periodo: string;
    urgencia: string;
    observacoes: string;
}

const INITIAL_FORM: FormData = {
    relacao: '', nome: '', telefone: '', email: '',
    idadePaciente: '', cidade: '', condicao: '',
    tipoCuidado: '', periodo: '', urgencia: '', observacoes: '',
};

function formatPhone(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export default function SolicitarOrcamentoPage() {
    const [step, setStep] = useState(0);
    const [form, setForm] = useState<FormData>(INITIAL_FORM);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [animating, setAnimating] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [urgentMode, setUrgentMode] = useState(false);
    const [urgentName, setUrgentName] = useState('');
    const [urgentPhone, setUrgentPhone] = useState('');
    const [urgentNote, setUrgentNote] = useState('');
    const [urgentErrors, setUrgentErrors] = useState<Record<string, string>>({});
    const [urgentSubmitted, setUrgentSubmitted] = useState(false);

    const animateTransition = (callback: () => void) => {
        setAnimating(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => { callback(); setAnimating(false); }, 250);
    };

    // ── Validation ──
    const validateStep = (): boolean => {
        const e: Record<string, string> = {};
        if (step === 0 && !form.relacao) e.relacao = 'Selecione sua relação com o paciente';
        if (step === 1) {
            if (!form.nome || form.nome.trim().length < 3) e.nome = 'Informe seu nome completo';
            if (!form.telefone || form.telefone.replace(/\D/g, '').length < 10) e.telefone = 'Telefone inválido';
            if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Email inválido';
        }
        if (step === 2) {
            if (!form.cidade || form.cidade.trim().length < 2) e.cidade = 'Informe a cidade';
            if (form.idadePaciente && (isNaN(Number(form.idadePaciente)) || Number(form.idadePaciente) < 0 || Number(form.idadePaciente) > 150)) {
                e.idadePaciente = 'Idade inválida';
            }
        }
        if (step === 3) {
            if (!form.condicao) e.condicao = 'Selecione a condição de saúde';
            if (!form.tipoCuidado) e.tipoCuidado = 'Selecione o tipo de cuidado';
        }
        if (step === 4) {
            if (!form.periodo) e.periodo = 'Selecione o período';
            if (!form.urgencia) e.urgencia = 'Selecione a urgência';
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleNext = () => {
        if (!validateStep()) return;
        if (step < STEPS.length - 1) {
            animateTransition(() => setStep(s => s + 1));
        } else {
            handleSubmit();
        }
    };

    const handleBack = () => {
        if (step > 0) animateTransition(() => setStep(s => s - 1));
    };

    const handleSubmit = async () => {
        if (!validateStep()) return;
        setSubmitting(true);
        try {
            await fetch('/api/leads/web', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    telefone: form.telefone.replace(/\D/g, ''),
                }),
            });
            setSubmitted(true);
        } catch {
            setSubmitted(true);
        } finally {
            setSubmitting(false);
        }
    };

    const handleUrgentSubmit = async () => {
        const e: Record<string, string> = {};
        if (!urgentName || urgentName.trim().length < 2) e.nome = 'Informe seu nome';
        if (!urgentPhone || urgentPhone.replace(/\D/g, '').length < 10) e.telefone = 'Telefone inválido';
        setUrgentErrors(e);
        if (Object.keys(e).length > 0) return;

        setSubmitting(true);
        try {
            await fetch('/api/leads/web', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nome: urgentName,
                    telefone: urgentPhone.replace(/\D/g, ''),
                    urgencia: 'URGENTE_AGORA',
                    observacoes: urgentNote || 'Contato urgente via site',
                }),
            });
            setUrgentSubmitted(true);
        } catch {
            setUrgentSubmitted(true);
        } finally {
            setSubmitting(false);
        }
    };

    // ═══ Urgent Submitted Success ═══
    if (urgentSubmitted) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50">
                <header className="bg-white/80 backdrop-blur-md border-b border-red-100 sticky top-0 z-50">
                    <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-2 group">
                            <span className="text-2xl">🤝</span>
                            <span className="text-xl font-bold text-primary-800 group-hover:text-primary-600 transition-colors">Mãos Amigas</span>
                        </Link>
                    </div>
                </header>

                <main className="max-w-2xl mx-auto px-4 py-12 sm:py-20">
                    <div className="bg-white rounded-2xl shadow-lg shadow-red-100/50 border border-red-50 overflow-hidden">
                        <div className="bg-gradient-to-br from-red-600 to-red-700 px-6 sm:px-8 py-10 text-center">
                            <div className="text-6xl mb-4">🚨</div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                                Contato Urgente Enviado!
                            </h1>
                            <p className="text-white/90 text-lg">
                                Vamos ligar para você o mais rápido possível.
                            </p>
                        </div>

                        <div className="px-6 sm:px-8 py-8 space-y-6">
                            <div className="bg-red-50 rounded-xl p-5 border border-red-100">
                                <h3 className="font-semibold text-red-800 mb-2">📞 Próximos passos</h3>
                                <ul className="text-sm text-red-700 space-y-1.5">
                                    <li>1. Nossa equipe já foi notificada com <strong>prioridade máxima</strong></li>
                                    <li>2. Vamos ligar para <strong>{urgentPhone}</strong> em breve</li>
                                    <li>3. Se prefer, você também pode nos ligar diretamente</li>
                                </ul>
                            </div>

                            <div className="bg-neutral-50 rounded-xl p-5">
                                <p className="text-sm text-muted-foreground"><strong>Nome:</strong> {urgentName}</p>
                                <p className="text-sm text-muted-foreground"><strong>Telefone:</strong> {urgentPhone}</p>
                                {urgentNote && <p className="text-sm text-muted-foreground"><strong>Observação:</strong> {urgentNote}</p>}
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3 pt-2">
                                <Link href="/" className="flex-1 px-6 py-3 border-2 border-neutral-200 text-foreground rounded-xl font-semibold hover:bg-neutral-50 transition-all text-center">
                                    ← Voltar ao Site
                                </Link>
                                <a
                                    href={`https://wa.me/5545999999999?text=${encodeURIComponent(`URGENTE: Preciso de cuidador com urgência. Meu nome é ${urgentName}.`)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 px-6 py-3 bg-secondary-600 text-white rounded-xl font-semibold hover:bg-secondary-700 transition-all text-center flex items-center justify-center gap-2"
                                >
                                    💬 Falar no WhatsApp
                                </a>
                            </div>
                        </div>
                    </div>
                </main>

                <footer className="border-t border-neutral-100 mt-12 py-6 text-center text-sm text-muted-foreground">
                    © {new Date().getFullYear()} Mãos Amigas — Especialistas em Cuidado de Idosos
                </footer>
            </div>
        );
    }

    // ═══ Normal Submitted Success ═══
    if (submitted) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50">
                <header className="bg-white/80 backdrop-blur-md border-b border-primary-100 sticky top-0 z-50">
                    <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-2 group">
                            <span className="text-2xl">🤝</span>
                            <span className="text-xl font-bold text-primary-800 group-hover:text-primary-600 transition-colors">Mãos Amigas</span>
                        </Link>
                    </div>
                </header>

                <main className="max-w-3xl mx-auto px-4 py-12 sm:py-20">
                    <div className="bg-white rounded-2xl shadow-lg shadow-primary-100/50 border border-primary-50 overflow-hidden">
                        <div className="bg-gradient-to-br from-success-600 to-primary-700 px-6 sm:px-8 py-10 text-center">
                            <div className="text-6xl mb-4" style={{ animation: 'scale-in 0.5s ease' }}>✅</div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                                Solicitação Enviada!
                            </h1>
                            <p className="text-white/80 text-lg">
                                Nossa equipe entrará em contato em breve.
                            </p>
                        </div>

                        <div className="px-6 sm:px-8 py-8 space-y-6">
                            {/* Summary */}
                            <div className="bg-neutral-50 rounded-xl p-5">
                                <h3 className="font-semibold text-foreground mb-3">📋 Resumo da Solicitação</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                    <div><span className="text-muted-foreground">Nome:</span> <strong>{form.nome}</strong></div>
                                    <div><span className="text-muted-foreground">Telefone:</span> <strong>{form.telefone}</strong></div>
                                    <div><span className="text-muted-foreground">Cidade:</span> <strong>{form.cidade}</strong></div>
                                    <div><span className="text-muted-foreground">Tipo:</span> <strong>{TIPOS_CUIDADO.find(t => t.value === form.tipoCuidado)?.label}</strong></div>
                                    <div><span className="text-muted-foreground">Período:</span> <strong>{PERIODOS.find(p => p.value === form.periodo)?.label}</strong></div>
                                    <div><span className="text-muted-foreground">Urgência:</span> <strong>{URGENCIAS.find(u => u.value === form.urgencia)?.label}</strong></div>
                                </div>
                            </div>

                            {/* Next steps */}
                            <div className="p-5 bg-info-50 rounded-xl border border-blue-100">
                                <h4 className="font-semibold text-primary-800 mb-2">📞 Próximos passos</h4>
                                <ol className="text-sm text-primary-700 space-y-1.5 list-decimal list-inside">
                                    <li>Nossa equipe analisará sua solicitação</li>
                                    <li>Entraremos em contato pelo WhatsApp informado</li>
                                    <li>Agendaremos uma avaliação presencial</li>
                                    <li>Você receberá um orçamento personalizado</li>
                                </ol>
                            </div>

                            {form.urgencia === 'URGENTE' && (
                                <div className="p-4 bg-error-50 rounded-xl border border-error-200">
                                    <p className="font-medium text-error-700 text-sm">
                                        🚨 Sua solicitação foi marcada como <strong>URGENTE</strong>.
                                        Nossa equipe será notificada com prioridade máxima.
                                    </p>
                                </div>
                            )}

                            <div className="flex flex-col sm:flex-row gap-3 pt-2">
                                <Link href="/" className="flex-1 px-6 py-3 border-2 border-neutral-200 text-foreground rounded-xl font-semibold hover:bg-neutral-50 transition-all text-center">
                                    ← Voltar ao Site
                                </Link>
                                <a
                                    href={`https://wa.me/5545999999999?text=${encodeURIComponent(`Olá, acabei de enviar uma solicitação de orçamento pelo site. Meu nome é ${form.nome}.`)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 px-6 py-3 bg-secondary-600 text-white rounded-xl font-semibold hover:bg-secondary-700 transition-all text-center flex items-center justify-center gap-2"
                                >
                                    💬 Falar no WhatsApp
                                </a>
                            </div>
                        </div>
                    </div>
                </main>

                <footer className="border-t border-neutral-100 mt-12 py-6 text-center text-sm text-muted-foreground">
                    © {new Date().getFullYear()} Mãos Amigas — Especialistas em Cuidado de Idosos
                </footer>
            </div>
        );
    }

    // ── Form Steps ──
    return (
        <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50">
            {/* Header */}
            <header className="bg-white/80 backdrop-blur-md border-b border-primary-100 sticky top-0 z-50">
                <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 group">
                        <span className="text-2xl">🤝</span>
                        <span className="text-xl font-bold text-primary-800 group-hover:text-primary-600 transition-colors">Mãos Amigas</span>
                    </Link>
                    <Link href="/" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                        ← Voltar ao início
                    </Link>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
                {/* Hero (only on first step) */}
                {step === 0 && (
                    <div className="text-center mb-10" style={{ animation: 'fade-in-up 0.5s ease both' }}>
                        <div className="inline-flex items-center gap-2 bg-primary-100 text-primary-800 px-4 py-1.5 rounded-full text-sm font-medium mb-4">
                            <span className="w-2 h-2 bg-primary-500 rounded-full animate-pulse" />
                            Atendimento Online
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3" style={{ letterSpacing: '-0.03em' }}>
                            Solicitar Orçamento
                        </h1>
                        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                            Conte-nos sobre suas necessidades para que possamos ajudá-lo da melhor forma
                        </p>
                    </div>
                )}

                {/* Step Indicator */}
                <div className="flex items-center justify-center gap-2 sm:gap-3 mb-8">
                    {STEPS.map((s, i) => (
                        <div key={s.key} className="flex items-center gap-2 sm:gap-3">
                            {i > 0 && <div className={`w-6 sm:w-10 h-0.5 rounded-full transition-colors duration-500 ${step >= i ? 'bg-primary-500' : 'bg-neutral-200'}`} />}
                            <div className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all duration-500 ${step === i ? 'bg-primary-600 text-white shadow-md shadow-primary-200' :
                                step > i ? 'bg-primary-100 text-primary-700' :
                                    'bg-neutral-100 text-neutral-400'
                                }`}>
                                <span>{s.icon}</span>
                                <span className="hidden sm:inline">{s.label}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Step Progress Bar */}
                <div className="mb-6">
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                        <span>{STEPS[step].icon} {STEPS[step].label}</span>
                        <span>{step + 1} de {STEPS.length}</span>
                    </div>
                    <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full transition-all duration-500 ease-out" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
                    </div>
                </div>

                {/* Form Card */}
                <div className={`transition-all duration-250 ${animating ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0'}`}>
                    <div className="bg-white rounded-2xl shadow-lg shadow-primary-100/50 border border-primary-50 p-6 sm:p-8">

                        {/* ═══ URGENT MINI-FORM ═══ */}
                        {urgentMode ? (
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="text-3xl">🚨</span>
                                    <h2 className="text-xl font-semibold text-red-700">Contato Urgente</h2>
                                </div>
                                <p className="text-muted-foreground text-sm mb-6">Informe seu telefone e entraremos em contato o mais rápido possível.</p>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-foreground mb-1.5">Seu Nome *</label>
                                        <input type="text" value={urgentName} onChange={(e) => setUrgentName(e.target.value)}
                                            placeholder="Seu nome"
                                            className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 transition-all" />
                                        {urgentErrors.nome && <p className="text-error-600 text-sm mt-1">{urgentErrors.nome}</p>}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-foreground mb-1.5">Telefone (WhatsApp) *</label>
                                        <input type="text" value={urgentPhone} onChange={(e) => setUrgentPhone(formatPhone(e.target.value))}
                                            placeholder="(45) 99999-9999" maxLength={15}
                                            className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 transition-all font-mono text-lg" />
                                        {urgentErrors.telefone && <p className="text-error-600 text-sm mt-1">{urgentErrors.telefone}</p>}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-foreground mb-1.5">O que aconteceu? <span className="text-muted-foreground font-normal">(opcional)</span></label>
                                        <textarea value={urgentNote} onChange={(e) => setUrgentNote(e.target.value)}
                                            placeholder="Descreva brevemente a situação..."
                                            rows={2}
                                            className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 transition-all resize-none" />
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mt-8 pt-6 border-t border-neutral-100">
                                    <button onClick={() => { setUrgentMode(false); setAnimating(true); setTimeout(() => setAnimating(false), 250); }}
                                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-neutral-100 transition-all text-sm font-medium">
                                        ← Voltar ao formulário completo
                                    </button>
                                    <button onClick={handleUrgentSubmit} disabled={submitting}
                                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold active:scale-[0.97] transition-all shadow-md text-sm bg-red-600 text-white hover:bg-red-700 shadow-red-200 ${submitting ? 'opacity-70 cursor-wait' : ''}`}>
                                        {submitting ? (
                                            <>
                                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Enviando...
                                            </>
                                        ) : (
                                            '🚨 Enviar — Liguem para mim!'
                                        )}
                                    </button>
                                </div>

                                <p className="text-xs text-center text-muted-foreground mt-4">
                                    ⚠️ Em caso de emergência médica, ligue <strong>192 (SAMU)</strong>
                                </p>
                            </div>
                        ) : (
                            <>

                                {/* ═══ STEP 0: Relação ═══ */}
                                {step === 0 && (
                                    <div>
                                        <h2 className="text-xl font-semibold mb-2">Qual a sua relação com a pessoa que precisa de cuidados?</h2>
                                        <p className="text-muted-foreground text-sm mb-6">Isso nos ajuda a direcionar melhor o atendimento.</p>
                                        <div className="grid gap-3">
                                            {RELACOES.map((r) => (
                                                <button key={r.value} onClick={() => {
                                                    setForm({ ...form, relacao: r.value });
                                                    setErrors({});
                                                    setTimeout(() => { animateTransition(() => setStep(1)); }, 300);
                                                }}
                                                    className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 flex items-center gap-4 group ${form.relacao === r.value
                                                        ? 'border-primary-500 bg-primary-50 shadow-md shadow-primary-100'
                                                        : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50'
                                                        }`}>
                                                    <span className="text-2xl">{r.icon}</span>
                                                    <span className="font-medium text-foreground">{r.label}</span>
                                                    {form.relacao === r.value && (
                                                        <span className="ml-auto text-primary-600 font-bold text-lg">✓</span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                        {errors.relacao && <p className="text-error-600 text-sm mt-3">{errors.relacao}</p>}

                                        {/* Urgent shortcut */}
                                        <div className="mt-6 pt-6 border-t border-neutral-100">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="flex-1 h-px bg-neutral-200" />
                                                <span className="text-xs text-muted-foreground font-medium">ou</span>
                                                <div className="flex-1 h-px bg-neutral-200" />
                                            </div>
                                            <button
                                                onClick={() => { setUrgentMode(true); setAnimating(true); setTimeout(() => setAnimating(false), 250); }}
                                                className="w-full p-4 rounded-xl border-2 border-red-200 bg-gradient-to-r from-red-50 to-orange-50 hover:border-red-400 hover:shadow-md hover:shadow-red-100 transition-all duration-200 flex items-center gap-4 group"
                                            >
                                                <span className="text-3xl">🚨</span>
                                                <div className="text-left">
                                                    <span className="font-semibold text-red-700 block">Preciso URGENTE!</span>
                                                    <span className="text-xs text-red-500">Pule as etapas — informe seu telefone e ligamos para você</span>
                                                </div>
                                                <span className="ml-auto text-red-400 group-hover:text-red-600 transition-colors">→</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* ═══ STEP 1: Dados Pessoais ═══ */}
                                {step === 1 && (
                                    <div>
                                        <h2 className="text-xl font-semibold mb-2">Seus Dados de Contato</h2>
                                        <p className="text-muted-foreground text-sm mb-6">Para que possamos entrar em contato com você.</p>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-foreground mb-1.5">Nome Completo *</label>
                                                <input type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                                                    placeholder="Seu nome completo"
                                                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all" />
                                                {errors.nome && <p className="text-error-600 text-sm mt-1.5">{errors.nome}</p>}
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-foreground mb-1.5">Telefone (WhatsApp) *</label>
                                                <input type="text" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: formatPhone(e.target.value) })}
                                                    placeholder="(45) 99999-9999" maxLength={15}
                                                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all font-mono" />
                                                {errors.telefone && <p className="text-error-600 text-sm mt-1">{errors.telefone}</p>}
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-foreground mb-1.5">Email <span className="text-muted-foreground font-normal">(opcional)</span></label>
                                                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                                                    placeholder="seu@email.com"
                                                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all" />
                                                {errors.email && <p className="text-error-600 text-sm mt-1">{errors.email}</p>}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* ═══ STEP 2: Dados do Paciente ═══ */}
                                {step === 2 && (
                                    <div>
                                        <h2 className="text-xl font-semibold mb-2">Informações do Paciente</h2>
                                        <p className="text-muted-foreground text-sm mb-6">Dados sobre a pessoa que receberá os cuidados.</p>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-foreground mb-1.5">Cidade *</label>
                                                <input type="text" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                                                    placeholder="Ex: Toledo"
                                                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all" />
                                                {errors.cidade && <p className="text-error-600 text-sm mt-1">{errors.cidade}</p>}
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-foreground mb-1.5">Idade do paciente <span className="text-muted-foreground font-normal">(opcional)</span></label>
                                                <input type="text" value={form.idadePaciente} onChange={(e) => {
                                                    const val = e.target.value.replace(/\D/g, '').slice(0, 3);
                                                    setForm({ ...form, idadePaciente: val });
                                                }}
                                                    placeholder="Ex: 75"
                                                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all font-mono" />
                                                {errors.idadePaciente && <p className="text-error-600 text-sm mt-1">{errors.idadePaciente}</p>}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* ═══ STEP 3: Tipo de Cuidado ═══ */}
                                {step === 3 && (
                                    <div>
                                        <h2 className="text-xl font-semibold mb-2">Necessidade de Cuidado</h2>
                                        <p className="text-muted-foreground text-sm mb-6">Qual a condição do paciente e o tipo de cuidado necessário.</p>

                                        {/* Condição */}
                                        <div className="mb-6">
                                            <label className="block text-sm font-medium text-foreground mb-3">Condição de saúde *</label>
                                            <div className="grid gap-2">
                                                {CONDICOES.map((c) => (
                                                    <button key={c.value} onClick={() => { setForm({ ...form, condicao: c.value }); setErrors(e => { const { condicao: _, ...rest } = e; return rest; }); }}
                                                        className={`w-full text-left p-3.5 rounded-xl border-2 transition-all duration-200 flex items-center gap-3 text-sm ${form.condicao === c.value
                                                            ? 'border-primary-500 bg-primary-50 shadow-sm shadow-primary-100'
                                                            : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50'
                                                            }`}>
                                                        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${form.condicao === c.value ? 'border-primary-500 bg-primary-500' : 'border-neutral-300'}`}>
                                                            {form.condicao === c.value && <span className="w-2 h-2 bg-white rounded-full" />}
                                                        </span>
                                                        <span className="font-medium text-foreground">{c.label}</span>
                                                    </button>
                                                ))}
                                            </div>
                                            {errors.condicao && <p className="text-error-600 text-sm mt-2">{errors.condicao}</p>}
                                        </div>

                                        {/* Tipo de cuidado */}
                                        <div>
                                            <label className="block text-sm font-medium text-foreground mb-3">Tipo de cuidado *</label>
                                            <div className="grid sm:grid-cols-2 gap-3">
                                                {TIPOS_CUIDADO.map((t) => (
                                                    <button key={t.value} onClick={() => { setForm({ ...form, tipoCuidado: t.value }); setErrors(e => { const { tipoCuidado: _, ...rest } = e; return rest; }); }}
                                                        className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 flex items-center gap-3 ${form.tipoCuidado === t.value
                                                            ? 'border-primary-500 bg-primary-50 shadow-md shadow-primary-100'
                                                            : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50'
                                                            }`}>
                                                        <span className="text-2xl">{t.icon}</span>
                                                        <span className="font-medium text-foreground text-sm">{t.label}</span>
                                                        {form.tipoCuidado === t.value && <span className="ml-auto text-primary-600 font-bold">✓</span>}
                                                    </button>
                                                ))}
                                            </div>
                                            {errors.tipoCuidado && <p className="text-error-600 text-sm mt-2">{errors.tipoCuidado}</p>}
                                        </div>
                                    </div>
                                )}

                                {/* ═══ STEP 4: Período, Urgência & Observações ═══ */}
                                {step === 4 && (
                                    <div>
                                        <h2 className="text-xl font-semibold mb-2">Detalhes do Atendimento</h2>
                                        <p className="text-muted-foreground text-sm mb-6">Informe o período desejado e a urgência.</p>

                                        {/* Período */}
                                        <div className="mb-6">
                                            <label className="block text-sm font-medium text-foreground mb-3">Período desejado *</label>
                                            <div className="grid gap-2">
                                                {PERIODOS.map((p) => (
                                                    <button key={p.value} onClick={() => { setForm({ ...form, periodo: p.value }); setErrors(e => { const { periodo: _, ...rest } = e; return rest; }); }}
                                                        className={`w-full text-left p-3.5 rounded-xl border-2 transition-all duration-200 flex items-center gap-3 text-sm ${form.periodo === p.value
                                                            ? 'border-primary-500 bg-primary-50 shadow-sm shadow-primary-100'
                                                            : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50'
                                                            }`}>
                                                        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${form.periodo === p.value ? 'border-primary-500 bg-primary-500' : 'border-neutral-300'}`}>
                                                            {form.periodo === p.value && <span className="w-2 h-2 bg-white rounded-full" />}
                                                        </span>
                                                        <span className="font-medium text-foreground">{p.label}</span>
                                                    </button>
                                                ))}
                                            </div>
                                            {errors.periodo && <p className="text-error-600 text-sm mt-2">{errors.periodo}</p>}
                                        </div>

                                        {/* Urgência */}
                                        <div className="mb-6">
                                            <label className="block text-sm font-medium text-foreground mb-3">Urgência *</label>
                                            <div className="grid gap-2">
                                                {URGENCIAS.map((u) => (
                                                    <button key={u.value} onClick={() => { setForm({ ...form, urgencia: u.value }); setErrors(e => { const { urgencia: _, ...rest } = e; return rest; }); }}
                                                        className={`w-full text-left p-3.5 rounded-xl border-2 transition-all duration-200 flex items-center gap-3 text-sm ${form.urgencia === u.value
                                                            ? u.value === 'URGENTE' ? 'border-error-400 bg-error-50 shadow-sm shadow-error-100' :
                                                                u.value === 'ALTA' ? 'border-warning-400 bg-warning-50 shadow-sm shadow-warning-100' :
                                                                    'border-primary-500 bg-primary-50 shadow-sm shadow-primary-100'
                                                            : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50'
                                                            }`}>
                                                        <span className="text-lg">{u.icon}</span>
                                                        <span className="font-medium text-foreground">{u.label}</span>
                                                        {form.urgencia === u.value && <span className="ml-auto text-primary-600 font-bold">✓</span>}
                                                    </button>
                                                ))}
                                            </div>
                                            {errors.urgencia && <p className="text-error-600 text-sm mt-2">{errors.urgencia}</p>}
                                        </div>

                                        {/* Observações */}
                                        <div>
                                            <label className="block text-sm font-medium text-foreground mb-1.5">Observações adicionais <span className="text-muted-foreground font-normal">(opcional)</span></label>
                                            <textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                                                placeholder="Conte-nos mais detalhes sobre suas necessidades específicas..."
                                                rows={4}
                                                className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all resize-none" />
                                        </div>
                                    </div>
                                )}

                                {/* Navigation */}
                                <div className="flex items-center justify-between mt-8 pt-6 border-t border-neutral-100">
                                    {step > 0 ? (
                                        <button onClick={handleBack} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-neutral-100 transition-all text-sm font-medium">
                                            ← Voltar
                                        </button>
                                    ) : <div />}
                                    <button onClick={handleNext} disabled={submitting}
                                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold active:scale-[0.97] transition-all shadow-md text-sm ${step === STEPS.length - 1
                                            ? 'bg-secondary-600 text-white hover:bg-secondary-700 shadow-green-200'
                                            : 'bg-primary-600 text-white hover:bg-primary-700 shadow-primary-200'
                                            } ${submitting ? 'opacity-70 cursor-wait' : ''}`}>
                                        {submitting ? (
                                            <>
                                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Enviando...
                                            </>
                                        ) : step === STEPS.length - 1 ? (
                                            '✅ Enviar Solicitação'
                                        ) : (
                                            'Próximo →'
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Trust indicators */}
                <div className="mt-8 flex items-center justify-center gap-6 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">🔒 Dados protegidos</span>
                    <span className="flex items-center gap-1.5">⚡ Resposta rápida</span>
                    <span className="flex items-center gap-1.5">📞 Sem compromisso</span>
                </div>
            </main>

            <footer className="border-t border-neutral-100 mt-12 py-6 text-center text-sm text-muted-foreground">
                © {new Date().getFullYear()} Mãos Amigas — Especialistas em Cuidado de Idosos
            </footer>
        </div>
    );
}
