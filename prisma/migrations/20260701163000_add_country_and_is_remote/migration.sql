-- AlterEnum
-- This is executed to add new payment method options to the PaymentMethod enum
ALTER TYPE "PaymentMethod" ADD VALUE 'M_PESA';
ALTER TYPE "PaymentMethod" ADD VALUE 'AIRTEL_MONEY';
ALTER TYPE "PaymentMethod" ADD VALUE 'VODAFONE_CASH';
ALTER TYPE "PaymentMethod" ADD VALUE 'MOOV_MONEY';
ALTER TYPE "PaymentMethod" ADD VALUE 'WAVE';
ALTER TYPE "PaymentMethod" ADD VALUE 'TIGO_PESA';
ALTER TYPE "PaymentMethod" ADD VALUE 'ETISALAT_CASH';

-- AlterTable
-- Adds the country and isRemote columns to Job table
ALTER TABLE "Job" ADD COLUMN "country" TEXT DEFAULT 'Cameroon',
ADD COLUMN "isRemote" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- Adds the country column to User table
ALTER TABLE "User" ADD COLUMN "country" TEXT DEFAULT 'Cameroon';
