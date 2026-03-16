import { prisma } from '@/lib/prisma';
import { sendMessage } from '@/lib/whatsapp/client';
import { getUserState } from '@/lib/whatsapp/state-manager';
import { notifyAdminHelp } from '@/lib/notifications/emergency';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// In-memory fallback when database is unavailable
const memoryStore = new Map<string, { state: ConversationState; data: ConversationData; lastActivity: number }>();
const USE_MOCK = process.env.USE_MOCK_DB === 'true';
const LEAD_COMPATIBLE_STATUSES = new Set([
    'LEAD',
    'AVALIACAO',
    'PROPOSTA_ENVIADA',
    'CONTRATO_ENVIADO',
]);

type ConversationState =
    | 'MENU'
    | 'ORCAMENTO_RESPONSAVEL'
    | 'ORCAMENTO_NOME'
    | 'ORCAMENTO_IDADE'
    | 'ORCAMENTO_TIPO_CUIDADO'
    | 'ORCAMENTO_URGENCIA'
    | 'ORCAMENTO_CARGA_HORARIA'
    | 'ORCAMENTO_ENDERECO'
    | 'ORCAMENTO_DATA_INICIO'
    | 'ORCAMENTO_TELEFONE'
    | 'ORCAMENTO_OBSERVACOES'
    | 'ORCAMENTO_CONFIRMACAO';

type LeadPriority = 'NORMAL' | 'ALTA' | 'URGENTE';

interface ConversationData {
    nomeResponsavel?: string;
    nomePaciente?: string;
    idadePaciente?: number;
    tipoCuidadoCodigo?: string;
    tipoCuidadoLabel?: string;
    urgenciaLabel?: string;
    prioridade?: LeadPriority;
    cargaHorariaLabel?: string;
    endereco?: string;
    dataInicio?: string;
    telefoneContato?: string;
    observacoes?: string;
}

interface IncomingMessage {
    jid: string;
    phone: string;
    text: string;
}

const MAIN_MENU_TEXT = [
    '*Maos Amigas - Atendimento Comercial*',
    '',
    'Como posso te ajudar agora?',
    '',
    '1 - Conhecer servicos',
    '2 - Iniciar cadastro para orcamento',
    '3 - Horarios e cobertura',
    '4 - Falar com consultor humano',
    '',
    'Comandos rapidos: MENU, ORCAMENTO, AJUDA',
].join('\n');

const SERVICES_TEXT = [
    '*Nossos Servicos*',
    '',
    '- Cuidador domiciliar (6h, 12h e 24h)',
    '- Acompanhamento hospitalar',
    '- Suporte para idosos e pos-operatorio',
    '- Supervisao de enfermagem',
    '',
    'Para iniciar cadastro, digite 2.',
].join('\n');

const HOURS_TEXT = [
    '*Horarios de Atendimento*',
    '',
    'Segunda a Sexta: 08:00 as 18:00',
    'Sabado: 08:00 as 12:00',
    'Plantao comercial emergencial: 24h',
    '',
    'Digite MENU para voltar.',
].join('\n');

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function extractPhoneFromJid(jid: string): string {
    return jid.split('@')[0].replace(/\D/g, '');
}

function sanitizePhone(value: string): string {
    return value.replace(/\D/g, '');
}

function isGreeting(text: string): boolean {
    const normalized = normalizeText(text);
    return ['oi', 'oii', 'ola', 'olaa', 'bom dia', 'boa tarde', 'boa noite', 'hey'].includes(normalized);
}

function isMenuCommand(text: string): boolean {
    const normalized = normalizeText(text);
    return ['menu', 'inicio', 'iniciar', 'voltar'].includes(normalized);
}

function isResetCommand(text: string): boolean {
    const normalized = normalizeText(text);
    return ['cancelar', 'sair', 'parar', 'reiniciar', 'resetar'].includes(normalized);
}

function isBudgetCommand(text: string): boolean {
    const normalized = normalizeText(text);
    return ['2', 'orcamento', 'solicitar orcamento', 'simular', 'cotacao', 'preco', 'valor'].includes(normalized);
}

function isHumanCommand(text: string): boolean {
    const normalized = normalizeText(text);
    return ['4', 'ajuda', 'atendente', 'humano', 'consultor', 'falar'].includes(normalized);
}

function isHoursCommand(text: string): boolean {
    const normalized = normalizeText(text);
    return ['3', 'horario', 'funcionamento', 'cobertura'].includes(normalized);
}

function isServiceCommand(text: string): boolean {
    const normalized = normalizeText(text);
    return ['1', 'servicos', 'servico'].includes(normalized);
}

function parseConversationData(raw: string | null): ConversationData {
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed as ConversationData;
        }
    } catch {
        // keep empty data when JSON is invalid
    }

    return {};
}

function parseLocation(raw: string | undefined): { cidade?: string; bairro?: string } {
    if (!raw) return {};
    const trimmed = raw.trim();
    if (!trimmed) return {};

    const splitter = trimmed.includes(',') ? ',' : trimmed.includes('-') ? '-' : null;
    if (!splitter) return { cidade: trimmed };

    const parts = trimmed.split(splitter).map((part) => part.trim()).filter(Boolean);
    return {
        cidade: parts[0],
        bairro: parts[1],
    };
}

function parseCareType(text: string): { code: string; label: string } | null {
    const normalized = normalizeText(text);
    const explicitMap: Record<string, { code: string; label: string }> = {
        '1': { code: 'HOME_CARE', label: 'Cuidador domiciliar' },
        '2': { code: 'HOSPITAL', label: 'Acompanhamento hospitalar' },
        '3': { code: 'POS_OPERATORIO', label: 'Pos-operatorio/reabilitacao' },
        domiciliar: { code: 'HOME_CARE', label: 'Cuidador domiciliar' },
        hospitalar: { code: 'HOSPITAL', label: 'Acompanhamento hospitalar' },
        hospital: { code: 'HOSPITAL', label: 'Acompanhamento hospitalar' },
        reabilitacao: { code: 'POS_OPERATORIO', label: 'Pos-operatorio/reabilitacao' },
    };

    if (explicitMap[normalized]) {
        return explicitMap[normalized];
    }

    const custom = text.trim();
    if (custom.length >= 4) {
        return { code: 'HOME_CARE', label: custom };
    }

    return null;
}

function parseUrgency(text: string): { label: string; priority: LeadPriority } | null {
    const normalized = normalizeText(text);
    const map: Record<string, { label: string; priority: LeadPriority }> = {
        '1': { label: 'Alta (inicio em ate 24h)', priority: 'URGENTE' },
        '2': { label: 'Media (inicio nesta semana)', priority: 'ALTA' },
        '3': { label: 'Baixa (sem urgencia)', priority: 'NORMAL' },
        urgente: { label: 'Alta (inicio em ate 24h)', priority: 'URGENTE' },
        emergencia: { label: 'Alta (inicio em ate 24h)', priority: 'URGENTE' },
        planejado: { label: 'Baixa (sem urgencia)', priority: 'NORMAL' },
    };

    return map[normalized] || null;
}

function parseWorkload(text: string): string | null {
    const normalized = normalizeText(text);
    const map: Record<string, string> = {
        '1': '6h por dia',
        '2': '12h por dia',
        '3': '24h por dia',
    };

    if (map[normalized]) {
        return map[normalized];
    }

    const custom = text.trim();
    if (custom.length >= 2) {
        return custom;
    }

    return null;
}

function parseStartDate(text: string): string | null {
    const normalized = normalizeText(text);
    if (['hoje', 'imediato', 'agora'].includes(normalized)) return 'Hoje';
    if (['amanha', 'amanha cedo'].includes(normalized)) return 'Amanha';

    const raw = text.trim();
    if (/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(raw)) {
        return raw.replace(/-/g, '/');
    }

    if (raw.length >= 3) {
        return raw;
    }

    return null;
}

async function saveSession(phone: string, state: ConversationState, data: ConversationData) {
    memoryStore.set(phone, { state, data, lastActivity: Date.now() });

    if (USE_MOCK) return;

    try {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS);

        await prisma.whatsAppSession.upsert({
            where: { phone },
            update: {
                state,
                data: JSON.stringify(data),
                lastActivity: now,
                expiresAt,
            },
            create: {
                phone,
                state,
                data: JSON.stringify(data),
                lastActivity: now,
                expiresAt,
            },
        });
    } catch (err) {
        console.warn('[bot] DB saveSession failed, using memory fallback:', (err as Error).message?.slice(0, 80));
    }
}

async function loadSession(
    phone: string
): Promise<{ state: ConversationState; data: ConversationData; hasRecord: boolean }> {
    // Try memory store first
    const mem = memoryStore.get(phone);
    if (mem) {
        const expired = Date.now() - mem.lastActivity > SESSION_TIMEOUT_MS;
        if (expired) {
            memoryStore.delete(phone);
            return { state: 'MENU', data: {}, hasRecord: false };
        }
        return { state: mem.state, data: mem.data, hasRecord: true };
    }

    if (USE_MOCK) return { state: 'MENU', data: {}, hasRecord: false };

    try {
        const session = await prisma.whatsAppSession.findUnique({ where: { phone } });
        if (!session) return { state: 'MENU', data: {}, hasRecord: false };

        const now = Date.now();
        const lastActivity = session.lastActivity?.getTime() || session.updatedAt.getTime();
        const expiredByInactivity = now - lastActivity > SESSION_TIMEOUT_MS;
        const expiredByDate = session.expiresAt ? session.expiresAt.getTime() < now : false;

        if (expiredByInactivity || expiredByDate) {
            return { state: 'MENU', data: {}, hasRecord: false };
        }

        const state = (session.state || 'MENU') as ConversationState;
        const data = parseConversationData(session.data);
        return { state, data, hasRecord: true };
    } catch (err) {
        console.warn('[bot] DB loadSession failed, using memory fallback:', (err as Error).message?.slice(0, 80));
        return { state: 'MENU', data: {}, hasRecord: false };
    }
}

async function logIncoming(jid: string, text: string, state: string) {
    if (USE_MOCK) return;
    try {
        await prisma.mensagem.create({
            data: {
                telefone: jid,
                direcao: 'IN',
                conteudo: text,
                flow: 'BOT_ATENDIMENTO',
                step: state,
            },
        });
    } catch {
        // silently skip logging when DB is down
    }
}

async function sendAndTrack(jid: string, text: string): Promise<boolean> {
    const result = await sendMessage(jid, text);
    return result.success;
}

async function syncLeadDraft(whatsappPhone: string, data: ConversationData) {
    if (USE_MOCK) return;
    try {
        const phone = sanitizePhone(whatsappPhone);
        if (phone.length < 10) return;

        const existing = await prisma.paciente.findUnique({
            where: { telefone: phone },
            select: { status: true },
        });

        if (existing && !LEAD_COMPATIBLE_STATUSES.has(existing.status)) {
            return;
        }

        const location = parseLocation(data.endereco);
        const patientName = data.nomePaciente || data.nomeResponsavel || 'Lead WhatsApp';
        const tipo = data.tipoCuidadoCodigo || 'HOME_CARE';
        const prioridade = data.prioridade || 'NORMAL';

        await prisma.paciente.upsert({
            where: { telefone: phone },
            update: {
                nome: patientName,
                cidade: location.cidade || undefined,
                bairro: location.bairro || undefined,
                tipo,
                prioridade,
                status: 'LEAD',
            },
            create: {
                telefone: phone,
                nome: patientName,
                cidade: location.cidade || null,
                bairro: location.bairro || null,
                tipo,
                prioridade,
                status: 'LEAD',
            },
        });
    } catch {
        // silently skip sync when DB is down
    }
}

async function finalizeLeadFromBudget(whatsappPhone: string, data: ConversationData) {
    await syncLeadDraft(whatsappPhone, data);

    if (USE_MOCK) return;

    try {
        const phone = sanitizePhone(whatsappPhone);
        const patientName = data.nomePaciente || data.nomeResponsavel || 'Lead WhatsApp';
        const contactPhone = sanitizePhone(data.telefoneContato || '') || phone;

        await prisma.formSubmission.create({
            data: {
                tipo: 'ORCAMENTO_WHATSAPP',
                telefone: phone,
                dados: JSON.stringify({
                    ...data,
                    whatsappPhone: phone,
                    contactPhone,
                    submittedAt: new Date().toISOString(),
                    flowVersion: 'commercial-v2',
                }),
            },
        });

        await prisma.systemLog.create({
            data: {
                type: 'WHATSAPP',
                action: 'orcamento_whatsapp_capturado',
                message: `Lead capturado via WhatsApp: ${patientName}`,
                metadata: JSON.stringify({
                    whatsappPhone: phone,
                    contactPhone,
                    tipoCuidado: data.tipoCuidadoCodigo,
                    urgencia: data.urgenciaLabel,
                    cargaHoraria: data.cargaHorariaLabel,
                }),
            },
        });
    } catch {
        // silently skip finalization when DB is down
    }
}

function extractTextFromPayload(payload: any): string {
    if (typeof payload?.message?.conversation === 'string') {
        return payload.message.conversation.trim();
    }
    if (typeof payload?.message?.extendedTextMessage?.text === 'string') {
        return payload.message.extendedTextMessage.text.trim();
    }
    if (typeof payload?.message?.imageMessage?.caption === 'string') {
        return payload.message.imageMessage.caption.trim();
    }
    if (typeof payload?.message?.buttonsResponseMessage?.selectedDisplayText === 'string') {
        return payload.message.buttonsResponseMessage.selectedDisplayText.trim();
    }
    if (typeof payload?.message?.templateButtonReplyMessage?.selectedDisplayText === 'string') {
        return payload.message.templateButtonReplyMessage.selectedDisplayText.trim();
    }
    if (typeof payload?.message?.listResponseMessage?.singleSelectReply?.selectedRowId === 'string') {
        return payload.message.listResponseMessage.singleSelectReply.selectedRowId.trim();
    }
    return '';
}

function extractIncomingMessage(payload: any): IncomingMessage | null {
    const jid = String(payload?._replyJid || payload?.key?.remoteJid || '').trim();
    if (!jid) return null;

    const text = extractTextFromPayload(payload);
    if (!text) return null;

    return {
        jid,
        phone: extractPhoneFromJid(jid),
        text,
    };
}

function isLegacyFlowActive(flow: string | undefined): boolean {
    if (!flow) return false;
    return flow !== 'IDLE';
}

function buildBudgetSummary(data: ConversationData): string {
    return [
        '*Resumo do Cadastro Comercial*',
        `Responsavel: ${data.nomeResponsavel || '-'}`,
        `Paciente: ${data.nomePaciente || '-'}`,
        `Idade: ${data.idadePaciente || '-'}`,
        `Tipo de cuidado: ${data.tipoCuidadoLabel || '-'}`,
        `Urgencia: ${data.urgenciaLabel || '-'}`,
        `Carga horaria: ${data.cargaHorariaLabel || '-'}`,
        `Local: ${data.endereco || '-'}`,
        `Inicio desejado: ${data.dataInicio || '-'}`,
        `Telefone de contato: ${data.telefoneContato || '-'}`,
        `Observacoes: ${data.observacoes || '-'}`,
        '',
        '1 - Confirmar envio',
        '2 - Editar cadastro',
        '3 - Cancelar',
    ].join('\n');
}

async function handleBudgetState(message: IncomingMessage, state: ConversationState, data: ConversationData) {
    const normalized = normalizeText(message.text);

    if (state === 'ORCAMENTO_RESPONSAVEL') {
        if (message.text.trim().length < 3) {
            await sendAndTrack(message.jid, 'Informe seu nome completo para continuarmos.');
            return { handled: true, state, data };
        }

        const nextData = { ...data, nomeResponsavel: message.text.trim() };
        await syncLeadDraft(message.phone, nextData);
        await sendAndTrack(message.jid, 'Qual o nome completo do paciente?');
        return { handled: true, state: 'ORCAMENTO_NOME' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_NOME') {
        if (message.text.trim().length < 3) {
            await sendAndTrack(message.jid, 'Informe o nome completo do paciente.');
            return { handled: true, state, data };
        }

        const nextData = { ...data, nomePaciente: message.text.trim() };
        await syncLeadDraft(message.phone, nextData);
        await sendAndTrack(message.jid, 'Qual a idade do paciente?');
        return { handled: true, state: 'ORCAMENTO_IDADE' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_IDADE') {
        const age = Number.parseInt(message.text.replace(/\D/g, ''), 10);
        if (!Number.isInteger(age) || age < 0 || age > 120) {
            await sendAndTrack(message.jid, 'Idade invalida. Informe apenas numero (ex.: 78).');
            return { handled: true, state, data };
        }

        const nextData = { ...data, idadePaciente: age };
        await sendAndTrack(
            message.jid,
            [
                'Qual tipo de cuidado voce precisa?',
                '1 - Cuidador domiciliar',
                '2 - Acompanhamento hospitalar',
                '3 - Pos-operatorio/reabilitacao',
            ].join('\n')
        );
        return { handled: true, state: 'ORCAMENTO_TIPO_CUIDADO' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_TIPO_CUIDADO') {
        const careType = parseCareType(message.text);
        if (!careType) {
            await sendAndTrack(message.jid, 'Digite 1, 2 ou 3 para selecionar o tipo de cuidado.');
            return { handled: true, state, data };
        }

        const nextData = {
            ...data,
            tipoCuidadoCodigo: careType.code,
            tipoCuidadoLabel: careType.label,
        };
        await syncLeadDraft(message.phone, nextData);
        await sendAndTrack(
            message.jid,
            [
                'Qual o nivel de urgencia?',
                '1 - Alta (inicio em ate 24h)',
                '2 - Media (inicio nesta semana)',
                '3 - Baixa (sem urgencia)',
            ].join('\n')
        );
        return { handled: true, state: 'ORCAMENTO_URGENCIA' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_URGENCIA') {
        const urgency = parseUrgency(message.text);
        if (!urgency) {
            await sendAndTrack(message.jid, 'Digite 1, 2 ou 3 para informar a urgencia.');
            return { handled: true, state, data };
        }

        const nextData = {
            ...data,
            urgenciaLabel: urgency.label,
            prioridade: urgency.priority,
        };
        await syncLeadDraft(message.phone, nextData);
        await sendAndTrack(
            message.jid,
            [
                'Qual a carga horaria desejada?',
                '1 - 6h por dia',
                '2 - 12h por dia',
                '3 - 24h por dia',
            ].join('\n')
        );
        return { handled: true, state: 'ORCAMENTO_CARGA_HORARIA' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_CARGA_HORARIA') {
        const workload = parseWorkload(message.text);
        if (!workload) {
            await sendAndTrack(message.jid, 'Digite 1, 2 ou 3 para definir a carga horaria.');
            return { handled: true, state, data };
        }

        const nextData = { ...data, cargaHorariaLabel: workload };
        await sendAndTrack(message.jid, 'Informe cidade e bairro do atendimento (ex.: Bauru, Centro).');
        return { handled: true, state: 'ORCAMENTO_ENDERECO' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_ENDERECO') {
        if (message.text.trim().length < 3) {
            await sendAndTrack(message.jid, 'Informe cidade e bairro para continuarmos.');
            return { handled: true, state, data };
        }

        const nextData = { ...data, endereco: message.text.trim() };
        await syncLeadDraft(message.phone, nextData);
        await sendAndTrack(message.jid, 'Quando gostaria de iniciar? (ex.: hoje, amanha, 25/02/2026)');
        return { handled: true, state: 'ORCAMENTO_DATA_INICIO' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_DATA_INICIO') {
        const startDate = parseStartDate(message.text);
        if (!startDate) {
            await sendAndTrack(message.jid, 'Informe uma data valida (ex.: 25/02/2026) ou escreva "hoje".');
            return { handled: true, state, data };
        }

        const nextData = { ...data, dataInicio: startDate };
        await sendAndTrack(
            message.jid,
            'Qual telefone para contato? Se for este mesmo numero, digite "mesmo".'
        );
        return { handled: true, state: 'ORCAMENTO_TELEFONE' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_TELEFONE') {
        const currentPhone = message.phone;
        let phone = currentPhone;

        if (!['mesmo', 'igual'].includes(normalized)) {
            phone = sanitizePhone(message.text);
            if (phone.length < 10) {
                await sendAndTrack(message.jid, 'Telefone invalido. Envie com DDD (ex.: 11999998888).');
                return { handled: true, state, data };
            }
        }

        const nextData = { ...data, telefoneContato: phone };
        await sendAndTrack(message.jid, 'Deseja adicionar observacoes? Se nao, digite "nao".');
        return { handled: true, state: 'ORCAMENTO_OBSERVACOES' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_OBSERVACOES') {
        const nextData = {
            ...data,
            observacoes: ['nao', 'nenhuma', 'n/a'].includes(normalized) ? 'Nenhuma' : message.text.trim(),
        };
        await syncLeadDraft(message.phone, nextData);
        await sendAndTrack(message.jid, buildBudgetSummary(nextData));
        return { handled: true, state: 'ORCAMENTO_CONFIRMACAO' as ConversationState, data: nextData };
    }

    if (state === 'ORCAMENTO_CONFIRMACAO') {
        if (['1', 'sim', 'confirmar', 'confirmo'].includes(normalized)) {
            await finalizeLeadFromBudget(message.phone, data);
            await sendAndTrack(
                message.jid,
                [
                    'Cadastro concluido com sucesso.',
                    'Seu lead foi registrado e ja esta disponivel na pagina Leads do painel admin.',
                    'Nossa equipe comercial entrara em contato em breve.',
                ].join('\n')
            );
            return { handled: true, state: 'MENU' as ConversationState, data: {} };
        }

        if (['2', 'editar', 'revisar', 'corrigir'].includes(normalized)) {
            await sendAndTrack(message.jid, 'Sem problema. Vamos editar desde o inicio.\nQual seu nome completo?');
            return { handled: true, state: 'ORCAMENTO_RESPONSAVEL' as ConversationState, data: {} };
        }

        if (['3', 'nao', 'cancelar'].includes(normalized)) {
            await sendAndTrack(message.jid, MAIN_MENU_TEXT);
            return { handled: true, state: 'MENU' as ConversationState, data: {} };
        }

        await sendAndTrack(message.jid, 'Digite 1 para confirmar, 2 para editar ou 3 para cancelar.');
        return { handled: true, state, data };
    }

    return { handled: false, state, data };
}

async function beginBudgetFlow(message: IncomingMessage) {
    const data: ConversationData = {};
    await syncLeadDraft(message.phone, data);
    await sendAndTrack(
        message.jid,
        [
            'Perfeito. Vamos iniciar seu cadastro comercial para orcamento.',
            'Qual seu nome completo (responsavel pelo contato)?',
        ].join('\n')
    );
    return { state: 'ORCAMENTO_RESPONSAVEL' as ConversationState, data };
}

export async function handleConversationMessage(payload: any): Promise<boolean> {
    const incoming = extractIncomingMessage(payload);
    if (!incoming) return false;

    if (payload?.key?.fromMe) return true;

    const normalizedIncoming = normalizeText(incoming.text);
    const legacyState = await getUserState(incoming.phone);
    const session = await loadSession(incoming.phone);
    const hasConversationSession =
        session.hasRecord || session.state !== 'MENU' || Object.keys(session.data).length > 0;
    const explicitConversationKeywords = new Set([
        'orcamento',
        'solicitar orcamento',
        'simular',
        'cotacao',
        'preco',
        'valor',
        'servicos',
        'servico',
        'horario',
        'funcionamento',
        'cobertura',
        'ajuda',
        'atendente',
        'humano',
        'consultor',
    ]);
    const explicitConversationIntent =
        isGreeting(incoming.text) ||
        isMenuCommand(incoming.text) ||
        isResetCommand(incoming.text) ||
        explicitConversationKeywords.has(normalizedIncoming);

    if (isLegacyFlowActive(legacyState?.currentFlow) && !hasConversationSession && !explicitConversationIntent) {
        return false;
    }

    await logIncoming(incoming.jid, incoming.text, session.state);

    const normalized = normalizeText(incoming.text);

    if (isResetCommand(incoming.text)) {
        await sendAndTrack(incoming.jid, `Cadastro cancelado.\n\n${MAIN_MENU_TEXT}`);
        await saveSession(incoming.phone, 'MENU', {});
        return true;
    }

    if (isGreeting(incoming.text) || isMenuCommand(incoming.text)) {
        await sendAndTrack(incoming.jid, MAIN_MENU_TEXT);
        await saveSession(incoming.phone, 'MENU', {});
        return true;
    }

    if (session.state !== 'MENU') {
        const result = await handleBudgetState(incoming, session.state, session.data);
        if (!result.handled) return false;
        await saveSession(incoming.phone, result.state, result.data);
        return true;
    }

    if (isServiceCommand(incoming.text)) {
        await sendAndTrack(incoming.jid, SERVICES_TEXT);
        await saveSession(incoming.phone, 'MENU', {});
        return true;
    }

    if (isBudgetCommand(incoming.text)) {
        const started = await beginBudgetFlow(incoming);
        await saveSession(incoming.phone, started.state, started.data);
        return true;
    }

    if (isHumanCommand(incoming.text)) {
        await sendAndTrack(
            incoming.jid,
            'Perfeito. Um consultor humano foi notificado e vai continuar seu atendimento.'
        );
        await saveSession(incoming.phone, 'MENU', {});
        await notifyAdminHelp(incoming.jid);
        return true;
    }

    if (isHoursCommand(incoming.text)) {
        await sendAndTrack(incoming.jid, HOURS_TEXT);
        await saveSession(incoming.phone, 'MENU', {});
        return true;
    }

    if (normalized.length > 0) {
        await sendAndTrack(
            incoming.jid,
            [
                'Nao entendi sua mensagem.',
                'Digite uma opcao valida:',
                '1 para servicos',
                '2 para cadastro de orcamento',
                '3 para horarios',
                '4 para consultor humano',
            ].join('\n')
        );
        await saveSession(incoming.phone, 'MENU', {});
        return true;
    }

    return false;
}
