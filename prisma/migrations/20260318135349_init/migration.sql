-- CreateTable
CREATE TABLE
    IF NOT EXISTS "Service" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "idSalt" INTEGER,
        "tenantId_" INTEGER NOT NULL,
        "tenantId_Salt" INTEGER,
        "slug" TEXT NOT NULL,
        "version" TEXT NOT NULL,
        "deletedAt" BIGINT NOT NULL DEFAULT 0,
        "name" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Service_tenantId__idx" ON "Service" ("tenantId_");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Service_tenantId__slug_version_deletedAt_key" ON "Service" ("tenantId_", "slug", "version", "deletedAt");