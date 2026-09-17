ALTER TABLE "ProviderProfile" ADD COLUMN "socialLinks" JSONB;
ALTER TABLE "ProviderProfile" ADD COLUMN "profileMode" TEXT NOT NULL DEFAULT 'WORK';
