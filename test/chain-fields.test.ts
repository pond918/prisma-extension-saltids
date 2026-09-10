import { describe, it, expect } from 'vitest';
import { deepTransformInput } from '../src/logic';
import { ModelRegistry, SaltIdsHelper } from '../src/utils';

/**
 * chainFields (2.2.0): id-handle columns WITHOUT a Salt sibling
 * (e.g. Service.inheritedId Int?, Service.ancestorIds Int[]).
 *
 * Storage law: chain columns store RAW ids. Callers hand the extension
 * hijacked (salted) ids; the write path decodes each potential-saltid
 * element to its raw id. Non-saltid elements (raw ids, negative fixture
 * ids, zeros) pass through untouched.
 *
 * Why the extension owns this (not call sites): the salted values are
 * produced by the extension's own read-side hijack ("salted in, salted
 * out"); only the extension can close the loop at the write boundary.
 * sqlite has no Int[] columns, so these tests drive deepTransformInput
 * directly with a synthetic registry entry (same seam the real
 * $allOperations path uses).
 */

const SALT_LEN = 4;

function registryWithChain(): ModelRegistry {
  const registry = new ModelRegistry();
  // Bypass DMMF parsing: chain columns are config-declared, not schema-derived.
  (registry as any).chainFields = new Map([['Service', new Set(['inheritedId', 'ancestorIds'])]]);
  return registry;
}

function opts(extra: Record<string, unknown> = {}) {
  return {
    saltLength: SALT_LEN,
    saltSuffix: 'Salt',
    rawResultHijack: true,
    prisma: undefined as any,
    ...extra,
  } as any;
}

describe('chainFields', () => {
  it('decodes a scalar chain id: salted inheritedId -> raw', () => {
    const raw = 51;
    const salted = SaltIdsHelper.encode(raw, 1100, SALT_LEN);
    const args = { data: { inheritedId: salted } };
    const res = deepTransformInput(
      args,
      'Service',
      registryWithChain(),
      opts({ chainFields: { Service: ['inheritedId', 'ancestorIds'] } })
    );
    expect(res.didTransformId).toBe(true);
    expect(args.data.inheritedId).toBe(raw);
  });

  it('decodes each salted element of an Int[] chain column', () => {
    const a = SaltIdsHelper.encode(-900051, 1100, SALT_LEN);
    const b = SaltIdsHelper.encode(7, 42, SALT_LEN);
    const args = { data: { ancestorIds: [a, b] } };
    deepTransformInput(
      args,
      'Service',
      registryWithChain(),
      opts({ chainFields: { Service: ['inheritedId', 'ancestorIds'] } })
    );
    expect(args.data.ancestorIds).toEqual([-900051, 7]);
  });

  it('passes through zeros and negative ids untouched', () => {
    // isPotentialSaltId exempts only zero and negatives with |v| < 10^saltLen
    // (positive ints are ALWAYS potential saltids — decode(50) = {id:0,
    // salt:50}; negatives with |v| ≥ 10^saltLen, e.g. fixture -204001, decode
    // too). So the safe passthrough set is exactly: zero + negatives with
    // |v| < 10^saltLen. Chain columns therefore accept real ids ONLY as
    // extension-produced saltids; any other |v| ≥ 10^saltLen value is
    // decoded by shape (next test). Seed/integration fixtures never write
    // such values into chain columns (their ancestorIds is []), and fork
    // chains always originate from hijacked (true-saltid) parent rows.
    const args = { data: { ancestorIds: [0, -5, -999] } };
    const res = deepTransformInput(
      args,
      'Service',
      registryWithChain(),
      opts({ chainFields: { Service: ['inheritedId', 'ancestorIds'] } })
    );
    expect(args.data.ancestorIds).toEqual([0, -5, -999]);
    expect(res.didTransformId).toBe(false);
  });

  it('decodes every potential-saltid element, including small raw ids that share the shape', () => {
    // 11000 decodes to raw 1/salt 1000 — live evidence: seed rows store
    // ancestorIds={11000}, whose true identity IS encode(1, 1000) (@ogent/base,
    // id=1/idSalt=1000). The codec cannot tell a "raw id that looks salted"
    // from a true saltid, so it decodes uniformly: callers must pass chain
    // ids the extension produced (true saltids), never bare raw ids ≥
    // 10^saltLen. Values < 10^saltLen are unambiguous and always pass
    // through (previous test). Uniform decoding CONVERTS the legacy seed
    // shape {11000} to its raw truth {1} — a fix, not collateral: the same
    // row is hit either way (read-side IN-lists already decode to {id:1,
    // idSalt:1000} pairs).
    const salted = SaltIdsHelper.encode(51, 1100, SALT_LEN);
    const args = { data: { ancestorIds: [11000, salted] } };
    deepTransformInput(
      args,
      'Service',
      registryWithChain(),
      opts({ chainFields: { Service: ['inheritedId', 'ancestorIds'] } })
    );
    expect(args.data.ancestorIds).toEqual([1, 51]);
  });

  it('keeps raw/salted mixed arrays element-wise', () => {
    const salted = SaltIdsHelper.encode(51, 1100, SALT_LEN);
    const args = { data: { ancestorIds: [0, salted, -5] } };
    deepTransformInput(
      args,
      'Service',
      registryWithChain(),
      opts({ chainFields: { Service: ['inheritedId', 'ancestorIds'] } })
    );
    expect(args.data.ancestorIds).toEqual([0, 51, -5]);
  });

  it('round-trips the production fork path: hijacked parent chain decodes back to raw', () => {
    // resolveInheritedId reads parentService.id through the extension, which
    // hijacks raw+salt into a salted id; the child write must land raw again.
    const parentRaw = 11000;
    const parentSalt = 4321;
    const hijacked = SaltIdsHelper.encode(parentRaw, parentSalt, SALT_LEN);
    const args = { data: { inheritedId: hijacked, ancestorIds: [hijacked] } };
    deepTransformInput(
      args,
      'Service',
      registryWithChain(),
      opts({ chainFields: { Service: ['inheritedId', 'ancestorIds'] } })
    );
    expect(args.data.inheritedId).toBe(parentRaw);
    expect(args.data.ancestorIds).toEqual([parentRaw]);
  });

  it('does nothing when chainFields is not declared (legacy behavior)', () => {
    const salted = SaltIdsHelper.encode(51, 1100, SALT_LEN);
    const args = { data: { ancestorIds: [salted], inheritedId: salted } };
    const res = deepTransformInput(args, 'Service', new ModelRegistry(), opts());
    expect(res.didTransformId).toBe(false);
    expect(args.data.ancestorIds).toEqual([salted]);
    expect(args.data.inheritedId).toBe(salted);
  });

  it('decodes chain columns inside nested writes and update data', () => {
    const salted = SaltIdsHelper.encode(51, 1100, SALT_LEN);
    const args = { data: { ancestorIds: { set: [salted] } } };
    deepTransformInput(
      args,
      'Service',
      registryWithChain(),
      opts({ chainFields: { Service: ['inheritedId', 'ancestorIds'] } })
    );
    expect(args.data.ancestorIds).toEqual({ set: [51] });
  });
});

describe('chainFields read side', () => {
  it('never hijacks chain columns: ancestorIds stays raw on the way out', async () => {
    const { deepHijackResult } = await import('../src/logic');
    // Synthetic registry carries chainFields but no DMMF-derived saltFields
    // (bypassed parse), so hijack the registered shape manually: id stays a
    // plain value here — the assertion that matters is the chain column.
    const row = { id: 51, idSalt: 1100, ancestorIds: [11000, 7] };
    deepHijackResult(
      row,
      { saltLength: SALT_LEN, saltSuffix: 'Salt', rawResultHijack: true, prisma: undefined as any },
      'Service',
      registryWithChain()
    );
    // The chain column is untouched raw (no Salt sibling exists to pair it).
    expect(row.ancestorIds).toEqual([11000, 7]);
  });
});
