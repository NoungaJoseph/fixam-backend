ALTER TABLE "ProviderProfile"
ADD COLUMN "portfolio" JSONB,
ADD COLUMN "certificates" JSONB,
ADD COLUMN "profileScore" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Job"
ADD COLUMN "selectedAssignmentId" TEXT;

ALTER TABLE "JobAssignment"
ADD COLUMN "selectedAt" TIMESTAMP(3),
ADD COLUMN "refundedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "JobAssignment_jobId_providerId_key" ON "JobAssignment"("jobId", "providerId");

ALTER TABLE "Transaction"
ADD COLUMN "jobId" TEXT;

ALTER TABLE "Notification"
ADD COLUMN "archivedAt" TIMESTAMP(3);
