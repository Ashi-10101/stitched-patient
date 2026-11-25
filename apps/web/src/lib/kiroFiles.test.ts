/**
 * Example tests of the Kiro files of the engine-mcp spec (design "Kiro files", Test files row
 * `kiroFiles.test.ts`; Requirements 15.1, 15.5 to 15.8, 16.1 to 16.3, 16.5, 16.7, 17.6, 17.7).
 *
 * - Parses `.kiro/settings/mcp.json` and every `.kiro/hooks/*.json`.
 * - Scans the hook scripts, the hook commands, the MCP_Config and `apps/web/scripts/*.ts` for
 *   `--build`, `--service-ports` and Blocked_Compose_Commands (the guard itself is excluded from
 *   the Blocked_Compose_Command scan, because it names them on purpose). The steering files are
 *   not scripts and are not scanned: they name the blocked commands as things not to run.
 * - Checks the steering front matter.
 * - Spawns the Compose_Guard_Hook with sample stdin JSON. The guard only scans that text; it
 *   never executes it.
 * - Spawns the file hooks only with paths that match none of them, so they exit before
 *   `requireImage()` or any child process. No docker command runs in this file.
 *
 * - Property 6 calls `findBlockedCompose` in-process on generated command text. It spawns
 *   nothing and never executes a generated command.
 *
 * Child processes run `process.execPath` with an argument array (no shell), with
 * `NODE_USE_ENV_PROXY` removed from their environment so Node prints no proxy warning, and stderr
 * is compared exactly.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { PBT_PARAMS } from '@/test/pbt';
import { findBlockedCompose } from '../../../../scripts/hooks/compose-guard.mjs';

// apps/web/src/lib/ -> repository root
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const HOOKS_DIR = path.join(REPO_ROOT, '.kiro', 'hooks');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts', 'hooks');
const SPAWN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 60_000;

const readRepoFile = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const readJson = (rel: string): unknown => JSON.parse(readRepoFile(rel));

/** Local type of the part of `hookLib.mjs` used here (it has no `.d.mts`). */
interface HookLibModule {
  REPO_ROOT: string;
  savedRepoPath(input: unknown): string | null;
}

interface HookSpec {
  file: string;
  name: string;
  trigger: 'PostFileSave' | 'PreToolUse';
  matcher: string;
  script: string;
  timeout: number;
  matches: string[];
  nonMatches: string[];
}

const ABS = (rel: string) => path.join(REPO_ROOT, rel);

/** The design table of "Hooks". */
const HOOKS: HookSpec[] = [
  {
    file: 'case-check.json',
    name: 'Check case files',
    trigger: 'PostFileSave',
    matcher: '(^|/)cases/',
    script: 'case-check.mjs',
    timeout: 180,
    matches: ['cases/adult-tension-pneumothorax.yaml', 'cases/case.schema.json', ABS('cases/a.yaml')],
    nonMatches: ['casesx/a.yaml', 'mycases/a.yaml', 'apps/web/src/lib/a.ts', 'services/physiology/a.py'],
  },
  {
    file: 'web-related-tests.json',
    name: 'Run related web tests',
    trigger: 'PostFileSave',
    matcher: '(^|/)apps/web/src/.+\\.tsx?$',
    script: 'web-related-tests.mjs',
    timeout: 300,
    matches: ['apps/web/src/lib/engineRunner.ts', 'apps/web/src/components/PlayView.tsx', ABS('apps/web/src/lib/a.test.ts')],
    nonMatches: ['apps/web/src/a.css', 'apps/web/src/a.tsx.bak', 'apps/web/scripts/engineCli.ts', 'cases/a.yaml'],
  },
  {
    file: 'python-tests.json',
    name: 'Run fast physiology tests',
    trigger: 'PostFileSave',
    matcher: '(^|/)services/physiology/.+\\.py$',
    script: 'python-tests.mjs',
    timeout: 300,
    matches: ['services/physiology/app/main.py', ABS('services/physiology/tests/test_a.py')],
    nonMatches: ['services/physiology/a.txt', 'services/physiology.py', 'services/physiology/a.pyc', 'cases/a.yaml'],
  },
  {
    file: 'compose-guard.json',
    name: 'Block container start and stop',
    trigger: 'PreToolUse',
    matcher: '^(execute_bash|execute_pwsh)$',
    script: 'compose-guard.mjs',
    timeout: 10,
    matches: ['execute_bash', 'execute_pwsh'],
    nonMatches: ['fs_write', 'read_file', 'execute_bash_extra', 'my_execute_bash', 'control_bash_process'],
  },
];

const commandFor = (script: string) => `node "$(git rev-parse --show-toplevel)/scripts/hooks/${script}"`;

/** Environment of the spawned hooks: the test's own, without the proxy flag that makes Node warn. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_USE_ENV_PROXY;
  return env;
}

function spawnHook(script: string, stdin: string) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, script)], {
    cwd: REPO_ROOT,
    env: childEnv(),
    input: stdin,
    encoding: 'utf8',
    shell: false,
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The leading `---` front matter block as key/value pairs, quotes removed. */
function frontMatter(text: string): { lines: string[]; values: Record<string, string> } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error('no front matter');
  const lines = match[1].split('\n');
  const values: Record<string, string> = {};
  for (const line of lines) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`unexpected front matter line: ${line}`);
    values[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return { lines, values };
}

describe('MCP_Config (.kiro/settings/mcp.json)', () => {
  it('matches the design structure exactly (16.1 to 16.3)', () => {
    expect(readJson('.kiro/settings/mcp.json')).toStrictEqual({
      mcpServers: {
        'stitched-patient-engine': {
          command: 'bash',
          args: [
            '-c',
            'cd "$(git rev-parse --show-toplevel)/apps/web" && exec ./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineMcp.ts',
          ],
          disabled: false,
          autoApprove: ['list_cases'],
        },
      },
    });
  });

  it('auto-approves only list_cases and sets no env, cwd or timeout (16.2, 16.3)', () => {
    const config = readJson('.kiro/settings/mcp.json') as { mcpServers: Record<string, Record<string, unknown>> };
    expect(Object.keys(config.mcpServers)).toEqual(['stitched-patient-engine']);
    const server = config.mcpServers['stitched-patient-engine'];
    expect(server.autoApprove).not.toContain('run_scenario');
    expect(server.autoApprove).not.toContain('run_calibration');
    expect(server.autoApprove).not.toContain('*');
    for (const key of Object.keys(server)) {
      expect(['command', 'args', 'disabled', 'autoApprove']).toContain(key);
      expect(key.toLowerCase()).not.toContain('timeout');
    }
    expect(readRepoFile('.kiro/settings/mcp.json')).not.toContain('PHYSIOLOGY_URL');
  });
});

describe('hook files (.kiro/hooks/*.json, 15.1, 15.7)', () => {
  it('contains exactly the four hooks of the design and no manual hook', () => {
    expect(readdirSync(HOOKS_DIR).sort()).toEqual(HOOKS.map((h) => h.file).sort());
  });

  for (const spec of HOOKS) {
    describe(spec.file, () => {
      const read = () =>
        readJson(path.join('.kiro', 'hooks', spec.file)) as {
          version: string;
          hooks: Array<Record<string, unknown> & { action: Record<string, unknown> }>;
        };

      it('has version v1, one hook, the design fields, trigger, command and timeout', () => {
        const file = read();
        expect(Object.keys(file).sort()).toEqual(['hooks', 'version']);
        expect(file.version).toBe('v1');
        expect(file.hooks).toHaveLength(1);
        const hook = file.hooks[0];
        expect(Object.keys(hook).sort()).toEqual(['action', 'description', 'matcher', 'name', 'timeout', 'trigger']);
        expect(hook.name).toBe(spec.name);
        expect(typeof hook.description).toBe('string');
        expect((hook.description as string).length).toBeGreaterThan(0);
        expect(hook.trigger).toBe(spec.trigger);
        expect(hook.matcher).toBe(spec.matcher);
        expect(hook.timeout).toBe(spec.timeout);
        expect(hook.action).toStrictEqual({ type: 'command', command: commandFor(spec.script) });
        expect(readdirSync(SCRIPTS_DIR)).toContain(spec.script);
      });

      it('has a matcher that compiles as a RegExp and selects only its targets', () => {
        const matcher = new RegExp(read().hooks[0].matcher as string);
        for (const target of spec.matches) expect(matcher.test(target), target).toBe(true);
        for (const other of spec.nonMatches) expect(matcher.test(other), other).toBe(false);
      });
    });
  }
});

describe('no image build, port publishing or Blocked_Compose_Command in the scripts (15.8)', () => {
  const nonGuardScripts = ['hookLib.mjs', 'case-check.mjs', 'web-related-tests.mjs', 'python-tests.mjs'].map((f) =>
    path.join('scripts', 'hooks', f),
  );
  const engineScripts = readdirSync(path.join(REPO_ROOT, 'apps', 'web', 'scripts'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join('apps', 'web', 'scripts', f));

  const scanned = (): Array<{ label: string; text: string }> => [
    ...[...nonGuardScripts, ...engineScripts, path.join('.kiro', 'settings', 'mcp.json')].map((rel) => ({
      label: rel,
      text: readRepoFile(rel),
    })),
    ...HOOKS.map((h) => ({
      label: `${h.file} command`,
      text: String((readJson(path.join('.kiro', 'hooks', h.file)) as { hooks: Array<{ action: { command: string } }> }).hooks[0].action.command),
    })),
  ];

  it('scans the expected files', () => {
    expect(engineScripts.length).toBeGreaterThan(0);
    expect(scanned()).toHaveLength(nonGuardScripts.length + engineScripts.length + 1 + HOOKS.length);
  });

  it('finds no --build, no --service-ports and no Blocked_Compose_Command', () => {
    for (const { label, text } of scanned()) {
      expect(text.includes('--build'), label).toBe(false);
      expect(text.includes('--service-ports'), label).toBe(false);
      expect(findBlockedCompose(text), label).toBeNull();
    }
    const guard = readRepoFile(path.join('scripts', 'hooks', 'compose-guard.mjs'));
    expect(guard.includes('--build')).toBe(false);
    expect(guard.includes('--service-ports')).toBe(false);
  });

  it('calls compose only as `run -T --rm --no-deps` in the hook scripts', () => {
    const subcommands: string[] = [];
    for (const rel of nonGuardScripts) {
      for (const m of readRepoFile(rel).matchAll(/'compose',\s*((?:'[^']*',\s*){4})/g)) {
        subcommands.push(m[1].replace(/\s+/g, ''));
      }
    }
    expect(subcommands).toEqual(["'run','-T','--rm','--no-deps',", "'run','-T','--rm','--no-deps',"]);
  });
});

describe('steering front matter (16.5, 16.7)', () => {
  it('engine-calibration.md is included for every file under cases/', () => {
    const { lines, values } = frontMatter(readRepoFile('.kiro/steering/engine-calibration.md'));
    expect(values).toStrictEqual({ inclusion: 'fileMatch', fileMatchPattern: 'cases/**' });
    expect(lines).toContain('fileMatchPattern: "cases/**"');
  });

  it('calibrate-the-case.md is manual and has five numbered steps naming list_cases and run_calibration', () => {
    const text = readRepoFile('.kiro/steering/calibrate-the-case.md');
    expect(frontMatter(text).values).toStrictEqual({ inclusion: 'manual' });
    const steps = text.split('\n').filter((line) => /^\d+\. /.test(line));
    expect(steps.map((line) => Number(line.split('.')[0]))).toEqual([1, 2, 3, 4, 5]);
    expect(steps[0]).toContain('`list_cases`');
    expect(steps[1]).toContain('`run_calibration`');
  });
});

describe('spawned Compose_Guard_Hook (15.5 to 15.7, 17.6)', () => {
  const guardInput = (command: string) => JSON.stringify({ tool_name: 'execute_bash', tool_input: { command } });

  const blocked: Array<[string, string]> = [
    ['docker compose up', 'docker compose up'],
    ['docker compose down', 'docker compose down'],
    ['docker compose stop', 'docker compose stop'],
    ['docker compose restart', 'docker compose restart'],
    ['docker compose -f x.yml down', 'docker compose -f x.yml down'],
    ['echo docker compose down', 'docker compose down'],
  ];

  for (const [command, hit] of blocked) {
    it(
      `blocks \`${command}\` with exit 2 and the 15.5 message`,
      () => {
        const result = spawnHook('compose-guard.mjs', guardInput(command));
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe(
          `Blocked: \`${hit}\`. The agent does not start, stop or restart the containers in this project. Please run this command in your own terminal.\n`,
        );
      },
      TEST_TIMEOUT_MS,
    );
  }

  for (const command of ['docker compose run', 'docker compose build', 'docker compose ps', 'ls -la']) {
    it(
      `lets \`${command}\` through with exit 0 and no output`,
      () => {
        const result = spawnHook('compose-guard.mjs', guardInput(command));
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
      },
      TEST_TIMEOUT_MS,
    );
  }
});

describe('findBlockedCompose on generated commands (Property 6, 15.5, 15.6)', () => {
  // Written here from the design ("Hooks", compose-guard.mjs), not imported from the guard.
  const BLOCKED = ['up', 'down', 'stop', 'restart'] as const;
  const VALUE_OPTIONS = [
    '-f', '--file', '-p', '--project-name', '--project-directory',
    '--env-file', '--profile', '--ansi', '--progress', '--parallel',
  ] as const;
  const FLAGS = ['--dry-run', '--compatibility', '--all-resources', '--verbose'] as const;
  const OTHER_SUBCOMMANDS = ['run', 'build', 'ps', 'logs', 'config', 'exec', 'pull', 'images', 'ls'] as const;
  const PREFIXES = ['', 'echo ', 'cd x && ', 'FOO=1 '] as const;
  const SUFFIXES = ['', '; ls', ' | cat'] as const;
  const QUOTES = [['', ''], ['"', '"'], ["'", "'"], ['`', '`'], ['$(', ')']] as const;
  const GAPS = [' ', '  ', '\t'] as const;
  const ARG_FLAGS = ['-d', '--rm', '-T', '--no-deps', '-v'] as const;
  const CLASSIC_NO_PAIR = ['docker-compose up', 'docker ps', 'compose up', 'echo up', 'compose docker down', 'docker info && compose stop'];
  const NO_PAIR_WORDS = ['docker', 'compose', 'docker-compose', 'echo', '-f', '-p', 'x.yml', '--dry-run', ...BLOCKED, ...OTHER_SUBCOMMANDS];
  const NO_PAIR_JOINS = [' ', '; ', ' | ', ' && ', '\t', '\n'] as const;

  const isBlocked = (word: string) => (BLOCKED as readonly string[]).includes(word);

  // Safe words start with a lowercase letter or digit (never an option) and use only [a-z0-9._/]
  // (no quote, separator or whitespace, so each is exactly one token). They are never `docker`,
  // `compose` or a blocked word, so a random word cannot form a `docker compose` pair or put a
  // blocked word in subcommand position.
  const RESERVED = new Set<string>(['docker', 'compose', ...BLOCKED]);
  const safeWord = fc.stringMatching(/^[a-z0-9][a-z0-9._/]{0,7}$/).filter((w) => !RESERVED.has(w));

  // Option values and arguments are never `docker` or `compose`. They may be blocked words on
  // purpose: the guard skips a value (`-p up`) and stops at the subcommand, so neither blocks.
  const valueArb = fc.oneof(safeWord, fc.constantFrom(...BLOCKED, ...OTHER_SUBCOMMANDS));
  const argArb = fc.oneof(safeWord, fc.constantFrom(...BLOCKED, ...OTHER_SUBCOMMANDS, ...ARG_FLAGS));

  type GlobalOption = { form: 'space' | 'eq' | 'flag'; tokens: string[]; value: string | null };
  const optionArb: fc.Arbitrary<GlobalOption> = fc.oneof(
    fc.tuple(fc.constantFrom(...VALUE_OPTIONS), valueArb).map(([o, v]): GlobalOption => ({ form: 'space', tokens: [o, v], value: v })),
    fc.tuple(fc.constantFrom(...VALUE_OPTIONS), valueArb).map(([o, v]): GlobalOption => ({ form: 'eq', tokens: [`${o}=${v}`], value: v })),
    fc.constantFrom(...FLAGS).map((f): GlobalOption => ({ form: 'flag', tokens: [f], value: null })),
  );

  const composeCase = fc.record({
    kind: fc.constant('compose' as const),
    prefix: fc.constantFrom(...PREFIXES),
    options: fc.array(optionArb, { maxLength: 4 }),
    sub: fc.oneof(fc.constantFrom(...BLOCKED), fc.constantFrom(...OTHER_SUBCOMMANDS), safeWord),
    args: fc.array(argArb, { maxLength: 3 }),
    quote: fc.constantFrom(...QUOTES),
    suffix: fc.constantFrom(...SUFFIXES),
    gap: fc.constantFrom(...GAPS),
  });

  const randomNoPair = fc
    .record({
      kind: fc.constant('noPairRandom' as const),
      prefix: fc.constantFrom(...PREFIXES),
      words: fc.array(fc.oneof(fc.constantFrom(...NO_PAIR_WORDS), safeWord), { minLength: 1, maxLength: 6 }),
      joins: fc.array(fc.constantFrom(...NO_PAIR_JOINS), { minLength: 5, maxLength: 5 }),
      suffix: fc.constantFrom(...SUFFIXES),
    })
    .filter(({ words }) => !words.some((w, i) => w === 'docker' && words[i + 1] === 'compose'));

  const classicNoPair = fc.constantFrom(...CLASSIC_NO_PAIR).map((text) => ({ kind: 'noPairClassic' as const, text }));

  const commandCase = fc.oneof({ arbitrary: composeCase, weight: 4 }, { arbitrary: randomNoPair, weight: 1 }, { arbitrary: classicNoPair, weight: 1 });

  // Feature: engine-mcp, Property 6: The Compose_Guard_Hook blocks exactly the Blocked_Compose_Commands
  it('returns a hit exactly for docker compose up, down, stop and restart', () => {
    const seen = new Map<string, number>();
    const mark = (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1);

    fc.assert(
      fc.property(commandCase, (c) => {
        if (c.kind === 'noPairClassic') {
          mark('noPair:classic');
          expect(findBlockedCompose(c.text)).toBeNull();
          return;
        }
        if (c.kind === 'noPairRandom') {
          mark('noPair:random');
          const body = c.words.map((w, i) => (i === 0 ? w : `${c.joins[i - 1]}${w}`)).join('');
          expect(findBlockedCompose(`${c.prefix}${body}${c.suffix}`)).toBeNull();
          return;
        }

        const optionTokens = c.options.flatMap((o) => o.tokens);
        const body = ['docker', 'compose', ...optionTokens, c.sub, ...c.args].join(c.gap);
        const text = `${c.prefix}${c.quote[0]}${body}${c.quote[1]}${c.suffix}`;

        // Reference model: blocked exactly when the subcommand after the global options is a
        // blocked word; the hit is the compose part up to the subcommand, single-space joined.
        const expected = isBlocked(c.sub) ? ['docker', 'compose', ...optionTokens, c.sub].join(' ') : null;
        const hit = findBlockedCompose(text);
        expect(hit).toBe(expected);
        if (expected !== null) {
          expect(hit?.startsWith('docker compose')).toBe(true);
          expect(hit?.endsWith(` ${c.sub}`)).toBe(true);
        }

        mark(isBlocked(c.sub) ? 'blocked' : 'notBlocked');
        mark(`prefix:${c.prefix}`);
        mark(`quote:${c.quote[0]}`);
        mark(`suffix:${c.suffix}`);
        for (const o of c.options) mark(`form:${o.form}`);
        if (c.options.some((o) => o.value !== null && isBlocked(o.value))) {
          mark(isBlocked(c.sub) ? 'blockedValue:blockedSub' : 'blockedValue:otherSub');
        }
        if (c.options.some((o) => o.form === 'space' && o.value !== null && isBlocked(o.value)) && !isBlocked(c.sub)) {
          mark('blockedSpaceValue:otherSub');
        }
        if (!isBlocked(c.sub) && c.args.some(isBlocked)) mark('blockedArg:otherSub');
      }),
      PBT_PARAMS,
    );

    const required = [
      'blocked', 'notBlocked',
      ...PREFIXES.map((p) => `prefix:${p}`),
      ...QUOTES.map((q) => `quote:${q[0]}`),
      ...SUFFIXES.map((s) => `suffix:${s}`),
      'form:space', 'form:eq', 'form:flag',
      'blockedValue:blockedSub', 'blockedValue:otherSub', 'blockedSpaceValue:otherSub', 'blockedArg:otherSub',
      'noPair:classic', 'noPair:random',
    ];
    for (const key of required) expect(seen.get(key) ?? 0, JSON.stringify(key)).toBeGreaterThan(0);
  });
});

describe('findBlockedCompose with multiple compose pairs in one command (15.5, 15.6)', () => {
  // Property 6 generates one compose pair per command, so these check that a pair with a
  // subcommand that is not blocked does not end the scan before a later pair.
  it.each([
    ['docker compose ps && docker compose down', 'docker compose down'],
    ['docker compose run --rm x; docker compose -f a.yml stop', 'docker compose -f a.yml stop'],
    ['docker compose ps | docker compose logs', null],
  ])('%j gives %j', (command, expected) => {
    expect(findBlockedCompose(command)).toBe(expected);
  });
});

describe('spawned file hooks with non-matching paths (exit before any check)', () => {
  // Every path matches none of the three file hooks, so none reaches requireImage() or docker.
  // The outside path is also non-matching as a relative path, so it stays safe on its own.
  const OUTSIDE = path.join(path.dirname(REPO_ROOT), 'outside-stitched-patient', 'a.txt');
  const paths = ['apps/web/src/a.css', 'casesx/a.yaml', 'services/physiology/a.txt', OUTSIDE];
  const fileHooks = ['case-check.mjs', 'web-related-tests.mjs', 'python-tests.mjs'];

  it('uses paths that no file hook matcher or script pattern selects', () => {
    const patterns = [
      ...HOOKS.filter((h) => h.trigger === 'PostFileSave').map((h) => new RegExp(h.matcher)),
      /^cases\//,
      /^apps\/web\/src\/.+\.tsx?$/,
      /^services\/physiology\/.+\.py$/,
    ];
    for (const p of paths) for (const re of patterns) expect(re.test(p), `${re} ${p}`).toBe(false);
  });

  for (const script of fileHooks) {
    for (const filePath of paths) {
      it(
        `${script} exits 0 with no output for ${filePath === OUTSIDE ? 'a path outside the repository' : filePath}`,
        () => {
          const result = spawnHook(script, JSON.stringify({ file_path: filePath }));
          expect(result.status).toBe(0);
          expect(result.stdout).toBe('');
          expect(result.stderr).toBe('');
        },
        TEST_TIMEOUT_MS,
      );
    }
  }

  it(
    'a file hook without file_path exits 1 with the Error Handling message',
    () => {
      const result = spawnHook('case-check.mjs', JSON.stringify({}));
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('Hook input has no file_path; nothing was checked.\n');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('savedRepoPath (hookLib.mjs)', () => {
  let hookLib: HookLibModule;

  beforeAll(async () => {
    hookLib = (await import('../../../../scripts/hooks/hookLib.mjs')) as unknown as HookLibModule;
  });

  it('uses the repository root', () => {
    expect(hookLib.REPO_ROOT).toBe(REPO_ROOT);
  });

  it('turns an absolute path inside the repository into a relative POSIX path', () => {
    expect(hookLib.savedRepoPath({ file_path: path.join(REPO_ROOT, 'cases', 'a.yaml') })).toBe('cases/a.yaml');
    expect(hookLib.savedRepoPath({ file_path: path.join(REPO_ROOT, 'apps', 'web', 'src', 'lib', 'a.ts') })).toBe(
      'apps/web/src/lib/a.ts',
    );
  });

  it('keeps and normalizes a relative path', () => {
    expect(hookLib.savedRepoPath({ file_path: 'apps/web/src/lib/a.ts' })).toBe('apps/web/src/lib/a.ts');
    expect(hookLib.savedRepoPath({ file_path: './cases/../cases/a.yaml' })).toBe('cases/a.yaml');
  });

  it('returns null for paths outside the repository, the root itself and a missing file_path', () => {
    expect(hookLib.savedRepoPath({ file_path: path.join(path.dirname(REPO_ROOT), 'other', 'cases', 'a.yaml') })).toBeNull();
    expect(hookLib.savedRepoPath({ file_path: `${REPO_ROOT}x/cases/a.yaml` })).toBeNull();
    expect(hookLib.savedRepoPath({ file_path: '../other/cases/a.yaml' })).toBeNull();
    expect(hookLib.savedRepoPath({ file_path: REPO_ROOT })).toBeNull();
    expect(hookLib.savedRepoPath({})).toBeNull();
    expect(hookLib.savedRepoPath({ file_path: 42 })).toBeNull();
  });
});
