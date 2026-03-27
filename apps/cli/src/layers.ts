import { Layer, References } from "effect";
import { DevTools } from "effect/unstable/devtools";
import { Executor, FlowStorage, Git, LiveViewer, Reporter, Updates } from "@expect/supervisor";
import { Agent, AgentBackend } from "@expect/agent";
import { Analytics, DebugFileLoggerLayer, Tracing } from "@expect/shared/observability";
import { layerLiveViewerRpcServer, layerLiveViewerStaticServer } from "./live-viewer-server";

export const layerCli = ({ verbose, agent }: { verbose: boolean; agent: AgentBackend }) => {
  const gitLayer = Git.withRepoRoot(process.cwd());

  return Layer.mergeAll(
    Executor.layer.pipe(Layer.provide(gitLayer)),
    Reporter.layer,
    Updates.layer,
    FlowStorage.layer,
    DevTools.layer(),
    gitLayer,
    Analytics.layerPostHog,
    layerLiveViewerRpcServer,
    layerLiveViewerStaticServer,
  ).pipe(
    Layer.provide(Agent.layerFor(agent ?? "claude")),
    Layer.provide(DebugFileLoggerLayer),
    Layer.provide(Tracing.layerAxiom),
    Layer.provideMerge(Layer.succeed(References.MinimumLogLevel, verbose ? "All" : "Error")),
  );
};
