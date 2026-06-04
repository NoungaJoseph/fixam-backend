-- CreateIndex
CREATE INDEX "Job_clientId_status_idx" ON "Job"("clientId", "status");

-- CreateIndex
CREATE INDEX "Job_status_approvalStatus_idx" ON "Job"("status", "approvalStatus");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");

-- CreateIndex
CREATE INDEX "JobAssignment_providerId_status_idx" ON "JobAssignment"("providerId", "status");

-- CreateIndex
CREATE INDEX "JobAssignment_jobId_status_idx" ON "JobAssignment"("jobId", "status");

-- CreateIndex
CREATE INDEX "Transaction_walletId_status_idx" ON "Transaction"("walletId", "status");

-- CreateIndex
CREATE INDEX "Transaction_walletId_createdAt_idx" ON "Transaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_clientId_status_idx" ON "Booking"("clientId", "status");

-- CreateIndex
CREATE INDEX "Booking_providerId_status_idx" ON "Booking"("providerId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
