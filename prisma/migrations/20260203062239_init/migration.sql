-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idSalt" INTEGER,
    "name" TEXT
);

-- CreateTable
CREATE TABLE "Post" (
    "postPk" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postPkSalt" INTEGER,
    "title" TEXT NOT NULL,
    "authorId" INTEGER NOT NULL,
    "authorIdSalt" INTEGER
);

-- CreateIndex
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");
