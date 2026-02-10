import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { saltIdsExtension } from "../src";

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
      }),
    );
  };

  beforeAll(async () => {
    prisma = createClient();
    // 清理脏数据
    try {
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
});
