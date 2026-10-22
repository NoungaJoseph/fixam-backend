ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

UPDATE "Job"
SET "expiryDate" = "createdAt" + INTERVAL '14 days'
WHERE "expiryDate" IS NULL;
