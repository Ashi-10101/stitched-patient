/**
 * Clean stdout for the engine entry points (engine-mcp design D25, Requirement 1.3).
 *
 * Points `console.log`, `console.info` and `console.debug` at stderr, so that in the
 * Engine_MCP_Server only the SDK's `StdioServerTransport` writes to stdout, and in the Engine_CLI
 * stdout carries only the result. Because ES module imports are hoisted, this redirect lives in
 * its own tiny module, which `engineMcp.ts` and `engineCli.ts` import first.
 */

for (const key of ['log', 'info', 'debug'] as const) {
  console[key] = console.error;
}

export {};
