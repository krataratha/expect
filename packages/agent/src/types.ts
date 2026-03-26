import { Schema } from "effect";

export class AgentStreamOptions extends Schema.Class<AgentStreamOptions>("AgentStreamOptions")({
  cwd: Schema.String,
  sessionId: Schema.Option(Schema.String),
  prompt: Schema.String,
  systemPrompt: Schema.Option(Schema.String),
  mcpEnv: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
  ),
}) {}
