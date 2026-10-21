-- Service agreements power the admin agreements list and agreement history.
-- The table may already exist on development databases, hence the safe guards.
CREATE TABLE IF NOT EXISTS "ServiceAgreement" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "publicAgreementNumber" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'BOOKING',
  "bookingId" TEXT,
  "taskId" TEXT,
  "clientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
  "terms" JSONB NOT NULL,
  "clientAcceptance" JSONB,
  "providerAcceptance" JSONB,
  "pdfReference" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "activatedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "supersededAt" TIMESTAMPTZ,
  CONSTRAINT "ServiceAgreement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceAgreement_publicAgreementNumber_key" UNIQUE ("publicAgreementNumber")
);

CREATE INDEX IF NOT EXISTS "ServiceAgreement_bookingId_version_idx" ON "ServiceAgreement" ("bookingId", "version");
CREATE INDEX IF NOT EXISTS "ServiceAgreement_taskId_version_idx" ON "ServiceAgreement" ("taskId", "version");
CREATE INDEX IF NOT EXISTS "ServiceAgreement_clientId_status_idx" ON "ServiceAgreement" ("clientId", "status");
CREATE INDEX IF NOT EXISTS "ServiceAgreement_providerId_status_idx" ON "ServiceAgreement" ("providerId", "status");
CREATE INDEX IF NOT EXISTS "ServiceAgreement_createdAt_idx" ON "ServiceAgreement" ("createdAt");
