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
    *   **Read**: `user.id` is automatically transformed into the public ID.
    *   **Write**: When saving to relation tables, the public ID is automatically unpacked into `xxx` and `xxxSalt` fields.
    *   **Query**: `findUnique({ where: { id: PublicID } })` is automatically handled.
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
import { PrismaClient } from '@prisma/client';
import { saltIdsExtension } from 'prisma-extension-saltids';

const prisma = new PrismaClient().$extends(
  saltIdsExtension({
    saltLength: 3, // Salt length, e.g., 3 digits
  })
);
```

### 4. Enjoy!

Write code as usual, IDs are automatically obfuscated:

```typescript
// Create: Just pass data, ID and Salt are auto-generated
const user = await prisma.user.create({
  data: { name: 'Geek' }
});

console.log(user.id); 
// Output: 5821 (Assuming DB id=1, salt=582)
// Only you know how it's composed; externally it's just a random number.

// Query: directly use the public ID
const found = await prisma.user.findUnique({
  where: { id: user.id } // Pass in 5821
});
// The plugin automatically unpacks it to: where: { id: 1, idSalt: 582 }
// Utilizing the primary key index!
```

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
    *   **读**：`user.id` 自动变成混淆 ID。
    *   **写**：存入关联表时，自动拆解混淆 ID 存入 `xxx` 和 `xxxSalt` 两个字段。
    *   **查**：`findUnique({ where: { id: 混淆ID } })` 自动处理。
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
import { PrismaClient } from '@prisma/client';
import { saltIdsExtension } from 'prisma-extension-saltids';

const prisma = new PrismaClient().$extends(
  saltIdsExtension({
    saltLength: 3, // 盐值长度，比如 3 位
  })
);
```

#### 4. 爽！

像平常一样写代码，ID 自动混淆：

```typescript
// 创建：只需传入数据，ID 和 Salt 自动生成
const user = await prisma.user.create({
  data: { name: 'Geek' }
});

console.log(user.id); 
// 输出: 5821 (假设 DB id=1, salt=582)
// 只有你知道它是怎么拼出来的，外部看到的就是一个随机数

// 查询：直接用混淆后的 ID 查
const found = await prisma.user.findUnique({
  where: { id: user.id } // 传入 5821
});
// 插件会自动拆解成 where: { id: 1, idSalt: 582 }，利用主键索引！
```
