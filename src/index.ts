import { Prisma as PrismaExtension } from '@prisma/client/extension';
import { BaseDMMF } from '@prisma/client/runtime/library';
import { deepHijackResult, deepInjectSalt, deepTransformInput } from './logic';
import { saltIdsSql } from './raw';
import { SaltIdsOptions } from './types';
import { ModelRegistry, SaltIdsHelper } from './utils';
export { SaltIdsColumnRef, saltIdsSql } from './raw';

export { SaltIdsHelper, SaltIdsOptions };

export const saltIdsExtension = (options?: SaltIdsOptions, dmmf?: BaseDMMF) => {
  const config: Required<SaltIdsOptions> = {
    saltLength: options?.saltLength ?? 4,
    saltSuffix: options?.saltSuffix ?? 'Salt',
    rawResultHijack: options?.rawResultHijack ?? true,
  };

  const registry = new ModelRegistry();
  const raw = saltIdsSql(config);

  return PrismaExtension.defineExtension((client) => {
    return client.$extends({
      name: 'prisma-extension-saltids',
      client: {
        $saltIds: raw,
      },
      query: {
        async $queryRaw({ args, query }) {
          const result = await query(args);
          if (config.rawResultHijack) raw.resultScan(result);
          return result;
        },
        async $queryRawUnsafe({ args, query }) {
          const result = await query(args);
          if (config.rawResultHijack) raw.resultScan(result);
          return result;
        },
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            // Ensure registry is initialized
            if (!registry.initialized) {
              const dmmf1 = dmmf ?? extractDmmfFromClient(client);
              if (!dmmf1) {
                throw new Error(
                  'prisma-extension-saltids: Could not extract DMMF from client. ' +
                    'Please pass dmmf explicitly: saltIdsExtension({}, Prisma.dmmf)'
                );
              }
              registry.init(dmmf1, config.saltSuffix);
            }

            // ------------------------------------------------
            // 1. 输入参数转换 (Input Transformation)
            // ------------------------------------------------
            let didTransformId = false;
            // args 包含 where, data, select, include 等
            // 我们直接对 args 进行变换，递归中会根据 Key 匹配字段
            if (args) {
              const res = deepTransformInput(args, model, registry, config);
              didTransformId = res.didTransformId;
            }

            // ------------------------------------------------
            // 2. 自动生成 Salt (Auto Generate Salt)
            // ------------------------------------------------
            if (operation === 'create' || operation === 'createMany') {
              if (args.data) deepInjectSalt(args.data, model, registry, config, false);
            } else if (operation === 'update' || operation === 'updateMany') {
              if (args.data) deepInjectSalt(args.data, model, registry, config, true);
            } else if (operation === 'upsert') {
              if (args.create) deepInjectSalt(args.create, model, registry, config, false);
              if (args.update) deepInjectSalt(args.update, model, registry, config, true);
            }

            // ------------------------------------------------
            // 3. 执行查询 (含自动降级逻辑)
            // ------------------------------------------------
            let result: any;

            // Auto-ensure salt fields are selected for read operations
            // Salt fields MUST be selected from DB for encoding (deepHijackResult encodes rawId+salt into saltedId).
            // Hiding salt from API response is deepHijackResult's job (sets enumerable: false), NOT SQL select's job.
            // So even if business code sets {xxxSalt: false} in select (e.g. via defSelect), we override to true.
            const readOperations = ['findUnique', 'findFirst', 'findMany', 'update', 'upsert'];
            if (readOperations.includes(operation) && args.select) {
              const saltFields = registry.getSaltFields(model);

              for (const { salt, base } of saltFields) {
                // Skip only when base field is explicitly excluded — no base means nothing to encode
                if (args.select[base] === false) continue;

                // Force salt field to be selected (override false → true)
                // Business code may set xxxSalt: false to exclude from API response,
                // but SQL must still select it for deepHijackResult to encode.
                if (args.select[salt] !== true) {
                  args.select[salt] = true;
                }
                // Ensure base field is also selected when not explicitly included
                if (args.select[base] === undefined) {
                  args.select[base] = true;
                }
              }
            }

            // 场景：用户调用 findUnique，但我们注入了 salt。
            // 此时 args.where 包含 { id, salt }，这在没有联合唯一索引时会导致 Prisma 报错。
            // 解决：拦截此操作，手动清理 args.where 中的 salt，调用原 query，并在结果中验证。
            if (operation === 'findUnique' && didTransformId) {
              const saltFields = registry.getSaltFields(model);
              const expectedSalts: Record<string, any> = {};

              // Helper: Recursively extract and remove salt fields from object
              const extractAndRemoveSalts = (obj: any) => {
                if (!obj || typeof obj !== 'object') return;
                for (const key of Object.keys(obj)) {
                  const saltDef = saltFields.find((f) => f.salt === key);
                  if (saltDef) {
                    expectedSalts[key] = obj[key];
                    delete obj[key];
                  } else if (typeof obj[key] === 'object') {
                    extractAndRemoveSalts(obj[key]);
                  }
                }
              };

              if (args.where) extractAndRemoveSalts(args.where);

              // Ensure salt fields are selected if we are using select
              if (args.select && Object.keys(expectedSalts).length > 0) {
                for (const key of Object.keys(expectedSalts)) {
                  args.select[key] = true;
                }
              }

              result = await query(args);

              // Verify salt match
              if (result) {
                for (const [key, val] of Object.entries(expectedSalts)) {
                  if (result[key] !== val) {
                    result = null;
                    break;
                  }
                }
              }
            } else {
              result = await query(args);
            }

            // ------------------------------------------------
            // 4. 结果劫持 (隐藏 Salt，暴露 SaltID)
            // ------------------------------------------------
            if (result) {
              deepHijackResult(result, config, model, registry);
            }

            return result;
          },
        },
      },
    });
  });
};

/**
 * Extract DMMF from Prisma client instance
 */
function extractDmmfFromClient(client: any): BaseDMMF | null {
  if (client?._dmmf?.datamodel?.models) return client._dmmf as BaseDMMF;
  if (client?._engineConfig?.dmmf?.datamodel?.models) return client._engineConfig.dmmf as BaseDMMF;

  // Try to get from _runtimeDataModel (Prisma 7+)
  if (client._runtimeDataModel) {
    return {
      datamodel: {
        models: Object.entries(client._runtimeDataModel.models).map(([name, model]: [string, any]) => ({
          name,
          fields: model.fields || [],
          uniqueFields: model.uniqueFields || [],
          uniqueIndexes: model.uniqueIndexes || [],
          primaryKey: model.primaryKey,
          dbName: model.dbName ?? null,
          schema: model.schema ?? null,
        })),
        enums: [],
        types: [],
      },
    };
  }
  return null;
}
