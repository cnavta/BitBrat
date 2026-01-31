# Retro – sprint-240-a1b2c3

## What Worked
- **Vercel AI SDK Integration**: Extracting `toolCalls` and `toolResults` from the `generateText` result provided a clean way to log all multi-step tool interactions without deep-hooking into every tool's `execute` function.
- **Fire-and-forget Logging**: Existing pattern for logging to Firestore was easy to extend.

## What Didn't Work / Challenges
- **Tool Latency in Logs**: Capturing individual tool latency in the `prompt_logs` document is slightly complex because `generateText` handles the loop. We'd need to manually time the wrappers and attach the timings to the event object.
- **Top-level vs Step Tool Calls**: Realized that the AI SDK returns `toolCalls`/`toolResults` at the top level for single steps or when execution doesn't complete, but they must be aggregated from `steps` for multi-step runs. The code now handles both.
- **AI SDK Property Mapping**: Discovered that the AI SDK types (e.g. `StaticToolCall`) often use `input` instead of `args`, and `output` instead of `result`. Failing to check both caused blank logs in Firestore.
- **Tool Error Capture**: Realized that errors can live on either the `toolCall` (if invalid) or `toolResult` (if failed execution). Checking both ensures robust error logging.

## Lessons Learned
- Always check the AI SDK's return object for rich metadata like tool interactions; it's often more comprehensive than manual tracking.
