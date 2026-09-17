ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "importantDetails" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "whatNeedsDone" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "taskScope" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "preferences" TEXT[];

CREATE TABLE IF NOT EXISTS "CareerpathEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerpathEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CareerpathModuleProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CareerpathModuleProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CareerpathCertificate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "certificateUrl" TEXT,

    CONSTRAINT "CareerpathCertificate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PageView" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SecurityLog" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "ipAddress" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CareerpathEnrollment_userId_idx" ON "CareerpathEnrollment"("userId");
CREATE INDEX IF NOT EXISTS "CareerpathEnrollment_categoryKey_idx" ON "CareerpathEnrollment"("categoryKey");
CREATE UNIQUE INDEX IF NOT EXISTS "CareerpathModuleProgress_userId_categoryKey_moduleId_key" ON "CareerpathModuleProgress"("userId", "categoryKey", "moduleId");
CREATE UNIQUE INDEX IF NOT EXISTS "CareerpathCertificate_userId_categoryKey_key" ON "CareerpathCertificate"("userId", "categoryKey");
CREATE INDEX IF NOT EXISTS "PageView_domain_path_idx" ON "PageView"("domain", "path");
CREATE INDEX IF NOT EXISTS "PageView_createdAt_idx" ON "PageView"("createdAt");
CREATE INDEX IF NOT EXISTS "SecurityLog_eventType_idx" ON "SecurityLog"("eventType");
CREATE INDEX IF NOT EXISTS "SecurityLog_createdAt_idx" ON "SecurityLog"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CareerpathEnrollment_userId_fkey') THEN
        ALTER TABLE "CareerpathEnrollment" ADD CONSTRAINT "CareerpathEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CareerpathModuleProgress_userId_fkey') THEN
        ALTER TABLE "CareerpathModuleProgress" ADD CONSTRAINT "CareerpathModuleProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CareerpathCertificate_userId_fkey') THEN
        ALTER TABLE "CareerpathCertificate" ADD CONSTRAINT "CareerpathCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
