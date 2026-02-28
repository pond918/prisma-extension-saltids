# prisma-extension-saltids

[![npm version](https://img.shields.io/npm/v/prisma-extension-saltids.svg?style=flat)](https://www.npmjs.com/package/prisma-extension-saltids)
[![License](https://img.shields.io/npm/l/prisma-extension-saltids.svg?style=flat)](https://github.com/pond918/prisma-extension-saltids/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/prisma-extension-saltids.svg?style=flat)](https://www.npmjs.com/package/prisma-extension-saltids)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074C1.svg)](http://www.typescriptlang.org/)

[English](#english) | [中文说明](#chinese)

<a name="english"></a>

Make your Prisma primary key IDs **Scrape-Proof**, **Secure**, **High-Performance**, and **Completely Transparent** to your business logic.

## What is it?

It transparently combines a database `Auto-Increment ID` (e.g., `1`) with a `Random Salt` (e.g., `123`) into a single **Public Obfuscated ID** (e.g., `1231`).

In your code, you only deal with this public ID. In the database, it remains a highly efficient auto-increment integer primary key.

## Why use it? Key Benefits

1.  🛡️ **Anti-Scraping / Enumeration Protection**: prevents others from guessing your data volume by traversing IDs like `user/1`, `user/2`.
2.  ⚡ **High Performance**: underlying checks still use the database's `Int` primary key index. Extremely fast queries with no need for additional string indexes (like UUIDs).
3.  🪄 **Zero Intrusion**:
    - **Read**: `user.id` is automatically transformed into the public ID.
    - **Write**: When saving to relation tables, the public ID is automatically unpacked into `xxx` and `xxxSalt` fields.
    - **Query**: `findUnique({ where: { id: PublicID } })` is automatically handled.
4.  🔢 **Pure Integer**: The generated ID is still a number (`BigInt` or `Int`), making it URL-friendly and shorter than UUIDs.

## How to use?

### 1. Install

```bash
npm install prisma-extension-saltids
```

### 2. Define Schema

Just add an `idSalt` field (`Int`) to your Model. No extra indexes needed!

```prisma
model User {
  id     Int  @id @default(autoincrement()) // Real Primary Key
  idSalt Int? // Random Salt
}
```

### 3. Register Extension

```typescript
import { PrismaClient } from "@prisma/client";
import { saltIdsExtension } from "prisma-extension-saltids";

const prisma = new PrismaClient().$extends(
  saltIdsExtension({
    saltLength: 3, // Salt length, e.g., 3 digits
  })
);
```

### 4. Foreign Keys

Foreign keys work as usual; simply add a corresponding salt field for the foreign key.

```prisma
model Post {
  id     Int @id @default(autoincrement())
  idSalt Int

  authorId     Int // Foreign Key as usual
  authorIdSalt Int? // Just add one line!
  author       User @relation(fields: [authorId], references: [id])

  @@index([authorId]) // Index works as usual, no need to add Salt
}
```

```typescript
// Query by foreign key automatically works
const posts = await prisma.post.findMany({
  where: { authorId: user.id }, // Pass the public ID (e.g. 5821)
});
// Automatically transforms to: where: { authorId: 1, authorIdSalt: 582 }
```

### 5. Enjoy!

Write code as usual, IDs are automatically obfuscated:

```typescript
// Create: Just pass data, ID and Salt are auto-generated
const user = await prisma.user.create({
  data: { name: "Geek" },
});

console.log(user.id);
// Output: 5821 (Assuming DB id=1, salt=582)
// Only you know how it's composed; externally it's just a random number.

// Query: directly use the public ID
const found = await prisma.user.findUnique({
  where: { id: user.id }, // Pass in 5821
});
// The plugin automatically unpacks it to: where: { id: 1, idSalt: 582 }
// Utilizing the primary key index!
```

### 6. Raw SQL ($queryRaw / $executeRaw)

Raw SQL has no model/field context, so this package does not try to "guess" and auto-decode numbers in raw queries.

Use `prisma.$saltIds` to build safe SQL fragments with explicit column references (supports table alias).

If your SELECT returns `xxx` and `xxxSalt` (column aliases should follow your configured `saltSuffix`), the extension will automatically:

- hide `xxxSalt` (non-enumerable)
- expose `xxx` as the public SaltID (getter)

```ts
import { PrismaClient } from "@prisma/client";
import { saltIdsExtension } from "prisma-extension-saltids";

const prisma = new PrismaClient().$extends(saltIdsExtension({ saltLength: 3, saltSuffix: "Salt" }));
const s = prisma.$saltIds;

const user = await prisma.user.create({ data: { name: "RawUser" } });

const uId = s.col("u", "id");
const whereEq = s.where.eq(uId, user.id);

const rows = await prisma.$queryRaw`
  SELECT u."id", u."idSalt", u."name"
  FROM "User" u
  WHERE ${whereEq}
`;
```

Unsafe positional example:

```ts
const frag = s.where.eq(s.col("User", "id"), user.id);
const u = s.toUnsafe(frag);
const rows = await prisma.$queryRawUnsafe(`SELECT id FROM "User" WHERE ${u.sql}`, ...u.values);
```

Range comparisons:

- `gtFromSaltId / ltFromSaltId / betweenFromSaltIds` compare by decoded `realId` only (salt cannot be validated for range queries).

### 7. ⚠️ Limitation

By default, the extension identifies fields matching the pattern `xxx` and `xxxSalt` as salted fields. Please be mindful of this naming convention when defining your schema.

---

<a name="chinese"></a>

## 中文说明

让你的 Prisma ID **防爬**、**安全**、**高性能**，且**对业务代码完全透明**。

### 它是干什么的？

它可以把数据库里的 `自增 ID` (比如 `1`) 和一个 `随机盐值` (比如 `123`) 自动合并成一个 **对外的混淆 ID** (比如 `1231` )。

在你的代码里，你只需要处理这个混淆后的 ID，而在数据库里，它依然是高效的整型自增主键。

### 有什么用？优点是啥？

1.  🛡️ **防爬虫/防遍历**：别人无法通过 `user/1`、`user/2` 这种规律猜测你的数据量。
2.  ⚡ **高性能**：底层依然使用数据库的 `Int` 主键索引，查询速度极快，不需要额外的字符串索引。
3.  🪄 **零侵入**：
    - **读**：`user.id` 自动变成混淆 ID。
    - **写**：存入关联表时，自动拆解混淆 ID 存入 `xxx` 和 `xxxSalt` 两个字段。
    - **查**：`findUnique({ where: { id: 混淆ID } })` 自动处理。
4.  🔢 **纯整型**：生成的 ID 依然是数字（`BigInt` 或 `Int`），适合用于 URL 和 JSON，比 UUID 更短更友好。

### 怎么用？

#### 1. 安装

```bash
npm install prisma-extension-saltids
```

#### 2. 定义 Schema

只需要在你的 Model 里加一个 `idSalt` 字段 (`Int`)。不需要任何额外索引！

```prisma
model User {
  id     Int  @id @default(autoincrement()) // 真实主键
  idSalt Int? // 盐值字段
}
```

#### 3. 注册扩展

```typescript
import { PrismaClient } from "@prisma/client";
import { saltIdsExtension } from "prisma-extension-saltids";

const prisma = new PrismaClient().$extends(
  saltIdsExtension({
    saltLength: 3, // 盐值长度，比如 3 位
  })
);
```

#### 4. 外键支持

外键也跟平时一样，只需要给外键加个 Salt 字段即可。

```prisma
model Post {
  id     Int @id @default(autoincrement())
  idSalt Int

  authorId     Int // 外键跟平时一样
  authorIdSalt Int? // 只需要加一行这个就够了！
  author       User @relation(fields: [authorId], references: [id])

  @@index([authorId]) // 索引跟平时一样，不需要加 Salt
}
```

```typescript
// 直接使用混淆后的 ID 进行查询
const posts = await prisma.post.findMany({
  where: { authorId: user.id }, // 传入混淆 ID
});
// 自动转换为: where: { authorId: 1, authorIdSalt: 582 }
```

#### 5. 爽！

像平常一样写代码，ID 自动混淆：

```typescript
// 创建：只需传入数据，ID 和 Salt 自动生成
const user = await prisma.user.create({
  data: { name: "Geek" },
});

console.log(user.id);
// 输出: 5821 (假设 DB id=1, salt=582)
// 只有你知道它是怎么拼出来的，外部看到的就是一个随机数

// 查询：直接用混淆后的 ID 查
const found = await prisma.user.findUnique({
  where: { id: user.id }, // 传入 5821
});
// 插件会自动拆解成 where: { id: 1, idSalt: 582 }，利用主键索引！
```

#### 6. Raw SQL ($queryRaw / $executeRaw)

Raw SQL 没有模型/字段上下文，因此本包不会在 raw 里“猜测”某个数字是否是 SaltID 并自动拆解。

请使用 `prisma.$saltIds` 生成严谨的 SQL 片段（支持表别名）。

只要 SELECT 返回 `xxx` 与 `xxxSalt`（列别名遵循配置的 `saltSuffix`），扩展会自动：

- 隐藏 `xxxSalt`（不可枚举）
- 把 `xxx` 映射成对外 SaltID（getter）

```ts
import { PrismaClient } from "@prisma/client";
import { saltIdsExtension } from "prisma-extension-saltids";

const prisma = new PrismaClient().$extends(saltIdsExtension({ saltLength: 3, saltSuffix: "Salt" }));
const s = prisma.$saltIds;

const user = await prisma.user.create({ data: { name: "RawUser" } });

const uId = s.col("u", "id");
const whereEq = s.where.eq(uId, user.id);

const rows = await prisma.$queryRaw`
  SELECT u."id", u."idSalt", u."name"
  FROM "User" u
  WHERE ${whereEq}
`;
```

Unsafe positional 示例：

```ts
const frag = s.where.eq(s.col("User", "id"), user.id);
const u = s.toUnsafe(frag);
const rows = await prisma.$queryRawUnsafe(`SELECT id FROM "User" WHERE ${u.sql}`, ...u.values);
```

范围比较：

- `gtFromSaltId / ltFromSaltId / betweenFromSaltIds` 仅比较解码后的 `realId`（范围查询无法做 salt 校验）。

#### 7. ⚠️ 限制

默认会把 `xxx` + `xxxSalt` 识别成加盐字段，故字段定义时需注意。
