'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { PricingBreakdownItem } from '@/lib/pricing/enterprise-engine';

const BRL = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const SECTION_KEYS = new Set([
    'valor_profissional_total',
    'comissao_bruta',
    'subtotal_sem_taxa_sem_desconto',
    'total_final',
]);

const DEDUCTION_KEYS = new Set([
    'gastos_sobre_comissao',
    'imposto_sobre_comissao',
    'desconto',
]);

/**
 * Converts the nested breakdown from calculator.ts (EnterprisePricingResult)
 * into the flat PricingBreakdownItem[] format used by BreakdownTable.
 */
export function calculatorBreakdownToLines(
    bd: Record<string, unknown> | undefined | null,
): PricingBreakdownItem[] {
    if (!bd) return [];
    const lines: PricingBreakdownItem[] = [];
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);

    lines.push({ key: 'custo_profissional', label: 'Custo profissional', value: n(bd.custo_profissional) });

    const adicionais = (bd.adicionais_por_evento ?? {}) as Record<string, number>;
    const adNames: Record<string, string> = {
        night: 'Adicional noturno',
        weekend: 'Adicional fim de semana',
        holiday: 'Adicional feriado',
        disease_complexity_manual: 'Complexidade/manual',
        patient_extra: 'Paciente extra',
    };
    for (const [k, label] of Object.entries(adNames)) {
        const v = n(adicionais[k]);
        if (v !== 0) lines.push({ key: `adicional_${k}`, label, value: v });
    }

    const minicustos = Array.isArray(bd.minicustos_ativos) ? bd.minicustos_ativos : [];
    for (const mc of minicustos) {
        const m = mc as { tipo?: string; valor?: number };
        if (n(m.valor) !== 0) {
            lines.push({ key: `minicusto_${m.tipo}`, label: `Minicusto: ${m.tipo}`, value: n(m.valor) });
        }
    }

    lines.push({ key: 'margem_bruta', label: 'Margem bruta', value: n(bd.margem_bruta) });
    lines.push({ key: 'imposto_sobre_comissao', label: 'Imposto sobre comissao', value: -Math.abs(n(bd.imposto_sobre_comissao)) });
    lines.push({ key: 'subtotal_sem_taxa_sem_desconto', label: 'Subtotal antes desconto', value: n(bd.subtotal_antes_desconto) });
    lines.push({ key: 'taxa_pagamento', label: 'Taxa de pagamento', value: n(bd.taxa_pagamento) });

    const descontos = (bd.descontos ?? {}) as Record<string, number>;
    const descTotal = n(descontos.total);
    if (descTotal !== 0) {
        lines.push({ key: 'desconto', label: 'Desconto', value: -Math.abs(descTotal), meta: `${n(descontos.percentual)}%` });
    }

    lines.push({ key: 'total_final', label: 'Total final', value: n(bd.final_cliente) });

    return lines;
}

interface BreakdownTableProps {
    lines: PricingBreakdownItem[];
    defaultOpen?: boolean;
    title?: string;
}

export function BreakdownTable({
    lines,
    defaultOpen = false,
    title = 'Detalhamento de custos',
}: BreakdownTableProps) {
    const [open, setOpen] = useState(defaultOpen);

    if (!lines || lines.length === 0) return null;

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between p-3 text-sm font-semibold text-foreground hover:bg-surface-subtle transition-colors"
            >
                <span>{title}</span>
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {open && (
                <div className="border-t border-border">
                    {lines.map((line) => {
                        const isTotal = line.key === 'total_final';
                        const isSubtotal = SECTION_KEYS.has(line.key);
                        const isDeduction = DEDUCTION_KEYS.has(line.key) || line.value < 0;

                        return (
                            <div
                                key={line.key}
                                className={`flex items-center justify-between px-4 py-2 text-sm ${
                                    isTotal
                                        ? 'bg-primary/5 border-t-2 border-primary/30 font-bold text-foreground py-3'
                                        : isSubtotal
                                            ? 'bg-surface-subtle/30 font-medium text-foreground'
                                            : 'text-muted-foreground'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span>{line.label}</span>
                                    {line.meta && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-subtle text-muted-foreground">
                                            {line.meta}
                                        </span>
                                    )}
                                </div>
                                <span
                                    className={`font-mono text-sm ${
                                        isDeduction
                                            ? 'text-red-500'
                                            : isTotal
                                                ? 'text-primary font-bold text-base'
                                                : ''
                                    }`}
                                >
                                    {line.value < 0
                                        ? `- ${BRL(Math.abs(line.value))}`
                                        : BRL(line.value)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
