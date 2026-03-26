import * as os from "node:os";
import { assert, describe, it } from "vite-plus/test";
import { Effect, Option } from "effect";
import { Browsers } from "../src/browser-detector";
import { layerLive } from "../src/layers";

const MIN_DETECTED_BROWSERS = os.platform() === "darwin" ? 2 : 1;

describe("Browsers", () => {
  it("returns detected browsers", () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const results = yield* browsers.list;
      assert.isArray(results);
      assert.isAtLeast(results.length, MIN_DETECTED_BROWSERS);
    }).pipe(Effect.provide(layerLive), Effect.runPromise));

  it("chromium browsers have an executablePath", () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const results = yield* browsers.list;
      const chromium = results.filter((browser) => browser._tag === "ChromiumBrowser");
      if (chromium.length === 0) return;
      for (const browser of chromium) {
        assert.isString(browser.executablePath);
        assert.notStrictEqual(browser.executablePath, "");
      }
    }).pipe(Effect.provide(layerLive), Effect.runPromise));

  it("defaultBrowser returns a known browser", () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const detected = yield* browsers.list;
      const result = yield* browsers.defaultBrowser();
      if (Option.isNone(result)) return;
      const tag = result.value._tag;
      assert.isTrue(
        tag === "ChromiumBrowser" || tag === "FirefoxBrowser" || tag === "SafariBrowser",
      );
      const isDetected = detected.some((browser) => {
        if (browser._tag !== result.value._tag) return false;
        if (browser._tag === "ChromiumBrowser") {
          return (
            browser.key === result.value.key && browser.profilePath === result.value.profilePath
          );
        }
        if (browser._tag === "FirefoxBrowser") {
          return browser.profilePath === result.value.profilePath;
        }
        return true;
      });
      assert.isTrue(isDetected);
    }).pipe(Effect.provide(layerLive), Effect.runPromise));
});
