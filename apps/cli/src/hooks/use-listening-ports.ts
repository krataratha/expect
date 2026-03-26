import { useQuery } from "@tanstack/react-query";
import { execSync } from "child_process";
import {
  LISTENING_PORTS_REFETCH_INTERVAL_MS,
  MIN_USER_PORT,
  MAX_PORT,
  EPHEMERAL_PORT_START,
} from "../constants";

interface ListeningPort {
  readonly port: number;
  readonly processName: string;
  readonly cwd: string;
}

const NON_WEB_SERVER_PREFIXES = [
  "spotify",
  "raycast",
  "google",
  "controlce",
  "controlcenter",
  "cursor",
  "electron",
  "slack",
  "discord",
  "figma",
  "redis",
  "postgres",
  "mysqld",
  "mongod",
  "mongos",
  "memcached",
  "dockerd",
  "containerd",
  "com.docke",
  "docker",
  "code",
  "rapportd",
  "wifiagent",
  "airplayxpc",
  "identitys",
  "sharingd",
  "bluetoothd",
  "screencap",
  "loginwind",
  "systempol",
  "corespeec",
  "apsd",
  "mds_store",
  "spotlight",
  "lsd",
];

const FRAMEWORK_PATTERNS: readonly [RegExp, string][] = [
  [/next[\\/]dist[\\/]/, "next"],
  [/next-server/, "next"],
  [/vite[\\/]/, "vite"],
  [/vite-plus[\\/]/, "vite"],
  [/react-scripts[\\/]/, "react-scripts"],
  [/angular[\\/]cli[\\/]/, "angular"],
  [/remix[\\/]/, "remix"],
  [/astro[\\/]/, "astro"],
  [/nuxt[\\/]/, "nuxt"],
  [/svelte[\\/]/, "svelte"],
  [/webpack[\\/]/, "webpack"],
  [/webpack-dev-server/, "webpack"],
  [/turbopack[\\/]/, "turbopack"],
  [/remotion[\\/]/, "remotion"],
  [/gatsby[\\/]/, "gatsby"],
  [/parcel[\\/]/, "parcel"],
  [/http-server/, "http-server"],
  [/live-server/, "live-server"],
  [/serve[\\/]/, "serve"],
  [/express[\\/]/, "express"],
  [/fastify[\\/]/, "fastify"],
  [/hono[\\/]/, "hono"],
  [/elysia[\\/]/, "elysia"],
];

const isBlockedProcess = (commandName: string): boolean => {
  const lower = commandName.toLowerCase();
  return NON_WEB_SERVER_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

interface ResolvedProcess {
  readonly name: string;
  readonly isFramework: boolean;
  readonly cwd: string;
}

const getProcessCwd = (pid: string): string => {
  if (!/^\d+$/.test(pid)) return "";
  try {
    const output = execSync(`lsof -p ${pid} -a -d cwd -Fn`, {
      encoding: "utf-8",
      timeout: 1000,
    });
    const line = output.split("\n").find((entry) => entry.startsWith("n"));
    return line ? line.slice(1) : "";
  } catch {
    return "";
  }
};

const resolveProcess = (pid: string, fallbackName: string): ResolvedProcess | undefined => {
  if (!/^\d+$/.test(pid)) return undefined;
  if (isBlockedProcess(fallbackName)) return undefined;

  const cwd = getProcessCwd(pid);

  try {
    const fullCommand = execSync(`ps -p ${pid} -o command=`, {
      encoding: "utf-8",
      timeout: 1000,
    }).trim();

    for (const [pattern, name] of FRAMEWORK_PATTERNS) {
      if (pattern.test(fullCommand)) return { name, isFramework: true, cwd };
    }
  } catch {
    // fall through
  }

  if (fallbackName === "node" || fallbackName === "bun" || fallbackName === "deno") {
    return { name: fallbackName, isFramework: false, cwd };
  }

  return { name: fallbackName, isFramework: false, cwd };
};

interface LsofEntry {
  readonly port: number;
  readonly pid: string;
  readonly commandName: string;
}

const parseLsofOutput = (output: string): LsofEntry[] => {
  const seen = new Set<number>();
  const entries: LsofEntry[] = [];

  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 9) continue;

    const commandName = columns[0] ?? "";
    const pid = columns[1] ?? "";
    const nameField = columns[8] ?? "";

    const portMatch = nameField.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = Number(portMatch[1]);
    if (port < MIN_USER_PORT || port > MAX_PORT) continue;
    if (seen.has(port)) continue;

    seen.add(port);
    entries.push({ port, pid, commandName });
  }

  return entries;
};

const detectListeningPorts = (): ListeningPort[] => {
  try {
    const output = execSync("lsof -iTCP -sTCP:LISTEN -nP", {
      encoding: "utf-8",
      timeout: 3000,
    });

    const entries = parseLsofOutput(output);
    const ports: ListeningPort[] = [];

    for (const entry of entries) {
      const resolved = resolveProcess(entry.pid, entry.commandName);
      if (resolved === undefined) continue;
      if (entry.port >= EPHEMERAL_PORT_START && !resolved.isFramework) continue;
      ports.push({ port: entry.port, processName: resolved.name, cwd: resolved.cwd });
    }

    return ports.sort((left, right) => left.port - right.port);
  } catch {
    return [];
  }
};

export const useListeningPorts = () =>
  useQuery({
    queryKey: ["listening-ports"],
    queryFn: () => detectListeningPorts(),
    refetchInterval: LISTENING_PORTS_REFETCH_INTERVAL_MS,
  });
