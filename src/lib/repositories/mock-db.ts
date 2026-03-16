import {
    IDatabaseFactory,
    ICuidadorRepository,
    IPacienteRepository,
    IWhatsAppSessionRepository,
    IMessagingRepository,
    IFormSubmissionRepository,
    IAvaliacaoRepository
} from './types';

// Global storage to survive HMR
const globalState = globalThis as any;
if (!globalState.mockRepoStore) {
    globalState.mockRepoStore = {
        session: { id: 'main', status: 'DISCONNECTED', qrCode: null, connectedAt: null },
        messages: [],
        cuidadores: [
            { id: '1', telefone: '5511999990001', nome: 'João Silva', area: 'Cuidador de Idosos', status: 'AGUARDANDO_RH', quizScore: 85, deletedAt: null, createdAt: new Date() }
        ],
        pacientes: [
            { id: 'p1', telefone: '5511988880001', nome: 'Sra. Ana Souza', prioridade: 'ALTA', status: 'LEAD', cidade: 'São Paulo', deletedAt: null, createdAt: new Date() }
        ],
        submissions: [],
        avaliacoes: [],
        orcamentos: [],
        alocacoes: []
    };
}
const store = globalState.mockRepoStore;

export const MockRepository: IDatabaseFactory = {
    cuidador: {
        async findById(id) { return store.cuidadores.find((c: any) => c.id === id) || null; },
        async findByPhone(phone) { return store.cuidadores.find((c: any) => c.telefone === phone) || null; },
        async findAllPending() { return store.cuidadores.filter((c: any) => c.status === 'AGUARDANDO_RH'); },
        async upsert(phone, data) {
            const idx = store.cuidadores.findIndex((c: any) => c.telefone === phone);
            if (idx >= 0) {
                store.cuidadores[idx] = { ...store.cuidadores[idx], ...data };
                return store.cuidadores[idx];
            }
            const novo = { id: Date.now().toString(), telefone: phone, ...data, createdAt: new Date() };
            store.cuidadores.push(novo);
            return novo;
        },
        async update(id, data) {
            const idx = store.cuidadores.findIndex((c: any) => c.id === id);
            if (idx >= 0) {
                store.cuidadores[idx] = { ...store.cuidadores[idx], ...data };
                return store.cuidadores[idx];
            }
            throw new Error('Cuidador not found');
        }
    },
    paciente: {
        async findByPhone(phone) { return store.pacientes.find((p: any) => p.telefone === phone) || null; },
        async findAllHighPriority() { return store.pacientes.filter((p: any) => p.prioridade === 'ALTA'); },
        async search(query) {
            const q = query.toLowerCase();
            return store.pacientes.filter((p: any) =>
                p.nome?.toLowerCase().includes(q) || p.telefone.includes(q)
            );
        },
        async upsert(phone, data) {

            const idx = store.pacientes.findIndex((p: any) => p.telefone === phone);
            if (idx >= 0) {
                store.pacientes[idx] = { ...store.pacientes[idx], ...data };
                return store.pacientes[idx];
            }
            const novo = { id: Date.now().toString(), telefone: phone, ...data, createdAt: new Date() };
            store.pacientes.push(novo);
            return novo;
        }
    },
    whatsapp: {
        async getSession() { return store.session; },
        async updateSession(data) {
            store.session = { ...store.session, ...data, updatedAt: new Date() };
            return store.session;
        }
    },
    messaging: {
        async logMessage(data) {
            store.messages.unshift({ id: Date.now().toString(), timestamp: new Date(), ...data });
        },
        async getHistory(phone, limit = 50) {
            return store.messages.filter((m: any) => m.telefone === phone).slice(0, limit);
        },
        async getAllRecent(limit = 100) {
            return store.messages.slice(0, limit);
        }
    },
    form: {
        async logSubmission(tipo, data, phone) {
            const sub = {
                id: Date.now().toString(),
                tipo,
                dados: JSON.stringify(data),
                telefone: phone || null,
                createdAt: new Date(),
                ipAddress: null,
                userAgent: null
            };
            store.submissions.unshift(sub);
            return sub;
        },
        async getAll() { return store.submissions; }
    },
    avaliacao: {
        async create(data) {
            const nova = {
                id: Date.now().toString(),
                pacienteId: data.pacienteId,
                abemidScore: data.abemidScore ?? null,
                katzScore: data.katzScore ?? null,
                lawtonScore: data.lawtonScore ?? null,
                gqp: data.gqp ?? null,
                nivelSugerido: data.nivelSugerido ?? null,
                cargaSugerida: data.cargaSugerida ?? null,
                status: data.status ?? 'PENDENTE',
                dadosDetalhados: (data as any).dadosDetalhados ?? null,
                nivelFinal: null,
                cargaFinal: null,
                avaliadorId: null,
                validadoEm: null,
                // WhatsApp tracking fields
                whatsappEnviado: false,
                whatsappEnviadoEm: null,
                whatsappMessageId: null,
                whatsappErro: null,
                whatsappTentativas: 0,
                valorProposto: null,
                unidadeId: null,
                deletedAt: null,
                createdAt: new Date()
            };
            store.avaliacoes.push(nova);
            return nova;
        },
        async findPending() { return store.avaliacoes.filter((a: any) => a.status === 'PENDENTE'); }
    },
    orcamento: {
        async create(data) {
            const novo = {
                id: Date.now().toString(),
                pacienteId: data.pacienteId,
                unidadeId: (data as any).unidadeId ?? null,
                configVersionId: (data as any).configVersionId ?? null,
                avaliacaoId: (data as any).avaliacaoId ?? null,
                cenarioEconomico: data.cenarioEconomico ?? null,
                cenarioRecomendado: data.cenarioRecomendado ?? null,
                cenarioPremium: data.cenarioPremium ?? null,
                cenarioSelecionado: (data as any).cenarioSelecionado ?? null,
                valorFinal: (data as any).valorFinal ?? null,
                snapshotInput: (data as any).snapshotInput ?? null,
                snapshotOutput: (data as any).snapshotOutput ?? null,
                planningInput: (data as any).planningInput ?? null,
                normalizedSchedule: (data as any).normalizedSchedule ?? null,
                pricingBreakdown: (data as any).pricingBreakdown ?? null,
                calculationHash: (data as any).calculationHash ?? null,
                auditHash: (data as any).auditHash ?? null,
                engineVersion: (data as any).engineVersion ?? null,
                createdBy: (data as any).createdBy ?? null,
                descontoManualPercent: (data as any).descontoManualPercent ?? null,
                minicustosDesativados: (data as any).minicustosDesativados ?? null,
                moeda: (data as any).moeda ?? 'BRL',
                status: (data as any).status ?? 'RASCUNHO',
                aprovadoPor: (data as any).aprovadoPor ?? null,
                enviadoEm: (data as any).enviadoEm ?? null,
                aceitoEm: (data as any).aceitoEm ?? null,
                deletedAt: null,
                createdAt: new Date()
            };
            store.orcamentos.push(novo);
            return novo;
        },
        async update(id, data) {
            const idx = store.orcamentos.findIndex((o: any) => o.id === id);
            if (idx >= 0) {
                store.orcamentos[idx] = { ...store.orcamentos[idx], ...data };
                return store.orcamentos[idx];
            }
            throw new Error('Orcamento not found');
        },
        async findByPaciente(pacienteId) { return store.orcamentos.filter((o: any) => o.pacienteId === pacienteId); }
    },
    alocacao: {
        async create(data) {
            const novo = {
                id: Date.now().toString(),
                cuidadorId: data.cuidadorId,
                pacienteId: data.pacienteId ?? null,
                slotId: data.slotId,
                turno: data.turno,
                diaSemana: data.diaSemana,
                dataInicio: data.dataInicio,
                hospital: data.hospital ?? null,
                quarto: data.quarto ?? null,
                status: 'PENDENTE_FEEDBACK',
                ofertadoEm: new Date(),
                respondidoEm: null,
                confirmadoT24: null,
                confirmadoT2: null,
                unidadeId: null,
                deletedAt: null,
                createdAt: new Date()
            };
            store.alocacoes.push(novo);
            return novo;
        },
        async update(id, data) {
            const idx = store.alocacoes.findIndex((a: any) => a.id === id);
            if (idx >= 0) {
                store.alocacoes[idx] = { ...store.alocacoes[idx], ...data };
                return store.alocacoes[idx];
            }
            throw new Error('Alocacao not found');
        },
        async findByCuidador(cuidadorId) { return store.alocacoes.filter((a: any) => a.cuidadorId === cuidadorId); },
        async findByPaciente(pacienteId) { return store.alocacoes.filter((a: any) => a.pacienteId === pacienteId); }
    }
};
