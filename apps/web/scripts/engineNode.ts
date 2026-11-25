/**
 * Node adapters for the engine entry points (engine-mcp design, "`scripts/engineNode.ts`", D17,
 * D18, D24, Requirements 1.4, 1.8, 1.9, 6.3, 7.2).
 *
 * Only `engineMcp.ts` and `engineCli.ts` import this module. It builds the `EngineDeps` of the
 * SDK-free tool handlers from Node: the global `fetch`, `new WebSocket(url)` (Node 22 global),
 * `node:fs/promises`, the real clock, stderr logging, and the Git facts of the Record_Header.
 *
 * Processes: the only processes started anywhere are the three read-only `git` commands of D24,
 * run with `execFile` (no shell) in the repository root with a 5 s timeout (1.8, conflict C1).
 * Nothing here starts, stops or restarts the Physiology_Service, a container or any other process.
 * Creating the deps sends no request; requests start only when a tool handler runs.
 */

import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { GitInfo, RecordFs } from '@/lib/calibrationRecord';
import {
  CLEANUP_REQUEST_TIMEOUT_MS,
  EngineError,
  KEBAB,
  SHUTDOWN_BUDGET_MS,
  createPhysiologyClient,
  parseServiceUrl,
  parseSessionCap,
  type EngineClock,
  type FetchLike,
  type SocketFactory,
  type VitalsSocket,
} from '@/lib/engineClient';
import { DECOMPRESSION_CHECK_COMMIT } from '@/lib/engineCalibration';
import { createSessionRegistry, createSessionSlots } from '@/lib/engineSlots';
import type { EngineDeps } from '@/lib/engineTools';

// ---------------------------------------------------------------------------
// Constants (tool constants, not clinical values)
// ---------------------------------------------------------------------------

/** D24: each read-only `git` command gets at most 5 s. */
const GIT_TIMEOUT_MS = 5_000;
/** 6.2: a cancelled call stops and deletes its own Sessions within 5 s; shutdown waits that long for it. */
const CALL_CLEANUP_WAIT_MS = 5_000;

// ---------------------------------------------------------------------------
// Configuration (1.9, 7.2, D9)
// ---------------------------------------------------------------------------

export interface NodeConfig {
  serviceUrl: string;
  sessionCap: number;
}

/** Rethrows a config error with the name of the variable or flag the value came from. */
function fromSource<T>(source: string, parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    if (err instanceof EngineError) throw new EngineError('config', `${source}: ${err.message}`);
    throw err;
  }
}

/** Reads PHYSIOLOGY_URL and ENGINE_MCP_MAX_SESSIONS, overridden by CLI values; exits via EngineError('config') (1.9). */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  overrides: { url?: string; maxSessions?: string } = {},
): NodeConfig {
  const urlSource = overrides.url !== undefined ? '--url' : 'PHYSIOLOGY_URL';
  const rawUrl = overrides.url ?? env.PHYSIOLOGY_URL;
  const capSource = overrides.maxSessions !== undefined ? '--max-sessions' : 'ENGINE_MCP_MAX_SESSIONS';
  const rawCap = overrides.maxSessions ?? env.ENGINE_MCP_MAX_SESSIONS;
  return {
    serviceUrl: fromSource(urlSource, () => parseServiceUrl(rawUrl)),
    sessionCap: fromSource(capSource, () => parseSessionCap(rawCap)),
  };
}

// ---------------------------------------------------------------------------
// Repository root (D18)
// ---------------------------------------------------------------------------

/** The repository root, from this file's own location (`apps/web/scripts/`), not the working directory. No trailing slash. */
export const REPO_ROOT: string = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

// ---------------------------------------------------------------------------
// Git facts (D24)
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

/** Runs one read-only `git` command with no shell. `GIT_OPTIONAL_LOCKS=0` keeps `git status` from refreshing the index. */
async function git(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd: REPO_ROOT,
    timeout: GIT_TIMEOUT_MS,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return stdout;
}

function exitCodeOf(err: unknown): unknown {
  return typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
}

/** Porcelain v1 lines "XY path" or "XY from -> to", paths relative to the repository root (cwd). */
function dirtyFlags(porcelain: string): { casesDirty: boolean; libDirty: boolean } {
  let casesDirty = false;
  let libDirty = false;
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) continue;
    for (const part of line.slice(3).split(' -> ')) {
      const p = part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part;
      if (p === 'cases' || p.startsWith('cases/')) casesDirty = true;
      if (p.startsWith('apps/web/src/lib/')) libDirty = true;
    }
  }
  return { casesDirty, libDirty };
}

async function readGitInfo(log: (line: string) => void): Promise<GitInfo> {
  const [sha, status, ancestor] = await Promise.all([
    git(['rev-parse', '--short', 'HEAD']).then(
      (out): string => {
        const value = out.trim();
        return /^[0-9a-f]{4,40}$/.test(value) ? value : 'unknown';
      },
      (err: unknown): string => {
        log(`git rev-parse failed; the commit is reported as unknown: ${messageOf(err)}`);
        return 'unknown';
      },
    ),
    git(['status', '--porcelain', '--', 'cases', 'apps/web/src/lib']).then(
      (out) => dirtyFlags(out),
      (err: unknown) => {
        log(`git status failed; the changed files are reported as unknown: ${messageOf(err)}`);
        return { casesDirty: 'unknown' as const, libDirty: 'unknown' as const };
      },
    ),
    git(['merge-base', '--is-ancestor', DECOMPRESSION_CHECK_COMMIT, 'HEAD']).then(
      (): boolean => true,
      (err: unknown): boolean | 'unknown' => {
        // Exit code 1 means "not an ancestor"; any other failure is "unknown" (D24).
        if (exitCodeOf(err) === 1) return false;
        log(`git merge-base failed; the ancestry is reported as unknown: ${messageOf(err)}`);
        return 'unknown';
      },
    ),
  ]);
  return { shortSha: sha, casesDirty: status.casesDirty, libDirty: status.libDirty, has1e71454: ancestor };
}

// ---------------------------------------------------------------------------
// EngineDeps for Node
// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Host local date as YYYY-MM-DD (Record_Header and the record file name). */
function localDate(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const nodeFetch: FetchLike = (url, init) => fetch(url, init);

/** Node 22's global WebSocket. Its MessageEvent and CloseEvent carry the `data`, `code` and `reason` the runner reads. */
const nodeSocket: SocketFactory = (url) => new WebSocket(url) as unknown as VitalsSocket;

const realClock: EngineClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const nodeRecordFs: RecordFs = {
  mkdir: (p, opts) => mkdir(p, opts),
  readFile: (p, enc) => readFile(p, enc),
  writeFile: (p, data, opts) => writeFile(p, data, opts),
  appendFile: (p, data) => appendFile(p, data),
};

function stderrLog(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Global fetch, new WebSocket(url), fs/promises, git (D24). Sends no request and starts no process when called. */
export function createNodeDeps(config: NodeConfig): EngineDeps {
  const { serviceUrl, sessionCap } = config;
  return {
    serviceUrl,
    client: createPhysiologyClient({ serviceUrl, fetch: nodeFetch }),
    openSocket: nodeSocket,
    slots: createSessionSlots(sessionCap),
    registry: createSessionRegistry(),
    clock: realClock,
    log: stderrLog,
    sessionCap,
    repoRoot: REPO_ROOT,
    async readCaseFile(caseId) {
      // The schema has already checked the id; checked again so no other path can be read.
      if (!KEBAB.test(caseId)) throw new EngineError('input', `Invalid input: case_id: must be a kebab-case string`);
      return readFile(`${REPO_ROOT}/cases/${caseId}.yaml`, 'utf8');
    },
    gitInfo: () => readGitInfo(stderrLog),
    today: localDate,
    recordFs: nodeRecordFs,
  };
}

// ---------------------------------------------------------------------------
// Shutdown (6.3)
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 6.3: on SIGINT or SIGTERM (and, with `watchStdin`, when stdin ends or closes, or stdout fails):
 * aborts `controller`, waits up to 5 s for the running calls in `calls` to delete their own
 * Sessions (6.2), then DELETEs every id still in the registry in parallel, and exits. The whole
 * shutdown takes at most SHUTDOWN_BUDGET_MS. Exit code 0 after stdin closes, 1 otherwise.
 * Only ids in the registry (Sessions this process created) are deleted (6.5).
 */
export function installShutdown(opts: {
  controller: AbortController;
  deps: EngineDeps;
  watchStdin: boolean;
  /** The tool calls still running; shutdown lets them finish their own cleanup first. */
  calls?: ReadonlySet<Promise<unknown>>;
}): void {
  const { controller, deps, watchStdin, calls } = opts;
  let started = false;

  async function deleteRemaining(): Promise<void> {
    if (calls !== undefined && calls.size > 0) {
      await Promise.race([Promise.allSettled([...calls]), delay(CALL_CLEANUP_WAIT_MS)]);
    }
    const ids = deps.registry.ids();
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        await deps.client.deleteSession(id, new AbortController().signal, CLEANUP_REQUEST_TIMEOUT_MS);
        deps.registry.remove(id);
      }),
    );
    const failed = ids.filter((_, i) => results[i].status === 'rejected');
    if (failed.length > 0) deps.log(`Sessions not deleted: ${failed.join(', ')}`);
  }

  function shutdown(reason: string, code: 0 | 1): void {
    if (started) return;
    started = true;
    deps.log(`${reason}; deleting ${deps.registry.ids().length} Session(s)`);
    const deadline = setTimeout(() => {
      const left = deps.registry.ids();
      deps.log(
        `Shutdown took longer than ${SHUTDOWN_BUDGET_MS / 1000} s` +
          (left.length > 0 ? `; Sessions not deleted: ${left.join(', ')}` : ''),
      );
      process.exit(code);
    }, SHUTDOWN_BUDGET_MS);
    controller.abort();
    deleteRemaining().then(
      () => {
        clearTimeout(deadline);
        process.exit(code);
      },
      (err: unknown) => {
        clearTimeout(deadline);
        deps.log(`Shutdown cleanup failed: ${messageOf(err)}`);
        process.exit(code);
      },
    );
  }

  process.on('SIGINT', () => shutdown('Interrupted', 1));
  process.on('SIGTERM', () => shutdown('Interrupted', 1));
  if (watchStdin) {
    process.stdin.on('end', () => shutdown('stdin closed', 0));
    process.stdin.on('close', () => shutdown('stdin closed', 0));
    process.stdout.on('error', (err) => shutdown(`stdout failed (${messageOf(err)})`, 1));
  }
}
