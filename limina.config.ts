import { defineConfig } from "limina";
export default defineConfig({
  scope: {
    regions: { extendNestedPackageScopes: false },
    source: {
      include: ["..."],
      exclude: ["...", "skills/**", "**/fixtures/**", "**/.build/**", "reports/**"],
    },
    checkers: {
      tsc: { include: ["tsconfig.json"] },
      auto: { exclude: ["skills/**", "**/fixtures/**", "**/.build/**"] },
    },
  },
});
