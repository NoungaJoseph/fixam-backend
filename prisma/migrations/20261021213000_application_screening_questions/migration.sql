ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "applicationQuestions" JSONB;
ALTER TABLE "JobAssignment" ADD COLUMN IF NOT EXISTS "screeningAnswers" JSONB;
ALTER TABLE "ExternalJob" ADD COLUMN IF NOT EXISTS "applicationQuestions" JSONB;
ALTER TABLE "ExternalJobApplication" ADD COLUMN IF NOT EXISTS "screeningAnswers" JSONB;
