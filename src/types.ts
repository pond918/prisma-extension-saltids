/**
 * Minimal subset of the Prisma SQL namespace needed by `saltIdsSql`.
 *
 * When the consumer generates its Prisma client to a custom output path
 * (e.g. `output = "../../src/.generated"`), the `sql` / `raw` functions from
 * that client create `Sql` / `RawString` objects whose constructor identity
 * differs from the ones in `@prisma/client`. A `$queryRaw` template on the
 * custom client will not recognise `Sql` objects created by `@prisma/client`'s
 * `Prisma.sql` — they get serialised as jsonb parameters instead of SQL
 * fragments (BUG-1209). Passing the consumer's own `Prisma` namespace
 * ensures the `Sql` objects are created by the same runtime that
 * `$queryRaw` uses.
 */
export interface PrismaSqlNamespace {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
  raw: (value: string) => unknown;
  /** DMMF for schema metadata (auto-used by saltIdsExtension) */
  dmmf?: unknown;
}

export interface SaltIdsOptions {
  /**
   * Salt 长度 (默认为 4)
   */
  saltLength?: number;

  /**
   * Salt 字段后缀 (默认为 'Salt')
   * 例如: userId -> userSalt
   */
  saltSuffix?: string;

  rawResultHijack?: boolean;

  /**
   * Id-handle columns WITHOUT a Salt sibling (e.g. a materialized
   * inheritance chain `Service.ancestorIds: Int[]`, or a chain-head FK
   * `Service.inheritedId: Int?` when the caller passes salted ids without
   * the salt column).
   *
   * Storage law: chain columns store RAW ids. On the write path each
   * potential-saltid element is decoded to its raw id; non-saltid
   * elements (raw ids, negative fixture ids, zeros) pass through
   * untouched. The read path never hijacks these columns (no Salt
   * sibling exists), so they are raw on the way out as well.
   *
   * Absent by default — undeclared models keep legacy behavior.
   */
  chainFields?: Record<string, string[]>;

  /**
   * The consumer's Prisma SQL namespace (`Prisma.sql` / `Prisma.raw`).
   *
   * Required when the consumer uses a custom Prisma client output path —
   * the default `@prisma/client` `sql`/`raw` functions produce `Sql` objects
   * that a different Prisma client instance's `$queryRaw` does not recognise
   * (BUG-1209). Pass the `Prisma` namespace exported from the same generated
   * client that `$queryRaw` is called on.
   *
   * `Prisma.dmmf` is auto-extracted from this for schema metadata.
   */
  prisma?: PrismaSqlNamespace;
}
