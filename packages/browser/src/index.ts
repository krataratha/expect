export { Playwright, type OpenOptions } from "./playwright";
export { Artifacts } from "./artifacts";
export { layerMcpServer } from "./mcp-server";
export { diffSnapshots } from "./diff";
export { collectEvents, collectAllEvents, loadSession } from "./recorder";
export type {
  Browser as BrowserProfile,
  BrowserKey,
  Cookie,
  ExtractOptions,
} from "@expect/cookies";
export {
  ActionTimeoutError,
  ActionUnknownError,
  BrowserAlreadyOpenError,
  BrowserLaunchError,
  BrowserNotOpenError,
  McpServerStartError,
  NavigationError,
  RecorderInjectionError,
  RefAmbiguousError,
  RefBlockedError,
  RefNotFoundError,
  RefNotVisibleError,
  SessionLoadError,
  SnapshotTimeoutError,
} from "./errors";
export type { ActionError } from "./errors";
export type {
  Annotation,
  AnnotatedScreenshotOptions,
  AnnotatedScreenshotResult,
  AriaRole,
  CollectResult,
  RefEntry,
  RefMap,
  SnapshotDiff,
  SnapshotOptions,
  SnapshotResult,
  SnapshotStats,
} from "./types";
