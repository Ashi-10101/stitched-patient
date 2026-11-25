// Shared helpers for the Kiro hook scripts in this directory (engine-mcp design "Hooks", D21, D22).
//
// Child processes start with `spawn`, an argument array and `shell: false`, so a file name read
// from the hook's stdin never reaches a shell.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the repository root (two levels above this file). */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** Name of the physiology image that the docker-based hooks need. */
export const PHYSIOLOGY_IMAGE = 'stitched-patient-physiology';

export const MISSING_IMAGE_MESSAGE =
  'The physiology image is missing. Build it in your own terminal (docker compose build physiology); this hook does not build images.';

export const NO_FILE_PATH_MESSAGE = 'Hook input has no file_path; nothing was checked.';

/** `<program> was not found on PATH; the hook could not run its checks.` */
export function notOnPathMessage(program) {
  return `${program} was not found on PATH; the hook could not run its checks.`;
}

function realpathOrNull(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Writes `text` to `stream`, waits until it is flushed and exits with `code`.
 * The returned promise never resolves, so `await exitWith(...)` stops the caller.
 */
export function exitWith(code, stream, text) {
  return new Promise(() => {
    const done = () => process.exit(code);
    if (text) {
      stream.write(text.endsWith('\n') ? text : `${text}\n`, done);
    } else {
      done();
    }
  });
}

/** Reads all of stdin as text. A TTY stdin (manual run without input) counts as empty. */
export function readStdinText() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

/** Returns the parsed stdin JSON object, or `{ raw }` with the stdin text when it is not a JSON object. */
export async function readStdinJson() {
  const raw = await readStdinText();
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  return { raw };
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function insideRelative(root, absolute) {
  const rel = path.relative(root, absolute);
  if (rel === '' || path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) return null;
  return toPosix(rel);
}

/**
 * Turns the `file_path` of a hook input into a repository-relative POSIX path.
 *
 * - An absolute path inside the repository gives its path relative to `REPO_ROOT`. The check also
 *   compares the real paths of the root and of the file, so a symlinked checkout or workspace
 *   path still matches.
 * - A relative path is taken as relative to the repository root and normalized.
 * - The repository root itself, an absolute path outside it, a relative path that leaves it
 *   through `..`, and a missing or non-string `file_path` give `null`.
 */
export function savedRepoPath(input) {
  const filePath = input?.file_path;
  if (typeof filePath !== 'string' || filePath === '') return null;

  if (!path.isAbsolute(filePath)) {
    const normalized = path.normalize(filePath);
    if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${path.sep}`) || path.isAbsolute(normalized)) {
      return null;
    }
    return toPosix(normalized).replace(/\/+$/, '') || null;
  }

  const roots = [REPO_ROOT];
  const realRoot = realpathOrNull(REPO_ROOT);
  if (realRoot && realRoot !== REPO_ROOT) roots.push(realRoot);

  const candidates = [path.resolve(filePath)];
  const realFile = realpathOrNull(filePath);
  if (realFile && realFile !== candidates[0]) candidates.push(realFile);

  for (const candidate of candidates) {
    for (const root of roots) {
      const rel = insideRelative(root, candidate);
      if (rel !== null) return rel;
    }
  }
  return null;
}

/** Shell-like display text of a command, for messages only (never executed). */
export function commandLine(cmd, args) {
  return [cmd, ...args].map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a))).join(' ');
}

/**
 * Runs `cmd` with `args` in `cwd` without a shell and collects its output.
 * Resolves `{ code, stdout, stderr }`; `code` is `null` when the process ended by a signal.
 * When the program is not on PATH (ENOENT), writes the Error Handling message and exits 1.
 */
export function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    let settled = false;
    const stdout = [];
    const stderr = [];
    const child = spawn(cmd, args, { cwd, shell: false, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (error.code === 'ENOENT') {
        exitWith(1, process.stderr, notOnPathMessage(cmd));
        return;
      }
      resolve({ code: null, stdout: Buffer.concat(stdout).toString('utf8'), stderr: `${Buffer.concat(stderr).toString('utf8')}${error.message}\n` });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

/** Writes the failing output to stderr and exits 1 (Requirement 15.9). */
export function failWith(output) {
  return exitWith(1, process.stderr, output);
}

/** Exits 1 with the missing-image message unless the physiology image exists. Never builds it. */
export async function requireImage() {
  const result = await run('docker', ['image', 'inspect', PHYSIOLOGY_IMAGE], REPO_ROOT);
  if (result.code !== 0) await exitWith(1, process.stderr, MISSING_IMAGE_MESSAGE);
}

/** Formats one failed step for `failWith`. */
export function failureReport(cmd, args, result) {
  const status = result.code === null ? 'no exit code' : `exit ${result.code}`;
  return [`FAILED (${status}): ${commandLine(cmd, args)}`, result.stdout.trimEnd(), result.stderr.trimEnd()]
    .filter((part) => part !== '')
    .join('\n');
}

/**
 * Common start of the file hooks: reads stdin, exits 1 when there is no `file_path`, and returns
 * the repository-relative saved path, or exits 0 without output when it is outside the repository
 * or does not match `pattern`.
 */
export async function savedPathMatching(pattern) {
  const input = await readStdinJson();
  if (typeof input.file_path !== 'string' || input.file_path === '') {
    await exitWith(1, process.stderr, NO_FILE_PATH_MESSAGE);
  }
  const repoPath = savedRepoPath(input);
  if (repoPath === null || !pattern.test(repoPath)) await exitWith(0, process.stdout, '');
  return repoPath;
}

/** Runs the steps in order, every step even after a failure; fails with all failing outputs. */
export async function runSteps(steps) {
  const failures = [];
  const passed = [];
  for (const { cmd, args, cwd } of steps) {
    const result = await run(cmd, args, cwd);
    if (result.code === 0) passed.push(`ok: ${commandLine(cmd, args)}`);
    else failures.push(failureReport(cmd, args, result));
  }
  if (failures.length > 0) await failWith(failures.join('\n\n'));
  await exitWith(0, process.stdout, passed.join('\n'));
}
