import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export interface BackendConfig {
  url: string;
  token?: string;
}

export interface RepositConfig {
  backends: Record<string, BackendConfig>;
  default?: string;
  autoShare?: boolean;
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

// Default backend for zero-config usage
const DEFAULT_LOCAL_BACKEND: BackendConfig = {
  url: "https://reposit.bot",
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

  // REPOSIT_URL env var adds/overrides default backend
  if (process.env.REPOSIT_URL) {
    backends["default"] = { url: process.env.REPOSIT_URL };
  }

  // If no backends configured at all, use default backend
  if (Object.keys(backends).length === 0) {
    backends["default"] = { ...DEFAULT_LOCAL_BACKEND };
  }

  // REPOSIT_TOKEN env var applies to backends without a token
  if (process.env.REPOSIT_TOKEN) {
    for (const name of Object.keys(backends)) {
      if (!backends[name].token) {
        backends[name] = { ...backends[name], token: process.env.REPOSIT_TOKEN };
      }
    }
  }

  // Determine default backend
  const defaultBackend =
    localConfig?.default ?? globalConfig?.default ?? Object.keys(backends)[0];

  // Determine autoShare setting (env > local > global > default)
  const autoShare =
    process.env.REPOSIT_AUTO_SHARE === "true" ||
    localConfig?.autoShare ??
    globalConfig?.autoShare ??
    false;

  return { backends, default: defaultBackend, autoShare };
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

/**
 * Saves or updates a backend configuration with a token.
 * Creates the config file if it doesn't exist.
 */
export function saveBackendToken(
  backendName: string,
  url: string,
  token: string
): void {
  // Read existing config or create empty
  let config: Partial<RepositConfig> = loadJsonFile(GLOBAL_CONFIG_PATH) ?? {
    backends: {},
  };

  // Ensure backends object exists
  if (!config.backends) {
    config.backends = {};
  }

  // Update or create the backend
  config.backends[backendName] = {
    ...(config.backends[backendName] ?? {}),
    url,
    token,
  };

  // Set as default if no default exists
  if (!config.default) {
    config.default = backendName;
  }

  // Write config
  const dir = dirname(GLOBAL_CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export { GLOBAL_CONFIG_PATH };
