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
    const maxSalt = 10 ** saltLen;
    if (salt < 0 || salt >= maxSalt) {
      throw new Error(`Salt must be in range [0, ${maxSalt - 1}]`);
    }
    const result = Math.abs(realId) * maxSalt + salt;
    return realId < 0 ? -result : result;
  }

  static decode(pid: number, saltLen: number = DEFAULT_SALT_LEN): { id: number; salt: number } {
    const divisor = 10 ** saltLen;
    const absPid = Math.abs(pid);
    const salt = absPid % divisor;
    const id = Math.floor(absPid / divisor);
    return {
      id: pid < 0 ? -id : id,
      salt,
    };
  }

  static isPotentialSaltId(_val: number, _saltLen: number = DEFAULT_SALT_LEN): boolean {
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
  saltHasDefaultValue: boolean; // 标识 salt 字段是否也有默认值
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
      const relationMap = new Map<string, RelationField>();
      const modelUniqueIndexes: UniqueIndexInfo[] = [];

      const intFieldsMap = new Map<string, { hasDefaultValue: boolean }>();
      fields.forEach((f) => {
        if (f.kind === 'scalar' && f.type === 'Int') {
          intFieldsMap.set(f.name, {
            hasDefaultValue: f.hasDefaultValue || false,
          });
        }
        if (f.kind === 'object') {
          relationMap.set(f.name, {
            name: f.name,
            type: f.type,
            isList: f.isList,
          });
        }
      });

      intFieldsMap.forEach((metadata, fieldName) => {
        const potentialSaltName = `${fieldName}${suffix}`;
        const saltMetadata = intFieldsMap.get(potentialSaltName);
        if (saltMetadata) {
          validSalts.push({
            base: fieldName,
            salt: potentialSaltName,
            hasDefaultValue: metadata.hasDefaultValue,
            saltHasDefaultValue: saltMetadata.hasDefaultValue,
          });
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
      this.relations.set(model.name, relationMap);
      this.uniqueIndexes.set(model.name, modelUniqueIndexes);
    }
  }

  getSaltFields(model: string): SaltField[] {
    return this.saltFields.get(model) || [];
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
