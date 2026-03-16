import type { DefaultSession } from 'next-auth';
import type { AdminRole } from '@/lib/auth/roles';

export interface UnidadeAccess {
    unidadeId: string;
    role: AdminRole;
    codigo: string;
    nome: string;
}

declare module 'next-auth' {
    interface Session {
        user: DefaultSession['user'] & {
            role?: AdminRole;
            /** true = acesso global (administração total) */
            isGlobal?: boolean;
            /** unidades acessíveis com role por unidade */
            unidades?: UnidadeAccess[];
            /** unidade ativa selecionada (null = visão global) */
            activeUnidadeId?: string | null;
        };
    }

    interface User {
        role?: AdminRole;
        isGlobal?: boolean;
        unidades?: UnidadeAccess[];
    }
}

declare module 'next-auth/jwt' {
    interface JWT {
        role?: AdminRole;
        isGlobal?: boolean;
        unidades?: UnidadeAccess[];
        activeUnidadeId?: string | null;
    }
}
