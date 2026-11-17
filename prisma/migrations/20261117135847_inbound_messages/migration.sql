-- CreateEnum
CREATE TYPE "InboundKind" AS ENUM ('TEXT', 'AUDIO', 'IMAGE', 'DOCUMENT', 'VIDEO', 'STICKER', 'OTHER');

-- CreateEnum
CREATE TYPE "InboundIntent" AS ENUM ('OPT_OUT', 'PAYMENT_CLAIM', 'OTHER');

-- CreateTable
CREATE TABLE "InboundMessage" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "kind" "InboundKind" NOT NULL,
    "text" TEXT,
    "intent" "InboundIntent" NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "handledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundMessage_providerMessageId_key" ON "InboundMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "InboundMessage_customerId_idx" ON "InboundMessage"("customerId");

-- CreateIndex
CREATE INDEX "InboundMessage_receivedAt_idx" ON "InboundMessage"("receivedAt");

-- CreateIndex
CREATE INDEX "InboundMessage_handledAt_intent_idx" ON "InboundMessage"("handledAt", "intent");

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
