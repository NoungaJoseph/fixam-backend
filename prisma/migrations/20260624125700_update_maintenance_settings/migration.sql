-- AlterTable
ALTER TABLE "Settings" 
  DROP COLUMN IF EXISTS "maintenanceEnabled",
  ADD COLUMN "appMaintenanceEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "webMaintenanceEnabled" BOOLEAN NOT NULL DEFAULT false;
