import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { E, fail } from '@/lib/api/response';
import { hasCapability, resolveUserRole, type AdminRole, type Capability } from './roles';
import { getRoleForUnidade } from './user-unidades';
import type { UnidadeAccess } from '@/types/next-auth';

export interface GuardResult {
    role: AdminRole;
    userId: string;
    /** true if user has global access */
    isGlobal: boolean;
    /** per-unit access list */
    unidades: UnidadeAccess[];
    /** active unit from session (may be null for global view) */
    activeUnidadeId: string | null;
}

/**
 * Guard a route by capability. Optionally scope to a specific unidadeId.
 *
 * @param capability - The required capability
 * @param unidadeId  - If provided, validates the user has access to this unit
 *                     and checks capability using unit-specific role
 */
export async function guardCapability(
    capability: Capability,
    unidadeId?: string | null,
): Promise<GuardResult | NextResponse> {
    const session = await auth();

    if (!session?.user?.email) {
        return fail(E.UNAUTHORIZED, 'Authentication required', { status: 401 });
    }

    const isGlobal = session.user.isGlobal ?? false;
    const unidades = session.user.unidades ?? [];
    const activeUnidadeId = session.user.activeUnidadeId ?? null;

    // Determine which unit to check against
    const targetUnidadeId = unidadeId ?? activeUnidadeId;

    // Resolve role for this specific context
    let role: AdminRole;
    if (unidades.length > 0 || isGlobal) {
        // DB-based unit system active
        role = getRoleForUnidade(
            isGlobal,
            session.user.role ?? 'LEITURA',
            unidades,
            targetUnidadeId,
        );
    } else {
        // Fallback to env-var based roles
        role = resolveUserRole(session.user.email);
    }

    // If a specific unit was requested, verify access
    if (unidadeId && !isGlobal) {
        const hasAccess = unidades.some((u) => u.unidadeId === unidadeId);
        if (!hasAccess) {
            return fail(E.FORBIDDEN, 'No access to this unit', { status: 403 });
        }
    }

    if (!hasCapability(role, capability)) {
        return fail(E.FORBIDDEN, `Missing capability: ${capability}`, { status: 403 });
    }

    return {
        role,
        userId: String(session.user.email || 'unknown'),
        isGlobal,
        unidades,
        activeUnidadeId: targetUnidadeId,
    };
}
