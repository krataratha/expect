import { Effect, Layer, PubSub, ServiceMap, Stream } from "effect";
import type { LiveUpdatePayload } from "@expect/shared/rpcs";
import { Updates } from "./updates";

export class LiveViewer extends ServiceMap.Service<LiveViewer>()("@supervisor/LiveViewer", {
  make: Effect.gen(function* () {
    yield* Updates;
    const pubsub = yield* PubSub.unbounded<LiveUpdatePayload>({
      replay: Infinity,
    });

    const push = Effect.fn("LiveViewer.push")(function* (payload: LiveUpdatePayload) {
      yield* PubSub.publish(pubsub, payload);
    });

    const stream = Stream.fromPubSub(pubsub);

    return { push, stream } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(Updates.layer));
}
