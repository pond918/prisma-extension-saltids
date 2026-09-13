/**
 * SaltID Helper — Arithmetic Encoding
 *
 * Encoding formula (pure integer arithmetic, no string concatenation):
 *   saltId = sign(realId) * (abs(realId) * 10^saltLen + salt)
 *
 * Decoding formula (inverse):
 *   salt = abs(saltId) % 10^saltLen
 *   id   = floor(abs(saltId) / 10^saltLen) * sign(saltId)
 *
 * Salt range: [0, 10^saltLen - 1]  (e.g. saltLen=4 → [0, 9999])
 * Every integer has a unique {id, salt} decomposition — no ambiguity.
 */
const DEFAULT_SALT_LEN = 4;

export class SaltIdsHelper {
  static encode(realId: number, salt: number, saltLen: number = DEFAULT_SALT_LEN): number {
    if (!Number.isInteger(realId) || !Number.isInteger(salt)) {
      return NaN;
    }
    const maxSalt = 10 ** saltLen;
    if (salt < 0 || salt >= maxSalt) {
      throw new Error(`Salt must be in range [0, ${maxSalt - 1}]`);
    }
    const result = Math.abs(realId) * maxSalt + salt;
    return realId < 0 ? -result : result;
  }

  static decode(pid: number, saltLen: number = DEFAULT_SALT_LEN): { id?: number; salt?: number } {
    if (!Number.isInteger(pid)) {
      return {};
    }
    const divisor = 10 ** saltLen;
    // Invalid range: negative pid with abs(pid) < divisor
    // encode(0, salt, saltLen) always produces >= 0, so [-divisor+1, -1] are invalid
    if (pid < 0 && Math.abs(pid) < divisor) {
      return {};
    }
    const absPid = Math.abs(pid);
    const salt = absPid % divisor;
    const id = Math.floor(absPid / divisor);
    return {
      id: pid < 0 ? -id : id,
      salt,
    };
  }

  static isPotentialSaltId(val: number, saltLen: number = DEFAULT_SALT_LEN): boolean {
    if (!Number.isInteger(val)) {
      return false;
    }
    const divisor = 10 ** saltLen;
    // Invalid range: negative val with abs(val) < divisor
    if (val < 0 && Math.abs(val) < divisor) {
      return false;
    }
    return true;
  }

  static generateSalt(saltLen: number = DEFAULT_SALT_LEN): number {
    const maxSalt = 10 ** saltLen;
    return Math.floor(Math.random() * maxSalt);
  }
}

export interface SaltField {
  base: string;
  salt: string;
  hasDefaultValue: boolean; // 标识 base 字段是否有默认值（autoincrement 或其他 @default）
  /** Scalar default value when the schema declares a literal (@default(0)); undefined for autoincrement/dbgenerated. */
  defaultValue?: number;
  saltHasDefaultValue: boolean; // 标识 salt 字段是否也有默认值
}

/**
 * A companion salt pair where BOTH sides are list scalars (`Int[]` +
 * `Int[]Salt`), e.g. a materialized handle chain `ancestorIds Int[]` riding
 * `ancestorIdsSalt Int[]` (element-wise parallel salts).
 *
 * List pairs follow the same declaration-as-configuration law as scalar
 * pairs: the schema column pair IS the opt-in, no extension option exists.
 * Semantics differ from scalars in exactly one way — salts are NEVER
 * auto-generated (deepInjectSalt skips list pairs): every element references
 * an EXISTING row, so its salt can only come from the element handle itself
 * (write-side decode) or an explicit companion array.
 */
export interface SaltListField {
  base: string;
  salt: string;
}

export interface RelationField {
  name: string;
  type: string;
  isList: boolean;
}

export interface UniqueIndexInfo {
  name: string | null;
  fields: string[];
}

export class ModelRegistry {
  private saltFields = new Map<string, SaltField[]>();
  private saltListFields = new Map<string, SaltListField[]>();
  private relations = new Map<string, Map<string, RelationField>>();
  private uniqueIndexes = new Map<string, UniqueIndexInfo[]>();
  public initialized = false;

  init(dmmf: any, suffix: string) {
    if (this.initialized) return;
    dmmf && this.parse(dmmf, suffix);
    this.initialized = true;
  }

  private parse(dmmf: any, suffix: string) {
    const models = dmmf.datamodel.models;
    for (const model of models) {
      const fields = model.fields as any[];
      const validSalts: SaltField[] = [];
      const validListSalts: SaltListField[] = [];
      const relationMap = new Map<string, RelationField>();
      const modelUniqueIndexes: UniqueIndexInfo[] = [];

      // Scalar and list Int fields are collected SEPARATELY so a pair can
      // only form within its own kind — a scalar `xxxSalt` must never pair
      // with a list `xxx` (or vice versa): deepInjectSalt would auto-generate
      // a scalar salt next to an array column and the write would blow up on
      // the Prisma input type.
      const scalarIntFields = new Map<string, { hasDefaultValue: boolean; defaultValue?: number }>();
      const listIntFields = new Set<string>();
      fields.forEach((f) => {
        if (f.kind === 'object') {
          relationMap.set(f.name, {
            name: f.name,
            type: f.type,
            isList: f.isList,
          });
          return;
        }
        if (f.kind !== 'scalar' || f.type !== 'Int') return;
        if (f.isList) {
          listIntFields.add(f.name);
          return;
        }
        scalarIntFields.set(f.name, {
          hasDefaultValue: f.hasDefaultValue || false,
          // DMMF: literal @default(0) → number; autoincrement/dbgenerated → object.
          defaultValue: typeof f.default === 'number' ? f.default : undefined,
        });
      });

      scalarIntFields.forEach((metadata, fieldName) => {
        const potentialSaltName = `${fieldName}${suffix}`;
        const saltMetadata = scalarIntFields.get(potentialSaltName);
        if (saltMetadata) {
          validSalts.push({
            base: fieldName,
            salt: potentialSaltName,
            hasDefaultValue: metadata.hasDefaultValue,
            defaultValue: metadata.defaultValue,
            saltHasDefaultValue: saltMetadata.hasDefaultValue,
          });
        }
      });

      listIntFields.forEach((fieldName) => {
        const potentialSaltName = `${fieldName}${suffix}`;
        if (listIntFields.has(potentialSaltName)) {
          validListSalts.push({ base: fieldName, salt: potentialSaltName });
        }
      });

      if (model.uniqueIndexes && Array.isArray(model.uniqueIndexes)) {
        for (const idx of model.uniqueIndexes) {
          modelUniqueIndexes.push({
            name: idx.name,
            fields: idx.fields,
          });
        }
      }

      if (model.uniqueFields && Array.isArray(model.uniqueFields)) {
        for (const fieldSet of model.uniqueFields) {
          modelUniqueIndexes.push({
            name: null,
            fields: fieldSet,
          });
        }
      }

      this.saltFields.set(model.name, validSalts);
      this.saltListFields.set(model.name, validListSalts);
      this.relations.set(model.name, relationMap);
      this.uniqueIndexes.set(model.name, modelUniqueIndexes);
    }
  }

  getSaltFields(model: string): SaltField[] {
    return this.saltFields.get(model) || [];
  }

  /** Companion salt pairs where both sides are list scalars (`Int[]`). */
  getSaltListFields(model: string): SaltListField[] {
    return this.saltListFields.get(model) || [];
  }

  getRelation(model: string, field: string): RelationField | undefined {
    return this.relations.get(model)?.get(field);
  }

  getUniqueIndexes(model: string): UniqueIndexInfo[] {
    return this.uniqueIndexes.get(model) || [];
  }

  isFieldInUniqueIndexWithoutSalt(model: string, fieldName: string, suffix: string): boolean {
    const indexes = this.getUniqueIndexes(model);
    const saltFields = this.getSaltFields(model);
    const saltFieldDef = saltFields.find((f) => f.base === fieldName);

    if (!saltFieldDef) return false;

    for (const idx of indexes) {
      if (idx.fields.includes(fieldName) && !idx.fields.includes(saltFieldDef.salt)) {
        return true;
      }
    }

    return false;
  }
}
