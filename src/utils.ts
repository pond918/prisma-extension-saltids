/**
 * SaltID Helper (Pure Number)
 */
const DEFAULT_SALT_LEN = 6;

export class SaltIdsHelper {
  static encode(
    realId: number,
    salt: number,
    saltLen: number = DEFAULT_SALT_LEN,
  ): number {
    return Number(`${salt}${realId}`);
  }

  static decode(
    pid: number,
    saltLen: number = DEFAULT_SALT_LEN,
  ): { id: number; salt: number } {
    const str = pid.toString();
    // 容错：长度不足则不做处理
    if (str.length <= saltLen) {
      return { id: pid, salt: 0 };
    }
    const saltStr = str.slice(0, saltLen);
    const idStr = str.slice(saltLen);
    return {
      salt: parseInt(saltStr, 10),
      id: parseInt(idStr, 10),
    };
  }

  static isPotentialSaltId(
    val: number,
    saltLen: number = DEFAULT_SALT_LEN,
  ): boolean {
    return val.toString().length > saltLen;
  }

  static generateSalt(saltLen: number = DEFAULT_SALT_LEN): number {
    const min = Math.pow(10, saltLen - 1); // e.g. 100
    const max = Math.pow(10, saltLen) - 1; // e.g. 999
    return Math.floor(min + Math.random() * (max - min + 1));
  }
}

export interface SaltField {
  base: string;
  salt: string;
}

export interface RelationField {
  name: string;
  type: string;
  isList: boolean;
}

export class ModelRegistry {
  private saltFields = new Map<string, SaltField[]>();
  private relations = new Map<string, Map<string, RelationField>>();
  private initialized = false;

  init(dmmf: any, suffix: string) {
    if (this.initialized) return;
    this.parse(dmmf, suffix);
    this.initialized = true;
  }

  private parse(dmmf: any, suffix: string) {
    const models = dmmf.datamodel.models;
    for (const model of models) {
      const fields = model.fields as any[];
      const validSalts: SaltField[] = [];
      const relationMap = new Map<string, RelationField>();

      // 1. Map all Int fields
      const intFields = new Set<string>();
      fields.forEach((f) => {
        if (f.kind === "scalar" && f.type === "Int") {
          intFields.add(f.name);
        }
        if (f.kind === "object") {
          relationMap.set(f.name, {
            name: f.name,
            type: f.type,
            isList: f.isList,
          });
        }
      });

      // 2. Find Pairs
      intFields.forEach((fieldName) => {
        // assumption: base field "xxx", salt field "xxxSalt" (if suffix is "Salt")
        // Check if this field could be a base?
        // If "postPk" exists, check if "postPkSalt" exists.
        const potentialSaltName = `${fieldName}${suffix}`;
        if (intFields.has(potentialSaltName)) {
          validSalts.push({ base: fieldName, salt: potentialSaltName });
        }
      });

      this.saltFields.set(model.name, validSalts);
      this.relations.set(model.name, relationMap);
    }
  }

  getSaltFields(model: string): SaltField[] {
    return this.saltFields.get(model) || [];
  }

  getRelation(model: string, field: string): RelationField | undefined {
    return this.relations.get(model)?.get(field);
  }
}
