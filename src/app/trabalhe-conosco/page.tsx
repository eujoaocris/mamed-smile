'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

// ── Same quiz questions from handlers/quiz.ts ──
const QUESTIONS = [
    { id: 1, text: "Um paciente idoso engasgou durante a refeição. Qual a primeira ação?", options: ["Dar água imediatamente", "Aplicar a manobra de Heimlich", "Colocar deitado", "Ligar para o SAMU"], correct: 2 },
    { id: 2, text: "Qual a frequência ideal para mudança de decúbito em paciente acamado?", options: ["A cada 30 minutos", "A cada 2 horas", "A cada 6 horas", "Uma vez por dia"], correct: 2 },
    { id: 3, text: "O que é PA (Pressão Arterial) considerada normal para um adulto?", options: ["120x80 mmHg", "160x100 mmHg", "90x50 mmHg", "200x120 mmHg"], correct: 1 },
    { id: 4, text: "Qual destas NÃO é uma atribuição do cuidador?", options: ["Auxiliar no banho", "Administrar medicação oral prescrita", "Prescrever medicamentos", "Fazer companhia"], correct: 3 },
    { id: 5, text: "O paciente apresenta febre alta (39°C). O que fazer imediatamente?", options: ["Dar antibiótico por conta própria", "Cobrir o paciente com cobertores", "Informar familiar/responsável e realizar compressas frias", "Ignorar pois passa logo"], correct: 3 },
    { id: 6, text: "Sinais de AVC (Derrame) incluem:", options: ["Dor no pé", "Assimetria facial, perda de força em um lado, fala enrolada", "Espirros constantes", "Fome excessiva"], correct: 2 },
    { id: 7, text: "O que é Hipoglicemia?", options: ["Açúcar alto no sangue", "Açúcar baixo no sangue", "Pressão alta", "Batimento cardíaco rápido"], correct: 2 },
    { id: 8, text: "Para prevenir úlceras de pressão (escaras), deve-se:", options: ["Manter a pele úmida", "Deixar o paciente na mesma posição", "Manter pele limpa, seca e hidratada, e mudar decúbito", "Usar colchão muito duro"], correct: 3 },
    { id: 9, text: "Qual via de administração é usada para insulina?", options: ["Oral (Comprimido)", "Subcutânea (Injeção)", "Tópica (Pomada)", "Ocular (Colírio)"], correct: 2 },
    { id: 10, text: "Ao verificar que o paciente não respira e não tem pulso, você deve:", options: ["Esperar voltar sozinho", "Iniciar RCP (Ressuscitação) e chamar ajuda", "Dar um copo d'água", "Ir embora"], correct: 2 },
    { id: 11, text: "O que significa GTT?", options: ["Gastrostomia (Sonda no estômago)", "Gripe Total", "Grande Tratamento Térmico", "Gaze Tamanho Total"], correct: 1 },
    { id: 12, text: "Paciente com Alzheimer agressivo. Como proceder?", options: ["Gritar com ele", "Prender no quarto", "Manter a calma, não confrontar e distrair", "Agredir de volta"], correct: 3 },
    { id: 13, text: "Qual a posição correta para alimentar um paciente no leito?", options: ["Totalmente deitado (Horizontal)", "Sentado ou elevado (Fowler - 45° a 90°)", "De barriga para baixo", "De cabeça para baixo"], correct: 2 },
    { id: 14, text: "Saturação de oxigênio normal em ar ambiente é:", options: ["Abaixo de 80%", "Entre 95% e 100%", "50%", "10%"], correct: 2 },
    { id: 15, text: "Frequência Cardíaca (FC) normal em repouso varia geralmente entre:", options: ["10 e 20 bpm", "60 e 100 bpm", "150 e 200 bpm", "0 bpm"], correct: 2 },
];

const AREAS = [
    { value: 'CUIDADOR', label: 'Cuidador(a) de Idosos', icon: '👴' },
    { value: 'TECNICO_ENF', label: 'Técnico(a) de Enfermagem', icon: '💉' },
    { value: 'AUXILIAR_ENF', label: 'Auxiliar de Enfermagem', icon: '🩺' },
    { value: 'ENFERMEIRO', label: 'Enfermeiro(a)', icon: '👩‍⚕️' },
    { value: 'OUTRO', label: 'Outro', icon: '📋' },
];

const PASSING_SCORE = 70;

type Phase = 'cadastro' | 'quiz' | 'resultado';

interface FormData {
    area: string;
    nome: string;
    cpf: string;
    email: string;
    coren: string;
    cidade: string;
    bairros: string;
    telefone: string;
}

const INITIAL_FORM: FormData = {
    area: '', nome: '', cpf: '', email: '',
    coren: '', cidade: '', bairros: '', telefone: '',
};

const CADASTRO_STEPS = [
    { key: 'area', label: 'Área de Atuação', icon: '💼' },
    { key: 'nome', label: 'Dados Pessoais', icon: '👤' },
    { key: 'contato', label: 'Contato', icon: '📱' },
    { key: 'profissional', label: 'Registro Profissional', icon: '🏥' },
    { key: 'localizacao', label: 'Localização', icon: '📍' },
];

function formatCPF(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatPhone(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export default function TrabalheConoscoPage() {
    const [phase, setPhase] = useState<Phase>('cadastro');
    const [step, setStep] = useState(0);
    const [form, setForm] = useState<FormData>(INITIAL_FORM);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [quizIndex, setQuizIndex] = useState(0);
    const [answers, setAnswers] = useState<number[]>([]);
    const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
    const [showFeedback, setShowFeedback] = useState(false);
    const [score, setScore] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [animating, setAnimating] = useState(false);

    const animateTransition = (callback: () => void) => {
        setAnimating(true);
        setTimeout(() => { callback(); setAnimating(false); }, 250);
    };

    // ── Validation ──
    const validateStep = (): boolean => {
        const e: Record<string, string> = {};
        if (step === 0 && !form.area) e.area = 'Selecione sua área de atuação';
        if (step === 1) {
            if (!form.nome || form.nome.trim().length < 3) e.nome = 'Informe seu nome completo';
        }
        if (step === 2) {
            const cpfDigits = form.cpf.replace(/\D/g, '');
            if (cpfDigits.length !== 11) e.cpf = 'CPF deve ter 11 dígitos';
            if (!form.telefone || form.telefone.replace(/\D/g, '').length < 10) e.telefone = 'Telefone inválido';
            if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Email inválido';
        }
        if (step === 4) {
            if (!form.cidade || form.cidade.trim().length < 2) e.cidade = 'Informe sua cidade';
            if (!form.bairros || form.bairros.trim().length < 2) e.bairros = 'Informe os bairros';
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleNext = () => {
        if (!validateStep()) return;
        if (step < CADASTRO_STEPS.length - 1) {
            animateTransition(() => setStep(s => s + 1));
        } else {
            // Start quiz
            animateTransition(() => setPhase('quiz'));
        }
    };

    const handleBack = () => {
        if (step > 0) animateTransition(() => setStep(s => s - 1));
    };

    const handleAnswerSelect = (answerIndex: number) => {
        if (showFeedback) return;
        setSelectedAnswer(answerIndex);
    };

    const handleConfirmAnswer = () => {
        if (selectedAnswer === null) return;
        const q = QUESTIONS[quizIndex];
        const isCorrect = selectedAnswer === q.correct;
        const newScore = score + (isCorrect ? 1 : 0);
        setScore(newScore);
        setShowFeedback(true);

        setTimeout(() => {
            const newAnswers = [...answers, selectedAnswer];
            setAnswers(newAnswers);
            setSelectedAnswer(null);
            setShowFeedback(false);

            if (quizIndex + 1 >= QUESTIONS.length) {
                animateTransition(() => {
                    setScore(newScore);
                    setPhase('resultado');
                });
            } else {
                animateTransition(() => setQuizIndex(i => i + 1));
            }
        }, 1200);
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            await fetch('/api/candidatos/web', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    cpf: form.cpf.replace(/\D/g, ''),
                    telefone: form.telefone.replace(/\D/g, ''),
                    quizScore: Math.round((score / QUESTIONS.length) * 100),
                    quizPassed: Math.round((score / QUESTIONS.length) * 100) >= PASSING_SCORE,
                }),
            });
            setSubmitted(true);
        } catch {
            // still show success for UX
            setSubmitted(true);
        } finally {
            setSubmitting(false);
        }
    };

    const percentage = Math.round((score / QUESTIONS.length) * 100);
    const passed = percentage >= PASSING_SCORE;

    // Auto-submit on result
    useEffect(() => {
        if (phase === 'resultado' && !submitted && !submitting) {
            handleSubmit();
        }
    }, [phase]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50">
            {/* Header */}
            <header className="bg-white/80 backdrop-blur-md border-b border-primary-100 sticky top-0 z-50">
                <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 group">
                        <span className="text-2xl">🤝</span>
                        <span className="text-xl font-bold text-primary-800 group-hover:text-primary-600 transition-colors">Mãos Amigas</span>
                    </Link>
                    <span className="text-sm text-muted-foreground hidden sm:inline">Processo Seletivo Online</span>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
                {/* Hero Section */}
                {phase === 'cadastro' && step === 0 && (
                    <div className="text-center mb-10" style={{ animation: 'fade-in-up 0.5s ease both' }}>
                        <div className="inline-flex items-center gap-2 bg-primary-100 text-primary-800 px-4 py-1.5 rounded-full text-sm font-medium mb-4">
                            <span className="w-2 h-2 bg-primary-500 rounded-full animate-pulse" />
                            Vagas Abertas
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3" style={{ letterSpacing: '-0.03em' }}>
                            Faça Parte da Nossa Equipe
                        </h1>
                        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                            Cadastre-se, faça o teste de competência e entre para o time de profissionais da Mãos Amigas.
                        </p>
                    </div>
                )}

                {/* Phase Indicator */}
                <div className="flex items-center justify-center gap-3 mb-8">
                    {[
                        { label: 'Cadastro', phase: 'cadastro' as Phase, icon: '📋' },
                        { label: 'Quiz', phase: 'quiz' as Phase, icon: '📝' },
                        { label: 'Resultado', phase: 'resultado' as Phase, icon: '🎯' },
                    ].map((p, i) => (
                        <div key={p.phase} className="flex items-center gap-3">
                            {i > 0 && <div className={`w-8 sm:w-12 h-0.5 rounded-full transition-colors duration-500 ${['cadastro', 'quiz', 'resultado'].indexOf(phase) >= i ? 'bg-primary-500' : 'bg-neutral-200'
                                }`} />}
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-500 ${phase === p.phase ? 'bg-primary-600 text-white shadow-md shadow-primary-200' :
                                    ['cadastro', 'quiz', 'resultado'].indexOf(phase) > i ? 'bg-primary-100 text-primary-700' :
                                        'bg-neutral-100 text-neutral-400'
                                }`}>
                                <span>{p.icon}</span>
                                <span className="hidden sm:inline">{p.label}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* ═══════ CADASTRO ═══════ */}
                {phase === 'cadastro' && (
                    <div className={`transition-all duration-250 ${animating ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0'}`}>
                        {/* Step Progress */}
                        <div className="mb-6">
                            <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                                <span>{CADASTRO_STEPS[step].icon} {CADASTRO_STEPS[step].label}</span>
                                <span>{step + 1} de {CADASTRO_STEPS.length}</span>
                            </div>
                            <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full transition-all duration-500 ease-out" style={{ width: `${((step + 1) / CADASTRO_STEPS.length) * 100}%` }} />
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl shadow-lg shadow-primary-100/50 border border-primary-50 p-6 sm:p-8">
                            {/* Step 0: Área */}
                            {step === 0 && (
                                <div>
                                    <h2 className="text-xl font-semibold mb-2">Qual sua área de atuação?</h2>
                                    <p className="text-muted-foreground text-sm mb-6">Selecione a área que melhor descreve sua formação profissional.</p>
                                    <div className="grid gap-3">
                                        {AREAS.map((a) => (
                                            <button key={a.value} onClick={() => { setForm({ ...form, area: a.value }); setErrors({}); }}
                                                className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 flex items-center gap-4 group ${form.area === a.value
                                                        ? 'border-primary-500 bg-primary-50 shadow-md shadow-primary-100'
                                                        : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50'
                                                    }`}>
                                                <span className="text-2xl">{a.icon}</span>
                                                <span className="font-medium text-foreground">{a.label}</span>
                                                {form.area === a.value && (
                                                    <span className="ml-auto text-primary-600 font-bold text-lg">✓</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                    {errors.area && <p className="text-error-600 text-sm mt-3">{errors.area}</p>}
                                </div>
                            )}

                            {/* Step 1: Nome */}
                            {step === 1 && (
                                <div>
                                    <h2 className="text-xl font-semibold mb-2">Dados Pessoais</h2>
                                    <p className="text-muted-foreground text-sm mb-6">Precisamos do seu nome completo.</p>
                                    <div>
                                        <label className="block text-sm font-medium text-foreground mb-1.5">Nome Completo *</label>
                                        <input type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                                            placeholder="Maria da Silva Santos"
                                            className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all" />
                                        {errors.nome && <p className="text-error-600 text-sm mt-1.5">{errors.nome}</p>}
                                    </div>
                                </div>
                            )}

                            {/* Step 2: Contato */}
                            {step === 2 && (
                                <div>
                                    <h2 className="text-xl font-semibold mb-2">Informações de Contato</h2>
                                    <p className="text-muted-foreground text-sm mb-6">Como podemos entrar em contato com você.</p>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-foreground mb-1.5">CPF *</label>
                                            <input type="text" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: formatCPF(e.target.value) })}
                                                placeholder="000.000.000-00" maxLength={14}
                                                className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all font-mono" />
                                            {errors.cpf && <p className="text-error-600 text-sm mt-1">{errors.cpf}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-foreground mb-1.5">Telefone / WhatsApp *</label>
                                            <input type="text" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: formatPhone(e.target.value) })}
                                                placeholder="(00) 00000-0000" maxLength={15}
                                                className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all font-mono" />
                                            {errors.telefone && <p className="text-error-600 text-sm mt-1">{errors.telefone}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-foreground mb-1.5">Email *</label>
                                            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                                                placeholder="seu@email.com"
                                                className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all" />
                                            {errors.email && <p className="text-error-600 text-sm mt-1">{errors.email}</p>}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Step 3: Registro Profissional */}
                            {step === 3 && (
                                <div>
                                    <h2 className="text-xl font-semibold mb-2">Registro Profissional</h2>
                                    <p className="text-muted-foreground text-sm mb-6">Se você possui COREN, informe o número. Caso contrário, deixe em branco.</p>
                                    <div>
                                        <label className="block text-sm font-medium text-foreground mb-1.5">Número do COREN <span className="text-muted-foreground font-normal">(opcional)</span></label>
                                        <input type="text" value={form.coren} onChange={(e) => setForm({ ...form, coren: e.target.value })}
                                            placeholder="Ex: COREN-SP 123456"
                                            className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all" />
                                        <p className="text-sm text-muted-foreground mt-2">Não obrigatório para Cuidadores de Idosos.</p>
                                    </div>
                                </div>
                            )}

                            {/* Step 4: Localização */}
                            {step === 4 && (
                                <div>
                                    <h2 className="text-xl font-semibold mb-2">Localização</h2>
                                    <p className="text-muted-foreground text-sm mb-6">Onde você pode atender pacientes?</p>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-foreground mb-1.5">Cidade *</label>
                                            <input type="text" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                                                placeholder="Ex: Toledo"
                                                className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all" />
                                            {errors.cidade && <p className="text-error-600 text-sm mt-1">{errors.cidade}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-foreground mb-1.5">Bairros que atende *</label>
                                            <input type="text" value={form.bairros} onChange={(e) => setForm({ ...form, bairros: e.target.value })}
                                                placeholder="Centro, Jardim Europa, Vila Industrial"
                                                className="w-full px-4 py-3 rounded-xl border border-neutral-300 text-foreground placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all" />
                                            <p className="text-sm text-muted-foreground mt-1">Separe os bairros por vírgula.</p>
                                            {errors.bairros && <p className="text-error-600 text-sm mt-1">{errors.bairros}</p>}
                                        </div>
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
                                <button onClick={handleNext}
                                    className="flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 active:scale-[0.97] transition-all shadow-md shadow-primary-200 text-sm">
                                    {step === CADASTRO_STEPS.length - 1 ? 'Iniciar Quiz →' : 'Próximo →'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══════ QUIZ ═══════ */}
                {phase === 'quiz' && (
                    <div className={`transition-all duration-250 ${animating ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0'}`}>
                        {/* Quiz Progress */}
                        <div className="mb-6">
                            <div className="flex items-center justify-between text-sm mb-2">
                                <span className="text-muted-foreground">Pergunta {quizIndex + 1} de {QUESTIONS.length}</span>
                                <span className="font-medium text-primary-700">{Math.round(((quizIndex) / QUESTIONS.length) * 100)}% concluído</span>
                            </div>
                            <div className="h-2.5 bg-neutral-100 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-700 ease-out" style={{ width: `${((quizIndex + 1) / QUESTIONS.length) * 100}%` }} />
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl shadow-lg shadow-primary-100/50 border border-primary-50 overflow-hidden">
                            {/* Question Header */}
                            <div className="bg-gradient-to-r from-primary-700 to-primary-600 px-6 sm:px-8 py-5">
                                <div className="flex items-start gap-3">
                                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20 text-white font-bold text-sm flex-shrink-0 mt-0.5">
                                        {quizIndex + 1}
                                    </span>
                                    <h2 className="text-white font-medium text-lg leading-snug">
                                        {QUESTIONS[quizIndex].text}
                                    </h2>
                                </div>
                            </div>

                            {/* Options */}
                            <div className="p-6 sm:p-8 space-y-3">
                                {QUESTIONS[quizIndex].options.map((opt, i) => {
                                    const optionNum = i + 1;
                                    const isSelected = selectedAnswer === optionNum;
                                    const isCorrect = QUESTIONS[quizIndex].correct === optionNum;

                                    let borderClass = 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50';
                                    let iconBg = 'bg-neutral-100 text-neutral-500';

                                    if (showFeedback) {
                                        if (isCorrect) {
                                            borderClass = 'border-success-500 bg-success-50';
                                            iconBg = 'bg-success-500 text-white';
                                        } else if (isSelected && !isCorrect) {
                                            borderClass = 'border-error-400 bg-error-50';
                                            iconBg = 'bg-error-500 text-white';
                                        } else {
                                            borderClass = 'border-neutral-100 opacity-50';
                                        }
                                    } else if (isSelected) {
                                        borderClass = 'border-primary-500 bg-primary-50 shadow-md shadow-primary-100';
                                        iconBg = 'bg-primary-600 text-white';
                                    }

                                    return (
                                        <button key={i} onClick={() => handleAnswerSelect(optionNum)} disabled={showFeedback}
                                            className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 flex items-center gap-4 ${borderClass}`}>
                                            <span className={`flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm flex-shrink-0 transition-all ${iconBg}`}>
                                                {showFeedback && isCorrect ? '✓' : showFeedback && isSelected && !isCorrect ? '✗' : String.fromCharCode(65 + i)}
                                            </span>
                                            <span className="text-foreground text-sm sm:text-base">{opt}</span>
                                        </button>
                                    );
                                })}

                                {/* Confirm Button */}
                                {!showFeedback && (
                                    <div className="pt-4 flex justify-end">
                                        <button onClick={handleConfirmAnswer} disabled={selectedAnswer === null}
                                            className={`px-6 py-3 rounded-xl font-semibold text-sm transition-all ${selectedAnswer !== null
                                                    ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-md shadow-primary-200 active:scale-[0.97]'
                                                    : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                                                }`}>
                                            Confirmar Resposta
                                        </button>
                                    </div>
                                )}

                                {/* Feedback Message */}
                                {showFeedback && (
                                    <div className={`mt-4 p-4 rounded-xl text-sm font-medium flex items-center gap-3 ${selectedAnswer === QUESTIONS[quizIndex].correct
                                            ? 'bg-success-50 text-success-700 border border-success-200'
                                            : 'bg-error-50 text-error-700 border border-error-200'
                                        }`} style={{ animation: 'scale-in 0.3s ease' }}>
                                        <span className="text-xl">{selectedAnswer === QUESTIONS[quizIndex].correct ? '✅' : '❌'}</span>
                                        {selectedAnswer === QUESTIONS[quizIndex].correct ? 'Resposta correta!' : `Resposta incorreta. A correta era: ${QUESTIONS[quizIndex].options[QUESTIONS[quizIndex].correct - 1]}`}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Score Counter */}
                        <div className="mt-4 flex items-center justify-center gap-6 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1.5">✅ <strong className="text-success-600">{score}</strong> acertos</span>
                            <span className="flex items-center gap-1.5">❌ <strong className="text-error-500">{answers.length - score}</strong> erros</span>
                        </div>
                    </div>
                )}

                {/* ═══════ RESULTADO ═══════ */}
                {phase === 'resultado' && (
                    <div className={`transition-all duration-250 ${animating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
                        <div className="bg-white rounded-2xl shadow-lg shadow-primary-100/50 border border-primary-50 overflow-hidden">
                            {/* Result Header */}
                            <div className={`px-6 sm:px-8 py-8 text-center ${passed ? 'bg-gradient-to-br from-success-600 to-primary-700' : 'bg-gradient-to-br from-warning-600 to-accent-600'
                                }`}>
                                <div className="text-6xl mb-4" style={{ animation: 'scale-in 0.5s ease' }}>
                                    {passed ? '🎉' : '📚'}
                                </div>
                                <h2 className="text-2xl font-bold text-white mb-2">
                                    {passed ? 'Parabéns! Você foi aprovado(a)!' : 'Resultado Insuficiente'}
                                </h2>
                                <p className="text-white/80">
                                    {passed ? 'Seu perfil foi encaminhado para o RH.' : 'Estude mais e tente novamente.'}
                                </p>
                            </div>

                            {/* Score Display */}
                            <div className="px-6 sm:px-8 py-8">
                                <div className="flex items-center justify-center gap-8 mb-8">
                                    <div className="text-center">
                                        <div className={`text-5xl font-bold ${passed ? 'text-success-600' : 'text-warning-600'}`} style={{ animation: 'count-up 0.5s ease' }}>
                                            {percentage}%
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-1">Sua Pontuação</p>
                                    </div>
                                    <div className="w-px h-16 bg-neutral-200" />
                                    <div className="text-center">
                                        <div className="text-5xl font-bold text-neutral-300">{PASSING_SCORE}%</div>
                                        <p className="text-sm text-muted-foreground mt-1">Mínimo Exigido</p>
                                    </div>
                                </div>

                                {/* Stats Grid */}
                                <div className="grid grid-cols-3 gap-4 mb-8">
                                    <div className="bg-success-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-success-600">{score}</p>
                                        <p className="text-xs text-success-700 mt-1">Acertos</p>
                                    </div>
                                    <div className="bg-error-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-error-500">{QUESTIONS.length - score}</p>
                                        <p className="text-xs text-error-700 mt-1">Erros</p>
                                    </div>
                                    <div className="bg-primary-50 rounded-xl p-4 text-center">
                                        <p className="text-2xl font-bold text-primary-700">{QUESTIONS.length}</p>
                                        <p className="text-xs text-primary-800 mt-1">Total</p>
                                    </div>
                                </div>

                                {/* Resumo do Cadastro */}
                                <div className="bg-neutral-50 rounded-xl p-5 mb-6">
                                    <h3 className="font-semibold text-foreground mb-3">📋 Resumo do Cadastro</h3>
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div><span className="text-muted-foreground">Nome:</span> <strong>{form.nome}</strong></div>
                                        <div><span className="text-muted-foreground">Área:</span> <strong>{AREAS.find(a => a.value === form.area)?.label}</strong></div>
                                        <div><span className="text-muted-foreground">Cidade:</span> <strong>{form.cidade}</strong></div>
                                        <div><span className="text-muted-foreground">Email:</span> <strong>{form.email}</strong></div>
                                        <div className="col-span-2"><span className="text-muted-foreground">Bairros:</span> <strong>{form.bairros}</strong></div>
                                    </div>
                                </div>

                                {/* Status */}
                                <div className={`p-4 rounded-xl text-center ${passed ? 'bg-success-50 border border-success-200' : 'bg-warning-50 border border-warning-200'
                                    }`}>
                                    <p className={`font-medium ${passed ? 'text-success-700' : 'text-warning-700'}`}>
                                        {passed
                                            ? '✅ Status: AGUARDANDO RH — Nossa equipe entrará em contato para agendar a entrevista.'
                                            : '⏳ Você pode tentar novamente. Estude as respostas e refaça o teste.'}
                                    </p>
                                </div>

                                {/* Actions */}
                                <div className="flex flex-col sm:flex-row gap-3 mt-6">
                                    {!passed && (
                                        <button onClick={() => { setPhase('quiz'); setQuizIndex(0); setAnswers([]); setScore(0); setSelectedAnswer(null); setShowFeedback(false); setSubmitted(false); }}
                                            className="flex-1 px-6 py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 active:scale-[0.97] transition-all shadow-md shadow-primary-200 text-center">
                                            🔄 Refazer Quiz
                                        </button>
                                    )}
                                    <Link href="/" className="flex-1 px-6 py-3 border-2 border-neutral-200 text-foreground rounded-xl font-semibold hover:bg-neutral-50 transition-all text-center">
                                        ← Voltar ao Site
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="border-t border-neutral-100 mt-12 py-6 text-center text-sm text-muted-foreground">
                © {new Date().getFullYear()} Mãos Amigas — Cuidadores e Home Care
            </footer>
        </div>
    );
}
