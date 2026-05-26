-- CreateTable
CREATE TABLE
    IF NOT EXISTS "User" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "idSalt" INTEGER,
        "name" TEXT
    );

-- CreateTable
CREATE TABLE
    IF NOT EXISTS "Post" (
        "postPk" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "postPkSalt" INTEGER,
        "title" TEXT NOT NULL,
        "authorId" INTEGER NOT NULL,
        "authorIdSalt" INTEGER
    );

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_authorId_idx" ON "Post" ("authorId");