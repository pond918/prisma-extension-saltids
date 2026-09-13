import { SaltIdsOptions } from './types';
import { ModelRegistry, SaltIdsHelper } from './utils';

function isPlainObject(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Date);
}

function pushAnd(where: Record<string, any>, clause: Record<string, any>) {
  const cur = where.AND;
  if (cur === undefined) {
    where.AND = [clause];
    return;
  }
  if (Array.isArray(cur)) {
    cur.push(clause);
    return;
  }
  where.AND = [cur, clause];
}

function decodeSaltIdIfNeeded(
  val: unknown,
  options: Required<SaltIdsOptions>
): { isSaltId: boolean; id?: number; salt?: number } {
  if (typeof val !== 'number') return { isSaltId: false };
  if (!SaltIdsHelper.isPotentialSaltId(val, options.saltLength)) return { isSaltId: false };
  const { id, salt } = SaltIdsHelper.decode(val, options.saltLength);
  return { isSaltId: true, id, salt };
}

function buildOrClausesForIn(
  baseKey: string,
  saltKey: string,
  input: unknown,
  options: Required<SaltIdsOptions>
): Record<string, any>[] {
  const list = Array.isArray(input) ? input : [];
  const rawIds: number[] = [];
  const pairs: Array<{ id: number; salt: number }> = [];

  for (const v of list) {
    if (typeof v !== 'number') continue;
    const decoded = decodeSaltIdIfNeeded(v, options);
    if (decoded.isSaltId) {
      pairs.push({ id: decoded.id!, salt: decoded.salt! });
    } else {
      rawIds.push(v);
    }
  }

  const orClauses: Record<string, any>[] = [];
  if (rawIds.length > 0) {
    orClauses.push({ [baseKey]: { in: rawIds } });
  }

  // Strict matching: decoded saltIds must match both rawId AND salt.
  for (const p of pairs) {
    orClauses.push({ [baseKey]: p.id, [saltKey]: p.salt });
  }
  return orClauses;
}

function transformSaltedFieldFilterObject(
  where: Record<string, any>,
  baseKey: string,
  saltKey: string,
  filter: Record<string, any>,
  options: Required<SaltIdsOptions>
): boolean {
  let did = false;

  const decodeToAndSaltEq = (publicId: unknown): number | undefined => {
    const decoded = decodeSaltIdIfNeeded(publicId, options);
    if (!decoded.isSaltId) return undefined;
    pushAnd(where, { [saltKey]: decoded.salt });
    did = true;
    return decoded.id;
  };

  if ('equals' in filter) {
    const id = decodeToAndSaltEq(filter.equals);
    if (id !== undefined) filter.equals = id;
  }

  if ('set' in filter) {
    const id = decodeToAndSaltEq(filter.set);
    if (id !== undefined) filter.set = id;
  }

  for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
    if (!(op in filter)) continue;
    const decoded = decodeSaltIdIfNeeded(filter[op], options);
    if (decoded.isSaltId) {
      filter[op] = decoded.id;
      did = true;
    }
  }

  if ('in' in filter) {
    if (Array.isArray(filter.in) && filter.in.length > 0) {
      const orClauses = buildOrClausesForIn(baseKey, saltKey, filter.in, options);
      delete filter.in;
      if (orClauses.length > 0) {
        pushAnd(where, { OR: orClauses });
        did = true;
      }
    }
  }

  if ('notIn' in filter) {
    const list = Array.isArray(filter.notIn) ? filter.notIn : [];
    const rawIds: number[] = [];
    const saltIds: number[] = [];

    for (const v of list) {
      if (typeof v !== 'number') continue;
      const decoded = decodeSaltIdIfNeeded(v, options);
      if (decoded.isSaltId) saltIds.push(v);
      else rawIds.push(v);
    }

    const orClauses = buildOrClausesForIn(baseKey, saltKey, saltIds, options);
    if (orClauses.length > 0) {
      pushAnd(where, { NOT: { OR: orClauses } });
      did = true;
    }

    if (rawIds.length > 0) filter.notIn = rawIds;
    else delete filter.notIn;
  }

  if ('not' in filter) {
    const notVal = filter.not;
    const decoded = decodeSaltIdIfNeeded(notVal, options);
    if (decoded.isSaltId) {
      pushAnd(where, { NOT: { [baseKey]: decoded.id, [saltKey]: decoded.salt } });
      delete filter.not;
      did = true;
    } else if (isPlainObject(notVal)) {
      const inner = notVal as Record<string, any>;
      if ('equals' in inner) {
        const decodedInner = decodeSaltIdIfNeeded(inner.equals, options);
        if (decodedInner.isSaltId) {
          pushAnd(where, { NOT: { [baseKey]: decodedInner.id, [saltKey]: decodedInner.salt } });
          delete filter.not;
          did = true;
        }
      } else if ('in' in inner) {
        if (Array.isArray(inner.in) && inner.in.length > 0) {
          const orClauses = buildOrClausesForIn(baseKey, saltKey, inner.in, options);
          if (orClauses.length > 0) {
            pushAnd(where, { NOT: { OR: orClauses } });
            delete filter.not;
            did = true;
          }
        }
      }
    }
  }

  if (Object.keys(filter).length === 0) {
    delete where[baseKey];
  }

  return did;
}

// -----------------------------------------------------------------------------
// 1. 输入参数转换 (Input Transformation)
// -----------------------------------------------------------------------------
// 逻辑：将 SaltID (Number) 拆解为 Real ID (Number) + Salt (Number)
// 动态匹配：根据 ModelRegistry 查找当前模型中成对出现的字段 (xxx, xxxSalt)
export function deepTransformInput(
  obj: any,
  modelName: string,
  registry: ModelRegistry,
  options: Required<SaltIdsOptions>,
  parentKey?: string
): { didTransformId: boolean } {
  let didTransformId = false;

  if (!obj || typeof obj !== 'object') return { didTransformId };
  if (!modelName) return { didTransformId };

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = deepTransformInput(item, modelName, registry, options, parentKey);
      if (res.didTransformId) didTransformId = true;
    }
    return { didTransformId };
  }

  const saltFields = registry.getSaltFields(modelName);
  const uniqueIndexes = registry.getUniqueIndexes(modelName);

  const isUniqueIndexKey = (key: string): boolean => {
    for (const idx of uniqueIndexes) {
      const compositeKey = idx.fields.join('_');
      if (key === compositeKey) return true;
      if (idx.name && key === idx.name) return true;
    }
    return false;
  };

  const getUniqueIndexFields = (key: string): string[] | null => {
    for (const idx of uniqueIndexes) {
      const compositeKey = idx.fields.join('_');
      if (key === compositeKey || key === idx.name) {
        return idx.fields;
      }
    }
    return null;
  };

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (isUniqueIndexKey(key) && isPlainObject(val)) {
      const indexFields = getUniqueIndexFields(key);
      if (indexFields) {
        for (const field of indexFields) {
          const fieldSaltDef = saltFields.find((f) => f.base === field);
          if (fieldSaltDef && val[field] !== undefined && typeof val[field] === 'number') {
            const fieldVal = val[field];
            if (SaltIdsHelper.isPotentialSaltId(fieldVal, options.saltLength)) {
              const { id } = SaltIdsHelper.decode(fieldVal, options.saltLength);
              val[field] = id;
              didTransformId = true;
            }
          }
        }
      }
      continue;
    }

    const saltFieldDef = saltFields.find((f) => f.base === key);
    const saltListDef = registry.getSaltListFields(modelName).find((f) => f.base === key);

    if (saltListDef && Array.isArray(val)) {
      // Salt-list companion pair (e.g. Service.ancestorIds riding
      // ancestorIdsSalt): element-wise decode of the handle array into raw
      // ids + a PARALLEL salt array — the array twin of the scalar branch
      // below. The salts are never generated (deepInjectSalt skips list
      // pairs): every element references an EXISTING row, so its salt can
      // only come from the handle itself, or from an explicit companion
      // array (rule ① — decode off, raw written as given).
      // The `obj[salt] === undefined` guard doubles as the re-entrancy
      // guard for transaction clients that inherit the extension.
      if (obj[saltListDef.salt] === undefined) {
        const raws: unknown[] = [];
        const salts: number[] = [];
        let changed = false;
        for (const v of val) {
          if (typeof v === 'number' && v !== 0 && SaltIdsHelper.isPotentialSaltId(v, options.saltLength)) {
            const { id, salt } = SaltIdsHelper.decode(v, options.saltLength);
            raws.push(id!);
            salts.push(salt!);
            if (id !== v) changed = true;
          } else {
            // 0 rides the 0-sentinel law (BUG-1403: encode(0, 0) === 0);
            // any other non-handle element passes through raw with salt
            // slot 0 — same garbage-in-garbage-out contract as scalars.
            raws.push(v);
            salts.push(0);
          }
        }
        obj[key] = raws;
        obj[saltListDef.salt] = salts;
        if (changed) didTransformId = true;
      }
    } else if (saltListDef && isPlainObject(val)) {
      // Prisma list write envelopes: { set: [...] } / { push: [...] } ride
      // the same element-wise decode, mirrored into a companion salt
      // envelope of the same shape.
      for (const op of ['set', 'push'] as const) {
        const list = (val as Record<string, unknown>)[op];
        if (!Array.isArray(list)) continue;
        const raws: unknown[] = [];
        const salts: number[] = [];
        let changed = false;
        for (const v of list) {
          if (typeof v === 'number' && v !== 0 && SaltIdsHelper.isPotentialSaltId(v, options.saltLength)) {
            const { id, salt } = SaltIdsHelper.decode(v, options.saltLength);
            raws.push(id!);
            salts.push(salt!);
            if (id !== v) changed = true;
          } else {
            raws.push(v);
            salts.push(0);
          }
        }
        (val as Record<string, unknown>)[op] = raws;
        (obj as Record<string, unknown>)[saltListDef.salt] = { [op]: salts };
        if (changed) didTransformId = true;
      }
    } else if (saltFieldDef && typeof val === 'number') {
      if (obj[saltFieldDef.salt] === undefined && SaltIdsHelper.isPotentialSaltId(val, options.saltLength)) {
        const { id, salt } = SaltIdsHelper.decode(val, options.saltLength);
        obj[key] = id;
        obj[saltFieldDef.salt] = salt;
        didTransformId = true;
      }
    } else if (saltFieldDef && val === true) {
      if (obj[saltFieldDef.salt] === undefined) {
        obj[saltFieldDef.salt] = true;
      }
    } else if (saltFieldDef && isPlainObject(val)) {
      // console.log(
      //   `[saltids] deepTransformInput: Found salt field ${key} with object value, calling transformSaltedFieldFilterObject`
      // );
      const transformed = transformSaltedFieldFilterObject(obj, saltFieldDef.base, saltFieldDef.salt, val, options);
      if (transformed) didTransformId = true;
    } else if (typeof val === 'object' && val !== null) {
      // console.log(
      //   `[saltids] deepTransformInput: Found object key=${key}, val type=${typeof val}, isPlainObject=${isPlainObject(val)}, relation=${!!registry.getRelation(modelName, key)}`
      // );
      const relation = registry.getRelation(modelName, key);

      if (relation) {
        const res = deepTransformInput(val, relation.type, registry, options, key);
        if (res.didTransformId) didTransformId = true;
      } else {
        const res = deepTransformInput(val, modelName, registry, options, key);
        if (res.didTransformId) didTransformId = true;
      }
    }
  }

  return { didTransformId };
}

// -----------------------------------------------------------------------------
// 1.5. 自动注入 Salt (Auto Inject Salt)
// -----------------------------------------------------------------------------
// 逻辑：在 create 场景下，为所有缺失 Salt 的字段自动生成随机 Salt
export function deepInjectSalt(
  data: any,
  modelName: string,
  registry: ModelRegistry,
  options: Required<SaltIdsOptions>,
  skipRootInjection = false
) {
  if (!data || typeof data !== 'object') return;
  if (!modelName) return;

  if (Array.isArray(data)) {
    data.forEach((item) => deepInjectSalt(item, modelName, registry, options, skipRootInjection));
    return;
  }

  // 1. 注入当前层级的 Salt
  if (!skipRootInjection) {
    const saltFields = registry.getSaltFields(modelName);
    for (const { base, salt, hasDefaultValue, defaultValue, saltHasDefaultValue } of saltFields) {
      // 修正后的策略：只有当 base 字段会有值，且 salt 字段没有默认值也没有被提供时，才生成 salt
      // 场景 1: base 有标量默认值或用户提供非 null 值 -> base 会有值
      //   NOTE (2.1.4a): an EXPLICIT null base means "no relation" (nullable
      //   FK, e.g. Connector.contactId=null) — null !== undefined, but a null
      //   base must NOT receive a salt: the injected salt column pollutes the
      //   payload (flipping Prisma's checked/unchecked input discrimination,
      //   breaking the create) and writes garbage next to a NULL base.
      // 场景 2: salt 没有默认值 -> salt 不会由 DB 生成
      // 场景 3: salt 未被提供 -> salt 当前没有值
      // 只有以上三个条件都满足时，才生成 salt
      const baseExplicitlyNull = data[base] === null;
      const baseWillHaveValue = !baseExplicitlyNull && (hasDefaultValue || data[base] !== undefined);
      const saltHasNoValue = data[salt] === undefined;
      const saltNeedsGeneration = !saltHasDefaultValue;

      if (baseWillHaveValue && saltHasNoValue && saltNeedsGeneration) {
        // 0-sentinel determinism (BUG-1403): a base value of exactly 0 is a
        // "no relation / global" sentinel (e.g. Provider.engineId=0). A random
        // salt would make the encoded read value (0*10^saltLen + salt = salt)
        // lose the sentinel - encode(0, salt) must round-trip as 0, so the
        // salt is deterministically 0.
        // NOTE (2.1.4b): the sentinel check uses the EFFECTIVE base — the
        // caller-provided value when present, otherwise the SCALAR default
        // from the schema (@default(0)) — so the omit path
        // (`engineId` absent, default 0) yields salt 0 as well, not a random
        // salt. Autoincrement/unknown defaults keep the random salt (the id
        // materializes nonzero at flush time).
        const effectiveBase =
          data[base] !== undefined ? data[base] : typeof defaultValue === 'number' ? defaultValue : undefined;
        data[salt] = effectiveBase === 0 ? 0 : SaltIdsHelper.generateSalt(options.saltLength);
      }
    }
  }

  // 2. 递归查找嵌套写入
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (typeof val === 'object' && val !== null) {
      // Check for relation
      const relation = registry.getRelation(modelName, key);
      const targetModel = relation ? relation.type : undefined;

      if (targetModel) {
        // Prisma Nested Writes Keywords
        const nestedOps = ['create', 'update', 'upsert', 'connectOrCreate'];

        // Handle simple nested create (e.g. { posts: { create: ... } })
        if (val.create) {
          deepInjectSalt(val.create, targetModel, registry, options, false);
        }
        if (val.createMany && val.createMany.data) {
          deepInjectSalt(val.createMany.data, targetModel, registry, options, false);
        }
        if (val.connectOrCreate && val.connectOrCreate.create) {
          deepInjectSalt(val.connectOrCreate.create, targetModel, registry, options, false);
        }
        if (val.upsert && val.upsert.create) {
          deepInjectSalt(val.upsert.create, targetModel, registry, options, false);
        }
        // Note: 'update' usually takes 'data', which might need injection if we allow updating ID?
        // Usually ID/Salt is immutable, but if needed, add logic here.
      }
    }
  }
}

// -----------------------------------------------------------------------------
// 2. 结果劫持 (Result Hijacking)
// -----------------------------------------------------------------------------
// 逻辑：保持原样，利用后缀匹配来隐藏 Salt 并劫持 Getter
export function deepHijackResult(
  data: any,
  options: Required<SaltIdsOptions>,
  modelName?: string,
  registry?: ModelRegistry
) {
  if (!data || typeof data !== 'object') return;

  if (Array.isArray(data)) {
    data.forEach((item) => deepHijackResult(item, options, modelName, registry));
    return;
  }

  const keys = Object.keys(data);
  // console.log(`[saltids] deepHijackResult for ${modelName}: keys=${keys.join(',')}`);
  for (const key of keys) {
    if (key.endsWith(options.saltSuffix)) {
      const saltVal = data[key];
      const baseKey = key.slice(0, -options.saltSuffix.length);
      const baseVal = data[baseKey];

      // console.log(`[saltids] Found salt field ${key}: saltVal=${saltVal}, baseKey=${baseKey}, baseVal=${baseVal}`);

      // 0. Safety Check: Verify against registry to avoid false positives (e.g. inside JSON)
      let shouldHijack = true;
      if (registry) {
        if (!modelName) {
          // Case: Lost model context (e.g. inside JSON), stop hijacking
          shouldHijack = false;
        } else {
          // Case: Have model context, verify if this is a known salt field
          const saltFields = registry.getSaltFields(modelName);
          shouldHijack = saltFields.some((f) => f.base === baseKey && f.salt === key);
        }
      }

      // 0.5 Salt-LIST companion pair: element-wise re-encode into handle
      // values and hide the parallel salt column — the array twin of the
      // scalar hijack below. Elements whose salt slot is missing/not a
      // number (dangling ancestor, length drift) pass through raw.
      const listDef = registry && modelName ? registry.getSaltListFields(modelName).find((f) => f.salt === key) : undefined;
      if (listDef) {
        const saltArr = data[key];
        const baseArr = data[baseKey];
        if (Array.isArray(saltArr) && Array.isArray(baseArr)) {
          Object.defineProperty(data, key, {
            enumerable: false,
            value: saltArr,
            writable: true,
            configurable: true,
          });
          data[baseKey] = baseArr.map((raw: unknown, i: number) =>
            typeof raw === 'number' && typeof saltArr[i] === 'number'
              ? SaltIdsHelper.encode(raw, saltArr[i], options.saltLength)
              : raw
          );
        }
        continue;
      }

      if (shouldHijack && typeof saltVal === 'number' && typeof baseVal === 'number') {
        // 1. Hide Salt
        Object.defineProperty(data, key, {
          enumerable: false,
          value: saltVal,
          writable: true,
          configurable: true,
        });

        // 2. Hijack Base ID
        const encodedId = SaltIdsHelper.encode(baseVal, saltVal, options.saltLength);
        // console.log(`[saltids] Hijacking ${modelName}.${baseKey}: ${baseVal} + ${saltVal} = ${encodedId}`);
        Object.defineProperty(data, baseKey, {
          enumerable: true,
          configurable: true,
          get() {
            return SaltIdsHelper.encode(baseVal, saltVal, options.saltLength);
          },
          set(v) {
            // no-op
          },
        });
      } else if (shouldHijack && baseVal === null) {
        Object.defineProperty(data, key, {
          enumerable: false,
          value: null,
          writable: true,
          configurable: true,
        });
      } else if (shouldHijack && baseVal === undefined && typeof saltVal === 'number') {
        Object.defineProperty(data, key, {
          enumerable: false,
          value: saltVal,
          writable: true,
          configurable: true,
        });
      }
    }

    const val = data[key];
    if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
      let nextModel: string | undefined;
      if (registry && modelName) {
        const relation = registry.getRelation(modelName, key);
        if (relation) nextModel = relation.type;
      }
      deepHijackResult(val, options, nextModel, registry);
    }
  }
}
