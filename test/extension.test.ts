import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { saltIdsExtension } from "../src";
import { SaltIdsHelper } from "../src/utils";

describe("Prisma Extension SaltIDs", () => {
  let prisma: ReturnType<typeof createClient>;

  /*
   * 现在的设计，extension 自动负责 Salt 生成，不需要 Mock
   */
  const createClient = () => {
    return new PrismaClient().$extends(
      saltIdsExtension({
        saltLength: 3,
        saltSuffix: "Salt",
      })
    ) as any;
  };

  beforeAll(async () => {
    prisma = createClient();
    // 清理脏数据
    try {
      await prisma.product.deleteMany();
      await prisma.post.deleteMany();
      await prisma.user.deleteMany();
    } catch (e) {}
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. 创建: 应该返回合并后的 SaltID", async () => {
    const user = await prisma.user.create({
      data: { name: "Alice" },
    });

    // 验证类型
    expect(typeof user.id).toBe("number");

    // 验证长度 (3位Salt + ID长度)
    expect(user.id.toString().length).toBeGreaterThanOrEqual(4);
  });

  it("2. 查询: 应该能通过 SaltID 查到原始记录", async () => {
    const created = await prisma.user.create({ data: { name: "Bob" } });
    const saltId = created.id;

    const found = await prisma.user.findUnique({
      where: { id: saltId },
    });

    expect(found).not.toBeNull();
    expect(found?.id).toBe(saltId);
    expect(found?.name).toBe("Bob");
  });

  it("3. 关联: 应该能直接用 SaltID 创建外键关联", async () => {
    const user = await prisma.user.create({ data: { name: "Charlie" } });
    console.log("Created User SaltID:", user.id);

    // 创建 Post，authorId 直接传入 user.id (SaltID)
    // 插件会自动拆解 authorId -> authorId + authorIdSalt
    const post = await prisma.post.create({
      data: {
        title: "Testing Relations",
        authorId: user.id,
      },
    });

    expect(post).toBeDefined();

    // 验证关联是否成功
    const postWithAuthor = await prisma.post.findUnique({
      where: { postPk: post.postPk },
      include: { author: true },
    });
    console.log("Created Post:", JSON.stringify(postWithAuthor));

    expect(postWithAuthor?.author?.id).toBe(user.id);
    expect(postWithAuthor?.authorIdSalt).toBe(user.idSalt);

    const foundAuthor = await prisma.user.findUnique({
      where: { id: postWithAuthor?.authorId! },
    });
    expect(foundAuthor?.id).toBe(user.id);
  });

  it("4. 隐私: JSON 序列化时不应包含 Salt 字段", async () => {
    const user = await prisma.user.create({ data: { name: "Dave" } });

    const jsonString = JSON.stringify(user);
    const parsed = JSON.parse(jsonString);

    expect(parsed.id).toBe(user.id);
    expect(parsed.idSalt).toBeUndefined();
  });

  it("5. Nullable: Should hide salt field when base field is null", async () => {
    const post = await prisma.post.create({
      data: {
        title: "Orphan Post",
      },
    });

    expect(post).toBeDefined();
    expect(post.authorId).toBeNull();

    // Verify hiding mechanism
    const json = JSON.parse(JSON.stringify(post));
    expect(json.authorIdSalt).toBeUndefined();

    // Check enumerability directly
    expect(Object.keys(post)).not.toContain("authorIdSalt");
  });

  it("6. Select: Should auto-inject salt field when base is selected", async () => {
    const user = await prisma.user.create({ data: { name: "Eve" } });
    const saltId = user.id;

    // Only select id field, salt should be auto-injected
    const found = await prisma.user.findUnique({
      where: { id: saltId },
      select: { id: true, name: true },
    });

    expect(found).not.toBeNull();
    expect(found?.id).toBe(saltId);
    expect(found?.name).toBe("Eve");
    // Salt should have been injected internally for encoding to work
  });

  it("7. Include: Should work with relations when using select", async () => {
    const user = await prisma.user.create({ data: { name: "Frank" } });
    const post = await prisma.post.create({
      data: {
        title: "Test Include",
        authorId: user.id,
      },
    });

    // Include author with select on author
    const foundPost = await prisma.post.findUnique({
      where: { postPk: post.postPk },
      include: {
        author: {
          select: { id: true, name: true },
        },
      },
    });

    expect(foundPost).not.toBeNull();
    expect(foundPost?.author?.id).toBe(user.id);
    expect(foundPost?.author?.name).toBe("Frank");
  });

  it("8. OrderBy: Should work without injecting salt field", async () => {
    // Create multiple users
    await prisma.user.create({ data: { name: "User1" } });
    await prisma.user.create({ data: { name: "User2" } });
    await prisma.user.create({ data: { name: "User3" } });

    // OrderBy should NOT inject salt field
    const users = await prisma.user.findMany({
      orderBy: { id: "desc" },
      take: 3,
    });

    expect(users.length).toBeGreaterThanOrEqual(3);
    // Verify all returned users have valid SaltIDs
    users.forEach((user) => {
      expect(typeof user.id).toBe("number");
    });
  });

  it("9. Combined: Select + OrderBy should work correctly", async () => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { id: "asc" },
      take: 2,
    });

    expect(users.length).toBeGreaterThan(0);
    users.forEach((user) => {
      expect(typeof user.id).toBe("number");
      expect(typeof user.name).toBe("string");
    });
  });

  it("9.1 Where IN: Should work with Prisma id.in on SaltIDs", async () => {
    const u1 = await prisma.user.create({ data: { name: "WhereInU1" } });
    const u2 = await prisma.user.create({ data: { name: "WhereInU2" } });
    const found = await prisma.user.findMany({
      where: { id: { in: [u1.id, u2.id] } },
      select: { id: true, name: true },
    });
    const ids = found.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([u1.id, u2.id]));
  });

  it("9.2 Where NOT: Should work with Prisma id.not on SaltIDs", async () => {
    const u1 = await prisma.user.create({ data: { name: "WhereNotU1" } });
    const u2 = await prisma.user.create({ data: { name: "WhereNotU2" } });
    const found = await prisma.user.findMany({
      where: { id: { not: u1.id } },
      select: { id: true, name: true },
    });
    const ids = found.map((u) => u.id);
    expect(ids).not.toContain(u1.id);
    expect(ids).toContain(u2.id);
  });

  it("9.3 Where NOT IN: Should work with Prisma id.notIn on SaltIDs", async () => {
    const u1 = await prisma.user.create({ data: { name: "WhereNotInU1" } });
    const u2 = await prisma.user.create({ data: { name: "WhereNotInU2" } });
    const found = await prisma.user.findMany({
      where: { id: { notIn: [u1.id] } },
      select: { id: true, name: true },
    });
    const ids = found.map((u) => u.id);
    expect(ids).not.toContain(u1.id);
    expect(ids).toContain(u2.id);
  });

  it("9.4 Where GT/LT: Should compare by decoded realId only", async () => {
    const a = await prisma.user.create({ data: { name: "WhereRangeA" } });
    const b = await prisma.user.create({ data: { name: "WhereRangeB" } });
    const c = await prisma.user.create({ data: { name: "WhereRangeC" } });
    const aId = SaltIdsHelper.decode(a.id, 3).id;
    const bId = SaltIdsHelper.decode(b.id, 3).id;
    const cId = SaltIdsHelper.decode(c.id, 3).id;
    expect(aId).toBeLessThan(bId);
    expect(bId).toBeLessThan(cId);

    const gtB = await prisma.user.findMany({
      where: { id: { gt: b.id } },
      select: { id: true },
    });
    const gtIds = gtB.map((u) => u.id);
    expect(gtIds).toContain(c.id);
    expect(gtIds).not.toContain(a.id);
    expect(gtIds).not.toContain(b.id);

    const ltC = await prisma.user.findMany({
      where: { id: { lt: c.id } },
      select: { id: true },
    });
    const ltIds = ltC.map((u) => u.id);
    expect(ltIds).toContain(a.id);
    expect(ltIds).toContain(b.id);
    expect(ltIds).not.toContain(c.id);
  });

  it("9.5 Where IN: Should work with Prisma foreignKey.in on SaltIDs", async () => {
    const u1 = await prisma.user.create({ data: { name: "WhereFkInU1" } });
    const u2 = await prisma.user.create({ data: { name: "WhereFkInU2" } });
    const p1 = await prisma.post.create({ data: { title: "WhereFkInP1", authorId: u1.id } });
    const p2 = await prisma.post.create({ data: { title: "WhereFkInP2", authorId: u2.id } });
    const found = await prisma.post.findMany({
      where: { authorId: { in: [u1.id] } },
      select: { postPk: true, title: true, authorId: true },
    });
    const titles = found.map((p) => p.title);
    expect(titles).toContain(p1.title);
    expect(titles).not.toContain(p2.title);
  });

  // --- 新增测试：hasDefaultValue 逻辑 ---

  it("10. Salt Generation: Should generate salt for fields with default values (autoincrement)", async () => {
    // User.id has @default(autoincrement()) -> should generate salt
    const user = await prisma.user.create({
      data: { name: "TestUser" },
    });

    // Verify salt was generated
    expect(user.id).toBeDefined();
    expect(typeof user.id).toBe("number");
    // Salt should be hidden but present in internal state
    const rawUser = await prisma.$queryRawUnsafe(
      `SELECT id, idSalt FROM User WHERE id = (SELECT id FROM User WHERE name = 'TestUser' LIMIT 1)`
    );
    expect(Array.isArray(rawUser)).toBe(true);
    expect((rawUser as any)[0]?.idSalt).toBeDefined();
    expect((rawUser as any)[0]?.idSalt).not.toBeNull();
  });

  it("11. Salt Generation: Should generate salt when user provides value", async () => {
    // Create a product with ownerId (user provides value)
    const owner = await prisma.user.create({ data: { name: "Owner" } });
    const product = await prisma.product.create({
      data: {
        name: "Widget",
        ownerId: owner.id, // User provides value -> should generate salt
      },
    });

    // Verify salt was generated for ownerId
    const rawProduct = await prisma.$queryRawUnsafe(`SELECT ownerId, ownerIdSalt FROM Product WHERE name = 'Widget'`);
    expect(Array.isArray(rawProduct)).toBe(true);
    expect((rawProduct as any)[0]?.ownerIdSalt).toBeDefined();
    expect((rawProduct as any)[0]?.ownerIdSalt).not.toBeNull();
  });

  it("12. Salt Generation: Should NOT generate salt when optional field has no default and user doesn't provide value", async () => {
    // Create a product WITHOUT ownerId (user doesn't provide value, no default)
    const product = await prisma.product.create({
      data: {
        name: "Orphan Widget",
        // ownerId not provided -> should NOT generate salt
      },
    });

    expect(product.ownerId).toBeNull();

    // Verify salt was NOT generated
    const rawProduct = await prisma.$queryRawUnsafe(
      `SELECT ownerId, ownerIdSalt FROM Product WHERE name = 'Orphan Widget'`
    );
    expect(Array.isArray(rawProduct)).toBe(true);
    expect((rawProduct as any)[0]?.ownerId).toBeNull();
    expect((rawProduct as any)[0]?.ownerIdSalt).toBeNull();
  });

  it("13. Salt Generation: Verify behavior across multiple scenarios", async () => {
    // Scenario 1: autoincrement field -> generates salt
    const user1 = await prisma.user.create({ data: { name: "User1" } });
    expect(user1.id).toBeDefined();

    // Scenario 2: optional FK with value -> generates salt
    const product1 = await prisma.product.create({
      data: { name: "Product1", ownerId: user1.id },
    });
    expect(product1.ownerId).toBe(user1.id);

    // Scenario 3: optional FK without value -> no salt
    const product2 = await prisma.product.create({
      data: { name: "Product2" },
    });
    expect(product2.ownerId).toBeNull();

    // Verify in database
    const raw1 = await prisma.$queryRawUnsafe(`SELECT ownerIdSalt FROM Product WHERE name = 'Product1'`);
    const raw2 = await prisma.$queryRawUnsafe(`SELECT ownerIdSalt FROM Product WHERE name = 'Product2'`);

    expect((raw1 as any)[0]?.ownerIdSalt).not.toBeNull();
    expect((raw2 as any)[0]?.ownerIdSalt).toBeNull();
  });

  // --- 新增测试：Raw Query 参数转换 ---

  it("14. $queryRaw: Should decode SaltID in tagged template literal", async () => {
    const user = await prisma.user.create({ data: { name: "RawUser1" } });
    const saltId = user.id;

    const s = prisma.$saltIds;
    const where = s.where.eq(s.col("User", "id"), saltId);
    const result = (await prisma.$queryRaw`SELECT id FROM "User" WHERE ${where}`) as any[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);

    expect(result[0].id).toBeDefined();
  });

  it("15. $queryRawUnsafe: Should decode SaltID in positional arguments", async () => {
    const user = await prisma.user.create({ data: { name: "RawUser2" } });
    const saltId = user.id;

    const s = prisma.$saltIds;
    const where = s.where.eq(s.col("User", "id"), saltId);
    const u = s.toUnsafe(where);
    const result = (await prisma.$queryRawUnsafe(`SELECT id FROM "User" WHERE ${u.sql}`, ...u.values)) as any[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it("16. IN: Should decode SaltIDs in IN clause", async () => {
    const user1 = await prisma.user.create({ data: { name: "Join1" } });
    const user2 = await prisma.user.create({ data: { name: "Join2" } });

    const saltIds = [user1.id, user2.id];

    const s = prisma.$saltIds;
    const where = s.where.in(s.col("User", "id"), saltIds);
    const result = (await prisma.$queryRaw`SELECT id FROM "User" WHERE ${where} ORDER BY id ASC`) as any[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("17. $executeRaw: Should decode SaltID for write operations", async () => {
    const user = await prisma.user.create({ data: { name: "ExecuteUser" } });
    const saltId = user.id;

    const s = prisma.$saltIds;
    const where = s.where.eq(s.col("User", "id"), saltId);
    const count = await prisma.$executeRaw`UPDATE "User" SET "name" = 'UpdatedRaw' WHERE ${where}`;

    expect(count).toBe(1);

    const updated = await prisma.user.findUnique({ where: { id: saltId } });
    expect(updated?.name).toBe("UpdatedRaw");
  });

  it("18. $queryRaw: Should encode result when selecting base+salt", async () => {
    const user = await prisma.user.create({ data: { name: "RawResultUser" } });
    const saltId = user.id;

    const s = prisma.$saltIds;
    const where = s.where.eq(s.col("User", "id"), saltId);
    const rows = (await prisma.$queryRaw`SELECT "id", "idSalt" FROM "User" WHERE ${where}`) as any[];

    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(saltId);
    expect(Object.keys(rows[0])).not.toContain("idSalt");
  });
});
