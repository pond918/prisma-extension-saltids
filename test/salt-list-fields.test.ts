import { describe, it, expect } from 'vitest';
import { deepHijackResult, deepTransformInput } from '../src/logic';
import { ModelRegistry, SaltIdsHelper } from '../src/utils';

/**
 * Salt-list companion pairs (2.2.1): BOTH sides are list scalars —
 * `ancestorIds Int[]` riding `ancestorIdsSalt Int[]` (element-wise parallel
 * salts). The schema column pair IS the opt-in: no extension option exists,
 * the registry discovers the pair from the DMMF exactly like scalar pairs.
 *
 * Law:
 * - write side: a handle array decodes element-wise into raw ids + a
 *   PARALLEL salt array; an explicit companion array turns the decode OFF
 *   (rule ①, raw written as given); {set}/{push} envelopes decode into a
 *   companion envelope of the same shape. Salts are NEVER generated — every
 *   element references an EXISTING row.
 * - read side: raw + salt arrays re-encode element-wise into handle values;
 *   the salt column is hidden. Unpaired elements (length drift, dangling
 *   ancestor) pass through raw.
 *
 * The 0-sentinel rides BUG-1403: encode(0, 0) === 0, so a stored 0 element
 * round-trips as 0. Non-handle elements pass through with salt slot 0 —
 * garbage-in-garbage-out, same contract as scalars (callers pass chain ids
 * the extension produced, never bare raw ids).
 *
 * sqlite has no Int[] columns, so these tests drive deepTransformInput /
 * deepHijackResult directly with a synthetic registry (the same seam the
 * real $allOperations path uses).
 */

const SALT_LEN = 4;

function registryWithList(extraScalar = false): ModelRegistry {
  const registry = new ModelRegistry();
  (registry as any).saltListFields = new Map([
    ['Service', [{ base: 'ancestorIds', salt: 'ancestorIdsSalt' }]],
  ]);
  if (extraScalar) {
    (registry as any).saltFields = new Map([
      [
        'Service',
        [
          {
            base: 'inheritedId',
            salt: 'inheritedIdSalt',
            hasDefaultValue: false,
            saltHasDefaultValue: false,
          },
        ],
      ],
    ]);
  }
  return registry;
}

function opts() {
  return {
    saltLength: SALT_LEN,
    saltSuffix: 'Salt',
    rawResultHijack: true,
    prisma: undefined as any,
  } as any;
}

describe('salt-list companion — write side', () => {
  it('decodes a handle array into raw ids + a parallel salt array', () => {
    const a = SaltIdsHelper.encode(-900051, 1100, SALT_LEN);
    const b = SaltIdsHelper.encode(7, 42, SALT_LEN);
    const args = { data: { ancestorIds: [a, b] } };
    const res = deepTransformInput(args, 'Service', registryWithList(), opts());
    expect(res.didTransformId).toBe(true);
    expect(args.data.ancestorIds).toEqual([-900051, 7]);
    expect(args.data.ancestorIdsSalt).toEqual([1100, 42]);
  });

  it('rides the 0-sentinel: a stored 0 element round-trips with salt slot 0', () => {
    const args = { data: { ancestorIds: [0] } };
    const res = deepTransformInput(args, 'Service', registryWithList(), opts());
    expect(args.data.ancestorIds).toEqual([0]);
    expect(args.data.ancestorIdsSalt).toEqual([0]);
    // 0 → (0, 0) is the identity — no real transform happened.
    expect(res.didTransformId).toBe(false);
  });

  it('passes non-handle numbers through raw with salt slot 0', () => {
    // Safe passthrough set: negatives with |v| < 10^saltLen (positives are
    // ALWAYS potential saltids and decode by shape — the 形态不可区分律 means
    // callers pass extension-produced handles only).
    const args = { data: { ancestorIds: [-5, -999] } };
    const res = deepTransformInput(args, 'Service', registryWithList(), opts());
    expect(args.data.ancestorIds).toEqual([-5, -999]);
    expect(args.data.ancestorIdsSalt).toEqual([0, 0]);
    expect(res.didTransformId).toBe(false);
  });

  it('explicit companion array turns the decode OFF (rule ①, raw as given)', () => {
    const salted = SaltIdsHelper.encode(51, 1100, SALT_LEN);
    const args = { data: { ancestorIds: [salted], ancestorIdsSalt: [7] } };
    const res = deepTransformInput(args, 'Service', registryWithList(), opts());
    expect(res.didTransformId).toBe(false);
    expect(args.data.ancestorIds).toEqual([salted]);
    expect(args.data.ancestorIdsSalt).toEqual([7]);
  });

  it('is idempotent for re-entrant transaction clients', () => {
    const salted = SaltIdsHelper.encode(51, 1100, SALT_LEN);
    const args = { data: { ancestorIds: [salted] } };
    deepTransformInput(args, 'Service', registryWithList(), opts());
    const res2 = deepTransformInput(args, 'Service', registryWithList(), opts());
    expect(res2.didTransformId).toBe(false);
    expect(args.data.ancestorIds).toEqual([51]);
    expect(args.data.ancestorIdsSalt).toEqual([1100]);
  });

  it('decodes {set} / {push} envelopes into a companion envelope of the same shape', () => {
    const salted = SaltIdsHelper.encode(51, 1100, SALT_LEN);
    const setArgs = { data: { ancestorIds: { set: [salted] } } };
    deepTransformInput(setArgs, 'Service', registryWithList(), opts());
    expect(setArgs.data.ancestorIds).toEqual({ set: [51] });
    expect(setArgs.data.ancestorIdsSalt).toEqual({ set: [1100] });

    const pushArgs = { data: { ancestorIds: { push: [salted] } } };
    deepTransformInput(pushArgs, 'Service', registryWithList(), opts());
    expect(pushArgs.data.ancestorIds).toEqual({ push: [51] });
    expect(pushArgs.data.ancestorIdsSalt).toEqual({ push: [1100] });
  });

  it('coexists with a scalar salt pair in the same payload', () => {
    const salted = SaltIdsHelper.encode(51, 1100, SALT_LEN);
    const args = { data: { inheritedId: salted, ancestorIds: [salted] } };
    const res = deepTransformInput(args, 'Service', registryWithList(true), opts());
    expect(res.didTransformId).toBe(true);
    expect(args.data.inheritedId).toEqual(51);
    expect(args.data.inheritedIdSalt).toEqual(1100);
    expect(args.data.ancestorIds).toEqual([51]);
    expect(args.data.ancestorIdsSalt).toEqual([1100]);
  });

  it('does nothing for models without the companion pair (legacy behavior)', () => {
    const salted = SaltIdsHelper.encode(51, 1100, SALT_LEN);
    const args = { data: { ancestorIds: [salted] } };
    const res = deepTransformInput(args, 'Service', new ModelRegistry(), opts());
    expect(res.didTransformId).toBe(false);
    expect(args.data.ancestorIds).toEqual([salted]);
    expect(args.data.ancestorIdsSalt).toBeUndefined();
  });
});

describe('salt-list companion — registry pairing guard', () => {
  it('never pairs across kinds: a list base with a scalar salt stays unregistered', () => {
    const registry = new ModelRegistry();
    registry.init(
      {
        datamodel: {
          models: [
            {
              name: 'M',
              fields: [
                { name: 'a', kind: 'scalar', type: 'Int', isList: true },
                { name: 'aSalt', kind: 'scalar', type: 'Int', isList: false },
                { name: 'b', kind: 'scalar', type: 'Int', isList: false },
                { name: 'bSalt', kind: 'scalar', type: 'Int', isList: true },
              ],
            },
          ],
        },
      } as any,
      'Salt'
    );
    // Cross-kind pairs would make deepInjectSalt auto-generate a scalar salt
    // next to an array column — the pairing must be kind-exact.
    expect(registry.getSaltFields('M')).toEqual([]);
    expect(registry.getSaltListFields('M')).toEqual([]);
  });

  it('pairs kind-exact list scalars from the DMMF', () => {
    const registry = new ModelRegistry();
    registry.init(
      {
        datamodel: {
          models: [
            {
              name: 'M',
              fields: [
                { name: 'chain', kind: 'scalar', type: 'Int', isList: true },
                { name: 'chainSalt', kind: 'scalar', type: 'Int', isList: true },
              ],
            },
          ],
        },
      } as any,
      'Salt'
    );
    expect(registry.getSaltListFields('M')).toEqual([{ base: 'chain', salt: 'chainSalt' }]);
  });
});

describe('salt-list companion — read side', () => {
  it('re-encodes element-wise and hides the parallel salt column', () => {
    const row = { ancestorIds: [-900051, 7], ancestorIdsSalt: [1100, 42] };
    deepHijackResult(row, opts(), 'Service', registryWithList());
    expect(row.ancestorIds).toEqual([
      SaltIdsHelper.encode(-900051, 1100, SALT_LEN),
      SaltIdsHelper.encode(7, 42, SALT_LEN),
    ]);
    const desc = Object.getOwnPropertyDescriptor(row, 'ancestorIdsSalt');
    expect(desc?.enumerable).toBe(false);
  });

  it('round-trips the production fork path: encode → decode → encode is the identity', () => {
    const handle = SaltIdsHelper.encode(-900051, 1100, SALT_LEN);
    // fork write: hijacked parent chain in, raw + salts stored
    const args = { data: { ancestorIds: [handle] } };
    deepTransformInput(args, 'Service', registryWithList(), opts());
    // face read: raw + salts out, handles restored
    const row = { ancestorIds: args.data.ancestorIds, ancestorIdsSalt: args.data.ancestorIdsSalt };
    deepHijackResult(row, opts(), 'Service', registryWithList());
    expect(row.ancestorIds).toEqual([handle]);
  });

  it('passes unpaired elements through raw on length drift (dangling ancestor)', () => {
    const row = { ancestorIds: [51, 7], ancestorIdsSalt: [1100] };
    deepHijackResult(row, opts(), 'Service', registryWithList());
    expect(row.ancestorIds).toEqual([SaltIdsHelper.encode(51, 1100, SALT_LEN), 7]);
  });

  it('leaves list columns untouched for models without the companion pair', () => {
    const row = { ancestorIds: [11000, 7], ancestorIdsSalt: [1, 2] };
    deepHijackResult(row, opts(), 'Service', new ModelRegistry());
    expect(row.ancestorIds).toEqual([11000, 7]);
    const desc = Object.getOwnPropertyDescriptor(row, 'ancestorIdsSalt');
    expect(desc?.enumerable).toBe(true);
  });
});
