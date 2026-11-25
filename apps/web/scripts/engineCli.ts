/**
 * Engine_CLI: the same engine tools from a terminal (engine-mcp design, "`scripts/engineCli.ts`",
 * "Error Handling: Engine_CLI", Requirement 11, 1.8, 1.9, 6.3).
 *
 * From `apps/web/`:
 *   ./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- \
 *     [--url URL] [--max-sessions N] <list-cases | run-scenario ... | calibrate ...>
 *
 * 1. `parseCliArgs`; a parse error, a config error or a schema error (`input`) prints CLI_USAGE and
 *    the message to stderr and exits 2, before any request (11.5). The handler validates its
 *    arguments before the Health_Check (D27), so an invalid input never reaches the network.
 * 2. Builds the Node deps, installs the SIGINT and SIGTERM shutdown, and calls the same handler as
 *    the MCP tool (11.1).
 * 3. On success prints the tool's text content to stdout: the Calibration_Record for `calibrate`
 *    (11.2), the JSON for the others (11.3).
 * 4. Exits with `cliExitCode` (11.4): 0, 3 for "NOT calibrated", 2 for invalid arguments, 1 for every
 *    other error. A signal ends the run through `installShutdown` with exit code 1.
 */

import './engineStdout';
import { CLI_USAGE, cliExitCode, createEngineTools, parseCliArgs, type HandlerOutcome } from '@/lib/engineTools';
import { createNodeDeps, installShutdown, loadConfig, type NodeConfig } from './engineNode';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Writes `text` and exits once it is flushed, so a piped stdout gets the whole result. */
function finish(stream: NodeJS.WriteStream, text: string, code: 0 | 1 | 2 | 3): void {
  const out = text.endsWith('\n') ? text : `${text}\n`;
  stream.write(out, () => process.exit(code));
}

function usageExit(message: string): void {
  finish(process.stderr, `${CLI_USAGE}\n\n${message}`, 2);
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    usageExit(parsed.message);
    return;
  }

  let config: NodeConfig;
  try {
    config = loadConfig(process.env, { url: parsed.url, maxSessions: parsed.maxSessions });
  } catch (err) {
    usageExit(messageOf(err));
    return;
  }

  const deps = createNodeDeps(config);
  const controller = new AbortController();
  const calls = new Set<Promise<unknown>>();
  installShutdown({ controller, deps, watchStdin: false, calls });

  const tools = createEngineTools(deps);
  const run: Promise<HandlerOutcome> = tools[parsed.tool](parsed.args, { signal: controller.signal });
  calls.add(run);
  const outcome = await run;
  calls.delete(run);
  // After SIGINT or SIGTERM, installShutdown deletes the Sessions and exits 1.
  if (controller.signal.aborted) return;

  const code = cliExitCode(parsed.tool, outcome);
  const text = outcome.result.content.map((c) => c.text).join('\n');
  if (!outcome.result.isError) {
    finish(process.stdout, text, code);
  } else if (code === 2) {
    usageExit(text);
  } else {
    finish(process.stderr, text, code);
  }
}

main().catch((err: unknown) => {
  finish(process.stderr, `Internal error: ${messageOf(err)}`, 1);
});
