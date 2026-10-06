-- Migration: External Job Listings & Expiry Date Management
-- Apply this migration to your PostgreSQL database

-- 1. Add expiryDate to Job table
ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "expiryDate" TIMESTAMPTZ;

-- 2. Add CV columns to User table
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "cvUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "cvName" TEXT;

-- 3. Add configurable re-check days to Settings table
ALTER TABLE "Settings"
  ADD COLUMN IF NOT EXISTS "externalJobRecheckDays" INTEGER NOT NULL DEFAULT 14;

-- 4. Create ExternalJob table
CREATE TABLE IF NOT EXISTS "ExternalJob" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "title"             TEXT NOT NULL,
  "companyName"       TEXT NOT NULL,
  "description"       TEXT NOT NULL,
  "requirements"      TEXT,
  "destinationEmail"  TEXT NOT NULL,
  "source"            TEXT,
  "verifiedBy"        TEXT,
  "verifiedAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiryDate"        TIMESTAMPTZ NOT NULL,
  "reverifyAt"        TIMESTAMPTZ,
  "status"            TEXT NOT NULL DEFAULT 'ACTIVE',
  "category"          TEXT DEFAULT 'General Service',
  "location"          TEXT,
  "isRemote"          BOOLEAN NOT NULL DEFAULT false,
  "country"           TEXT DEFAULT 'Cameroon',
  "salary"            TEXT,
  "currency"          TEXT DEFAULT 'XAF',
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "ExternalJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExternalJob_status_idx" ON "ExternalJob"("status");
CREATE INDEX IF NOT EXISTS "ExternalJob_expiryDate_idx" ON "ExternalJob"("expiryDate");
CREATE INDEX IF NOT EXISTS "ExternalJob_verifiedAt_idx" ON "ExternalJob"("verifiedAt");
CREATE INDEX IF NOT EXISTS "ExternalJob_createdAt_idx" ON "ExternalJob"("createdAt");

-- 5. Create ExternalJobApplication table
CREATE TABLE IF NOT EXISTS "ExternalJobApplication" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "externalJobId"     TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "applicantName"     TEXT NOT NULL,
  "applicantEmail"    TEXT NOT NULL,
  "applicantPhone"    TEXT,
  "destinationEmail"  TEXT NOT NULL,
  "coverLetter"       TEXT,
  "cvUrl"             TEXT,
  "cvName"            TEXT,
  "status"            TEXT NOT NULL DEFAULT 'SENT',
  "resendEmailId"     TEXT,
  "errorMessage"      TEXT,
  "sentAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "ExternalJobApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalJobApplication_externalJobId_fkey" FOREIGN KEY ("externalJobId") REFERENCES "ExternalJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExternalJobApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ExternalJobApplication_externalJobId_idx" ON "ExternalJobApplication"("externalJobId");
CREATE INDEX IF NOT EXISTS "ExternalJobApplication_userId_idx" ON "ExternalJobApplication"("userId");
CREATE INDEX IF NOT EXISTS "ExternalJobApplication_destinationEmail_idx" ON "ExternalJobApplication"("destinationEmail");
CREATE INDEX IF NOT EXISTS "ExternalJobApplication_sentAt_idx" ON "ExternalJobApplication"("sentAt");
CREATE INDEX IF NOT EXISTS "ExternalJobApplication_status_idx" ON "ExternalJobApplication"("status");
