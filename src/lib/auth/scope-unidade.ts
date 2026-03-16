import type { GuardResult } from './capability-guard';
import { getAccessibleUnidadeIds } from './user-unidades';

/**
 * Build a Prisma `where` clause to scope queries by unit access.
 *
 * - Global users: returns {} (no filter — sees everything)
 * - Active unit selected: returns { unidadeId: activeUnidadeId }
 * - Multiple units: returns { unidadeId: { in: [...ids] } }
 *
 * Usage:
 *   const where = { ...scopeByUnidade(guard), deletedAt: null };
 *   const patients = await prisma.paciente.findMany({ where });
 */
export function scopeByUnidade(guard: GuardResult): Record<string, unknown> {
  // If a specific unit is active, scope to it
  if (guard.activeUnidadeId) {
    return { unidadeId: guard.activeUnidadeId };
  }

  // Global user with no active unit — see everything
  if (guard.isGlobal) {
    return {};
  }

  // Non-global user with no active unit — scope to accessible units
  const ids = getAccessibleUnidadeIds(guard.isGlobal, guard.unidades);
  if (ids === null) return {};
  if (ids.length === 0) {
    // User has no unit assignments — return impossible filter
    return { unidadeId: '__no_access__' };
  }

  return { unidadeId: { in: ids } };
}

/**
 * Build scope for CuidadorUnidade join table queries.
 * Used when querying cuidadores (many-to-many with units).
 *
 * Usage:
 *   const where = {
 *     ...scopeCuidadorByUnidade(guard),
 *     deletedAt: null,
 *   };
 *   const cuidadores = await prisma.cuidador.findMany({ where });
 */
export function scopeCuidadorByUnidade(guard: GuardResult): Record<string, unknown> {
  if (guard.activeUnidadeId) {
    return {
      unidades: {
        some: { unidadeId: guard.activeUnidadeId, ativo: true },
      },
    };
  }

  if (guard.isGlobal) return {};

  const ids = getAccessibleUnidadeIds(guard.isGlobal, guard.unidades);
  if (ids === null) return {};
  if (ids.length === 0) {
    return { id: '__no_access__' };
  }

  return {
    unidades: {
      some: { unidadeId: { in: ids }, ativo: true },
    },
  };
}
