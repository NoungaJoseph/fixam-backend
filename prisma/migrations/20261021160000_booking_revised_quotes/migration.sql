-- Premium revised-quote flow. Existing counter offers remain readable.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'REVISED_QUOTE_PENDING';

DO $$ BEGIN
  CREATE TYPE "BookingRevisionStatus" AS ENUM ('PENDING_CLIENT', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paymentPreference" TEXT DEFAULT 'AGREE_WITH_PROVIDER';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "budgetType" TEXT NOT NULL DEFAULT 'FIXED_BUDGET';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "acceptedRevisionId" TEXT;

CREATE TABLE IF NOT EXISTS "BookingRevision" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "BookingRevisionStatus" NOT NULL DEFAULT 'PENDING_CLIENT',
  "createdByUserId" TEXT NOT NULL,
  "reason" TEXT,
  "message" TEXT,
  "budget" DOUBLE PRECISION,
  "bookingDate" TIMESTAMP(3),
  "bookingTime" TEXT,
  "bookingDuration" TEXT,
  "scopeSummary" TEXT,
  "materialsList" JSONB,
  "paymentPreference" TEXT,
  "respondedAt" TIMESTAMP(3),
  "responseNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingRevision_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BookingRevision_bookingId_version_key" ON "BookingRevision"("bookingId", "version");
CREATE INDEX IF NOT EXISTS "BookingRevision_bookingId_status_idx" ON "BookingRevision"("bookingId", "status");
CREATE INDEX IF NOT EXISTS "BookingRevision_createdByUserId_createdAt_idx" ON "BookingRevision"("createdByUserId", "createdAt");
