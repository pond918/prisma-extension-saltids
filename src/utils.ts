/**
 * SaltID Helper (Pure Number)
 */
const DEFAULT_SALT_LEN = 4;

export class SaltIdsHelper {
  static encode(
    realId: number,
    salt: number,
    saltLen: number = DEFAULT_SALT_LEN,
  ): number {
    const saltStr = salt.toString();
    if (salt < 0 || saltStr.length !== saltLen) {
      throw new Error(`Salt must be positive and length must be ${saltLen}`);
    }
    const resultStr = saltStr + Math.abs(realId).toString();
    const result = Number(resultStr);
    return realId < 0 ? -result : result;
  }

  static decode(
    pid: number,
    saltLen: number = DEFAULT_SALT_LEN,
  ): { id: number; salt: number } {
    const pidStr = Math.abs(pid).toString();

    if (pidStr.length <= saltLen) {
      return { id: pid, salt: 0 };
    }

    const saltStr = pidStr.slice(0, saltLen);
    const idStr = pidStr.slice(saltLen);
    const salt = Number(saltStr);
    const id = Number(idStr);

    return {
      id: pid < 0 ? -id : id,
      salt: salt,
    };
  }

  static isPotentialSaltId(
    val: number,
    saltLen: number = DEFAULT_SALT_LEN,
  ): boolean {
    return Math.abs(val).toString().length > saltLen;
  }

  static generateSalt(saltLen: number = DEFAULT_SALT_LEN): number {
    const min = 10 ** (saltLen - 1);
    return Math.floor(min + Math.random() * 9 * min);
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
  public initialized = false;

  init(dmmf: any, suffix: string) {
    if (this.initialized || !dmmf) return;
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
