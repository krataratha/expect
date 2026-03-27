import { Browsers, Cookies, layerLive } from "@expect/cookies";
import type { Browser as BrowserProfile, Cookie } from "@expect/cookies";
import { chromium } from "playwright";
import type { Browser as PlaywrightBrowser, BrowserContext, Locator, Page } from "playwright";
import {
  Array as Arr,
  Effect,
  FiberHandle,
  Layer,
  Option,
  Queue,
  Schedule,
  ServiceMap,
  Stream,
} from "effect";
import {
  CONTENT_ROLES,
  EVENT_COLLECT_INTERVAL_MS,
  HEADLESS_CHROMIUM_ARGS,
  INTERACTIVE_ROLES,
  NAVIGATION_DETECT_DELAY_MS,
  OVERLAY_CONTAINER_ID,
  POST_NAVIGATION_SETTLE_MS,
  REF_PREFIX,
  SNAPSHOT_TIMEOUT_MS,
} from "./constants";
import {
  BrowserAlreadyOpenError,
  BrowserLaunchError,
  BrowserNotOpenError,
  NavigationError,
  SnapshotTimeoutError,
} from "./errors";
import { type Artifact, ConsoleLog, NetworkRequest, RrwebEvent } from "@expect/shared/models";
import { Artifacts } from "./artifacts";
import { collectAllEvents } from "./recorder";
import { toActionError } from "./utils/action-error";
import { compactTree } from "./utils/compact-tree";
import { createLocator } from "./utils/create-locator";
import { evaluateRuntime } from "./utils/evaluate-runtime";
import { findCursorInteractive } from "./utils/find-cursor-interactive";
import { getIndentLevel } from "./utils/get-indent-level";
import { parseAriaLine } from "./utils/parse-aria-line";
import { resolveNthDuplicates } from "./utils/resolve-nth-duplicates";
import { computeSnapshotStats } from "./utils/snapshot-stats";
import { RUNTIME_SCRIPT } from "./generated/runtime-script";
import type {
  AnnotatedScreenshotOptions,
  Annotation,
  RefMap,
  SnapshotOptions,
  SnapshotResult,
} from "./types";

export interface OpenOptions {
  readonly headed?: boolean;
  readonly cookies?: boolean;
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  readonly executablePath?: string;
}

// Playwright API helpers — wraps promises with BrowserLaunchError
const withBrowser = <A>(
  fn: (browser: PlaywrightBrowser) => Promise<A>,
  browser: PlaywrightBrowser,
) =>
  Effect.tryPromise({
    try: () => fn(browser),
    catch: (cause) => new BrowserLaunchError({ cause }),
  });

const withContext = <A>(fn: (context: BrowserContext) => Promise<A>, context: BrowserContext) =>
  Effect.tryPromise({
    try: () => fn(context),
    catch: (cause) => new BrowserLaunchError({ cause }),
  });

const withPage = <A>(fn: (page: Page) => Promise<A>, page: Page) =>
  Effect.tryPromise({
    try: () => fn(page),
    catch: (cause) => new BrowserLaunchError({ cause }),
  });

const shouldAssignRef = (role: string, name: string, interactive?: boolean): boolean => {
  if (INTERACTIVE_ROLES.has(role)) return true;
  if (interactive) return false;
  return CONTENT_ROLES.has(role) && name.length > 0;
};

const isSiblingProfile = (profile: BrowserProfile, reference: BrowserProfile) => {
  if (profile._tag !== reference._tag) return false;
  if (profile._tag === "ChromiumBrowser" && reference._tag === "ChromiumBrowser") {
    return profile.key === reference.key && profile.profilePath !== reference.profilePath;
  }
  if (profile._tag === "FirefoxBrowser" && reference._tag === "FirefoxBrowser") {
    return profile.profilePath !== reference.profilePath;
  }
  return false;
};

const appendCursorInteractiveElements = Effect.fn("Playwright.appendCursorInteractive")(function* (
  page: Page,
  filteredLines: string[],
  refs: RefMap,
  refCount: number,
  options: SnapshotOptions,
) {
  const cursorElements = yield* findCursorInteractive(page, options.selector);
  if (cursorElements.length === 0) return refCount;

  const existingNames = new Set(Object.values(refs).map((entry) => entry.name.toLowerCase()));
  const newLines: string[] = [];

  for (const element of cursorElements) {
    if (existingNames.has(element.text.toLowerCase())) continue;
    existingNames.add(element.text.toLowerCase());

    const ref = `${REF_PREFIX}${++refCount}`;
    refs[ref] = {
      role: "clickable",
      name: element.text,
      selector: element.selector,
    };
    newLines.push(`- clickable "${element.text}" [ref=${ref}] [${element.reason}]`);
  }

  if (newLines.length > 0) {
    filteredLines.push("# Cursor-interactive elements:");
    filteredLines.push(...newLines);
  }

  return refCount;
});

const injectOverlayLabels = (page: Page, labels: Array<{ label: number; x: number; y: number }>) =>
  evaluateRuntime(page, "injectOverlayLabels", OVERLAY_CONTAINER_ID, labels);

export class Playwright extends ServiceMap.Service<Playwright>()("@browser/Playwright", {
  make: Effect.gen(function* () {
    const artifacts = yield* Artifacts;
    const cookies = yield* Cookies;
    const browsers = yield* Browsers;

    let session: { browser: PlaywrightBrowser; context: BrowserContext; page: Page } | undefined;

    const handle = yield* FiberHandle.make();

    const resolveDefaultProfile = Effect.fn("Playwright.resolveDefaultProfile")(function* () {
      return yield* browsers.defaultBrowser().pipe(
        Effect.map(Option.getOrUndefined),
        Effect.catchTag("ListBrowsersError", () => Effect.succeed(undefined)),
      );
    });

    const extractCookies = Effect.fn("Playwright.extractCookies")(function* (
      preferredProfile: BrowserProfile | undefined,
    ) {
      if (!preferredProfile) return [];

      const allProfiles = yield* browsers.list.pipe(
        Effect.catchTag("ListBrowsersError", () => Effect.succeed<BrowserProfile[]>([])),
      );

      const profilesToExtract = [
        preferredProfile,
        ...allProfiles.filter((profile) => isSiblingProfile(profile, preferredProfile)),
      ];

      const extractOne = (profile: BrowserProfile) =>
        Effect.gen(function* () {
          return yield* cookies.extract(profile);
        }).pipe(
          Effect.catchTag("ExtractionError", () => Effect.succeed<Cookie[]>([])),
          Effect.catchTag("PlatformError", Effect.die),
        );

      const results = yield* Effect.forEach(profilesToExtract, extractOne, {
        concurrency: "unbounded",
      });

      const allCookies: Cookie[] = results.flat();
      return Arr.dedupeWith(
        allCookies,
        (cookieA, cookieB) =>
          cookieA.name === cookieB.name &&
          cookieA.domain === cookieB.domain &&
          cookieA.path === cookieB.path,
      );
    });

    // The entire browser session as a single scoped effect.
    // Launched via FiberHandle — interrupting the handle triggers the finalizer
    // which collects final rrweb events and closes the browser.
    const runSession = Effect.fn("Playwright.runSession")(function* (
      url: string,
      options: OpenOptions = {},
    ) {
      yield* Effect.annotateCurrentSpan({ url });

      // Launch browser with acquireRelease — guarantees close even if setup fails partway
      const browser = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            chromium.launch({
              headless: !options.headed,
              executablePath: options.executablePath,
              args: options.headed ? [] : HEADLESS_CHROMIUM_ARGS,
            }),
          catch: (cause) => new BrowserLaunchError({ cause }),
        }),
        (browser) =>
          Effect.tryPromise(() => browser.close()).pipe(
            Effect.ignore({
              message: "Failed to close browser process",
              log: "Warn",
            }),
          ),
      );

      const preferredProfile =
        options.cookies === true ? yield* resolveDefaultProfile() : undefined;

      const profileLocale =
        preferredProfile?._tag === "ChromiumBrowser" ? preferredProfile.locale : undefined;

      const contextOptions: Parameters<typeof browser.newContext>[0] = {};
      if (profileLocale) {
        contextOptions.locale = profileLocale;
      }

      const context = yield* withBrowser((b) => b.newContext(contextOptions), browser);
      yield* withContext((c) => c.addInitScript(RUNTIME_SCRIPT), context);

      if (options.cookies) {
        const extractedCookies = yield* extractCookies(preferredProfile);
        yield* withContext(
          (c) => c.addCookies(extractedCookies.map((cookie) => cookie.playwrightFormat)),
          context,
        );
      }

      const page = yield* withContext((c) => c.newPage(), context);

      yield* Effect.tryPromise({
        try: () => page.goto(url, { waitUntil: options.waitUntil ?? "load" }),
        catch: (cause) =>
          new NavigationError({
            url,
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      // Set session — finalizer below clears it
      session = { browser, context, page };

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          session = undefined;

          if (!page.isClosed()) {
            yield* collectAllEvents(page).pipe(
              Effect.tap((events) => {
                if (!Array.isArray(events) || events.length === 0) return Effect.void;
                return artifacts.push(...events.map((event) => new RrwebEvent({ event })));
              }),
              Effect.ignore({
                message: "Failed to collect final rrweb events",
                log: "Warn",
              }),
            );
          }
        }),
      );

      // Page event stream — console logs and network requests from Playwright callbacks
      const pageEvents = Stream.callback<Artifact>((queue) =>
        Effect.sync(() => {
          page.on("console", (message) => {
            Queue.offerUnsafe(
              queue,
              new ConsoleLog({
                type: message.type(),
                text: message.text(),
                timestamp: Date.now(),
              }),
            );
          });

          page.on("request", (request) => {
            Queue.offerUnsafe(
              queue,
              new NetworkRequest({
                url: request.url(),
                method: request.method(),
                status: undefined,
                resourceType: request.resourceType(),
                timestamp: Date.now(),
              }),
            );
          });
        }),
      );

      // Start rrweb recording
      yield* evaluateRuntime(page, "startRecording").pipe(
        Effect.catchCause((cause) => Effect.logDebug("rrweb recording failed to start", { cause })),
      );

      // rrweb polling stream — drains buffered events from the page runtime
      const rrwebEvents = Stream.repeatEffect(
        Effect.gen(function* () {
          if (page.isClosed()) return [] as Artifact[];
          const events = yield* evaluateRuntime(page, "getEvents");
          if (!Array.isArray(events) || events.length === 0) return [] as Artifact[];
          return events.map((event) => new RrwebEvent({ event })) as Artifact[];
        }).pipe(Effect.catchCause(() => Effect.succeed([] as Artifact[]))),
        Schedule.spaced(EVENT_COLLECT_INTERVAL_MS),
      ).pipe(Stream.flatMap((batch) => Stream.fromIterable(batch)));

      // Merge both streams and push all artifacts until interrupted
      yield* Stream.merge(pageEvents, rrwebEvents).pipe(
        Stream.tap((artifact) => artifacts.push(artifact)),
        Stream.runDrain,
      );
    }, Effect.scoped);

    const open = Effect.fn("Playwright.open")(function* (url: string, options: OpenOptions = {}) {
      if (session) return yield* new BrowserAlreadyOpenError();
      yield* runSession(url, options).pipe(FiberHandle.run(handle));
      // FiberHandle.run forks — session is set synchronously in runSession
      // before it yields to the poll loop, so it's available immediately
    });

    const close = Effect.fn("Playwright.close")(function* () {
      if (!session) return yield* new BrowserNotOpenError();
      yield* FiberHandle.clear(handle);
    });

    const assertPageExists = Effect.fn("Playwright.assertPageExists")(function* () {
      if (!session) return yield* new BrowserNotOpenError();
      return session.page;
    });

    const navigate = Effect.fn("Playwright.navigate")(function* (
      url: string,
      options: {
        waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
      } = {},
    ) {
      const currentPage = yield* assertPageExists();
      yield* Effect.tryPromise({
        try: () => currentPage.goto(url, { waitUntil: options.waitUntil ?? "load" }),
        catch: (cause) =>
          new NavigationError({
            url,
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
      });
    });

    const snapshot = Effect.fn("Playwright.snapshot")(function* (options: SnapshotOptions = {}) {
      const currentPage = yield* assertPageExists();
      const timeout = options.timeout ?? SNAPSHOT_TIMEOUT_MS;
      const selector = options.selector ?? "body";
      yield* Effect.annotateCurrentSpan({ selector });

      const rawTree = yield* Effect.tryPromise({
        try: () => currentPage.locator(selector).ariaSnapshot({ timeout }),
        catch: (cause) =>
          new SnapshotTimeoutError({
            selector,
            timeoutMs: timeout,
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      const refs: RefMap = {};
      const filteredLines: string[] = [];
      let refCount = 0;

      for (const line of rawTree.split("\n")) {
        if (options.maxDepth !== undefined && getIndentLevel(line) > options.maxDepth) continue;

        const parsed = parseAriaLine(line);
        if (Option.isNone(parsed)) {
          if (!options.interactive) filteredLines.push(line);
          continue;
        }

        const { role, name } = parsed.value;
        if (options.interactive && !INTERACTIVE_ROLES.has(role)) continue;

        if (shouldAssignRef(role, name, options.interactive)) {
          const ref = `${REF_PREFIX}${++refCount}`;
          refs[ref] = { role, name };
          filteredLines.push(`${line} [ref=${ref}]`);
        } else {
          filteredLines.push(line);
        }
      }

      if (options.cursor) {
        refCount = yield* appendCursorInteractiveElements(
          currentPage,
          filteredLines,
          refs,
          refCount,
          options,
        );
      }

      resolveNthDuplicates(refs);

      let tree = filteredLines.join("\n");
      if (options.interactive && refCount === 0) tree = "(no interactive elements)";
      if (options.compact) tree = compactTree(tree);

      const stats = computeSnapshotStats(tree, refs);

      return {
        tree,
        refs,
        stats,
        locator: createLocator(currentPage, refs),
      } satisfies SnapshotResult;
    });

    const act = Effect.fn("Playwright.act")(function* (
      ref: string,
      action: (locator: Locator) => Promise<void>,
      options?: SnapshotOptions,
    ) {
      yield* assertPageExists();
      yield* Effect.annotateCurrentSpan({ ref });
      const before = yield* snapshot(options);
      const locator = yield* before.locator(ref);
      yield* Effect.tryPromise({
        try: () => action(locator),
        catch: (error) => toActionError(error, ref),
      });
      return yield* snapshot(options);
    });

    const annotatedScreenshot = Effect.fn("Playwright.annotatedScreenshot")(function* (
      options: AnnotatedScreenshotOptions = {},
    ) {
      const currentPage = yield* assertPageExists();
      const snapshotResult = yield* snapshot(options);
      const annotations: Annotation[] = [];
      const labelPositions: Array<{ label: number; x: number; y: number }> = [];

      let labelCounter = 0;

      for (const [ref, entry] of Object.entries(snapshotResult.refs)) {
        const locator = yield* snapshotResult.locator(ref);
        const box = yield* Effect.tryPromise(() => locator.boundingBox()).pipe(
          Effect.catchTag("UnknownError", () => Effect.succeed(undefined)),
        );
        if (!box) continue;

        labelCounter++;
        annotations.push({
          label: labelCounter,
          ref,
          role: entry.role,
          name: entry.name,
        });
        labelPositions.push({ label: labelCounter, x: box.x, y: box.y });
      }

      yield* injectOverlayLabels(currentPage, labelPositions);
      return yield* Effect.ensuring(
        withPage((p) => p.screenshot({ fullPage: options.fullPage }), currentPage).pipe(
          Effect.map((screenshotBuffer) => ({
            screenshot: screenshotBuffer,
            annotations,
          })),
        ),
        // HACK: overlay removal is best-effort — evaluateRuntime uses Effect.promise which defects on failure
        evaluateRuntime(currentPage, "removeOverlay", OVERLAY_CONTAINER_ID).pipe(
          Effect.catchCause(() => Effect.void),
        ),
      );
    });

    const waitForNavigationSettle = Effect.fn("Playwright.waitForNavigationSettle")(function* (
      urlBefore: string,
    ) {
      const currentPage = yield* assertPageExists();
      yield* withPage(
        (p) =>
          p.waitForURL((url) => url.toString() !== urlBefore, {
            timeout: NAVIGATION_DETECT_DELAY_MS,
            waitUntil: "commit",
          }),
        currentPage,
      ).pipe(Effect.catchTag("BrowserLaunchError", () => Effect.void));
      if (currentPage.url() !== urlBefore) {
        yield* Effect.tryPromise(() => currentPage.waitForLoadState("domcontentloaded")).pipe(
          Effect.catchTag("UnknownError", () => Effect.void),
        );
        yield* withPage((p) => p.waitForTimeout(POST_NAVIGATION_SETTLE_MS), currentPage);
      }
    });

    return {
      open,
      close,
      navigate,
      snapshot,
      act,
      annotatedScreenshot,
      waitForNavigationSettle,
      assertPageExists,
      hasSession: () => Boolean(session),
    } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(
    Layer.provide(Artifacts.layer),
    Layer.provide(Cookies.layer),
    Layer.provide(layerLive),
  );
}
