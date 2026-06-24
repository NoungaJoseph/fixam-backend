-- CreateTable
CREATE TABLE "AdminMessage" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT,
    "recipientRole" TEXT,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "platformName" TEXT NOT NULL DEFAULT 'Fixam',
    "supportEmail" TEXT NOT NULL DEFAULT 'support@fixam.cm',
    "serviceFee" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'English',
    "baseCurrency" TEXT NOT NULL DEFAULT 'XAF',
    "apiEndpoint" TEXT NOT NULL DEFAULT 'https://api.fixam.cm/v1',
    "adminSecret" TEXT NOT NULL DEFAULT 'secret',
    "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT NOT NULL DEFAULT 'We are improving Fixam for you. Back soon!',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);
