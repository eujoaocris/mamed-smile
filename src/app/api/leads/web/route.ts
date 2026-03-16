import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import logger from '@/lib/observability/logger';

const USE_MOCK = process.env.USE_MOCK_DB === 'true';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const {
            relacao, nome, telefone, email,
            idadePaciente, cidade, condicao,
            tipoCuidado, periodo, urgencia,
            observacoes,
        } = body;

        const isUrgentShortcut = urgencia === 'URGENTE_AGORA';

        // Validate required fields (relaxed for urgent shortcut)
        if (isUrgentShortcut) {
            if (!nome || !telefone) {
                return NextResponse.json(
                    { success: false, error: 'Nome e telefone são obrigatórios.' },
                    { status: 400 }
                );
            }
        } else {
            if (!nome || !telefone || !cidade || !condicao || !tipoCuidado || !periodo || !urgencia) {
                return NextResponse.json(
                    { success: false, error: 'Campos obrigatórios não preenchidos.' },
                    { status: 400 }
                );
            }
        }

        const phone = String(telefone).replace(/\D/g, '');

        if (phone.length < 10 || phone.length > 11) {
            return NextResponse.json(
                { success: false, error: 'Telefone inválido.' },
                { status: 400 }
            );
        }

        // Map urgencia to prioridade
        const prioridadeMap: Record<string, string> = { NORMAL: 'NORMAL', ALTA: 'ALTA', URGENTE: 'URGENTE' };
        const prioridade = isUrgentShortcut ? 'URGENTE' : (prioridadeMap[String(urgencia)] || 'NORMAL');

        // Map tipoCuidado to DB value (default for urgent shortcut)
        const tipoMap: Record<string, string> = { HOME_CARE: 'HOME_CARE', HOSPITAL: 'HOSPITAL' };
        const tipo = isUrgentShortcut ? 'HOME_CARE' : (tipoMap[String(tipoCuidado)] || 'HOME_CARE');

        if (!USE_MOCK) {
            try {
                // 1. Upsert Patient as Lead
                const paciente = await prisma.paciente.upsert({
                    where: { telefone: phone },
                    update: {
                        nome,
                        cidade,
                        tipo,
                        prioridade,
                        status: 'LEAD',
                    },
                    create: {
                        telefone: phone,
                        nome,
                        cidade,
                        tipo,
                        prioridade,
                        status: 'LEAD',
                    },
                });

                // 2. Save full FormSubmission with ALL data
                await prisma.formSubmission.create({
                    data: {
                        tipo: 'SOLICITACAO_ORCAMENTO_WEB',
                        telefone: phone,
                        dados: JSON.stringify({
                            relacao,
                            nome,
                            telefone: phone,
                            email: email || null,
                            idadePaciente: idadePaciente || null,
                            cidade,
                            condicao,
                            tipoCuidado,
                            periodo,
                            urgencia,
                            observacoes: observacoes || null,
                            prioridade,
                            pacienteId: paciente.id,
                            submittedAt: new Date().toISOString(),
                            source: 'web-form',
                        }),
                    },
                });

                // 3. System Log
                const logAction = isUrgentShortcut ? 'lead_web_urgente' : 'lead_web_solicitacao_orcamento';
                const logMessage = isUrgentShortcut
                    ? `🚨 LEAD URGENTE via site: ${nome} - Tel: ${phone}`
                    : `Solicitação de orçamento via site: ${nome} (${cidade || 'N/A'}) - ${tipoCuidado} ${periodo} - Urgência: ${urgencia}`;

                await prisma.systemLog.create({
                    data: {
                        type: isUrgentShortcut ? 'WARNING' : 'INFO',
                        action: logAction,
                        message: logMessage,
                        metadata: JSON.stringify({
                            phone,
                            pacienteId: paciente.id,
                            relacao: relacao || null,
                            condicao: condicao || null,
                            tipoCuidado: tipoCuidado || null,
                            periodo: periodo || null,
                            urgencia,
                            isUrgentShortcut,
                        }),
                    },
                });

                // 4. If urgent, log notification attempt
                if (isUrgentShortcut) {
                    logger.info('lead.urgent', `🚨 Lead urgente via site: ${nome} (${phone})`, { module: 'leads-web', phone, pacienteId: paciente.id });
                }
            } catch (dbError) {
                console.warn('[leads/web] DB save failed:', (dbError as Error).message?.slice(0, 200));
                // Continue even if DB fails — show success to user
            }
        } else {
            console.log('[leads/web] Mock mode — lead data:', {
                nome, phone, cidade, tipoCuidado, periodo, urgencia, condicao,
            });
        }

        return NextResponse.json({
            success: true,
            data: {
                nome,
                cidade,
                tipoCuidado,
                urgencia,
            },
        });
    } catch (error) {
        console.error('[leads/web] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Erro interno ao processar solicitação.' },
            { status: 500 }
        );
    }
}
