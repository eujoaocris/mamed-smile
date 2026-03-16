import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const USE_MOCK = process.env.USE_MOCK_DB === 'true';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const {
            area, nome, cpf, email, coren,
            cidade, bairros, telefone,
            quizScore, quizPassed,
        } = body;

        // Validate required fields
        if (!nome || !cpf || !email || !telefone || !area || !cidade || !bairros) {
            return NextResponse.json(
                { success: false, error: 'Campos obrigatórios não preenchidos.' },
                { status: 400 }
            );
        }

        const phone = String(telefone).replace(/\D/g, '');
        const cleanCpf = String(cpf).replace(/\D/g, '');

        if (cleanCpf.length !== 11) {
            return NextResponse.json(
                { success: false, error: 'CPF inválido.' },
                { status: 400 }
            );
        }

        const status = quizPassed ? 'AGUARDANDO_RH' : 'REPROVADO_TRIAGEM';

        if (!USE_MOCK) {
            try {
                // Save caregiver
                await prisma.cuidador.upsert({
                    where: { telefone: phone },
                    update: {
                        nome,
                        area,
                        status,
                        endereco: `${bairros}, ${cidade}`,
                    },
                    create: {
                        telefone: phone,
                        nome,
                        area,
                        status,
                        endereco: `${bairros}, ${cidade}`,
                    },
                });

                // Save form submission
                await prisma.formSubmission.create({
                    data: {
                        tipo: 'CADASTRO_CUIDADOR_WEB',
                        telefone: phone,
                        dados: JSON.stringify({
                            nome, area, cpf: cleanCpf, email, coren,
                            cidade, bairros, telefone: phone,
                            quizScore, quizPassed, status,
                            submittedAt: new Date().toISOString(),
                            source: 'web-form',
                        }),
                    },
                });

                // Log
                await prisma.systemLog.create({
                    data: {
                        type: 'WHATSAPP',
                        action: 'candidato_web_cadastrado',
                        message: `Candidato via web: ${nome} (${area}) - Quiz: ${quizScore}% - ${quizPassed ? 'APROVADO' : 'REPROVADO'}`,
                        metadata: JSON.stringify({
                            phone, area, quizScore, quizPassed, status,
                        }),
                    },
                });
            } catch (dbError) {
                console.warn('[candidatos/web] DB save failed:', (dbError as Error).message?.slice(0, 100));
                // Continue even if DB fails — the form submission is still valid
            }
        } else {
            console.log('[candidatos/web] Mock mode — candidate data:', {
                nome, area, phone, email, quizScore, quizPassed, status,
            });
        }

        return NextResponse.json({
            success: true,
            data: {
                nome,
                area,
                status,
                quizScore,
                quizPassed,
            },
        });
    } catch (error) {
        console.error('[candidatos/web] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Erro interno ao processar cadastro.' },
            { status: 500 }
        );
    }
}
