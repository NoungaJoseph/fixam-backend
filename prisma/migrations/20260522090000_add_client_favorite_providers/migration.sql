CREATE TABLE "ClientFavoriteProvider" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFavoriteProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientFavoriteProvider_clientId_providerId_key" ON "ClientFavoriteProvider"("clientId", "providerId");
CREATE INDEX "ClientFavoriteProvider_clientId_idx" ON "ClientFavoriteProvider"("clientId");
CREATE INDEX "ClientFavoriteProvider_providerId_idx" ON "ClientFavoriteProvider"("providerId");

ALTER TABLE "ClientFavoriteProvider" ADD CONSTRAINT "ClientFavoriteProvider_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientFavoriteProvider" ADD CONSTRAINT "ClientFavoriteProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
