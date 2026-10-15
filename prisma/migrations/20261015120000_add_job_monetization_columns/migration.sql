-- Migration: Add Job Monetization, Pinning, Email Forwarding, and External Application Priority & Tracking
-- Safe SQL with IF NOT EXISTS to prevent migration failures

-- 1. Alter Job table
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "expiryDate" TIMESTAMPTZ;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "pinnedExpiresAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "forwardToEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "hiringEmail" TEXT;

-- 2. Alter User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cvUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cvName" TEXT;

-- 3. Alter Settings table
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "externalJobRecheckDays" INTEGER NOT NULL DEFAULT 14;

-- 4. Alter JobAssignment table
ALTER TABLE "JobAssignment" ADD COLUMN IF NOT EXISTS "cvUrl" TEXT;
ALTER TABLE "JobAssignment" ADD COLUMN IF NOT EXISTS "cvName" TEXT;
ALTER TABLE "JobAssignment" ADD COLUMN IF NOT EXISTS "cvViewedAt" TIMESTAMP(3);

-- 5. Create ExternalJob if not exists
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

-- 6. Create ExternalJobApplication if not exists
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
  "isPriority"        BOOLEAN NOT NULL DEFAULT false,
  "coinsSpent"        INTEGER NOT NULL DEFAULT 0,
  "cvViewedAt"        TIMESTAMP(3),
  "cvViewCount"       INTEGER NOT NULL DEFAULT 0,
  "viewToken"         TEXT,
  CONSTRAINT "ExternalJobApplication_pkey" PRIMARY KEY ("id")
);

-- 7. Add columns to ExternalJobApplication if table already existed
ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "isPriority" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "coinsSpent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "cvViewedAt" TIMESTAMP(3);
ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "cvViewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "viewToken" TEXT;
