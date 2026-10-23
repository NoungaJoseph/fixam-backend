ALTER TABLE "ProviderProfile"
ADD COLUMN IF NOT EXISTS "jobAlertPreferences" JSONB;
