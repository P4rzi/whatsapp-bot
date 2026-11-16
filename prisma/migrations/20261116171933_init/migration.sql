-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('STARTED', 'SUCCESS', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'QR_CODE_REQUIRED', 'CONNECTED', 'RECONNECTING', 'ERROR');

-- CreateEnum
CREATE TYPE "SystemCommandType" AS ENUM ('CONNECT_WHATSAPP', 'DISCONNECT_WHATSAPP', 'RESTART_WHATSAPP');

-- CreateEnum
CREATE TYPE "SystemCommandStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "consentAt" TIMESTAMPTZ(3),
    "consentSource" TEXT,
    "optedOutAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "message" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttempt" (
    "id" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL,
    "renderedMessage" TEXT,
    "errorMessage" TEXT,
    "providerMessageId" TEXT,
    "attemptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" UUID NOT NULL,
    "instance" TEXT NOT NULL DEFAULT 'default',
    "status" "WhatsAppStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "phoneNumber" TEXT,
    "qrCode" TEXT,
    "qrUpdatedAt" TIMESTAMPTZ(3),
    "lastConnectedAt" TIMESTAMPTZ(3),
    "lastDisconnectedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemCommand" (
    "id" UUID NOT NULL,
    "type" "SystemCommandType" NOT NULL,
    "payload" JSONB,
    "status" "SystemCommandStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SystemCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL DEFAULT 'worker',
    "instanceId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastCycleAt" TIMESTAMPTZ(3) NOT NULL,
    "lastCycleMs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultMessageTemplate" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Charge_scheduledAt_idx" ON "Charge"("scheduledAt");

-- CreateIndex
CREATE INDEX "Charge_status_idx" ON "Charge"("status");

-- CreateIndex
CREATE INDEX "Charge_customerId_idx" ON "Charge"("customerId");

-- CreateIndex
CREATE INDEX "Charge_status_scheduledAt_idx" ON "Charge"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "MessageAttempt_chargeId_idx" ON "MessageAttempt"("chargeId");

-- CreateIndex
CREATE INDEX "MessageAttempt_attemptedAt_idx" ON "MessageAttempt"("attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttempt_chargeId_attemptNumber_key" ON "MessageAttempt"("chargeId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_instance_key" ON "WhatsAppConnection"("instance");

-- CreateIndex
CREATE INDEX "SystemCommand_status_idx" ON "SystemCommand"("status");

-- CreateIndex
CREATE INDEX "SystemCommand_createdAt_idx" ON "SystemCommand"("createdAt");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
