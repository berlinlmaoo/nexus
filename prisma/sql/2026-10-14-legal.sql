-- Legal documents (owner 14 Oct 2026): invitation-only Legal module — members, issuing companies,
-- numbering series, templates (+versions), documents (+versions) and GIDEON edit proposals.
-- Additive and idempotent: run it as many times as you like; it only creates what is missing and never
-- drops or rewrites a row (the seed rows use ON CONFLICT DO NOTHING, so edits made in Settings survive a
-- re-run). Apply BEFORE deploying the image whose Prisma client reads these tables:
--   nexus-sql.sh <env> apply prisma/sql/2026-10-14-legal.sql
-- Names follow Prisma's conventions (<Table>_<cols>_key/_idx/_fkey) so `prisma migrate diff` sees no drift.
--
-- Seed: the four issuing companies and their default numbering series (formats from the owner's templates;
-- every series ends in a running {SEQ}, reset yearly except invoices, which reset monthly — owner 14 Oct).
-- Legal names other than PATS are left empty on purpose: the kop shows only a logo, and nobody guesses a
-- PT name for a contract. Fill them in Legal → Settings.

SET lock_timeout = '5s';

BEGIN;


CREATE TABLE IF NOT EXISTS "LegalMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LegalCompany" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "kopStorageKey" TEXT,
    "kopFileName" TEXT,
    "kopUpdatedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalCompany_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LegalSeries" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "resetPeriod" TEXT NOT NULL DEFAULT 'YEAR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LegalTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "docType" TEXT NOT NULL,
    "companyId" TEXT,
    "seriesId" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LegalTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LegalDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "seriesId" TEXT,
    "documentNumberId" TEXT,
    "number" TEXT NOT NULL DEFAULT '',
    "docType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL DEFAULT '',
    "docDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'GENERATED',
    "templateVersionId" TEXT,
    "fieldValues" JSONB NOT NULL DEFAULT '{}',
    "projectId" TEXT,
    "dealId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "finalVersion" INTEGER,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LegalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "docxKey" TEXT,
    "pdfKey" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "changes" JSONB,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LegalEditProposal" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "instruction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "question" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "changes" JSONB NOT NULL DEFAULT '[]',
    "appliedVersion" INTEGER,
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalEditProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegalMember_userId_key" ON "LegalMember"("userId");

CREATE INDEX IF NOT EXISTS "LegalMember_revokedAt_idx" ON "LegalMember"("revokedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "LegalCompany_code_key" ON "LegalCompany"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "LegalSeries_key_key" ON "LegalSeries"("key");

CREATE INDEX IF NOT EXISTS "LegalSeries_companyId_docType_idx" ON "LegalSeries"("companyId", "docType");

CREATE INDEX IF NOT EXISTS "LegalTemplate_docType_idx" ON "LegalTemplate"("docType");

CREATE UNIQUE INDEX IF NOT EXISTS "LegalTemplateVersion_templateId_version_key" ON "LegalTemplateVersion"("templateId", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "LegalDocument_documentNumberId_key" ON "LegalDocument"("documentNumberId");

CREATE INDEX IF NOT EXISTS "LegalDocument_companyId_docDate_idx" ON "LegalDocument"("companyId", "docDate");

CREATE INDEX IF NOT EXISTS "LegalDocument_docType_idx" ON "LegalDocument"("docType");

CREATE INDEX IF NOT EXISTS "LegalDocument_status_idx" ON "LegalDocument"("status");

CREATE INDEX IF NOT EXISTS "LegalDocument_number_idx" ON "LegalDocument"("number");

CREATE UNIQUE INDEX IF NOT EXISTS "LegalDocumentVersion_documentId_version_key" ON "LegalDocumentVersion"("documentId", "version");

CREATE INDEX IF NOT EXISTS "LegalEditProposal_documentId_status_idx" ON "LegalEditProposal"("documentId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalMember_userId_fkey') THEN
    ALTER TABLE "LegalMember" ADD CONSTRAINT "LegalMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalMember_invitedById_fkey') THEN
    ALTER TABLE "LegalMember" ADD CONSTRAINT "LegalMember_invitedById_fkey"
      FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalMember_revokedById_fkey') THEN
    ALTER TABLE "LegalMember" ADD CONSTRAINT "LegalMember_revokedById_fkey"
      FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalSeries_companyId_fkey') THEN
    ALTER TABLE "LegalSeries" ADD CONSTRAINT "LegalSeries_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "LegalCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalTemplate_companyId_fkey') THEN
    ALTER TABLE "LegalTemplate" ADD CONSTRAINT "LegalTemplate_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "LegalCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalTemplate_seriesId_fkey') THEN
    ALTER TABLE "LegalTemplate" ADD CONSTRAINT "LegalTemplate_seriesId_fkey"
      FOREIGN KEY ("seriesId") REFERENCES "LegalSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalTemplate_createdById_fkey') THEN
    ALTER TABLE "LegalTemplate" ADD CONSTRAINT "LegalTemplate_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalTemplateVersion_templateId_fkey') THEN
    ALTER TABLE "LegalTemplateVersion" ADD CONSTRAINT "LegalTemplateVersion_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "LegalTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalTemplateVersion_createdById_fkey') THEN
    ALTER TABLE "LegalTemplateVersion" ADD CONSTRAINT "LegalTemplateVersion_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_companyId_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "LegalCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_seriesId_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_seriesId_fkey"
      FOREIGN KEY ("seriesId") REFERENCES "LegalSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_documentNumberId_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_documentNumberId_fkey"
      FOREIGN KEY ("documentNumberId") REFERENCES "DocumentNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_templateVersionId_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_templateVersionId_fkey"
      FOREIGN KEY ("templateVersionId") REFERENCES "LegalTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_projectId_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_dealId_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "PipelineDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_createdById_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_updatedById_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocumentVersion_documentId_fkey') THEN
    ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_documentId_fkey"
      FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocumentVersion_authorId_fkey') THEN
    ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalEditProposal_documentId_fkey') THEN
    ALTER TABLE "LegalEditProposal" ADD CONSTRAINT "LegalEditProposal_documentId_fkey"
      FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalEditProposal_createdById_fkey') THEN
    ALTER TABLE "LegalEditProposal" ADD CONSTRAINT "LegalEditProposal_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalEditProposal_decidedById_fkey') THEN
    ALTER TABLE "LegalEditProposal" ADD CONSTRAINT "LegalEditProposal_decidedById_fkey"
      FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;


-- ── Seed ─────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO "LegalCompany" ("id", "code", "name", "legalName", "address", "position", "updatedAt") VALUES
  ('legalco_intoo', 'INTOO', 'Intoo', '', 'Jl. Mawar No.1, RT.5/RW.3, Cilandak Tim., Ps. Minggu, Jakarta Selatan, DKI Jakarta', 0, CURRENT_TIMESTAMP),
  ('legalco_pats', 'PATS', 'PATS', 'PT PATS DARI SELATAN', 'Jl. Mawar No.1, RT.5/RW.3, Cilandak Tim., Ps. Minggu, Jakarta Selatan, DKI Jakarta', 1, CURRENT_TIMESTAMP),
  ('legalco_swl', 'SWL', 'Suwara Lokal', '', 'Jl. Mawar No.1, RT.5/RW.3, Cilandak Tim., Ps. Minggu, Jakarta Selatan, DKI Jakarta', 2, CURRENT_TIMESTAMP),
  ('legalco_tzn', 'TZN', 'The Z Networks', '', 'Jl. Mawar No.1, RT.5/RW.3, Cilandak Tim., Ps. Minggu, Jakarta Selatan, DKI Jakarta', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "LegalSeries" ("id", "key", "companyId", "docType", "label", "format", "resetPeriod", "position", "updatedAt")
SELECT v.id, v.key, c."id", v.doc_type, v.label, v.format, v.reset_period, v.position, CURRENT_TIMESTAMP
FROM (VALUES
  ('legalser_intoo_surat', 'INTOO-SURAT', 'INTOO', 'SURAT', 'Surat', '{SEQ:3}/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 0),
  ('legalser_intoo_sp', 'INTOO-SP', 'INTOO', 'SP', 'Surat Peringatan', '{SEQ:3}/SP-{TINGKAT}/HRD/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 10),
  ('legalser_intoo_sk', 'INTOO-SK', 'INTOO', 'SK', 'Surat Kuasa', '{SEQ:3}/SK/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 20),
  ('legalser_intoo_pks', 'INTOO-PKS', 'INTOO', 'PKS', 'Perjanjian Kerja Sama', '{SEQ:3}/PKS/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 30),
  ('legalser_intoo_spk', 'INTOO-SPK', 'INTOO', 'SPK', 'Surat Perjanjian Kerja', '{SEQ:3}/SPK/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 40),
  ('legalser_intoo_nda', 'INTOO-NDA', 'INTOO', 'NDA', 'Perjanjian Kerahasiaan (NDA)', '{SEQ:3}/NDA/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 50),
  ('legalser_intoo_mou', 'INTOO-MOU', 'INTOO', 'MOU', 'Nota Kesepahaman (MOU)', '{SEQ:3}/MOU/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 60),
  ('legalser_intoo_pjm', 'INTOO-PJM', 'INTOO', 'PJM', 'Peminjaman Barang', '{SEQ:3}/PJM/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 70),
  ('legalser_intoo_pgb', 'INTOO-PGB', 'INTOO', 'PGB', 'Pengembalian Barang', '{SEQ:3}/PGB/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 80),
  ('legalser_intoo_invoice', 'INTOO-INVOICE', 'INTOO', 'INVOICE', 'Invoice', 'INV/{CO}/{ROMAWI}/{YYYY}/{SEQ:3}', 'MONTH', 90),
  ('legalser_pats_surat', 'PATS-SURAT', 'PATS', 'SURAT', 'Surat', '{SEQ:3}/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 0),
  ('legalser_pats_sp', 'PATS-SP', 'PATS', 'SP', 'Surat Peringatan', '{SEQ:3}/SP-{TINGKAT}/HRD/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 10),
  ('legalser_pats_sk', 'PATS-SK', 'PATS', 'SK', 'Surat Kuasa', '{SEQ:3}/SK/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 20),
  ('legalser_pats_pks', 'PATS-PKS', 'PATS', 'PKS', 'Perjanjian Kerja Sama', '{SEQ:3}/PKS/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 30),
  ('legalser_pats_spk', 'PATS-SPK', 'PATS', 'SPK', 'Surat Perjanjian Kerja', '{SEQ:3}/SPK/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 40),
  ('legalser_pats_nda', 'PATS-NDA', 'PATS', 'NDA', 'Perjanjian Kerahasiaan (NDA)', '{SEQ:3}/NDA/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 50),
  ('legalser_pats_mou', 'PATS-MOU', 'PATS', 'MOU', 'Nota Kesepahaman (MOU)', '{SEQ:3}/MOU/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 60),
  ('legalser_pats_pjm', 'PATS-PJM', 'PATS', 'PJM', 'Peminjaman Barang', '{SEQ:3}/PJM/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 70),
  ('legalser_pats_pgb', 'PATS-PGB', 'PATS', 'PGB', 'Pengembalian Barang', '{SEQ:3}/PGB/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 80),
  ('legalser_swl_surat', 'SWL-SURAT', 'SWL', 'SURAT', 'Surat', '{SEQ:3}/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 0),
  ('legalser_swl_sp', 'SWL-SP', 'SWL', 'SP', 'Surat Peringatan', '{SEQ:3}/SP-{TINGKAT}/HRD/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 10),
  ('legalser_swl_sk', 'SWL-SK', 'SWL', 'SK', 'Surat Kuasa', '{SEQ:3}/SK/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 20),
  ('legalser_swl_pks', 'SWL-PKS', 'SWL', 'PKS', 'Perjanjian Kerja Sama', '{SEQ:3}/PKS/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 30),
  ('legalser_swl_spk', 'SWL-SPK', 'SWL', 'SPK', 'Surat Perjanjian Kerja', '{SEQ:3}/SPK/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 40),
  ('legalser_swl_nda', 'SWL-NDA', 'SWL', 'NDA', 'Perjanjian Kerahasiaan (NDA)', '{SEQ:3}/NDA/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 50),
  ('legalser_swl_mou', 'SWL-MOU', 'SWL', 'MOU', 'Nota Kesepahaman (MOU)', '{SEQ:3}/MOU/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 60),
  ('legalser_swl_pjm', 'SWL-PJM', 'SWL', 'PJM', 'Peminjaman Barang', '{SEQ:3}/PJM/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 70),
  ('legalser_swl_pgb', 'SWL-PGB', 'SWL', 'PGB', 'Pengembalian Barang', '{SEQ:3}/PGB/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 80),
  ('legalser_swl_invoice', 'SWL-INVOICE', 'SWL', 'INVOICE', 'Invoice', 'INV/{CO}/{ROMAWI}/{YYYY}/{SEQ:3}', 'MONTH', 90),
  ('legalser_tzn_surat', 'TZN-SURAT', 'TZN', 'SURAT', 'Surat', '{SEQ:3}/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 0),
  ('legalser_tzn_sp', 'TZN-SP', 'TZN', 'SP', 'Surat Peringatan', '{SEQ:3}/SP-{TINGKAT}/HRD/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 10),
  ('legalser_tzn_sk', 'TZN-SK', 'TZN', 'SK', 'Surat Kuasa', '{SEQ:3}/SK/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 20),
  ('legalser_tzn_pks', 'TZN-PKS', 'TZN', 'PKS', 'Perjanjian Kerja Sama', '{SEQ:3}/PKS/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 30),
  ('legalser_tzn_spk', 'TZN-SPK', 'TZN', 'SPK', 'Surat Perjanjian Kerja', '{SEQ:3}/SPK/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 40),
  ('legalser_tzn_nda', 'TZN-NDA', 'TZN', 'NDA', 'Perjanjian Kerahasiaan (NDA)', '{SEQ:3}/NDA/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 50),
  ('legalser_tzn_mou', 'TZN-MOU', 'TZN', 'MOU', 'Nota Kesepahaman (MOU)', '{SEQ:3}/MOU/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 60),
  ('legalser_tzn_pjm', 'TZN-PJM', 'TZN', 'PJM', 'Peminjaman Barang', '{SEQ:3}/PJM/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 70),
  ('legalser_tzn_pgb', 'TZN-PGB', 'TZN', 'PGB', 'Pengembalian Barang', '{SEQ:3}/PGB/{CO}/{ROMAWI}/{YYYY}', 'YEAR', 80),
  ('legalser_tzn_invoice', 'TZN-INVOICE', 'TZN', 'INVOICE', 'Invoice', 'INV/{CO}/{ROMAWI}/{YYYY}/{SEQ:3}', 'MONTH', 90),
  ('legalser_pats_invoice', 'PATS-INVOICE', 'PATS', 'INVOICE', 'Invoice PATS', 'PATS/INV/{ROMAWI}/{YYYY}-{SEQ:3}', 'MONTH', 100),
  ('legalser_pats_pks_univ', 'PATS-PKS-UNIV', 'PATS', 'PKS', 'PKS Venue PATS University', 'PKS/PATS-UNIV/{KOTA}/{BLN}/{YYYY}/{SEQ:3}', 'YEAR', 101),
  ('legalser_pats_pks_pic_venue', 'PATS-PKS-PIC-VENUE', 'PATS', 'PKS', 'PKS PIC Venue PATS University', 'PKS/PIC-VENUE/PATS-UNIV/{KOTA}/{BLN}/{YYYY}/{SEQ:3}', 'YEAR', 102),
  ('legalser_pats_spk_ch', 'PATS-SPK-CH', 'PATS', 'SPK', 'SPK City Head PATS University', 'SPK/CH/PATS-UNIV/{KOTA}/{BLN}/{YYYY}/{SEQ:3}', 'YEAR', 103),
  ('legalser_pats_nda_ch', 'PATS-NDA-CH', 'PATS', 'NDA', 'NDA City Head PATS University', 'NDA/CH/PATS-UNIV/{KOTA}/{BLN}/{YYYY}/{SEQ:3}', 'YEAR', 104),
  ('legalser_pats_spk_cc', 'PATS-SPK-CC', 'PATS', 'SPK', 'SPK Content Creator PATS University', 'SPK/CC/PATS-UNIV/{KOTA}/{BLN}/{YYYY}/{SEQ:3}', 'YEAR', 105),
  ('legalser_pats_nda_cc', 'PATS-NDA-CC', 'PATS', 'NDA', 'NDA Content Creator PATS University', 'NDA/CC/PATS-UNIV/{KOTA}/{BLN}/{YYYY}/{SEQ:3}', 'YEAR', 106),
  ('legalser_pats_spk_talent', 'PATS-SPK-TALENT', 'PATS', 'SPK', 'SPK Talent PATS', '{SEQ:3}/SPK-TALENT/PATS/{ROMAWI}/{YYYY}', 'YEAR', 107)
) AS v(id, key, company_code, doc_type, label, format, reset_period, position)
JOIN "LegalCompany" c ON c."code" = v.company_code
ON CONFLICT ("key") DO NOTHING;

COMMIT;
