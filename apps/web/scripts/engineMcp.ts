/**
 * Engine_MCP_Server: the stdio MCP server of the engine tools (engine-mcp design,
 * "`scripts/engineMcp.ts`", "Error Handling: Engine_MCP_Server", D15, D25, Requirements 1.1 to 1.3,
 * 1.8, 1.9, 6.2, 6.3, 8.13).
 *
 * Start (from `apps/web/`): `./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineMcp.ts`.
 *
 * - The first import points console.log, info and debug at stderr, so only the SDK's
 *   StdioServerTransport writes to stdout (D25, 1.3).
 * - The low-level SDK `Server` publishes TOOL_DEFINITIONS and calls the SDK-free handlers of
 *   `engineTools.ts`, which validate their own arguments and return the tool result (D15).
 * - Startup sends no request to the Physiology_Service: no Health_Check runs until a tool is called
 *   (1.5). `tools/list` sends no request either.
 * - This is the only module outside test files that imports `@modelcontextprotocol/sdk` (18.3). It
 *   starts no process; the only processes are the read-only `git` commands of `engineNode.ts` (1.8).
 */

import './engineStdout';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_DEFINITIONS,
  createEngineTools,
  type EngineTools,
  type ToolCallContext,
  type ToolDefinition,
  type ToolName,
} from '@/lib/engineTools';
import { createNodeDeps, installShutdown, loadConfig, type NodeConfig } from './engineNode';

const SERVER_NAME = 'stitched-patient-engine';
const SERVER_VERSION = '0.1.0';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 1.9: an invalid PHYSIOLOGY_URL or ENGINE_MCP_MAX_SESSIONS exits 1 before connecting, naming the value. */
function configOrExit(): NodeConfig {
  try {
    return loadConfig(process.env);
  } catch (err) {
    process.stderr.write(`${messageOf(err)}\n`);
    process.exit(1);
  }
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

function sdkTool(def: ToolDefinition): Tool {
  const tool: Tool = {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema as Tool['inputSchema'],
  };
  if (def.outputSchema !== undefined) tool.outputSchema = def.outputSchema as Tool['outputSchema'];
  return tool;
}

const TOOL_NAMES: ReadonlySet<string> = new Set(TOOL_DEFINITIONS.map((t) => t.name));

function isToolName(name: string): name is ToolName {
  return TOOL_NAMES.has(name);
}

const config = configOrExit();
const deps = createNodeDeps(config);
const tools: EngineTools = createEngineTools(deps);
const processController = new AbortController();
const calls = new Set<Promise<unknown>>();

async function runTool(name: ToolName, args: unknown, ctx: ToolCallContext): Promise<CallToolResult> {
  try {
    const { result } = await tools[name](args, ctx);
    return { ...result };
  } catch (err) {
    // The handlers return every EngineError as a result; anything else lands here. The runner's
    // `finally` blocks have already deleted the call's Sessions.
    return errorResult(`Internal error: ${messageOf(err)}`);
  }
}

const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
server.onerror = (err) => deps.log(`MCP protocol error: ${messageOf(err)}`);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS.map(sdkTool) }));

server.setRequestHandler(CallToolRequestSchema, async (req, extra): Promise<CallToolResult> => {
  const name = req.params.name;
  if (!isToolName(name)) return errorResult(`Unknown tool: ${name}`);
  const token = req.params._meta?.progressToken;
  const ctx: ToolCallContext = {
    // A cancelled request (6.2) or a process shutdown (6.3) aborts the call. The SDK sends no
    // response for a request whose signal aborted.
    signal: AbortSignal.any([extra.signal, processController.signal]),
    reportProgress:
      token === undefined
        ? undefined
        : (p) => {
            extra
              .sendNotification({ method: 'notifications/progress', params: { progressToken: token, ...p } })
              .catch((err: unknown) => deps.log(`Could not send a progress notification: ${messageOf(err)}`));
          },
  };
  const run = runTool(name, req.params.arguments ?? {}, ctx);
  calls.add(run);
  try {
    return await run;
  } finally {
    calls.delete(run);
  }
});

installShutdown({ controller: processController, deps, watchStdin: true, calls });
await server.connect(new StdioServerTransport());
deps.log(`${SERVER_NAME} ${SERVER_VERSION} ready on stdio (Service_URL ${config.serviceUrl}, Session_Cap ${config.sessionCap})`);
