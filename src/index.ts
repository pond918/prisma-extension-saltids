import { Prisma } from '@prisma/client';
import { Prisma as PrismaExtension } from '@prisma/client/extension';
import { BaseDMMF } from '@prisma/client/runtime/library';
import { deepHijackResult, deepInjectSalt, deepTransformInput } from './logic';
import { saltIdsSql } from './raw';
import { PrismaSqlNamespace, SaltIdsOptions } from './types';
import { ModelRegistry, SaltIdsHelper } from './utils';
export { SaltIdsColumnRef, saltIdsSql } from './raw';

export { SaltIdsHelper, SaltIdsOptions, PrismaSqlNamespace };

export const saltIdsExtension = (options?: SaltIdsOptions) => {
  const config: Required<SaltIdsOptions> = {
    saltLength: options?.saltLength ?? 4,
    saltSuffix: options?.saltSuffix ?? 'Salt',
    rawResultHijack: options?.rawResultHijack ?? true,
    prisma: options?.prisma ?? (Prisma as unknown as PrismaSqlNamespace),
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
              const dmmf1 = (config.prisma as any)?.dmmf ?? extractDmmfFromClient(client);
              if (!dmmf1) {
                throw new Error(
                  'prisma-extension-saltids: Could not extract DMMF from client. ' +
                    'Please pass prisma: Prisma in options.'
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
            const readOperations = ['findUnique', 'findFirst', 'findMany', 'create', 'createMany', 'update', 'upsert'];
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

              // List companion pairs ride the same law: the parallel salt
              // array MUST ride the projection or the read-back has nothing
              // to re-encode element-wise from.
              for (const { salt, base } of registry.getSaltListFields(model)) {
                if (args.select[base] === false) continue;
                if (args.select[salt] !== true) {
                  args.select[salt] = true;
                }
                if (args.select[base] === undefined) {
                  args.select[base] = true;
                }
              }
            }

            // findUnique requires no special handling.
            // After deepTransformInput, args.where contains { id, idSalt }. Prisma 6.x
            // findUnique accepts multi-field where (even on non-unique-index fields)
            // without error, and the DB enforces the salt match. Keeping idSalt in
            // where preserves the deepTransformInput idempotency guard
            // (obj[salt] === undefined), so a second pass through this extension
            // (e.g. via a transaction client that inherits the extension) is a no-op.
            result = await query(args);

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
