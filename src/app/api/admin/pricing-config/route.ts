import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDefaultPricingConfig, getPricingConfigSnapshot } from '@/lib/pricing/config-service';

/**
 * GET /api/admin/pricing-config?unidadeId=xxx
 * Retorna toda a configuração de pricing da unidade (ou lista de unidades se sem param).
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const unidadeId = searchParams.get('unidadeId');

        // Se não passou unidadeId, retorna lista de unidades disponíveis
        if (!unidadeId) {
            await ensureDefaultPricingConfig();
            const unidades = await prisma.unidade.findMany({
                where: { ativa: true },
                orderBy: { nome: 'asc' },
                select: {
                    id: true,
                    codigo: true,
                    nome: true,
                    cidade: true,
                    estado: true,
                    ativa: true,
                },
            });
            return NextResponse.json({ success: true, unidades });
        }

        // Buscar snapshot completo da unidade
        const snapshot = await getPricingConfigSnapshot({ unidadeId });

        // Buscar a versão de configuração completa (com todos os campos editáveis)
        const configVersion = await prisma.unidadeConfiguracaoVersao.findFirst({
            where: { unidadeId, isActive: true },
            orderBy: { version: 'desc' },
        });

        if (!configVersion) {
            return NextResponse.json({ error: 'Configuração não encontrada' }, { status: 404 });
        }

        // Buscar todas as sub-tabelas
        const [hourRules, paymentFees, miniCosts, commissionPercents, diseases, discounts, servicosAvulsos] = await Promise.all([
            prisma.unidadeRegraHora.findMany({ where: { configVersionId: configVersion.id }, orderBy: { hora: 'asc' } }),
            prisma.unidadeTaxaPagamento.findMany({ where: { configVersionId: configVersion.id } }),
            prisma.unidadeMinicusto.findMany({ where: { configVersionId: configVersion.id } }),
            prisma.unidadePercentualComissao.findMany({ where: { configVersionId: configVersion.id } }),
            prisma.unidadeDoencaRegra.findMany({ where: { configVersionId: configVersion.id } }),
            prisma.unidadeDescontoPreset.findMany({ where: { configVersionId: configVersion.id } }),
            prisma.unidadeServicoAvulso.findMany({ where: { configVersionId: configVersion.id }, orderBy: { nome: 'asc' } }),
        ]);

        return NextResponse.json({
            success: true,
            unidadeId,
            configVersionId: configVersion.id,
            configVersion: configVersion.version,
            // Valores base por plantão de 12h
            base12h: {
                CUIDADOR: configVersion.baseCuidador12h,
                TECNICO_ENF: configVersion.baseTecnicoEnf12h,
                ENFERMEIRO: configVersion.baseEnfermeiro12h ?? configVersion.baseTecnicoEnf12h,
            },
            // Adicionais percentuais
            adicionais: {
                segundoPaciente: configVersion.adicionalSegundoPacientePercent,
                noturno: configVersion.adicionalNoturnoPercent,
                fimSemana: configVersion.adicionalFimSemanaPercent,
                feriado: configVersion.adicionalFeriadoPercent,
                altoRisco: configVersion.adicionalAltoRiscoPercent,
                at: configVersion.adicionalAtPercent,
                aa: configVersion.adicionalAaPercent,
                atEscalaHoras: configVersion.adicionalAtEscalaHoras,
                aaEscalaHoras: configVersion.adicionalAaEscalaHoras,
            },
            // Margem e lucro
            margem: {
                margemPercent: configVersion.margemPercent,
                lucroFixo: configVersion.lucroFixo,
                lucroFixoEscalaHoras: configVersion.lucroFixoEscalaHoras,
            },
            // Imposto
            impostoSobreComissaoPercent: configVersion.impostoSobreComissaoPercent,
            aplicarTaxaAntesDesconto: configVersion.aplicarTaxaAntesDesconto,
            // Sub-tabelas
            hourRules,
            paymentFees,
            miniCosts,
            commissionPercents,
            diseases,
            discounts,
            servicosAvulsos,
        });
    } catch (error: any) {
        console.error('[pricing-config GET]', error);
        return NextResponse.json({ error: error.message || 'Erro interno' }, { status: 500 });
    }
}

/**
 * PUT /api/admin/pricing-config
 * Atualiza a configuração de pricing de uma unidade.
 */
export async function PUT(req: NextRequest) {
    try {
        const body = await req.json();
        const { unidadeId, base12h, adicionais, margem, impostoSobreComissaoPercent, aplicarTaxaAntesDesconto, hourRules, paymentFees, miniCosts, commissionPercents, diseases, discounts, servicosAvulsos } = body;

        if (!unidadeId) {
            return NextResponse.json({ error: 'unidadeId obrigatório' }, { status: 400 });
        }

        // Buscar versão ativa
        const configVersion = await prisma.unidadeConfiguracaoVersao.findFirst({
            where: { unidadeId, isActive: true },
            orderBy: { version: 'desc' },
        });

        if (!configVersion) {
            return NextResponse.json({ error: 'Configuração ativa não encontrada' }, { status: 404 });
        }

        // 1. Atualizar valores principais da versão
        await prisma.unidadeConfiguracaoVersao.update({
            where: { id: configVersion.id },
            data: {
                baseCuidador12h: base12h?.CUIDADOR ?? configVersion.baseCuidador12h,
                baseAuxiliarEnf12h: base12h?.TECNICO_ENF ?? configVersion.baseAuxiliarEnf12h,
                baseTecnicoEnf12h: base12h?.TECNICO_ENF ?? configVersion.baseTecnicoEnf12h,
                baseEnfermeiro12h: base12h?.ENFERMEIRO ?? configVersion.baseEnfermeiro12h,
                adicionalSegundoPacientePercent: adicionais?.segundoPaciente ?? configVersion.adicionalSegundoPacientePercent,
                adicionalNoturnoPercent: adicionais?.noturno ?? configVersion.adicionalNoturnoPercent,
                adicionalFimSemanaPercent: adicionais?.fimSemana ?? configVersion.adicionalFimSemanaPercent,
                adicionalFeriadoPercent: adicionais?.feriado ?? configVersion.adicionalFeriadoPercent,
                adicionalAltoRiscoPercent: adicionais?.altoRisco ?? configVersion.adicionalAltoRiscoPercent,
                adicionalAtPercent: adicionais?.at ?? configVersion.adicionalAtPercent,
                adicionalAaPercent: adicionais?.aa ?? configVersion.adicionalAaPercent,
                adicionalAtEscalaHoras: adicionais?.atEscalaHoras ?? configVersion.adicionalAtEscalaHoras,
                adicionalAaEscalaHoras: adicionais?.aaEscalaHoras ?? configVersion.adicionalAaEscalaHoras,
                margemPercent: margem?.margemPercent ?? configVersion.margemPercent,
                lucroFixo: margem?.lucroFixo ?? configVersion.lucroFixo,
                lucroFixoEscalaHoras: margem?.lucroFixoEscalaHoras ?? configVersion.lucroFixoEscalaHoras,
                impostoSobreComissaoPercent: impostoSobreComissaoPercent ?? configVersion.impostoSobreComissaoPercent,
                aplicarTaxaAntesDesconto: aplicarTaxaAntesDesconto ?? configVersion.aplicarTaxaAntesDesconto,
            },
        });

        // 2. Atualizar regras de hora (upsert por hora)
        if (Array.isArray(hourRules)) {
            for (const rule of hourRules) {
                await prisma.unidadeRegraHora.upsert({
                    where: { configVersionId_hora: { configVersionId: configVersion.id, hora: rule.hora } },
                    create: { unidadeId, configVersionId: configVersion.id, hora: rule.hora, fatorPercent: rule.fatorPercent, ativa: rule.ativa ?? true },
                    update: { fatorPercent: rule.fatorPercent, ativa: rule.ativa ?? true },
                });
            }
        }

        // 3. Atualizar taxas de pagamento
        if (Array.isArray(paymentFees)) {
            for (const fee of paymentFees) {
                await prisma.unidadeTaxaPagamento.upsert({
                    where: { configVersionId_metodo_periodo: { configVersionId: configVersion.id, metodo: fee.metodo, periodo: fee.periodo } },
                    create: { unidadeId, configVersionId: configVersion.id, metodo: fee.metodo, periodo: fee.periodo, taxaPercent: fee.taxaPercent, ativa: fee.ativa ?? true },
                    update: { taxaPercent: fee.taxaPercent, ativa: fee.ativa ?? true },
                });
            }
        }

        // 4. Atualizar minicustos
        if (Array.isArray(miniCosts)) {
            for (const mc of miniCosts) {
                await prisma.unidadeMinicusto.upsert({
                    where: { configVersionId_tipo: { configVersionId: configVersion.id, tipo: mc.tipo } },
                    create: { unidadeId, configVersionId: configVersion.id, tipo: mc.tipo, nome: mc.nome, valor: mc.valor, escalaHoras: mc.escalaHoras ?? false, cobrancaUnica: mc.cobrancaUnica ?? false, ativoPadrao: mc.ativoPadrao ?? true, opcionalNoFechamento: mc.opcionalNoFechamento ?? true },
                    update: { nome: mc.nome, valor: mc.valor, escalaHoras: mc.escalaHoras ?? false, cobrancaUnica: mc.cobrancaUnica ?? false, ativoPadrao: mc.ativoPadrao ?? true, opcionalNoFechamento: mc.opcionalNoFechamento ?? true },
                });
            }
        }

        // 5. Atualizar percentuais de comissão
        if (Array.isArray(commissionPercents)) {
            for (const cp of commissionPercents) {
                await prisma.unidadePercentualComissao.upsert({
                    where: { configVersionId_tipo: { configVersionId: configVersion.id, tipo: cp.tipo } },
                    create: { unidadeId, configVersionId: configVersion.id, tipo: cp.tipo, nome: cp.nome, percentual: cp.percentual, ativo: cp.ativo ?? true },
                    update: { nome: cp.nome, percentual: cp.percentual, ativo: cp.ativo ?? true },
                });
            }
        }

        // 6. Atualizar regras de doença
        if (Array.isArray(diseases)) {
            for (const d of diseases) {
                await prisma.unidadeDoencaRegra.upsert({
                    where: { configVersionId_codigo: { configVersionId: configVersion.id, codigo: d.codigo } },
                    create: { unidadeId, configVersionId: configVersion.id, codigo: d.codigo, nome: d.nome, complexidade: d.complexidade, profissionalMinimo: d.profissionalMinimo, adicionalPercent: d.adicionalPercent ?? 0, ativa: d.ativa ?? true },
                    update: { nome: d.nome, complexidade: d.complexidade, profissionalMinimo: d.profissionalMinimo, adicionalPercent: d.adicionalPercent ?? 0, ativa: d.ativa ?? true },
                });
            }
        }

        // 7. Atualizar presets de desconto
        if (Array.isArray(discounts)) {
            for (const disc of discounts) {
                await prisma.unidadeDescontoPreset.upsert({
                    where: { configVersionId_nome: { configVersionId: configVersion.id, nome: disc.nome } },
                    create: { unidadeId, configVersionId: configVersion.id, nome: disc.nome, etiqueta: disc.etiqueta ?? disc.nome, percentual: disc.percentual, ativo: disc.ativo ?? true },
                    update: { etiqueta: disc.etiqueta ?? disc.nome, percentual: disc.percentual, ativo: disc.ativo ?? true },
                });
            }
        }

        // 8. Atualizar serviços avulsos
        if (Array.isArray(servicosAvulsos)) {
            for (const svc of servicosAvulsos) {
                await prisma.unidadeServicoAvulso.upsert({
                    where: { configVersionId_codigo: { configVersionId: configVersion.id, codigo: svc.codigo } },
                    create: {
                        unidadeId, configVersionId: configVersion.id,
                        codigo: svc.codigo, nome: svc.nome, descricao: svc.descricao ?? null,
                        valorCuidador: svc.valorCuidador ?? 0, valorAuxiliarEnf: svc.valorAuxiliarEnf ?? 0,
                        valorTecnicoEnf: svc.valorTecnicoEnf ?? 0, valorEnfermeiro: svc.valorEnfermeiro ?? 0,
                        aplicarMargem: svc.aplicarMargem ?? true, aplicarMinicustos: svc.aplicarMinicustos ?? false,
                        aplicarImpostos: svc.aplicarImpostos ?? true, ativo: svc.ativo ?? true,
                    },
                    update: {
                        nome: svc.nome, descricao: svc.descricao ?? null,
                        valorCuidador: svc.valorCuidador ?? 0, valorAuxiliarEnf: svc.valorAuxiliarEnf ?? 0,
                        valorTecnicoEnf: svc.valorTecnicoEnf ?? 0, valorEnfermeiro: svc.valorEnfermeiro ?? 0,
                        aplicarMargem: svc.aplicarMargem ?? true, aplicarMinicustos: svc.aplicarMinicustos ?? false,
                        aplicarImpostos: svc.aplicarImpostos ?? true, ativo: svc.ativo ?? true,
                    },
                });
            }
        }

        // Registrar no audit log
        await prisma.configAuditLog.create({
            data: {
                unidadeId,
                configVersionId: configVersion.id,
                entidade: 'PRICING_CONFIG',
                acao: 'UPDATE',
                afterSnapshot: JSON.stringify({ base12h, adicionais, margem }),
                actorId: 'admin',
            },
        });

        return NextResponse.json({ success: true, message: 'Configuração atualizada com sucesso' });
    } catch (error: any) {
        console.error('[pricing-config PUT]', error);
        return NextResponse.json({ error: error.message || 'Erro interno' }, { status: 500 });
    }
}
