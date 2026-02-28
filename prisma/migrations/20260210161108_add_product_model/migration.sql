-- CreateTable
CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idSalt" INTEGER,
    "name" TEXT NOT NULL,
    "ownerId" INTEGER,
    "ownerIdSalt" INTEGER
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "postPk" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postPkSalt" INTEGER,
    "title" TEXT NOT NULL,
    "authorId" INTEGER,
    "authorIdSalt" INTEGER
);
INSERT INTO "new_Post" ("authorId", "authorIdSalt", "postPk", "postPkSalt", "title") SELECT "authorId", "authorIdSalt", "postPk", "postPkSalt", "title" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Product_ownerId_idx" ON "Product"("ownerId");
