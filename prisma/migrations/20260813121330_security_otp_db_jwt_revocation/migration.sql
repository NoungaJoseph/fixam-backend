-- Security Migration: DB-backed OTP + JWT Revocation
-- Apply this migration to your Supabase database from the Supabase SQL Editor
-- or via: npx prisma migrate deploy

-- 1. Add tokenVersion to User table for JWT revocation
--    (incremented on logout/password-change to invalidate old tokens)
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- 2. Create PendingVerification table (replaces in-memory OTP Map)
--    - OTPs stored as bcrypt hashes (plaintext never persisted)
--    - Crash-safe: survives server restarts
--    - Horizontally scalable: works across multiple server instances
--    - Per-record attempt lockout after 5 wrong guesses
CREATE TABLE IF NOT EXISTS "PendingVerification" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "identifier" TEXT        NOT NULL,
  "otpHash"    TEXT        NOT NULL,
  "type"       TEXT        NOT NULL,
  "payload"    JSONB,
  "attempts"   INTEGER     NOT NULL DEFAULT 0,
  "expiresAt"  TIMESTAMPTZ NOT NULL,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "PendingVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PendingVerification_identifier_idx"
  ON "PendingVerification"("identifier");

CREATE INDEX IF NOT EXISTS "PendingVerification_expiresAt_idx"
  ON "PendingVerification"("expiresAt");

-- 3. Cleanup: remove expired rows (optional, the app also auto-cleans hourly)
DELETE FROM "PendingVerification" WHERE "expiresAt" < now();
