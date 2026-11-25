/**
 * Example tests of the Engine_CLI parser and exit code (engine-mcp task 5.3): each subcommand and
 * flag of 11.1, a bad `--intervention`, a leading `--` and none (O6), `cliExitCode` for every row
 * of the design's Engine_CLI error table (11.4) and the usage on invalid input (11.5). Task 5.4 adds
 * Property 3: CLI flags and tool arguments give the same parsed input and request (11.1, 11.6).
 *
 * `parseCliArgs` and `cliExitCode` are pure: no file system, network, process or timer is used
 * here. Printing to stderr and stdout belongs to `scripts/engineCli.ts`. No clinical value is
 * written here; the ids are the case's kebab-case ids and the numbers are synthetic.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_PARAMS } from '@/test/pbt';
import { EngineError, parseServiceUrl, parseSessionCap, unreachableMessage, type EngineErrorKind } from './engineClient';
import {
  CLI_USAGE,
  RunCalibrationInput,
  RunScenarioInput,
  cliExitCode,
  parseCliArgs,
  toCalibrationInput,
  toScenarioRequest,
  type CliParse,
  type HandlerOutcome,
  type ToolName,
} from './engineTools';

const CASE_ID = 'adult-tension-pneumothorax';
const TOOLS: readonly ToolName[] = ['list_cases', 'run_scenario', 'run_calibration'];

type CliOk = Extract<CliParse, { ok: true }>;
type CliFail = Extract<CliParse, { ok: false }>;

function parsedOk(argv: readonly string[]): CliOk {
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) throw new Error(`expected ok for ${JSON.stringify(argv)}, got: ${parsed.message}`);
  return parsed;
}

function parsedFail(argv: readonly string[]): CliFail {
  const parsed = parseCliArgs(argv);
  if (parsed.ok) throw new Error(`expected a parse error for ${JSON.stringify(argv)}, got ${JSON.stringify(parsed)}`);
  return parsed;
}

function errorOutcome(kind: EngineErrorKind, message: string): HandlerOutcome {
  return { result: { content: [{ type: 'text', text: message }], isError: true }, errorKind: kind };
}

function successOutcome(text: string, calibrated?: boolean): HandlerOutcome {
  const outcome: HandlerOutcome = { result: { content: [{ type: 'text', text }], structuredContent: {} } };
  if (calibrated !== undefined) outcome.calibrated = calibrated;
  return outcome;
}

function configOutcome(fn: () => unknown): HandlerOutcome {
  try {
    fn();
  } catch (err) {
    if (err instanceof EngineError) return errorOutcome(err.kind, err.message);
    throw err;
  }
  throw new Error('expected a config error');
}

// ---------------------------------------------------------------------------
// Subcommands and flags (11.1)
// ---------------------------------------------------------------------------

describe('parseCliArgs: subcommands and flags (11.1)', () => {
  it('parses the design example of "CLI options" to the exact CliParse', () => {
    const argv = [
      '--',
      '--url',
      'http://host:8000',
      'run-scenario',
      '--case',
      CASE_ID,
      '--variant',
      'left',
      '--intervention',
      'needle-decompression-left@150',
      '--max-seconds',
      '600',
      '--stop-at-ending',
    ];
    expect(parseCliArgs(argv)).toStrictEqual({
      ok: true,
      url: 'http://host:8000',
      tool: 'run_scenario',
      args: {
        case_id: CASE_ID,
        variant_id: 'left',
        interventions: [{ intervention_id: 'needle-decompression-left', at_seconds: 150 }],
        max_seconds: 600,
        stop_at_ending: true,
      },
    });
  });

  it('maps list-cases to list_cases with no arguments', () => {
    expect(parseCliArgs(['list-cases'])).toStrictEqual({ ok: true, tool: 'list_cases', args: {} });
  });

  it('maps every run-scenario flag to its tool argument, with --intervention repeatable in order', () => {
    const parsed = parsedOk([
      'run-scenario',
      '--case',
      CASE_ID,
      '--variant',
      'right',
      '--intervention',
      'first-id@30',
      '--intervention',
      'second-id@0',
      '--max-seconds',
      '900',
      '--interval',
      '5',
      '--stop-at-ending',
    ]);
    expect(parsed).toStrictEqual({
      ok: true,
      tool: 'run_scenario',
      args: {
        case_id: CASE_ID,
        variant_id: 'right',
        interventions: [
          { intervention_id: 'first-id', at_seconds: 30 },
          { intervention_id: 'second-id', at_seconds: 0 },
        ],
        max_seconds: 900,
        sample_interval_seconds: 5,
        stop_at_ending: true,
      },
    });
    expect(RunScenarioInput.safeParse(parsed.args).success).toBe(true);
  });

  it('maps every calibrate flag to its run_calibration argument', () => {
    const parsed = parsedOk([
      'calibrate',
      '--case',
      CASE_ID,
      '--decompress-at',
      '150',
      '--early-decompress-at',
      '40',
      '--max-seconds',
      '1200',
      '--write',
    ]);
    expect(parsed).toStrictEqual({
      ok: true,
      tool: 'run_calibration',
      args: {
        case_id: CASE_ID,
        decompress_at_seconds: 150,
        early_decompress_at_seconds: 40,
        max_seconds: 1200,
        write: true,
      },
    });
    expect(RunCalibrationInput.safeParse(parsed.args).success).toBe(true);
  });

  it('leaves absent flags as absent keys, so the tool schema supplies the defaults (11.6)', () => {
    const scenario = parsedOk(['run-scenario', '--case', CASE_ID, '--variant', 'left', '--max-seconds', '60']);
    expect(scenario.args).toStrictEqual({ case_id: CASE_ID, variant_id: 'left', max_seconds: 60 });
    const calibrate = parsedOk(['calibrate', '--case', CASE_ID]);
    expect(calibrate.args).toStrictEqual({ case_id: CASE_ID });
    expect(calibrate).not.toHaveProperty('url');
    expect(calibrate).not.toHaveProperty('maxSessions');
  });

  it('accepts the global --url and --max-sessions before or after the command, as text', () => {
    const before = parsedOk(['--url', 'http://other:9000', '--max-sessions', '3', 'list-cases']);
    const after = parsedOk(['list-cases', '--max-sessions', '3', '--url', 'http://other:9000']);
    const expected = { ok: true, url: 'http://other:9000', maxSessions: '3', tool: 'list_cases', args: {} };
    expect(before).toStrictEqual(expected);
    expect(after).toStrictEqual(expected);
  });

  it('accepts --flag=value as well as --flag value', () => {
    const spaced = parsedOk(['calibrate', '--case', CASE_ID, '--decompress-at', '150', '--url', 'http://h:1']);
    const inline = parsedOk(['calibrate', `--case=${CASE_ID}`, '--decompress-at=150', '--url=http://h:1']);
    expect(inline).toStrictEqual(spaced);
    expect(parsedOk(['run-scenario', '--intervention=some-id@7']).args).toStrictEqual({
      interventions: [{ intervention_id: 'some-id', at_seconds: 7 }],
    });
  });

  it('passes a number that is not a whole number through as text, so the schema names the field', () => {
    const parsed = parsedOk(['run-scenario', '--case', CASE_ID, '--variant', 'left', '--max-seconds', '1.5']);
    expect(parsed.args.max_seconds).toBe('1.5');
    const result = RunScenarioInput.safeParse(parsed.args);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('max_seconds');
    expect(parsedOk(['run-scenario', '--intervention', 'some-id@soon']).args).toStrictEqual({
      interventions: [{ intervention_id: 'some-id', at_seconds: 'soon' }],
    });
  });
});

// ---------------------------------------------------------------------------
// A bad --intervention (11.1, 11.5)
// ---------------------------------------------------------------------------

describe('parseCliArgs: a bad --intervention', () => {
  it.each([
    ['no @', 'needle-decompression-left'],
    ['more than one @', 'needle-decompression-left@150@200'],
  ])('fails with %s and names the expected form', (_label, value) => {
    const parsed = parsedFail(['run-scenario', '--case', CASE_ID, '--intervention', value]);
    expect(parsed.message).toContain('--intervention');
    expect(parsed.message).toContain(value);
    expect(parsed.message).toContain('<intervention_id>@<seconds>');
  });
});

// ---------------------------------------------------------------------------
// A leading "--" and none (O6)
// ---------------------------------------------------------------------------

describe('parseCliArgs: a leading "--" (O6)', () => {
  const ARGVS: ReadonlyArray<readonly [readonly string[]]> = [
    [['list-cases']],
    [['--url', 'http://host:8000', 'run-scenario', '--case', CASE_ID, '--variant', 'left', '--max-seconds', '60']],
    [['calibrate', '--case', CASE_ID, '--write']],
  ];
  it.each(ARGVS)('gives the same result with and without one leading "--": %j', (argv) => {
    const without = parsedOk(argv);
    expect(parseCliArgs(['--', ...argv])).toStrictEqual(without);
  });

  it('drops only one leading "--"', () => {
    parsedFail(['--', '--', 'list-cases']);
  });
});

// ---------------------------------------------------------------------------
// Usage on invalid input (11.5)
// ---------------------------------------------------------------------------

describe('parseCliArgs: usage on invalid input (11.5)', () => {
  const INVALID: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['no argument', []],
    ['only "--"', ['--']],
    ['only global flags', ['--url', 'http://host:8000']],
    ['an unknown command', ['run']],
    ['an option before the command', ['--case', CASE_ID, 'calibrate']],
    ['an unknown option', ['calibrate', '--case', CASE_ID, '--speed', '2']],
    ['an option of another command', ['calibrate', '--case', CASE_ID, '--variant', 'left']],
    ['a flag on list-cases', ['list-cases', '--case', CASE_ID]],
    ['a missing value at the end', ['run-scenario', '--case']],
    ['a missing value before the next flag', ['run-scenario', '--case', '--variant', 'left']],
    ['a missing global value', ['list-cases', '--url']],
    ['a repeated option', ['run-scenario', '--case', CASE_ID, '--case', CASE_ID]],
    ['a repeated global option', ['--max-sessions', '2', 'list-cases', '--max-sessions', '3']],
    ['a repeated boolean flag', ['calibrate', '--case', CASE_ID, '--write', '--write']],
    ['a value on a boolean flag', ['calibrate', '--case', CASE_ID, '--write=true']],
    ['an extra positional argument', ['run-scenario', '--case', CASE_ID, 'extra']],
    ['a second command', ['list-cases', 'calibrate']],
  ];
  it.each(INVALID)('fails with %s and returns a message to print after CLI_USAGE', (_label, argv) => {
    const parsed = parsedFail(argv);
    expect(parsed).toStrictEqual({ ok: false, message: expect.any(String) });
    expect(parsed.message.length).toBeGreaterThan(0);
  });

  it('leaves a missing required flag to the tool schema, which gives an input error', () => {
    const parsed = parsedOk(['run-scenario', '--case', CASE_ID]);
    const result = RunScenarioInput.safeParse(parsed.args);
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['variant_id', 'max_seconds']));
  });

  it('CLI_USAGE names every subcommand, every flag of 11.1 and the exit codes', () => {
    for (const word of [
      'list-cases',
      'run-scenario',
      'calibrate',
      '--url',
      '--max-sessions',
      '--case',
      '--variant',
      '--intervention ID@SECONDS',
      '--max-seconds',
      '--interval',
      '--stop-at-ending',
      '--decompress-at',
      '--early-decompress-at',
      '--write',
    ]) {
      expect(CLI_USAGE).toContain(word);
    }
    const lines = CLI_USAGE.split('\n');
    expect(lines[0]).toMatch(/^Usage: vite-node --config vitest\.config\.ts scripts\/engineCli\.ts -- /);
    const last = lines[lines.length - 1];
    expect(last).toMatch(/^Exit codes: /);
    for (const code of ['0', '1', '2', '3']) expect(last).toContain(`${code} `);
  });
});

// ---------------------------------------------------------------------------
// cliExitCode: the rows of the Engine_CLI error table (11.4)
// ---------------------------------------------------------------------------

describe('cliExitCode: the Engine_CLI error table (11.4)', () => {
  it.each(TOOLS)('exits 2 for a parse failure (usage) of %s', (tool) => {
    expect(cliExitCode(tool, { usage: true })).toBe(2);
  });

  it.each(TOOLS)('exits 2 for a schema (input) error of %s', (tool) => {
    expect(cliExitCode(tool, errorOutcome('input', 'Invalid input: max_seconds: is required'))).toBe(2);
  });

  it.each(TOOLS)('exits 2 for a config error of %s (Service_URL and Session_Cap)', (tool) => {
    expect(cliExitCode(tool, configOutcome(() => parseServiceUrl('not a url')))).toBe(2);
    expect(cliExitCode(tool, configOutcome(() => parseSessionCap('99')))).toBe(2);
  });

  it.each(TOOLS)('exits 1 for the Unreachable_Error of %s', (tool) => {
    const outcome = errorOutcome('unreachable', unreachableMessage('http://localhost:8000'));
    expect(cliExitCode(tool, outcome)).toBe(1);
  });

  const OTHER_KINDS: readonly EngineErrorKind[] = [
    'case',
    'http',
    'timeout',
    'variant',
    'plan',
    'checkpoint',
    'stream',
    'stall',
    'cancelled',
    'internal',
  ];
  it.each(OTHER_KINDS.flatMap((kind) => TOOLS.map((tool) => [kind, tool] as const)))(
    'exits 1 for a %s tool error of %s',
    (kind, tool) => {
      expect(cliExitCode(tool, errorOutcome(kind, `synthetic ${kind} error`))).toBe(1);
    },
  );

  it('exits 1 for a tool error that carries no kind', () => {
    const outcome: HandlerOutcome = { result: { content: [{ type: 'text', text: 'x' }], isError: true } };
    expect(cliExitCode('run_scenario', outcome)).toBe(1);
  });

  it('exits 3 when calibrate succeeds with "NOT calibrated"', () => {
    expect(cliExitCode('run_calibration', successOutcome('record: NOT calibrated', false))).toBe(3);
  });

  it('exits 0 when calibrate succeeds and every Calibration_Check passes', () => {
    expect(cliExitCode('run_calibration', successOutcome('record', true))).toBe(0);
  });

  it('exits 0 when list-cases or run-scenario succeeds', () => {
    expect(cliExitCode('list_cases', successOutcome(JSON.stringify([CASE_ID])))).toBe(0);
    expect(cliExitCode('run_scenario', successOutcome('{}'))).toBe(0);
  });

  it('exits 1, not 3, when calibrate fails with a tool error', () => {
    const outcome: HandlerOutcome = { ...errorOutcome('stall', 'synthetic stall'), calibrated: false };
    expect(cliExitCode('run_calibration', outcome)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Property 3: CLI flags and tool arguments give equal Scenario requests (11.1, 11.6)
// ---------------------------------------------------------------------------

/** Schema limits of 3.1 and 8.1, written here because engineTools.ts does not export them. */
const MAX_SECONDS_LIMIT = 3600;
const MAX_SAMPLE_INTERVAL = 60;
const MAX_PLANNED_INTERVENTIONS = 20;
/** `whole` has no upper bound; this keeps the numbers readable and well inside safe integers. */
const MAX_WHOLE = 100_000;

type CommandTool = 'run_scenario' | 'run_calibration';

/** Flag names of 11.1 and the design's CLI section, written independently of the parser. */
const COMMAND_NAME: Readonly<Record<CommandTool, string>> = {
  run_scenario: 'run-scenario',
  run_calibration: 'calibrate',
};
const VALUE_FLAGS: Readonly<Record<CommandTool, readonly (readonly [key: string, flag: string])[]>> = {
  run_scenario: [
    ['case_id', '--case'],
    ['variant_id', '--variant'],
    ['max_seconds', '--max-seconds'],
    ['sample_interval_seconds', '--interval'],
  ],
  run_calibration: [
    ['case_id', '--case'],
    ['decompress_at_seconds', '--decompress-at'],
    ['early_decompress_at_seconds', '--early-decompress-at'],
    ['max_seconds', '--max-seconds'],
  ],
};
/** Boolean flags take no value: present means true, absent means the schema default (false). */
const SWITCH_FLAGS: Readonly<Record<CommandTool, readonly (readonly [key: string, flag: string])[]>> = {
  run_scenario: [['stop_at_ending', '--stop-at-ending']],
  run_calibration: [['write', '--write']],
};

interface PlannedArg {
  intervention_id: string;
  at_seconds: number;
}
interface ToolCall {
  tool: CommandTool;
  args: Record<string, unknown>;
}
interface GlobalOptions {
  url?: string;
  maxSessions?: string;
  urlBefore: boolean;
  maxSessionsBefore: boolean;
}
interface FlagGroup {
  flag: string;
  value?: string;
  intervention?: true;
}

const KEBAB_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const arbKebab: fc.Arbitrary<string> = fc.oneof(
  fc.constant(CASE_ID),
  fc
    .array(fc.stringOf(fc.constantFrom(...KEBAB_CHARS), { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 4 })
    .map((parts) => parts.join('-')),
);

/** Valid run_scenario arguments; optional keys omitted at random, every at_seconds <= max_seconds. */
const arbScenarioArgs: fc.Arbitrary<Record<string, unknown>> = fc
  .integer({ min: 1, max: MAX_SECONDS_LIMIT })
  .chain((maxSeconds) =>
    fc.record(
      {
        case_id: arbKebab,
        variant_id: arbKebab,
        interventions: fc.array(
          fc.record({ intervention_id: arbKebab, at_seconds: fc.integer({ min: 0, max: maxSeconds }) }),
          { maxLength: MAX_PLANNED_INTERVENTIONS },
        ),
        max_seconds: fc.constant(maxSeconds),
        sample_interval_seconds: fc.integer({ min: 1, max: MAX_SAMPLE_INTERVAL }),
        stop_at_ending: fc.boolean(),
      },
      { requiredKeys: ['case_id', 'variant_id', 'max_seconds'] },
    ),
  );

/** Valid run_calibration arguments; optional keys omitted at random. */
const arbCalibrationArgs: fc.Arbitrary<Record<string, unknown>> = fc.record(
  {
    case_id: arbKebab,
    decompress_at_seconds: fc.nat({ max: MAX_WHOLE }),
    early_decompress_at_seconds: fc.nat({ max: MAX_WHOLE }),
    max_seconds: fc.integer({ min: 1, max: MAX_SECONDS_LIMIT }),
    write: fc.boolean(),
  },
  { requiredKeys: ['case_id'] },
);

const arbToolCall: fc.Arbitrary<ToolCall> = fc.oneof(
  arbScenarioArgs.map((args): ToolCall => ({ tool: 'run_scenario', args })),
  arbCalibrationArgs.map((args): ToolCall => ({ tool: 'run_calibration', args })),
);

const arbGlobals: fc.Arbitrary<GlobalOptions> = fc.record(
  {
    url: fc.constantFrom('http://localhost:8000', 'http://192.168.1.20:8000', 'https://physiology.example:8443'),
    maxSessions: fc.integer({ min: 1, max: 8 }).map(String),
    urlBefore: fc.boolean(),
    maxSessionsBefore: fc.boolean(),
  },
  { requiredKeys: ['urlBefore', 'maxSessionsBefore'] },
);

/** The command's flags in a fixed order: value flags, true switches, then each intervention. */
function commandGroups(call: ToolCall): FlagGroup[] {
  const groups: FlagGroup[] = [];
  for (const [key, flag] of VALUE_FLAGS[call.tool]) {
    if (call.args[key] !== undefined) groups.push({ flag, value: String(call.args[key]) });
  }
  for (const [key, flag] of SWITCH_FLAGS[call.tool]) {
    if (call.args[key] === true) groups.push({ flag });
  }
  for (const p of (call.args.interventions ?? []) as PlannedArg[]) {
    groups.push({ flag: '--intervention', value: `${p.intervention_id}@${p.at_seconds}`, intervention: true });
  }
  return groups;
}

function globalGroups(globals: GlobalOptions, before: boolean): FlagGroup[] {
  const groups: FlagGroup[] = [];
  if (globals.url !== undefined && globals.urlBefore === before) groups.push({ flag: '--url', value: globals.url });
  if (globals.maxSessions !== undefined && globals.maxSessionsBefore === before) {
    groups.push({ flag: '--max-sessions', value: globals.maxSessions });
  }
  return groups;
}

/**
 * Engine_CLI argv for a call: global options before or after the command, the command's flags (and
 * the global options after it) in the order `perm`, each value as `--flag value` or `--flag=value`
 * by `inline`, and an optional leading "--" (O6). The `--intervention` flags keep their list order:
 * the slots they take in the shuffled order are refilled in the original order.
 */
function renderArgv(
  call: ToolCall,
  globals: GlobalOptions,
  perm: readonly number[],
  inline: readonly boolean[],
  leadingDash: boolean,
): string[] {
  const pre = globalGroups(globals, true);
  const groups = [...commandGroups(call), ...globalGroups(globals, false)];
  const inOrder = groups.filter((g) => g.intervention);
  const shuffled = perm.map((i) => groups[i]);
  const ordered = shuffled.map((g) => (g.intervention ? (inOrder.shift() as FlagGroup) : g));
  const tokens = (g: FlagGroup, i: number): string[] => {
    if (g.value === undefined) return [g.flag];
    return inline[i] ? [`${g.flag}=${g.value}`] : [g.flag, g.value];
  };
  const argv = [
    ...pre.flatMap((g, i) => tokens(g, i)),
    COMMAND_NAME[call.tool],
    ...ordered.flatMap((g, i) => tokens(g, pre.length + i)),
  ];
  return leadingDash ? ['--', ...argv] : argv;
}

interface RenderedCall {
  call: ToolCall;
  globals: GlobalOptions;
  argv: string[];
}

const arbRenderedCall: fc.Arbitrary<RenderedCall> = fc.tuple(arbToolCall, arbGlobals).chain(([call, globals]) => {
  const n = commandGroups(call).length + globalGroups(globals, false).length;
  const indices = Array.from({ length: n }, (_, i) => i);
  return fc
    .record({
      perm: fc.shuffledSubarray(indices, { minLength: n, maxLength: n }),
      inline: fc.array(fc.boolean(), { minLength: n + 2, maxLength: n + 2 }),
      leadingDash: fc.boolean(),
    })
    .map(({ perm, inline, leadingDash }) => ({
      call,
      globals,
      argv: renderArgv(call, globals, perm, inline, leadingDash),
    }));
});

/** The raw args the CLI can express: a false switch and an empty intervention list have no flag. */
function expressibleArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

describe('CLI-to-tool equivalence', () => {
  // Feature: engine-mcp, Property 3: CLI flags and tool arguments give equal Scenario requests
  it('Property 3: CLI flags and tool arguments give equal Scenario requests', () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(arbRenderedCall, ({ call, globals, argv }) => {
        seen.add(`${call.tool} ${argv[0] === '--' ? 'dash' : 'no-dash'}`);
        const parsed = parsedOk(argv);
        expect(parsed.tool).toBe(call.tool);
        expect(parsed.url).toBe(globals.url);
        expect(parsed.maxSessions).toBe(globals.maxSessions);
        expect(parsed.args).toStrictEqual(expressibleArgs(call.args));

        if (call.tool === 'run_scenario') {
          const fromTool = RunScenarioInput.parse(call.args);
          const fromCli = RunScenarioInput.parse(parsed.args);
          expect(fromCli).toStrictEqual(fromTool);
          expect(toScenarioRequest(fromCli)).toStrictEqual(toScenarioRequest(fromTool));
        } else {
          const fromTool = RunCalibrationInput.parse(call.args);
          const fromCli = RunCalibrationInput.parse(parsed.args);
          expect(fromCli).toStrictEqual(fromTool);
          expect(toCalibrationInput(fromCli)).toStrictEqual(toCalibrationInput(fromTool));
        }
      }),
      PBT_PARAMS,
    );
    // Both tools were generated, each with and without the leading "--".
    expect(seen.size).toBe(4);
  });
});
