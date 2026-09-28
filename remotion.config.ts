import path from "node:path";
import { Config } from "@remotion/cli/config";

// Resolve the "@/..." imports the app uses.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: { ...(config.resolve?.alias ?? {}), "@": path.resolve(process.cwd()) },
  },
}));
