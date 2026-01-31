import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BackendConfig {
  url: string;
  token?: string;
}

export interface RepositConfig {
  backends: Record<string, BackendConfig>;
  default?: string;
}

const GLOBAL_CONFIG_PATH = join(homedir(), ".reposit", "config.json");
const LOCAL_CONFIG_PATH = ".reposit.json";

function loadJsonFile(path: string): Partial<RepositConfig> | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function parseEnvBackends(): Record<string, BackendConfig> | null {
  const env = process.env.REPOSIT_BACKENDS;
  if (!env) return null;
  try {
    return JSON.parse(env);
  } catch {
    return null;
  }
}

// Default backend for zero-config local development
const DEFAULT_LOCAL_BACKEND: BackendConfig = {
  url: "http://localhost:4000",
};

export function loadConfig(): RepositConfig {
  const globalConfig = loadJsonFile(GLOBAL_CONFIG_PATH);
  const localConfig = loadJsonFile(LOCAL_CONFIG_PATH);
  const envBackends = parseEnvBackends();

  // Merge: global -> local -> env (later wins)
  const backends: Record<string, BackendConfig> = {
    ...(globalConfig?.backends ?? {}),
    ...(localConfig?.backends ?? {}),
    ...(envBackends ?? {}),
  };

  // Single REPOSIT_URL env var adds/overrides "local" backend
  if (process.env.REPOSIT_URL) {
    backends["local"] = { url: process.env.REPOSIT_URL };
  }

  // If no backends configured at all, use default local backend
  if (Object.keys(backends).length === 0) {
    backends["local"] = DEFAULT_LOCAL_BACKEND;
  }

  // Determine default backend
  const defaultBackend =
    localConfig?.default ?? globalConfig?.default ?? Object.keys(backends)[0];

  return { backends, default: defaultBackend };
}

export function getBackends(
  config: RepositConfig,
  names?: string | string[]
): { name: string; backend: BackendConfig }[] {
  if (!names) {
    // Use default
    const name = config.default;
    if (!name || !config.backends[name]) {
      throw new Error(
        `No default backend configured. Available: ${Object.keys(config.backends).join(", ") || "none"}`
      );
    }
    return [{ name, backend: config.backends[name] }];
  }

  const nameList = Array.isArray(names) ? names : [names];

  if (nameList.includes("all")) {
    return Object.entries(config.backends).map(([name, backend]) => ({
      name,
      backend,
    }));
  }

  return nameList.map((name) => {
    const backend = config.backends[name];
    if (!backend) {
      throw new Error(
        `Backend "${name}" not found. Available: ${Object.keys(config.backends).join(", ") || "none"}`
      );
    }
    return { name, backend };
  });
}
