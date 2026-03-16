-- ==========================================
-- 1. CATCH-UP: Add missing tables/columns from schema drift
-- ==========================================

-- UnidadeServicoAvulso was added to schema but never migrated
CREATE TABLE IF NOT EXISTS "UnidadeServicoAvulso" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "configVersionId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "valorCuidador" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valorAuxiliarEnf" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valorTecnicoEnf" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valorEnfermeiro" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aplicarMargem" BOOLEAN NOT NULL DEFAULT true,
    "aplicarMinicustos" BOOLEAN NOT NULL DEFAULT false,
    "aplicarImpostos" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnidadeServicoAvulso_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UnidadeServicoAvulso_configVersionId_codigo_key" ON "UnidadeServicoAvulso"("configVersionId", "codigo");
CREATE INDEX IF NOT EXISTS "UnidadeServicoAvulso_unidadeId_ativo_idx" ON "UnidadeServicoAvulso"("unidadeId", "ativo");

ALTER TABLE "UnidadeServicoAvulso" ADD CONSTRAINT "UnidadeServicoAvulso_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnidadeServicoAvulso" ADD CONSTRAINT "UnidadeServicoAvulso_configVersionId_fkey" FOREIGN KEY ("configVersionId") REFERENCES "UnidadeConfiguracaoVersao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add cobrancaUnica to UnidadeMinicusto (if not exists)
ALTER TABLE "UnidadeMinicusto" ADD COLUMN IF NOT EXISTS "cobrancaUnica" BOOLEAN NOT NULL DEFAULT false;

-- ==========================================
-- 2. DATA MIGRATION: Unify AUXILIAR_ENF into TECNICO_ENF
-- ==========================================

UPDATE "Cuidador"
SET "area" = 'TECNICO_ENF', "updatedAt" = NOW()
WHERE "area" = 'AUXILIAR_ENF';

UPDATE "UnidadeDoencaRegra"
SET "profissionalMinimo" = 'TECNICO_ENF', "updatedAt" = NOW()
WHERE "profissionalMinimo" = 'AUXILIAR_ENF';

UPDATE "UnidadeConfiguracaoVersao"
SET "baseAuxiliarEnf12h" = "baseTecnicoEnf12h", "updatedAt" = NOW()
WHERE "baseAuxiliarEnf12h" != "baseTecnicoEnf12h";

UPDATE "UnidadeServicoAvulso"
SET "valorAuxiliarEnf" = "valorTecnicoEnf", "updatedAt" = NOW()
WHERE "valorAuxiliarEnf" != "valorTecnicoEnf";

-- ==========================================
-- 3. MULTI-UNIT SYSTEM: New tables
-- ==========================================

-- UsuarioUnidade: vincula email a unidade(s) com role por unidade
-- unidadeId NULL = acesso global (administração total)
CREATE TABLE "UsuarioUnidade" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "unidadeId" TEXT,
    "role" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsuarioUnidade_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsuarioUnidade_email_unidadeId_key" ON "UsuarioUnidade"("email", "unidadeId");
CREATE INDEX "UsuarioUnidade_email_ativo_idx" ON "UsuarioUnidade"("email", "ativo");
CREATE INDEX "UsuarioUnidade_unidadeId_idx" ON "UsuarioUnidade"("unidadeId");

ALTER TABLE "UsuarioUnidade" ADD CONSTRAINT "UsuarioUnidade_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CuidadorUnidade: many-to-many profissional <> unidade
CREATE TABLE "CuidadorUnidade" (
    "id" TEXT NOT NULL,
    "cuidadorId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuidadorUnidade_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CuidadorUnidade_cuidadorId_unidadeId_key" ON "CuidadorUnidade"("cuidadorId", "unidadeId");
CREATE INDEX "CuidadorUnidade_unidadeId_ativo_idx" ON "CuidadorUnidade"("unidadeId", "ativo");

ALTER TABLE "CuidadorUnidade" ADD CONSTRAINT "CuidadorUnidade_cuidadorId_fkey" FOREIGN KEY ("cuidadorId") REFERENCES "Cuidador"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CuidadorUnidade" ADD CONSTRAINT "CuidadorUnidade_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ==========================================
-- 4. Add unidadeId to core models
-- ==========================================

-- Paciente
ALTER TABLE "Paciente" ADD COLUMN IF NOT EXISTS "unidadeId" TEXT;
CREATE INDEX IF NOT EXISTS "Paciente_unidadeId_idx" ON "Paciente"("unidadeId");
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Avaliacao
ALTER TABLE "Avaliacao" ADD COLUMN IF NOT EXISTS "unidadeId" TEXT;
CREATE INDEX IF NOT EXISTS "Avaliacao_unidadeId_idx" ON "Avaliacao"("unidadeId");
ALTER TABLE "Avaliacao" ADD CONSTRAINT "Avaliacao_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Alocacao
ALTER TABLE "Alocacao" ADD COLUMN IF NOT EXISTS "unidadeId" TEXT;
CREATE INDEX IF NOT EXISTS "Alocacao_unidadeId_idx" ON "Alocacao"("unidadeId");
ALTER TABLE "Alocacao" ADD CONSTRAINT "Alocacao_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
