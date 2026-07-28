import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { saltIdsExtension } from '../src';
import { SaltIdsHelper } from '../src/utils';

describe('Prisma Extension SaltIDs', () => {
  let prisma: ReturnType<typeof createClient>;

  /*
   * 现在的设计，extension 自动负责 Salt 生成，不需要 Mock
   */
  const createClient = () => {
    return new PrismaClient().$extends(
      saltIdsExtension({
        saltLength: 3,
        saltSuffix: 'Salt',
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

  it('1. 创建: 应该返回合并后的 SaltID', async () => {
    const user = await prisma.user.create({
      data: { name: 'Alice' },
    });

    // 验证类型
    expect(typeof user.id).toBe('number');

    // 验证长度 (3位Salt + ID长度)
    expect(user.id.toString().length).toBeGreaterThanOrEqual(4);
  });

  it('2. 查询: 应该能通过 SaltID 查到原始记录', async () => {
    const created = await prisma.user.create({ data: { name: 'Bob' } });
    const saltId = created.id;

    const found = await prisma.user.findUnique({
      where: { id: saltId },
    });

    expect(found).not.toBeNull();
    expect(found?.id).toBe(saltId);
    expect(found?.name).toBe('Bob');
  });

  it('3. 关联: 应该能直接用 SaltID 创建外键关联', async () => {
    const user = await prisma.user.create({ data: { name: 'Charlie' } });
    console.log('Created User SaltID:', user.id);

    // 创建 Post，authorId 直接传入 user.id (SaltID)
    // 插件会自动拆解 authorId -> authorId + authorIdSalt
    const post = await prisma.post.create({
      data: {
        title: 'Testing Relations',
        authorId: user.id,
      },
    });

    expect(post).toBeDefined();

    // 验证关联是否成功
    const postWithAuthor = await prisma.post.findUnique({
      where: { postPk: post.postPk },
      include: { author: true },
    });
    console.log('Created Post:', JSON.stringify(postWithAuthor));

    expect(postWithAuthor?.author?.id).toBe(user.id);
    expect(postWithAuthor?.authorIdSalt).toBe(user.idSalt);

    const foundAuthor = await prisma.user.findUnique({
      where: { id: postWithAuthor?.authorId! },
    });
    expect(foundAuthor?.id).toBe(user.id);
  });

  it('4. 隐私: JSON 序列化时不应包含 Salt 字段', async () => {
    const user = await prisma.user.create({ data: { name: 'Dave' } });

    const jsonString = JSON.stringify(user);
    const parsed = JSON.parse(jsonString);

    expect(parsed.id).toBe(user.id);
    expect(parsed.idSalt).toBeUndefined();
  });

  it('5. Nullable: Should hide salt field when base field is null', async () => {
    const post = await prisma.post.create({
      data: {
        title: 'Orphan Post',
      },
    });

    expect(post).toBeDefined();
    expect(post.authorId).toBeNull();

    // Verify hiding mechanism
    const json = JSON.parse(JSON.stringify(post));
    expect(json.authorIdSalt).toBeUndefined();

    // Check enumerability directly
    expect(Object.keys(post)).not.toContain('authorIdSalt');
  });

  it('6. Select: Should auto-inject salt field when base is selected', async () => {
    const user = await prisma.user.create({ data: { name: 'Eve' } });
    const saltId = user.id;

    // Only select id field, salt should be auto-injected
    const found = await prisma.user.findUnique({
      where: { id: saltId },
      select: { id: true, name: true },
    });

    expect(found).not.toBeNull();
    expect(found?.id).toBe(saltId);
    expect(found?.name).toBe('Eve');
    // Salt should have been injected internally for encoding to work
  });

  it('7. Include: Should work with relations when using select', async () => {
    const user = await prisma.user.create({ data: { name: 'Frank' } });
    const post = await prisma.post.create({
      data: {
        title: 'Test Include',
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
    expect(foundPost?.author?.name).toBe('Frank');
  });

  it('8. OrderBy: Should work without injecting salt field', async () => {
    // Create multiple users
    await prisma.user.create({ data: { name: 'User1' } });
    await prisma.user.create({ data: { name: 'User2' } });
    await prisma.user.create({ data: { name: 'User3' } });

    // OrderBy should NOT inject salt field
    const users = await prisma.user.findMany({
      orderBy: { id: 'desc' },
      take: 3,
    });

    expect(users.length).toBeGreaterThanOrEqual(3);
    // Verify all returned users have valid SaltIDs
    users.forEach((user) => {
      expect(typeof user.id).toBe('number');
    });
  });

  it('9. Combined: Select + OrderBy should work correctly', async () => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      take: 2,
    });

    expect(users.length).toBeGreaterThan(0);
    users.forEach((user) => {
      expect(typeof user.id).toBe('number');
      expect(typeof user.name).toBe('string');
    });
  });

  it('9.1 Where IN: Should work with Prisma id.in on SaltIDs', async () => {
    const u1 = await prisma.user.create({ data: { name: 'WhereInU1' } });
    const u2 = await prisma.user.create({ data: { name: 'WhereInU2' } });
    const found = await prisma.user.findMany({
      where: { id: { in: [u1.id, u2.id] } },
      select: { id: true, name: true },
    });
    const ids = found.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([u1.id, u2.id]));
  });

  it('9.2 Where NOT: Should work with Prisma id.not on SaltIDs', async () => {
    const u1 = await prisma.user.create({ data: { name: 'WhereNotU1' } });
    const u2 = await prisma.user.create({ data: { name: 'WhereNotU2' } });
    const found = await prisma.user.findMany({
      where: { id: { not: u1.id } },
      select: { id: true, name: true },
    });
    const ids = found.map((u) => u.id);
    expect(ids).not.toContain(u1.id);
    expect(ids).toContain(u2.id);
  });

  it('9.3 Where NOT IN: Should work with Prisma id.notIn on SaltIDs', async () => {
    const u1 = await prisma.user.create({ data: { name: 'WhereNotInU1' } });
    const u2 = await prisma.user.create({ data: { name: 'WhereNotInU2' } });
    const found = await prisma.user.findMany({
      where: { id: { notIn: [u1.id] } },
      select: { id: true, name: true },
    });
    const ids = found.map((u) => u.id);
    expect(ids).not.toContain(u1.id);
    expect(ids).toContain(u2.id);
  });

  it('9.4 Where GT/LT: Should compare by decoded realId only', async () => {
    const a = await prisma.user.create({ data: { name: 'WhereRangeA' } });
    const b = await prisma.user.create({ data: { name: 'WhereRangeB' } });
    const c = await prisma.user.create({ data: { name: 'WhereRangeC' } });
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

  it('9.5 Where IN: Should work with Prisma foreignKey.in on SaltIDs', async () => {
    const u1 = await prisma.user.create({ data: { name: 'WhereFkInU1' } });
    const u2 = await prisma.user.create({ data: { name: 'WhereFkInU2' } });
    const p1 = await prisma.post.create({ data: { title: 'WhereFkInP1', authorId: u1.id } });
    const p2 = await prisma.post.create({ data: { title: 'WhereFkInP2', authorId: u2.id } });
    const found = await prisma.post.findMany({
      where: { authorId: { in: [u1.id] } },
      select: { postPk: true, title: true, authorId: true },
    });
    const titles = found.map((p) => p.title);
    expect(titles).toContain(p1.title);
    expect(titles).not.toContain(p2.title);
  });

  // --- 新增测试：hasDefaultValue 逻辑 ---

  it('10. Salt Generation: Should generate salt for fields with default values (autoincrement)', async () => {
    // User.id has @default(autoincrement()) -> should generate salt
    const user = await prisma.user.create({
      data: { name: 'TestUser' },
    });

    // Verify salt was generated
    expect(user.id).toBeDefined();
    expect(typeof user.id).toBe('number');
    // Salt should be hidden but present in internal state
    const rawUser = await prisma.$queryRawUnsafe(
      `SELECT id, idSalt FROM User WHERE id = (SELECT id FROM User WHERE name = 'TestUser' LIMIT 1)`
    );
    expect(Array.isArray(rawUser)).toBe(true);
    expect((rawUser as any)[0]?.idSalt).toBeDefined();
    expect((rawUser as any)[0]?.idSalt).not.toBeNull();
  });

  it('11. Salt Generation: Should generate salt when user provides value', async () => {
    // Create a product with ownerId (user provides value)
    const owner = await prisma.user.create({ data: { name: 'Owner' } });
    const product = await prisma.product.create({
      data: {
        name: 'Widget',
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
        name: 'Orphan Widget',
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

  it('13. Salt Generation: Verify behavior across multiple scenarios', async () => {
    // Scenario 1: autoincrement field -> generates salt
    const user1 = await prisma.user.create({ data: { name: 'User1' } });
    expect(user1.id).toBeDefined();

    // Scenario 2: optional FK with value -> generates salt
    const product1 = await prisma.product.create({
      data: { name: 'Product1', ownerId: user1.id },
    });
    expect(product1.ownerId).toBe(user1.id);

    // Scenario 3: optional FK without value -> no salt
    const product2 = await prisma.product.create({
      data: { name: 'Product2' },
    });
    expect(product2.ownerId).toBeNull();

    // Verify in database
    const raw1 = await prisma.$queryRawUnsafe(`SELECT ownerIdSalt FROM Product WHERE name = 'Product1'`);
    const raw2 = await prisma.$queryRawUnsafe(`SELECT ownerIdSalt FROM Product WHERE name = 'Product2'`);

    expect((raw1 as any)[0]?.ownerIdSalt).not.toBeNull();
    expect((raw2 as any)[0]?.ownerIdSalt).toBeNull();
  });

  // --- 新增测试：Raw Query 参数转换 ---

  it('14. $queryRaw: Should decode SaltID in tagged template literal', async () => {
    const user = await prisma.user.create({ data: { name: 'RawUser1' } });
    const saltId = user.id;

    const s = prisma.$saltIds;
    const where = s.where.eq(s.col('User', 'id'), saltId);
    const result = (await prisma.$queryRaw`SELECT id FROM "User" WHERE ${where}`) as any[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);

    expect(result[0].id).toBeDefined();
  });

  it('15. $queryRawUnsafe: Should decode SaltID in positional arguments', async () => {
    const user = await prisma.user.create({ data: { name: 'RawUser2' } });
    const saltId = user.id;

    const s = prisma.$saltIds;
    const where = s.where.eq(s.col('User', 'id'), saltId);
    const u = s.toUnsafe(where);
    const result = (await prisma.$queryRawUnsafe(`SELECT id FROM "User" WHERE ${u.sql}`, ...u.values)) as any[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it('16. IN: Should decode SaltIDs in IN clause', async () => {
    const user1 = await prisma.user.create({ data: { name: 'Join1' } });
    const user2 = await prisma.user.create({ data: { name: 'Join2' } });

    const saltIds = [user1.id, user2.id];

    const s = prisma.$saltIds;
    const where = s.where.in(s.col('User', 'id'), saltIds);
    const result = (await prisma.$queryRaw`SELECT id FROM "User" WHERE ${where} ORDER BY id ASC`) as any[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('17. $executeRaw: Should decode SaltID for write operations', async () => {
    const user = await prisma.user.create({ data: { name: 'ExecuteUser' } });
    const saltId = user.id;

    const s = prisma.$saltIds;
    const where = s.where.eq(s.col('User', 'id'), saltId);
    const count = await prisma.$executeRaw`UPDATE "User" SET "name" = 'UpdatedRaw' WHERE ${where}`;

    expect(count).toBe(1);

    const updated = await prisma.user.findUnique({ where: { id: saltId } });
    expect(updated?.name).toBe('UpdatedRaw');
  });

  it('18. $queryRaw: Should encode result when selecting base+salt', async () => {
    const user = await prisma.user.create({ data: { name: 'RawResultUser' } });
    const saltId = user.id;

    const s = prisma.$saltIds;
    const where = s.where.eq(s.col('User', 'id'), saltId);
    const rows = (await prisma.$queryRaw`SELECT "id", "idSalt" FROM "User" WHERE ${where}`) as any[];

    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(saltId);
    expect(Object.keys(rows[0])).not.toContain('idSalt');
  });

  describe('Unique Index without Salt field', () => {
    it('19. Should decode salted ID in unique index query without including salt field', async () => {
      const tenant = await prisma.user.create({ data: { name: 'Tenant1' } });
      const tenantSaltId = tenant.id;

      const service = await prisma.service.create({
        data: {
          name: 'TestService',
          slug: 'test-service',
          version: '1.0.0',
          tenantId_: tenantSaltId,
        },
      });

      expect(service).toBeDefined();
      expect(service.tenantId_).toBe(tenantSaltId);

      const found = await prisma.service.findUnique({
        where: {
          tenantId__slug_version_deletedAt: {
            tenantId_: tenantSaltId,
            slug: 'test-service',
            version: '1.0.0',
            deletedAt: 0,
          },
        },
      });

      expect(found).not.toBeNull();
      expect(found?.slug).toBe('test-service');
      expect(found?.tenantId_).toBe(tenantSaltId);
    });

    it('20. Should handle upsert with unique index without salt field', async () => {
      const tenant = await prisma.user.create({ data: { name: 'Tenant2' } });
      const tenantSaltId = tenant.id;

      const created = await prisma.service.upsert({
        where: {
          tenantId__slug_version_deletedAt: {
            tenantId_: tenantSaltId,
            slug: 'upsert-service',
            version: '1.0.0',
            deletedAt: 0,
          },
        },
        update: {
          name: 'UpdatedService',
        },
        create: {
          name: 'CreatedService',
          slug: 'upsert-service',
          version: '1.0.0',
          tenantId_: tenantSaltId,
        },
      });

      expect(created).toBeDefined();
      expect(created.name).toBe('CreatedService');

      const updated = await prisma.service.upsert({
        where: {
          tenantId__slug_version_deletedAt: {
            tenantId_: tenantSaltId,
            slug: 'upsert-service',
            version: '1.0.0',
            deletedAt: 0,
          },
        },
        update: {
          name: 'UpdatedService',
        },
        create: {
          name: 'CreatedService',
          slug: 'upsert-service',
          version: '1.0.0',
          tenantId_: tenantSaltId,
        },
      });

      expect(updated.name).toBe('UpdatedService');
      expect(updated.id).toBe(created.id);
    });

    it('21. Should work with multiple unique index queries', async () => {
      const tenant1 = await prisma.user.create({ data: { name: 'Tenant3' } });
      const tenant2 = await prisma.user.create({ data: { name: 'Tenant4' } });

      await prisma.service.create({
        data: {
          name: 'Service1',
          slug: 'multi-service',
          version: '1.0.0',
          tenantId_: tenant1.id,
        },
      });

      await prisma.service.create({
        data: {
          name: 'Service2',
          slug: 'multi-service',
          version: '1.0.0',
          tenantId_: tenant2.id,
        },
      });

      const found1 = await prisma.service.findUnique({
        where: {
          tenantId__slug_version_deletedAt: {
            tenantId_: tenant1.id,
            slug: 'multi-service',
            version: '1.0.0',
            deletedAt: 0,
          },
        },
      });

      const found2 = await prisma.service.findUnique({
        where: {
          tenantId__slug_version_deletedAt: {
            tenantId_: tenant2.id,
            slug: 'multi-service',
            version: '1.0.0',
            deletedAt: 0,
          },
        },
      });

      expect(found1?.name).toBe('Service1');
      expect(found2?.name).toBe('Service2');
    });
  });

  describe('Auto-ensure salt fields when select contains xxxSalt: false', () => {
    it('22. findUnique with { id: true, idSalt: false } should still encode id correctly', async () => {
      const user = await prisma.user.create({ data: { name: 'SaltFalseUser' } });
      const saltId = user.id;

      const found = await prisma.user.findUnique({
        where: { id: saltId },
        select: { id: true, idSalt: false, name: true },
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(saltId);
      expect(found?.name).toBe('SaltFalseUser');
      expect(Object.keys(found!)).not.toContain('idSalt');
    });

    it('23. findUnique with { id: true, idSalt: false } should return encoded salted id', async () => {
      const user = await prisma.user.create({ data: { name: 'SaltFalseUser2' } });
      const saltId = user.id;

      const found = await prisma.user.findUnique({
        where: { id: saltId },
        select: { id: true, idSalt: false },
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(saltId);
      const json = JSON.parse(JSON.stringify(found));
      expect(json.idSalt).toBeUndefined();
    });

    it('24. findMany with { id: true, idSalt: false } should encode all ids', async () => {
      const prefix = `ManySaltFalse_${Date.now()}`;
      const u1 = await prisma.user.create({ data: { name: `${prefix}_1` } });
      const u2 = await prisma.user.create({ data: { name: `${prefix}_2` } });

      const found = await prisma.user.findMany({
        where: { name: { in: [`${prefix}_1`, `${prefix}_2`] } },
        select: { id: true, idSalt: false, name: true },
      });

      expect(found.length).toBe(2);
      const ids = found.map((u) => u.id);
      expect(ids).toContain(u1.id);
      expect(ids).toContain(u2.id);
      found.forEach((u) => {
        expect(Object.keys(u)).not.toContain('idSalt');
      });
    });

    it('25. findFirst with { id: true, idSalt: false } should encode id', async () => {
      const uniqueName = `FirstSaltFalse_${Date.now()}`;
      const user = await prisma.user.create({ data: { name: uniqueName } });
      const saltId = user.id;

      const found = await prisma.user.findFirst({
        where: { name: uniqueName },
        select: { id: true, idSalt: false },
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(saltId);
    });

    it('26. select with { id: false } should not force-add idSalt (base excluded)', async () => {
      const user = await prisma.user.create({ data: { name: 'BaseExcludedUser' } });
      const saltId = user.id;

      const found = await prisma.user.findUnique({
        where: { id: saltId },
        select: { id: false, name: true },
      });

      expect(found).not.toBeNull();
      expect(found?.name).toBe('BaseExcludedUser');
      expect(Object.keys(found!)).not.toContain('id');
      expect(Object.keys(found!)).not.toContain('idSalt');
    });

    it('27. FK salt field with { authorId: true, authorIdSalt: false } should encode authorId', async () => {
      const user = await prisma.user.create({ data: { name: 'FkSaltFalseAuthor' } });
      const post = await prisma.post.create({
        data: { title: 'FkSaltFalsePost', authorId: user.id },
      });

      const found = await prisma.post.findUnique({
        where: { postPk: post.postPk },
        select: { postPk: true, authorId: true, authorIdSalt: false, title: true },
      });

      expect(found).not.toBeNull();
      expect(found?.authorId).toBe(user.id);
      expect(Object.keys(found!)).not.toContain('authorIdSalt');
    });

    it('28. update with select { id: true, idSalt: false } should encode id in returned result', async () => {
      const user = await prisma.user.create({ data: { name: 'UpdateSaltFalse' } });
      const saltId = user.id;

      const updated = await prisma.user.update({
        where: { id: saltId },
        data: { name: 'UpdateSaltFalseUpdated' },
        select: { id: true, idSalt: false, name: true },
      });

      expect(updated.id).toBe(saltId);
      expect(updated.name).toBe('UpdateSaltFalseUpdated');
      expect(Object.keys(updated)).not.toContain('idSalt');
    });

    it('29. select with only exclusion { idSalt: false, postPkSalt: false } (all-false) should still encode ids', async () => {
      const user = await prisma.user.create({ data: { name: 'AllFalseSelect' } });

      const found = await prisma.user.findUnique({
        where: { id: user.id },
        select: { idSalt: false },
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(user.id);
      const json = JSON.parse(JSON.stringify(found));
      expect(json.idSalt).toBeUndefined();
    });
  });

  describe('Autoincrement ID with salt injection (Connector-like scenario)', () => {
    it('30. Should create record when only idSalt is injected (no explicit id)', async () => {
      const user = await prisma.user.create({
        data: { name: 'AutoIncrementSaltTest' },
      });

      expect(user).toBeDefined();
      expect(typeof user.id).toBe('number');
      expect(user.id.toString().length).toBeGreaterThanOrEqual(4);

      const found = await prisma.user.findUnique({ where: { id: user.id } });
      expect(found).not.toBeNull();
      expect(found?.name).toBe('AutoIncrementSaltTest');
    });

    it('31. Should create record with explicit FK saltId and autoincrement PK', async () => {
      const owner = await prisma.user.create({ data: { name: 'FKOwner' } });

      const product = await prisma.product.create({
        data: {
          name: 'FKProduct',
          ownerId: owner.id,
        },
      });

      expect(product).toBeDefined();
      expect(typeof product.id).toBe('number');
      expect(product.ownerId).toBe(owner.id);
    });

    it('32. Should create record with no FK and autoincrement PK', async () => {
      const product = await prisma.product.create({
        data: {
          name: 'NoFKProduct',
        },
      });

      expect(product).toBeDefined();
      expect(typeof product.id).toBe('number');
      expect(product.ownerId).toBeNull();
    });
  });

  describe('Reference field salt mismatch (strict rawId+salt matching)', () => {
    // { in: [...] } queries must strictly match both rawId AND salt.
    // If a reference field's salt column differs from the input saltId's salt,
    // the record should NOT be matched. This is the correct business semantics:
    // a saltId encodes a specific rawId+salt pair, and { in: [...] } must
    // match that exact pair, not just the rawId.

    it('33. findMany with FK { in: [...] } should NOT match when FK salt differs from input saltId', async () => {
      // 1. Create a User (target record)
      const user = await prisma.user.create({ data: { name: 'RefTargetUser' } });

      // 2. Create a Post with authorId = user.id
      //    saltids extension will set authorIdSalt = user.idSalt
      const post = await prisma.post.create({
        data: { title: 'RefTestPost', authorId: user.id },
      });

      // Verify initial state: authorIdSalt matches user.idSalt
      expect(post.authorId).toBe(user.id);

      // 3. Tamper with Post.authorIdSalt to simulate salt mismatch
      //    (e.g., Favorite.targetIdSalt != ConnectorMeta.idSalt)
      const rawPostPk = SaltIdsHelper.decode(post.postPk, 3).id;
      const rawPost = await prisma.$queryRawUnsafe(
        `SELECT postPk, authorId, authorIdSalt FROM Post WHERE postPk = ${rawPostPk}`
      ) as any[];
      const originalSalt = rawPost[0].authorIdSalt;
      const mismatchedSalt = originalSalt + 1;

      await prisma.$executeRawUnsafe(
        `UPDATE Post SET authorIdSalt = ${mismatchedSalt} WHERE postPk = ${rawPostPk}`
      );

      // 4. Re-fetch the post: authorId is now a different saltId (rawId + mismatchedSalt)
      const refetched = await prisma.post.findUnique({
        where: { postPk: post.postPk },
      });
      expect(refetched?.authorId).not.toBe(user.id);

      // 5. THE KEY TEST: { in: [user.id] } should NOT match the Post
      //    because user.id decodes to (rawId, originalSalt) but Post now has mismatchedSalt
      const found = await prisma.post.findMany({
        where: { authorId: { in: [user.id] } },
      });

      const foundPks = found.map((p: any) => p.postPk);
      expect(foundPks).not.toContain(post.postPk);
    });

    it('34. findMany with FK { in: [...] } should match when salt matches correctly', async () => {
      // When salt DOES match, { in: [...] } should find the record
      const user1 = await prisma.user.create({ data: { name: 'RefMatchUser1' } });
      const user2 = await prisma.user.create({ data: { name: 'RefMatchUser2' } });

      const post1 = await prisma.post.create({
        data: { title: 'RefMatchPost1', authorId: user1.id },
      });
      const post2 = await prisma.post.create({
        data: { title: 'RefMatchPost2', authorId: user2.id },
      });

      // Query with user1.id should find post1 but NOT post2
      const found = await prisma.post.findMany({
        where: { authorId: { in: [user1.id] } },
      });

      const foundPks = found.map((p: any) => p.postPk);
      expect(foundPks).toContain(post1.postPk);
      expect(foundPks).not.toContain(post2.postPk);
    });

    it('35. findMany with FK equals should match when salt matches (baseline)', async () => {
      // Baseline: when salt matches, equals query should work
      const user = await prisma.user.create({ data: { name: 'RefBaselineUser' } });
      const post = await prisma.post.create({
        data: { title: 'RefBaselinePost', authorId: user.id },
      });

      const found = await prisma.post.findMany({
        where: { authorId: user.id },
      });

      expect(found.length).toBeGreaterThanOrEqual(1);
      const foundPks = found.map((p: any) => p.postPk);
      expect(foundPks).toContain(post.postPk);
    });

    it('36. findMany with FK { in: [...] } mixing matched and mismatched salts', async () => {
      const user1 = await prisma.user.create({ data: { name: 'RefMixUser1' } });
      const user2 = await prisma.user.create({ data: { name: 'RefMixUser2' } });
      const post1 = await prisma.post.create({
        data: { title: 'RefMixPost1', authorId: user1.id },
      });
      const post2 = await prisma.post.create({
        data: { title: 'RefMixPost2', authorId: user2.id },
      });

      const rawPostPk1 = SaltIdsHelper.decode(post1.postPk, 3).id;
      const rawPost = await prisma.$queryRawUnsafe(
        `SELECT authorIdSalt FROM Post WHERE postPk = ${rawPostPk1}`
      ) as any[];
      const mismatchedSalt = rawPost[0].authorIdSalt + 42;
      await prisma.$executeRawUnsafe(
        `UPDATE Post SET authorIdSalt = ${mismatchedSalt} WHERE postPk = ${rawPostPk1}`
      );

      const found = await prisma.post.findMany({
        where: { authorId: { in: [user1.id, user2.id] } },
      });
      const foundPks = found.map((p: any) => p.postPk);
      expect(foundPks).not.toContain(post1.postPk);
      expect(foundPks).toContain(post2.postPk);
    });
  });

  describe('Favorite-like upsert: FK salt correctness diagnosis', () => {
    // Diagnose: when creating a record via upsert with a composite unique index
    // that includes a FK field (like Favorite.targetId), does the saltids extension
    // correctly store the target's salt in the FK's salt column?

    it('37. upsert create: FK salt should match target record salt (direct DB verification)', async () => {
      const user = await prisma.user.create({ data: { name: 'FavTargetUser' } });

      // Get User's raw id and idSalt directly from DB
      const rawUser = await prisma.$queryRawUnsafe(
        `SELECT id, idSalt FROM User WHERE name = 'FavTargetUser'`
      ) as any[];
      const dbUserId = rawUser[0].id;
      const dbUserIdSalt = rawUser[0].idSalt;
      console.log(`[DIAG] User raw: id=${dbUserId}, idSalt=${dbUserIdSalt}, saltId=${user.id}`);

      // Create Service via upsert (simulates Favorite creation with composite unique index)
      const service = await prisma.service.upsert({
        where: {
          tenantId__slug_version_deletedAt: {
            tenantId_: user.id,
            slug: 'fav-diag-test',
            version: '1.0.0',
            deletedAt: 0,
          },
        },
        update: {},
        create: {
          name: 'FavDiagService',
          slug: 'fav-diag-test',
          version: '1.0.0',
          tenantId_: user.id,
        },
      });

      // Get Service's raw tenantId_ and tenantId_Salt directly from DB
      const rawService = await prisma.$queryRawUnsafe(
        `SELECT id, idSalt, tenantId_, tenantId_Salt FROM Service WHERE slug = 'fav-diag-test'`
      ) as any[];
      const dbTenantId = rawService[0].tenantId_;
      const dbTenantIdSalt = rawService[0].tenantId_Salt;
      console.log(`[DIAG] Service raw: tenantId_=${dbTenantId}, tenantId_Salt=${dbTenantIdSalt}`);
      console.log(`[DIAG] User raw: id=${dbUserId}, idSalt=${dbUserIdSalt}`);

      // KEY ASSERTION: tenantId_Salt MUST equal User.idSalt
      expect(dbTenantIdSalt).toBe(dbUserIdSalt);
      expect(dbTenantId).toBe(dbUserId);

      // Verify findMany with { in: [...] } works
      const found = await prisma.service.findMany({
        where: { tenantId_: { in: [user.id] } },
      });
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found.some((s: any) => s.slug === 'fav-diag-test')).toBe(true);
    });

    it('38. upsert update (idempotent re-create): FK salt should remain correct', async () => {
      const user = await prisma.user.create({ data: { name: 'FavIdempotentUser' } });

      // First upsert: creates
      await prisma.service.upsert({
        where: {
          tenantId__slug_version_deletedAt: {
            tenantId_: user.id,
            slug: 'fav-idempotent-test',
            version: '1.0.0',
            deletedAt: 0,
          },
        },
        update: {},
        create: {
          name: 'FavIdempotentService',
          slug: 'fav-idempotent-test',
          version: '1.0.0',
          tenantId_: user.id,
        },
      });

      // Second upsert: finds existing, update is empty
      await prisma.service.upsert({
        where: {
          tenantId__slug_version_deletedAt: {
            tenantId_: user.id,
            slug: 'fav-idempotent-test',
            version: '1.0.0',
            deletedAt: 0,
          },
        },
        update: {},
        create: {
          name: 'FavIdempotentService',
          slug: 'fav-idempotent-test',
          version: '1.0.0',
          tenantId_: user.id,
        },
      });

      // Direct DB check
      const rawUser = await prisma.$queryRawUnsafe(
        `SELECT id, idSalt FROM User WHERE name = 'FavIdempotentUser'`
      ) as any[];
      const rawService = await prisma.$queryRawUnsafe(
        `SELECT tenantId_, tenantId_Salt FROM Service WHERE slug = 'fav-idempotent-test'`
      ) as any[];

      console.log(`[DIAG] User: id=${rawUser[0].id}, idSalt=${rawUser[0].idSalt}`);
      console.log(`[DIAG] Service: tenantId_=${rawService[0].tenantId_}, tenantId_Salt=${rawService[0].tenantId_Salt}`);

      expect(rawService[0].tenantId_Salt).toBe(rawUser[0].idSalt);
      expect(rawService[0].tenantId_).toBe(rawUser[0].id);

      const found = await prisma.service.findMany({
        where: { tenantId_: { in: [user.id] } },
      });
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found.some((s: any) => s.slug === 'fav-idempotent-test')).toBe(true);
    });

    it('39. direct create (no upsert): FK salt should match target salt', async () => {
      const user = await prisma.user.create({ data: { name: 'FavDirectCreateUser' } });
      const post = await prisma.post.create({
        data: { title: 'FavDirectCreatePost', authorId: user.id },
      });

      // FK saltId should equal target saltId: deepTransformInput decodes
      // authorId (user.id saltId) → rawId + salt, deepHijackResult re-encodes
      // → same saltId. If salts mismatched, post.authorId !== user.id.
      expect(post.authorId).toBe(user.id);

      // Verify via decode that rawId + salt are identical
      const userDecoded = SaltIdsHelper.decode(user.id, 3);
      const postAuthorDecoded = SaltIdsHelper.decode(post.authorId!, 3);
      expect(postAuthorDecoded.salt).toBe(userDecoded.salt);
      expect(postAuthorDecoded.id).toBe(userDecoded.id);
    });
  });

  /**
   * BUG-956: findUnique 不需要特殊处理（delete/non-enumerable/findFirst 替代）。
   *
   * 根因：旧代码在 findUnique + didTransformId 时 delete salt 字段，破坏了
   * deepTransformInput 的幂等 guard（obj[salt] === undefined）。在 ABAC Case 2
   * 的 $transaction 中，tx client 继承 saltids 扩展，tx saltids 看到 salt=undefined
   * → guard 命中 → 再次 decode rawId → {id:0, salt:rawId} → WHERE id=0 → NOT_FOUND。
   *
   * 修复：移除 findUnique 特殊处理，直接 query(args)。Prisma 6.x findUnique 运行时
   * 接受多字段 where（即使非唯一索引字段），salt 保留在 where 中 → guard 有效 →
   * tx saltids 不 double-decode。
   *
   * 验证过的失败方案：
   * - delete：破坏 guard → double-decoding
   * - non-enumerable：Prisma deepCloneArgs 丢弃 non-enumerable 属性 → guard 仍被破坏
   * - findFirst 替代：saltids 的 client 是 baseClient（无 abac）→ 绕过 RLS
   */
  describe('BUG-956: findUnique preserves salt (no double-decoding)', () => {
    it('40. findUnique with saltID should find the record (salt preserved in where)', async () => {
      const user = await prisma.user.create({ data: { name: 'Bug956FindUnique' } });
      const saltId = user.id;

      // findUnique 用 saltID 查询，salt 应保留在 where 中
      // 如果 salt 被 delete，where 只剩 rawId，仍能查到（但不安全）
      // 如果 salt 保留，where = { id: rawId, idSalt: salt }，更精确
      const found = await prisma.user.findUnique({
        where: { id: saltId },
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(saltId);
      expect(found?.name).toBe('Bug956FindUnique');
    });

    it('41. findUnique with correct id but wrong salt should return null', async () => {
      const user = await prisma.user.create({ data: { name: 'Bug956WrongSalt' } });
      const saltId = user.id;

      // 解码获取 rawId 和 salt (saltLength=3 与 extension 配置一致)
      const { id: rawId, salt: correctSalt } = SaltIdsHelper.decode(saltId, 3);
      const wrongSalt = (correctSalt + 1) % 1000; // 错误的 salt

      // 用 rawId + 错误 salt 构造 saltID
      const wrongSaltId = SaltIdsHelper.encode(rawId, wrongSalt);

      // findUnique 用错误的 saltID 查询，应返回 null
      // 这证明 salt 确实保留在 where 中并用于 DB 过滤
      const found = await prisma.user.findUnique({
        where: { id: wrongSaltId },
      });

      expect(found).toBeNull();
    });

    it('42. findUnique inside $transaction should not double-decode (BUG-956 core scenario)', async () => {
      // 模拟 ABAC Case 2: $transaction 内的 tx.findUnique
      // tx client 继承 saltids 扩展，tx saltids 会再次处理 args
      // guard（obj[salt] === undefined）必须有效，否则 double-decode
      const user = await prisma.user.create({ data: { name: 'Bug956TxScenario' } });
      const saltId = user.id;
      const { id: rawId } = SaltIdsHelper.decode(saltId, 3);

      // 在 $transaction 内用 saltID findUnique
      // 如果 double-decoding 发生：rawId → decode(rawId) = {id:0, salt:rawId} → WHERE id=0 → null
      // 如果 guard 有效：salt 保留 → 不 double-decode → 正确找到记录
      const found = await prisma.$transaction(async (tx) => {
        return tx.user.findUnique({
          where: { id: saltId },
        });
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(saltId);
      expect(found?.name).toBe('Bug956TxScenario');

      // 确认没有 double-decode：rawId 不应为 0
      expect(rawId).toBeGreaterThan(0);
    });

    it('43. findUnique guard idempotency: pre-set idSalt prevents re-decode', async () => {
      const user = await prisma.user.create({ data: { name: 'Bug956GuardTest' } });
      const saltId = user.id;
      const { id: rawId, salt } = SaltIdsHelper.decode(saltId, 3);

      // 直接用 rawId + salt 查询（模拟 saltids 已 decode 后的 args）
      // deepTransformInput 的 guard: obj[idSalt] === undefined → false（salt 有值）→ 不 decode
      // 这是 guard 幂等性的核心验证
      const found = await prisma.user.findUnique({
        where: { id: rawId, idSalt: salt } as any,
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(saltId);
    });

    it('44. findUnique with select inside $transaction should not double-decode', async () => {
      const user = await prisma.user.create({ data: { name: 'Bug956TxSelect' } });
      const saltId = user.id;

      // $transaction 内 findUnique + select
      // select 会自动确保 salt 字段被选中，不应影响 guard
      const found = await prisma.$transaction(async (tx) => {
        return tx.user.findUnique({
          where: { id: saltId },
          select: { id: true, name: true },
        });
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(saltId);
      expect(found?.name).toBe('Bug956TxSelect');
    });

    it('45. nested findUnique (findUnique → $transaction → tx.findUnique) should not double-decode', async () => {
      // 完整模拟 ABAC Case 2 链路:
      // 外层 saltids decode → query(args) → abac → $transaction → tx.findUnique → tx saltids (guard)
      const user = await prisma.user.create({ data: { name: 'Bug956NestedChain' } });
      const saltId = user.id;
      const { id: rawId } = SaltIdsHelper.decode(saltId, 3);

      // 外层 findUnique（saltids decode saltID → rawId+salt）
      // 内层 $transaction → tx.findUnique（tx saltids guard 不命中 → 不 decode）
      const found = await prisma.$transaction(async (tx) => {
        // tx.findUnique 会经过 tx saltids hook
        // args.where = { id: saltId } → tx saltids decode → { id: rawId, idSalt: salt }
        // guard 有效，不会 double-decode
        return tx.user.findUnique({
          where: { id: saltId },
        });
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(saltId);

      // 如果 double-decoding 发生，rawId 会被 decode 成 {id:0, salt:rawId}
      // 查询会返回 null（WHERE id=0）
      // 这里 found 不为 null，证明没有 double-decoding
    });
  });

  describe('CRUD completeness: delete / update / count', () => {
    it('46. delete: should delete record by saltID', async () => {
      const user = await prisma.user.create({ data: { name: 'DeleteTarget' } });
      const saltId = user.id;

      await prisma.user.delete({ where: { id: saltId } });

      const found = await prisma.user.findUnique({ where: { id: saltId } });
      expect(found).toBeNull();
    });

    it('47. deleteMany: should delete multiple records by saltID filter', async () => {
      const u1 = await prisma.user.create({ data: { name: 'DeleteMany1' } });
      const u2 = await prisma.user.create({ data: { name: 'DeleteMany2' } });
      const u3 = await prisma.user.create({ data: { name: 'DeleteMany3' } });

      const result = await prisma.user.deleteMany({
        where: { id: { in: [u1.id, u2.id] } },
      });
      expect(result.count).toBe(2);

      const remaining = await prisma.user.findMany({
        where: { id: { in: [u1.id, u2.id, u3.id] } },
        select: { id: true },
      });
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(u3.id);
    });

    it('48. update: should update record by saltID, saltID unchanged', async () => {
      const user = await prisma.user.create({ data: { name: 'BeforeUpdate' } });
      const saltId = user.id;

      const updated = await prisma.user.update({
        where: { id: saltId },
        data: { name: 'AfterUpdate' },
      });

      // saltID should NOT change after update (same rawId + salt)
      expect(updated.id).toBe(saltId);
      expect(updated.name).toBe('AfterUpdate');

      // Verify via findUnique
      const found = await prisma.user.findUnique({ where: { id: saltId } });
      expect(found?.name).toBe('AfterUpdate');
      expect(found?.id).toBe(saltId);
    });

    it('49. updateMany: should update multiple records by saltID filter', async () => {
      const u1 = await prisma.user.create({ data: { name: 'UpdateMany1' } });
      const u2 = await prisma.user.create({ data: { name: 'UpdateMany2' } });

      const result = await prisma.user.updateMany({
        where: { id: { in: [u1.id, u2.id] } },
        data: { name: 'BulkUpdated' },
      });
      expect(result.count).toBe(2);

      const found = await prisma.user.findMany({
        where: { id: { in: [u1.id, u2.id] } },
        select: { id: true, name: true },
      });
      expect(found.length).toBe(2);
      found.forEach((u: any) => expect(u.name).toBe('BulkUpdated'));
    });

    it('50. count: should count records by saltID filter', async () => {
      const u1 = await prisma.user.create({ data: { name: 'CountUser1' } });
      const u2 = await prisma.user.create({ data: { name: 'CountUser2' } });
      await prisma.user.create({ data: { name: 'CountUser3' } });

      const count = await prisma.user.count({
        where: { id: { in: [u1.id, u2.id] } },
      });
      expect(count).toBe(2);
    });

    it('51. update FK: changing FK to new saltID should resolve correctly', async () => {
      const author1 = await prisma.user.create({ data: { name: 'Author1' } });
      const author2 = await prisma.user.create({ data: { name: 'Author2' } });
      const post = await prisma.post.create({
        data: { title: 'FKSwitch', authorId: author1.id },
      });

      // Switch FK to author2
      const updated = await prisma.post.update({
        where: { postPk: post.postPk },
        data: { authorId: author2.id },
      });

      // updated.authorId should be author2's saltId (re-encoded)
      expect(updated.authorId).toBe(author2.id);

      // Verify via findUnique + include
      const found = await prisma.post.findUnique({
        where: { postPk: post.postPk },
        include: { author: true },
      });
      expect(found?.author?.id).toBe(author2.id);
      expect(found?.author?.name).toBe('Author2');
    });

    it('52. update: should update FK to null (clear relation)', async () => {
      const author = await prisma.user.create({ data: { name: 'ClearRelAuthor' } });
      const post = await prisma.post.create({
        data: { title: 'ClearRelPost', authorId: author.id },
      });

      const updated = await prisma.post.update({
        where: { postPk: post.postPk },
        data: { authorId: null },
      });

      expect(updated.authorId).toBeNull();

      const found = await prisma.post.findUnique({
        where: { postPk: post.postPk },
      });
      expect(found?.authorId).toBeNull();
    });

    it('53. upsert: create path should generate correct saltID', async () => {
      // Upsert create: no existing record → create with saltID
      const result = await prisma.user.upsert({
        where: { id: 999999 }, // non-existent rawId
        create: { name: 'UpsertCreate' },
        update: { name: 'UpsertCreate' },
      });

      expect(typeof result.id).toBe('number');
      expect(result.name).toBe('UpsertCreate');

      // Verify findable by saltID
      const found = await prisma.user.findUnique({ where: { id: result.id } });
      expect(found?.name).toBe('UpsertCreate');
    });

    it('54. upsert: update path should preserve saltID', async () => {
      const user = await prisma.user.create({ data: { name: 'UpsertBefore' } });
      const saltId = user.id;

      const result = await prisma.user.upsert({
        where: { id: saltId },
        create: { name: 'UpsertNew' },
        update: { name: 'UpsertAfter' },
      });

      expect(result.id).toBe(saltId);
      expect(result.name).toBe('UpsertAfter');
    });
  });
});
