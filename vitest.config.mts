import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // 增加一点超时时间，因为 Prisma 初始化可能稍慢
    testTimeout: 10000,
  },
});
