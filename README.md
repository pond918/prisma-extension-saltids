# prisma-extension-saltids

**SaltIDs** is a Prisma 5+ extension that transparently transforms `Auto-Increment Int ID` + `Random Salt` into a single `Int` Public ID at the application layer. It provides an ID obfuscation solution with **zero schema overhead** through intelligent query interception.

* **App Layer**: Sees `123312` (Number).
* **DB Layer**: Stores `id: 312` and `idSalt: 123`.

This prevents **ID enumeration attacks** (scraping) while maintaining **primary key index performance**.

## Core Advantages

* 🛡️ **Enumeration Protection**: Even though IDs are auto-incrementing, the external world sees randomly jumping numbers.
* ⚡ **Zero Performance Cost**: Leverages the original primary key index for queries, requiring no additional indexes.
* 🪄 **Fully Transparent**:
  * Reading `user.id` automatically returns SaltID.
  * Writing `userId: SaltID` automatically unpacks and stores.
  * Querying `findUnique({ where: { id: SaltID } })` is automatically handled.
* 🙈 **Clean Output**: The `idSalt` field is hidden from `JSON.stringify` and loops.

## Installation

```bash
npm install prisma-extension-saltids
```

## Schema Preparation

Simply use the `Int` type and ensure there's a `idSalt` field. **No** additional `@@unique` indexes are required.

```prisma
model User {
  // 1. Physical Primary Key (Int)
  id Int @id @default(autoincrement())
  // 2. Random Salt (Int)
  idSalt Int?

  posts Post[]
}

model Post {
  postPk Int @id @default(autoincrement())
  postPkSalt Int?

  title String

  // 3. Relation Field Naming Convention (xxx + xxxSalt)
  authorId Int
  authorIdSalt Int?
  author User @relation(fields: [authorId], references: [id])

  @@index([authorId])
}
```

## Register Extension

```typescript
import { PrismaClient } from '@prisma/client';
import { saltIdsExtension } from 'prisma-extension-saltids';

const prisma = new PrismaClient().$extends(
  saltIdsExtension({
    saltLength: 3, // Default: 3 digits
    saltSuffix: 'Salt', // Default suffix for salt fields
  })
);
```

## Usage Example

```typescript
async function main() {
  // 1. Create (Transparent unpacking)
  const user = await prisma.user.create({
    data: { name: 'Geek' }
  });

  // 2. Read (Transparent composition)
  console.log(user.id); // 123312 (Number)
  console.log(JSON.stringify(user)); // {"id":123312, "name":"Geek"}

  // 3. Query (Automatically downgraded to findFirst)
  // Although you're calling findUnique, because the query condition becomes { id, idSalt }
  // the plugin automatically converts it to an efficient findFirst query, leveraging the id index.
  const found = await prisma.user.findUnique({
    where: { id: user.id }
  });

  // 4. Relations (Transparent)
  // Automatically unpacks authorId (SaltID) -> authorId + authorIdSalt
  await prisma.post.create({
    data: {
      title: 'Hello SaltIDs',
      authorId: user.id
    }
  });
}
```

## License

MIT
