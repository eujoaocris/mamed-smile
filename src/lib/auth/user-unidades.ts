import { prisma } from '@/lib/prisma';
import type { AdminRole } from './roles';
import type { UnidadeAccess } from '@/types/next-auth';

interface UserUnidadeResult {
  /** Highest role across all unit assignments (for backwards compat) */
  role: AdminRole;
  /** true if user has a global assignment (unidadeId = null) */
  isGlobal: boolean;
  /** Per-unit access list */
  unidades: UnidadeAccess[];
}

const ROLE_PRIORITY: Record<AdminRole, number> = {
  ADMIN: 7,
  SUPERVISOR: 6,
  FINANCEIRO: 5,
  RH: 4,
  OPERADOR: 3,
  AVALIADOR: 2,
  LEITURA: 1,
};

/**
 * Resolve user unit access from the UsuarioUnidade table.
 * Falls back to env-var based resolveUserRole if no DB entries exist.
 */
export async function resolveUserUnidades(email: string): Promise<UserUnidadeResult | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const assignments = await prisma.usuarioUnidade.findMany({
    where: {
      email: normalizedEmail,
      ativo: true,
    },
    include: {
      unidade: {
        select: { id: true, codigo: true, nome: true, ativa: true },
      },
    },
  });

  if (assignments.length === 0) return null;

  const isGlobal = assignments.some((a: { unidadeId: string | null }) => a.unidadeId === null);

  const unidades: UnidadeAccess[] = assignments
    .filter((a: { unidadeId: string | null; unidade: { ativa: boolean } | null }) => a.unidadeId !== null && a.unidade?.ativa)
    .map((a: { unidadeId: string | null; role: string; unidade: { codigo: string; nome: string } | null }) => ({
      unidadeId: a.unidadeId!,
      role: a.role as AdminRole,
      codigo: a.unidade!.codigo,
      nome: a.unidade!.nome,
    }));

  // Determine highest role (global assignment role takes priority)
  const globalAssignment = assignments.find((a: { unidadeId: string | null }) => a.unidadeId === null);
  let highestRole: AdminRole = 'LEITURA';

  if (globalAssignment) {
    highestRole = globalAssignment.role as AdminRole;
  } else {
    for (const u of unidades) {
      if (ROLE_PRIORITY[u.role] > ROLE_PRIORITY[highestRole]) {
        highestRole = u.role;
      }
    }
  }

  return { role: highestRole, isGlobal, unidades };
}

/**
 * Get the role for a specific user+unit combination.
 * Global users get their global role for any unit.
 */
export function getRoleForUnidade(
  isGlobal: boolean,
  globalRole: AdminRole,
  unidades: UnidadeAccess[],
  unidadeId: string | null | undefined,
): AdminRole {
  // Global users use their global role everywhere
  if (isGlobal) return globalRole;

  // No unit specified — use highest role
  if (!unidadeId) return globalRole;

  // Find specific unit assignment
  const match = unidades.find((u) => u.unidadeId === unidadeId);
  return match?.role ?? 'LEITURA';
}

/**
 * Get all unidadeIds a user can access.
 * Global users return null (meaning "all units").
 */
export function getAccessibleUnidadeIds(
  isGlobal: boolean,
  unidades: UnidadeAccess[],
): string[] | null {
  if (isGlobal) return null; // null = all units
  return unidades.map((u) => u.unidadeId);
}
