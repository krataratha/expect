import { Layer, Logger } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { layerMcpServer } from "../mcp-server";

const StderrLoggerLayer = Layer.succeed(Logger.LogToStderr, true);

Layer.launch(
  layerMcpServer.pipe(Layer.provide(StderrLoggerLayer), Layer.provide(NodeServices.layer)),
).pipe(NodeRuntime.runMain);
