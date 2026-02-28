import { Prisma } from "@prisma/client";
import { SaltIdsOptions } from "./types";
import { SaltIdsHelper } from "./utils";

type Sql = Prisma.Sql;

export type SaltIdsColumnRef = {
  base: Sql;
  salt: Sql;
  baseKey: string;
  saltKey: string;
};

function escapeIdentPart(s: string): string {
  return s.replaceAll('"', '""');
}

function q(part: string): string {
  return `"${escapeIdentPart(part)}"`;
}

function qualified(table: string | undefined, col: string): string {
  if (!table) return q(col);
  return `${q(table)}.${q(col)}`;
}

function ensureNumber(x: unknown): number {
  if (typeof x !== "number") {
    throw new Error("prisma-extension-saltids: expected a number");
  }
  return x;
}

function decodeSaltId(publicId: unknown, saltLength: number): { id: number; salt: number } {
  const n = ensureNumber(publicId);
  return SaltIdsHelper.decode(n, saltLength);
}

function combineOr(parts: Sql[]): Sql {
  if (parts.length === 0) return Prisma.sql`FALSE`;
  if (parts.length === 1) return parts[0];
  let acc = parts[0];
  for (let i = 1; i < parts.length; i++) {
    acc = Prisma.sql`${acc} OR ${parts[i]}`;
  }
  return Prisma.sql`(${acc})`;
}

function hijackObject(obj: any, fields: { baseKey: string; saltKey: string }[], saltLength: number) {
  if (!obj || typeof obj !== "object") return;

  for (const { baseKey, saltKey } of fields) {
    if (!(saltKey in obj)) continue;
    if (!(baseKey in obj)) continue;

    const saltVal = obj[saltKey];
    const baseVal = obj[baseKey];

    if (typeof saltVal === "number" && typeof baseVal === "number") {
      Object.defineProperty(obj, saltKey, {
        enumerable: false,
        value: saltVal,
        writable: true,
        configurable: true,
      });

      Object.defineProperty(obj, baseKey, {
        enumerable: true,
        configurable: true,
        get() {
          return SaltIdsHelper.encode(baseVal, saltVal, saltLength);
        },
        set() {},
      });
    } else if (baseVal === null) {
      Object.defineProperty(obj, saltKey, {
        enumerable: false,
        value: saltVal,
        writable: true,
        configurable: true,
      });
    }
  }
}

export function saltIdsSql(options?: SaltIdsOptions) {
  const saltLength = options?.saltLength ?? 4;
  const saltSuffix = options?.saltSuffix ?? "Salt";

  function col(base: string): SaltIdsColumnRef;
  function col(tableOrAlias: string, base: string): SaltIdsColumnRef;
  function col(a: string, b?: string): SaltIdsColumnRef {
    const table = b ? a : undefined;
    const baseKey = b ?? a;
    const saltKey = `${baseKey}${saltSuffix}`;
    return {
      base: Prisma.raw(qualified(table, baseKey)),
      salt: Prisma.raw(qualified(table, saltKey)),
      baseKey,
      saltKey,
    };
  }

  const where = {
    eq(c: SaltIdsColumnRef, publicId: number): Sql {
      const { id, salt } = decodeSaltId(publicId, saltLength);
      return Prisma.sql`(${c.base} = ${id} AND ${c.salt} = ${salt})`;
    },
    ne(c: SaltIdsColumnRef, publicId: number): Sql {
      const inner = where.eq(c, publicId);
      return Prisma.sql`(NOT ${inner})`;
    },
    in(c: SaltIdsColumnRef, publicIds: number[]): Sql {
      const parts = publicIds.map((pid) => where.eq(c, pid));
      return combineOr(parts);
    },
    gtRealId(c: SaltIdsColumnRef, realId: number): Sql {
      return Prisma.sql`${c.base} > ${ensureNumber(realId)}`;
    },
    ltRealId(c: SaltIdsColumnRef, realId: number): Sql {
      return Prisma.sql`${c.base} < ${ensureNumber(realId)}`;
    },
    betweenRealId(c: SaltIdsColumnRef, min: number, max: number): Sql {
      const a = ensureNumber(min);
      const b = ensureNumber(max);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return Prisma.sql`${c.base} BETWEEN ${lo} AND ${hi}`;
    },
    gtFromSaltId(c: SaltIdsColumnRef, publicId: number): Sql {
      const { id } = decodeSaltId(publicId, saltLength);
      return where.gtRealId(c, id);
    },
    ltFromSaltId(c: SaltIdsColumnRef, publicId: number): Sql {
      const { id } = decodeSaltId(publicId, saltLength);
      return where.ltRealId(c, id);
    },
    betweenFromSaltIds(c: SaltIdsColumnRef, a: number, b: number): Sql {
      const a1 = decodeSaltId(a, saltLength).id;
      const b1 = decodeSaltId(b, saltLength).id;
      return where.betweenRealId(c, a1, b1);
    },
  };

  function result(config: { fields: string[] }) {
    const fieldPairs = config.fields.map((baseKey) => ({ baseKey, saltKey: `${baseKey}${saltSuffix}` }));

    return (rows: any) => {
      if (Array.isArray(rows)) {
        for (const r of rows) hijackObject(r, fieldPairs, saltLength);
        return rows;
      }
      hijackObject(rows, fieldPairs, saltLength);
      return rows;
    };
  }

  function resultScan(rows: any) {
    const applyOne = (row: any) => {
      if (!row || typeof row !== "object") return;
      const fields: { baseKey: string; saltKey: string }[] = [];
      for (const key of Object.keys(row)) {
        if (!key.endsWith(saltSuffix)) continue;
        const baseKey = key.slice(0, -saltSuffix.length);
        if (!baseKey) continue;
        if (!(baseKey in row)) continue;
        fields.push({ baseKey, saltKey: key });
      }
      hijackObject(row, fields, saltLength);
    };

    if (Array.isArray(rows)) {
      for (const r of rows) applyOne(r);
      return rows;
    }
    applyOne(rows);
    return rows;
  }

  function toUnsafe(fragment: Sql): { sql: string; values: any[] } {
    const f: any = fragment as any;
    const sql = typeof f.sql === "string" ? f.sql : String(f.sql ?? "");
    const values = Array.isArray(f.values) ? f.values : [];
    return { sql, values };
  }

  return {
    col,
    where,
    result,
    resultScan,
    toUnsafe,
    config: {
      saltLength,
      saltSuffix,
    },
  };
}
