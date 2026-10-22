ALTER TABLE "ConversationParticipant"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "ConversationParticipant_userId_archivedAt_idx"
ON "ConversationParticipant"("userId", "archivedAt");

ALTER TABLE "Conversation" ADD COLUMN "bookingId" TEXT;
CREATE UNIQUE INDEX "Conversation_bookingId_key" ON "Conversation"("bookingId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
