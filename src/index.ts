import { Prisma, PrismaClientExtends } from "@prisma/client";
import { deepHijackResult, deepTransformInput, deepInjectSalt } from "./logic";
import { SaltIdsOptions } from "./types";
import { ModelRegistry } from "./utils";

export { SaltIdsOptions };

export const saltIdsExtension = (options?: SaltIdsOptions) => {
  const config: Required<SaltIdsOptions> = {
    saltLength: options?.saltLength ?? 4,
    saltSuffix: options?.saltSuffix ?? "Salt",
  };

  const registry = new ModelRegistry();

  return Prisma.defineExtension((client: PrismaClientExtends) => {
    return client.$extends({
      name: "prisma-extension-saltids",
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            // Ensure registry is initialized
            // @ts-ignore
            if (Prisma.dmmf) {
              // @ts-ignore
              registry.init(Prisma.dmmf, config.saltSuffix);
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
            if (operation === "create" || operation === "createMany") {
              if (args.data)
                deepInjectSalt(args.data, model, registry, config, false);
            } else if (operation === "update" || operation === "updateMany") {
              if (args.data)
                deepInjectSalt(args.data, model, registry, config, true);
            } else if (operation === "upsert") {
              if (args.create)
                deepInjectSalt(args.create, model, registry, config, false);
              if (args.update)
                deepInjectSalt(args.update, model, registry, config, true);
            }

            // ------------------------------------------------
            // 3. 执行查询 (含自动降级逻辑)
            // ------------------------------------------------
            let result: any;

            // 场景：用户调用 findUnique，但我们注入了 salt。
            // 此时 args.where 包含 { id, salt }，这在没有联合唯一索引时会导致 Prisma 报错。
            // 解决：拦截此操作，手动改为调用 findFirst。
            if (operation === "findUnique" && didTransformId) {
              result = await (client as any)[model].findFirst(args);
            } else {
              result = await query(args);
            }

            // ------------------------------------------------
            // 4. 结果劫持 (隐藏 Salt，暴露 SaltID)
            // ------------------------------------------------
            if (result) {
              deepHijackResult(result, config);
            }

            return result;
          },
        },
      },
    });
  });
};
