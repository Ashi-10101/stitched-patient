// Compose_Guard_Hook (Requirements 15.5 to 15.7, 18.5, design "Hooks", D13).
//
// PreToolUse hook for the agent's built-in shell tool. It only scans the command text of the
// tool call; it never executes, evaluates or passes that text anywhere. A Blocked_Compose_Command
// gives exit 2 with a message on stderr; anything else gives exit 0 with no output.
//
// The module exports `findBlockedCompose` for the tests and runs `main` only when executed
// directly (`node scripts/hooks/compose-guard.mjs`).

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitWith, readStdinText } from './hookLib.mjs';

/** Subcommands that start, stop or restart the containers. */
const BLOCKED_SUBCOMMANDS = new Set(['up', 'down', 'stop', 'restart']);

/** Compose global options that take a value. */
const VALUE_OPTIONS = [
  '-f', '--file',
  '-p', '--project-name',
  '--project-directory',
  '--env-file',
  '--profile',
  '--ansi',
  '--progress',
  '--parallel',
];

/** Compose global flags without a value. */
const FLAG_OPTIONS = new Set(['--dry-run', '--compatibility', '--all-resources', '--verbose']);

const VALUE_OPTION_SET = new Set(VALUE_OPTIONS);

/**
 * Quotes, command separators and grouping characters become spaces, so quoted text and chained
 * commands are scanned too. A backslash also becomes a space, so a line continuation between
 * the words of a compose call does not hide it.
 */
const SEPARATORS = /\$\(|["'`;&|(){}\\\r\n]/g;

/**
 * Number of tokens the compose global option at `token` takes (1 or 2), or 0 when `token` is not
 * a compose global option.
 */
function globalOptionWidth(token) {
  if (VALUE_OPTION_SET.has(token)) return 2;
  if (FLAG_OPTIONS.has(token)) return 1;
  if (VALUE_OPTIONS.some((option) => token.startsWith(`${option}=`))) return 1;
  return 0;
}

/**
 * Returns the first Blocked_Compose_Command in `text` as written (`docker compose ... <sub>`,
 * tokens joined by single spaces), or `null` when there is none.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function findBlockedCompose(text) {
  const tokens = String(text).replace(SEPARATORS, ' ').split(/\s+/).filter((token) => token !== '');
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    if (tokens[i] !== 'docker' || tokens[i + 1] !== 'compose') continue;
    let j = i + 2;
    while (j < tokens.length) {
      const width = globalOptionWidth(tokens[j]);
      if (width === 0) break;
      j += width;
    }
    if (j < tokens.length && BLOCKED_SUBCOMMANDS.has(tokens[j])) {
      return tokens.slice(i, j + 1).join(' ');
    }
  }
  return null;
}

/** The stderr message for a blocked command (Requirement 15.5). */
export function blockedMessage(hit) {
  return `Blocked: \`${hit}\`. The agent does not start, stop or restart the containers in this project. Please run this command in your own terminal.`;
}

/**
 * The command text of the tool call: `tool_input.command` of the stdin JSON, or the raw stdin
 * text when it does not parse or has no such string field (fails closed for blocked commands).
 */
export function commandText(raw) {
  try {
    const parsed = JSON.parse(raw);
    const command = parsed?.tool_input?.command;
    if (typeof command === 'string') return command;
  } catch {
    // fall through to the raw text
  }
  return raw;
}

async function main() {
  const raw = await readStdinText();
  const hit = findBlockedCompose(commandText(raw));
  if (hit !== null) await exitWith(2, process.stderr, blockedMessage(hit));
  await exitWith(0, process.stdout, '');
}

function realpathOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  realpathOrSelf(path.resolve(process.argv[1])) === realpathOrSelf(fileURLToPath(import.meta.url));

if (invokedDirectly) main();
