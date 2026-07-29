import { describe, it, expect, vi } from 'vitest';
import { saltIdsSql } from '../src/raw';
import { Prisma } from '@prisma/client';
import { SaltIdsHelper } from '../src/utils';

/**
 * BUG-1209: When a consumer generates its Prisma client to a custom output
 * path (e.g. `output = "../../src/.generated"`), the `sql` / `raw` functions
 * from that client create `Sql` / `RawString` objects whose constructor
 * identity differs from the ones in `@prisma/client`. A `$queryRaw` template
 * on the custom client will not recognise `Sql` objects created by
 * `@prisma/client`'s `Prisma.sql` — they get serialised as jsonb parameters
 * instead of SQL fragments.
 *
 * The fix: `saltIdsSql` accepts a `prisma` option so the consumer can pass
 * its own `Prisma` namespace, ensuring `Sql` objects are created by the same
 * runtime that `$queryRaw` uses.
 */
describe('BUG-1209: saltIdsSql prisma namespace option', () => {
  it('should use the default @prisma/client when no prisma option is provided', () => {
    const s = saltIdsSql({ saltLength: 4, saltSuffix: 'Salt' });
    const col = s.col('TaskMeta', 'createdBy');
    const fragment = s.where.eq(col, 10001);

    // The fragment should be a Prisma.Sql object (has sql + values)
    const f = fragment as any;
    expect(f).toBeDefined();
    expect(typeof f.sql).toBe('string');
    expect(Array.isArray(f.values)).toBe(true);
    // SQL should contain the column reference and AND
    expect(f.sql).toContain('"createdBy"');
    expect(f.sql).toContain('"createdBySalt"');
    expect(f.sql).toContain('AND');
  });

  it('should use the passed-in prisma namespace for sql/raw', () => {
    // Create a mock Prisma namespace that wraps the real one but tracks calls
    const sqlSpy = vi.fn(Prisma.sql.bind(Prisma));
    const rawSpy = vi.fn(Prisma.raw.bind(Prisma));
    const mockPrisma = { sql: sqlSpy, raw: rawSpy };

    const s = saltIdsSql({ saltLength: 4, saltSuffix: 'Salt', prisma: mockPrisma });
    const col = s.col('TaskMeta', 'createdBy');
    const fragment = s.where.eq(col, 10001);

    // raw should have been called for column references
    expect(rawSpy).toHaveBeenCalledWith('"TaskMeta"."createdBy"');
    expect(rawSpy).toHaveBeenCalledWith('"TaskMeta"."createdBySalt"');

    // sql should have been called to build the WHERE fragment
    expect(sqlSpy).toHaveBeenCalled();

    // The fragment should still be a valid Sql object
    const f = fragment as any;
    expect(f).toBeDefined();
    expect(typeof f.sql).toBe('string');
    expect(f.sql).toContain('"createdBy"');
  });

  it('should produce equivalent SQL regardless of which prisma namespace is used', () => {
    const sDefault = saltIdsSql({ saltLength: 4, saltSuffix: 'Salt' });
    const sCustom = saltIdsSql({
      saltLength: 4,
      saltSuffix: 'Salt',
      prisma: { sql: Prisma.sql.bind(Prisma), raw: Prisma.raw.bind(Prisma) },
    });

    const col1 = sDefault.col('TaskMeta', 'createdBy');
    const col2 = sCustom.col('TaskMeta', 'createdBy');

    const frag1 = sDefault.where.eq(col1, 10001) as any;
    const frag2 = sCustom.where.eq(col2, 10001) as any;

    // SQL strings should be identical
    expect(frag1.sql).toBe(frag2.sql);
    // Values should be identical (decoded rawId + salt)
    expect(frag1.values).toEqual(frag2.values);
  });

  it('should handle where.in with the passed-in prisma namespace', () => {
    const s = saltIdsSql({
      saltLength: 4,
      saltSuffix: 'Salt',
      prisma: { sql: Prisma.sql.bind(Prisma), raw: Prisma.raw.bind(Prisma) },
    });
    const col = s.col('User', 'id');
    const fragment = s.where.in(col, [10001, 20002]) as any;

    expect(fragment).toBeDefined();
    expect(typeof fragment.sql).toBe('string');
    expect(fragment.sql).toContain('OR');
    expect(fragment.values.length).toBeGreaterThan(0);
  });

  it('should handle where.ne with the passed-in prisma namespace', () => {
    const s = saltIdsSql({
      saltLength: 4,
      saltSuffix: 'Salt',
      prisma: { sql: Prisma.sql.bind(Prisma), raw: Prisma.raw.bind(Prisma) },
    });
    const col = s.col('User', 'id');
    const fragment = s.where.ne(col, 10001) as any;

    expect(fragment).toBeDefined();
    expect(typeof fragment.sql).toBe('string');
    expect(fragment.sql).toContain('NOT');
  });

  it('toUnsafe should extract sql + values from the fragment', () => {
    const s = saltIdsSql({
      saltLength: 4,
      saltSuffix: 'Salt',
      prisma: { sql: Prisma.sql.bind(Prisma), raw: Prisma.raw.bind(Prisma) },
    });
    const col = s.col('TaskMeta', 'createdBy');
    const fragment = s.where.eq(col, 10001);
    const unsafe = s.toUnsafe(fragment);

    expect(typeof unsafe.sql).toBe('string');
    expect(Array.isArray(unsafe.values)).toBe(true);
    expect(unsafe.sql).toContain('"createdBy"');
    expect(unsafe.sql).toContain('"createdBySalt"');
    // 10001 with saltLength=4 decodes to id=1, salt=1
    const decoded = SaltIdsHelper.decode(10001, 4);
    expect(unsafe.values).toContain(decoded.id);
    expect(unsafe.values).toContain(decoded.salt);
  });
});
