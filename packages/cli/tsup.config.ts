import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: false,
  dts: false,
  // Inline the workspace dep so published consumers don't need @mcpier/shared.
  // Everything else (commander, kleur, inquirer) stays external and is declared
  // in dependencies, so npm installs them normally.
  noExternal: ["@mcpier/shared"],
  // src/index.ts already has #!/usr/bin/env node — tsup preserves it.
});
