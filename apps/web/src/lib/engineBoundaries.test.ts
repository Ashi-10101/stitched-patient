/**
 * Boundary checks for the engine modules (engine-mcp task 5.6, design D17, "Testing Strategy" and
 * "Test files": `engineBoundaries.test.ts`; Requirements 1.2, 18.2, 18.3, 18.4).
 *
 * (a) No non-test module under `src/` imports `@modelcontextprotocol/sdk` or `vite-node`.
 * (b) The only non-test module under `src/` that imports `zod` is `src/lib/engineTools.ts`.
 * (c) No non-test module under `src/` outside the engine modules imports an engine module, so
 *     nothing the Next.js app loads can reach `zod` or the SDK.
 * (d) The engine modules import no `node:` module (nor a bare Node builtin such as `fs`).
 * Also: `apps/web/package.json` lists the SDK, `zod` and `vite-node` only under `devDependencies`.
 *
 * Test module: a file named `*.test.ts` or `*.test.tsx`, or any file under `src/test/`. The design
 * calls the files under `src/test/` (Fake_Service, fake clock, fixtures, generators) "test-only
 * modules", and only test files import them. The doubles `src/test/fakeClock.ts` and
 * `src/test/fakePhysiologyService.ts` import `@/lib/engineClient`; that is allowed because they
 * are test-only.
 *
 * Imports are read from the TypeScript syntax tree (the `typescript` devDependency), so comments
 * and string contents never count, and multi-line imports, `import type`, `export ... from`,
 * side-effect imports, dynamic `import()`, `require()`, `import x = require()` and type-level
 * `import('...')` all count. Specifiers are resolved (relative paths and the `@/` alias of
 * `tsconfig.json`, with or without an extension or `/index`) to a path under `src/`, or to a
 * package name, so subpaths such as `zod/v4` count as `zod`.
 *
 * The test reads source files only. It never runs `next build` (the 18.3 build check runs in a
 * separate copy of `apps/web`, see the task report). No clinical value is written here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// apps/web/src/lib/ -> apps/web/
const WEB_DIR = fileURLToPath(new URL('../../', import.meta.url));
const SRC_DIR = path.join(WEB_DIR, 'src');

const ENGINE_MODULES = [
  'engineClient',
  'engineSlots',
  'calibration',
  'engineRunner',
  'engineCalibration',
  'calibrationRecord',
  'engineTools',
] as const;
const ENGINE_PATHS = new Set<string>(ENGINE_MODULES.map((name) => `src/lib/${name}`));
const ZOD_ALLOWED = ['src/lib/engineTools.ts'];
const DEV_ONLY_PACKAGES = ['@modelcontextprotocol/sdk', 'zod', 'vite-node'] as const;
const NODE_BUILTINS = new Set(builtinModules);

interface SourceModule {
  /** Posix path relative to `apps/web/`, for example `src/lib/engineTools.ts`. */
  file: string;
  text: string;
}

interface ImportRef {
  /** The module specifier, or `null` for `import(expr)` / `require(expr)` with a non-literal argument. */
  specifier: string | null;
  line: number;
}

type Target =
  | { kind: 'builtin'; name: string }
  | { kind: 'package'; name: string }
  /** Path under `apps/web/` without extension or trailing `/index`, for example `src/lib/engineRunner`. */
  | { kind: 'local'; path: string };

// ---------------------------------------------------------------------------------------------
// Scanner

function isTestModule(file: string): boolean {
  return /\.test\.tsx?$/.test(file) || file.startsWith('src/test/');
}

function isEngineModule(file: string): boolean {
  return ENGINE_PATHS.has(stripExtension(file));
}

function stripExtension(p: string): string {
  return p.replace(/\.(d\.ts|tsx?|mts|cts|jsx?|mjs|cjs)$/, '').replace(/\/index$/, '');
}

/** Every import-like reference in one file, read from the syntax tree. */
function scanImports(file: string, text: string): ImportRef[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const refs: ImportRef[] = [];
  const add = (node: ts.Node, specifier: string | null) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    refs.push({ specifier, line });
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      add(node, node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      add(node, ts.isStringLiteralLike(expr) ? expr.text : null);
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      add(node, ts.isLiteralTypeNode(arg) && ts.isStringLiteralLike(arg.literal) ? arg.literal.text : null);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isLoad =
        callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require');
      if (isLoad) {
        const arg = node.arguments[0];
        add(node, arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : null);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refs;
}

function resolveSpecifier(fromFile: string, specifier: string): Target {
  if (specifier.startsWith('.')) {
    return { kind: 'local', path: stripExtension(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))) };
  }
  if (specifier.startsWith('@/')) {
    return { kind: 'local', path: stripExtension(path.posix.normalize(`src/${specifier.slice(2)}`)) };
  }
  if (specifier.startsWith('node:')) {
    return { kind: 'builtin', name: specifier };
  }
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(name)) {
    return { kind: 'builtin', name: specifier };
  }
  return { kind: 'package', name };
}

interface ResolvedImport {
  file: string;
  line: number;
  specifier: string;
  target: Target;
}

function resolvedImports(modules: readonly SourceModule[]): ResolvedImport[] {
  return modules.flatMap(({ file, text }) =>
    scanImports(file, text).flatMap(({ specifier, line }) =>
      specifier === null ? [] : [{ file, line, specifier, target: resolveSpecifier(file, specifier) }],
    ),
  );
}

const describeImport = (i: ResolvedImport) => `${i.file}:${i.line} imports '${i.specifier}'`;

// ---------------------------------------------------------------------------------------------
// Checks (pure, so the in-memory examples below run the same code as the real check)

/** Non-literal `import(expr)` / `require(expr)` in non-test modules: these could evade the checks. */
function nonLiteralLoads(modules: readonly SourceModule[]): string[] {
  return modules
    .filter((m) => !isTestModule(m.file))
    .flatMap(({ file, text }) =>
      scanImports(file, text)
        .filter((r) => r.specifier === null)
        .map((r) => `${file}:${r.line} loads a non-literal module specifier`),
    );
}

/** (a) */
function sdkOrViteNodeImports(modules: readonly SourceModule[]): string[] {
  return resolvedImports(modules.filter((m) => !isTestModule(m.file)))
    .filter(
      ({ target }) =>
        target.kind === 'package' && (target.name.startsWith('@modelcontextprotocol/') || target.name === 'vite-node'),
    )
    .map(describeImport);
}

/** (b) The non-test modules that import `zod`, sorted. */
function zodImporters(modules: readonly SourceModule[]): string[] {
  const files = resolvedImports(modules.filter((m) => !isTestModule(m.file)))
    .filter(({ target }) => target.kind === 'package' && target.name === 'zod')
    .map((i) => i.file);
  return [...new Set(files)].sort();
}

/** (c) */
function engineImportsOutsideEngine(modules: readonly SourceModule[]): string[] {
  return resolvedImports(modules.filter((m) => !isTestModule(m.file) && !isEngineModule(m.file)))
    .filter(({ target }) => target.kind === 'local' && ENGINE_PATHS.has(target.path))
    .map(describeImport);
}

/** (d) */
function nodeImportsInEngine(modules: readonly SourceModule[]): string[] {
  return resolvedImports(modules.filter((m) => isEngineModule(m.file) && !isTestModule(m.file)))
    .filter(({ target }) => target.kind === 'builtin')
    .map(describeImport);
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** 18.2: the SDK, `zod` and `vite-node` are in `devDependencies` and in no other dependency list. */
function packageViolations(pkg: PackageJson): string[] {
  const out: string[] = [];
  for (const name of DEV_ONLY_PACKAGES) {
    if (pkg.devDependencies?.[name] === undefined) out.push(`${name} is missing from devDependencies`);
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      if (pkg[field]?.[name] !== undefined) out.push(`${name} is listed in ${field}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Real sources

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const ALL_MODULES: SourceModule[] = walk(SRC_DIR)
  .map((full) => ({
    file: path.relative(WEB_DIR, full).split(path.sep).join('/'),
    text: readFileSync(full, 'utf8'),
  }))
  .sort((a, b) => a.file.localeCompare(b.file));
const NON_TEST_MODULES = ALL_MODULES.filter((m) => !isTestModule(m.file));
const BY_PATH = new Map(ALL_MODULES.map((m) => [stripExtension(m.file), m]));

/** Files reachable through local imports from the Next.js App Router files under `src/app/`. */
function reachableFromApp(): SourceModule[] {
  const seen = new Map<string, SourceModule>();
  const queue = ALL_MODULES.filter((m) => m.file.startsWith('src/app/'));
  while (queue.length > 0) {
    const m = queue.shift() as SourceModule;
    if (seen.has(m.file)) continue;
    seen.set(m.file, m);
    for (const i of resolvedImports([m])) {
      if (i.target.kind !== 'local') continue;
      // Stylesheets such as `./globals.css` import no module.
      if (/\.(css|scss|sass|less)$/.test(i.target.path)) continue;
      const next = BY_PATH.get(i.target.path);
      if (next === undefined) throw new Error(`${describeImport(i)}, which resolves to no file under src/`);
      queue.push(next);
    }
  }
  return [...seen.values()];
}

/** In-memory fixture modules, never written to disk. */
const mod = (file: string, text: string): SourceModule => ({ file, text });

// ---------------------------------------------------------------------------------------------

describe('scanner', () => {
  it('walks every .ts and .tsx file under src/ and finds the non-test modules the app loads', () => {
    const files = NON_TEST_MODULES.map((m) => m.file);
    expect(NON_TEST_MODULES.length).toBeGreaterThanOrEqual(30);
    expect(ALL_MODULES.length).toBeGreaterThan(NON_TEST_MODULES.length);
    for (const name of ENGINE_MODULES) expect(files).toContain(`src/lib/${name}.ts`);
    expect(files).toEqual(expect.arrayContaining(['src/app/page.tsx', 'src/components/SessionScreen.tsx', 'src/lib/api.ts']));
    // This file and the test doubles are test modules.
    expect(files).not.toContain('src/lib/engineBoundaries.test.ts');
    expect(files.some((f) => f.startsWith('src/test/'))).toBe(false);
  });

  it('reads every import form and ignores comments and strings', () => {
    const text = [
      "import { a,",
      "  b,",
      "} from './multi';",
      "import type { T } from '@/types';",
      "import './sideEffect';",
      "export { c } from '../lib/reexport.ts';",
      "export * from 'pkg/sub';",
      "import x = require('legacy');",
      "type U = import('typeOnly').U;",
      "const d = await import('dyn');",
      "const e = require(`req`);",
      "// import { z } from 'zod';",
      "/* import { Server } from '@modelcontextprotocol/sdk'; require('vite-node') */",
      "const s = \"import { z } from 'zod'\";",
      "const t = `export * from 'node:fs'`;",
      "const u = { from: 'zod' };",
      "const v = import(name);",
    ].join('\n');
    expect(scanImports('src/lib/sample.ts', text)).toEqual([
      { specifier: './multi', line: 1 },
      { specifier: '@/types', line: 4 },
      { specifier: './sideEffect', line: 5 },
      { specifier: '../lib/reexport.ts', line: 6 },
      { specifier: 'pkg/sub', line: 7 },
      { specifier: 'legacy', line: 8 },
      { specifier: 'typeOnly', line: 9 },
      { specifier: 'dyn', line: 10 },
      { specifier: 'req', line: 11 },
      { specifier: null, line: 17 },
    ]);
  });

  it('resolves relative paths, the @/ alias, package subpaths and Node builtins', () => {
    expect(resolveSpecifier('src/components/A.tsx', '../lib/engineRunner.ts')).toEqual({ kind: 'local', path: 'src/lib/engineRunner' });
    expect(resolveSpecifier('src/lib/a.ts', './engineRunner')).toEqual({ kind: 'local', path: 'src/lib/engineRunner' });
    expect(resolveSpecifier('src/app/page.tsx', '@/lib/engineRunner')).toEqual({ kind: 'local', path: 'src/lib/engineRunner' });
    expect(resolveSpecifier('src/app/page.tsx', '@/types/index')).toEqual({ kind: 'local', path: 'src/types' });
    expect(resolveSpecifier('src/lib/a.ts', 'zod/v4')).toEqual({ kind: 'package', name: 'zod' });
    expect(resolveSpecifier('src/lib/a.ts', '@modelcontextprotocol/sdk/server/index.js')).toEqual({
      kind: 'package',
      name: '@modelcontextprotocol/sdk',
    });
    expect(resolveSpecifier('src/lib/a.ts', 'vite-node/client')).toEqual({ kind: 'package', name: 'vite-node' });
    expect(resolveSpecifier('src/lib/a.ts', 'node:fs/promises')).toEqual({ kind: 'builtin', name: 'node:fs/promises' });
    expect(resolveSpecifier('src/lib/a.ts', 'fs/promises')).toEqual({ kind: 'builtin', name: 'fs/promises' });
    expect(resolveSpecifier('src/lib/a.ts', 'path')).toEqual({ kind: 'builtin', name: 'path' });
  });

  it('finds no non-literal import() or require() in non-test modules', () => {
    expect(nonLiteralLoads(NON_TEST_MODULES)).toEqual([]);
    expect(nonLiteralLoads([mod('src/lib/bad.ts', 'const m = await import(name);')])).toEqual([
      'src/lib/bad.ts:1 loads a non-literal module specifier',
    ]);
    expect(nonLiteralLoads([mod('src/lib/bad.test.ts', 'const m = require(name);')])).toEqual([]);
  });
});

describe('(a) no non-test module under src/ imports @modelcontextprotocol/sdk or vite-node (18.3)', () => {
  it('holds for the real sources', () => {
    expect(sdkOrViteNodeImports(ALL_MODULES)).toEqual([]);
  });

  it('sanity: the scanner sees the SDK imports of the real test modules', () => {
    const sdkTest = ALL_MODULES.find((m) => m.file === 'src/lib/engineMcpSdk.test.ts') as SourceModule;
    const names = resolvedImports([sdkTest]).map((i) => i.target);
    expect(names).toContainEqual({ kind: 'package', name: '@modelcontextprotocol/sdk' });
  });

  it('flags forbidden imports in in-memory non-test modules and not in comments, strings or test modules', () => {
    const fixtures = [
      mod('src/components/Bad.tsx', "import {\n  Server,\n} from '@modelcontextprotocol/sdk/server/index.js';"),
      mod('src/lib/badDynamic.ts', "export async function f() { return import('vite-node/client'); }"),
      mod('src/hooks/badRequire.ts', 'const sdk = require("@modelcontextprotocol/sdk");'),
      mod('src/lib/badType.ts', "import type { Tool } from '@modelcontextprotocol/sdk/types.js';"),
      mod(
        'src/lib/fine.ts',
        "// import { Server } from '@modelcontextprotocol/sdk';\n/* require('vite-node') */\nconst s = \"import 'vite-node'\";",
      ),
      mod('src/lib/fine.test.ts', "import { Server } from '@modelcontextprotocol/sdk/server/index.js';"),
      mod('src/test/fineDouble.ts', "import 'vite-node';"),
    ];
    expect(sdkOrViteNodeImports(fixtures)).toEqual([
      "src/components/Bad.tsx:1 imports '@modelcontextprotocol/sdk/server/index.js'",
      "src/lib/badDynamic.ts:1 imports 'vite-node/client'",
      "src/hooks/badRequire.ts:1 imports '@modelcontextprotocol/sdk'",
      "src/lib/badType.ts:1 imports '@modelcontextprotocol/sdk/types.js'",
    ]);
  });
});

describe('(b) the only non-test module under src/ that imports zod is src/lib/engineTools.ts', () => {
  it('holds for the real sources, and the scanner finds engineTools.ts importing zod/v4 (sanity)', () => {
    expect(zodImporters(ALL_MODULES)).toEqual(ZOD_ALLOWED);
    const tools = ALL_MODULES.find((m) => m.file === 'src/lib/engineTools.ts') as SourceModule;
    expect(scanImports(tools.file, tools.text).map((r) => r.specifier)).toContain('zod/v4');
  });

  it('flags zod imports of in-memory non-test modules other than engineTools.ts', () => {
    const fixtures = [
      mod('src/lib/engineTools.ts', "import { z } from 'zod/v4';"),
      mod('src/hooks/useBad.ts', "import type {\n  ZodType,\n} from 'zod/v4';"),
      mod('src/lib/badExport.ts', "export { z } from 'zod';"),
      mod('src/lib/badTypeImport.ts', "type T = import('zod').ZodType;"),
      mod('src/components/Fine.tsx', "// import { z } from 'zod'\nconst label = 'zod';"),
      mod('src/lib/fine.test.ts', "import { z } from 'zod';"),
      mod('src/test/fineDouble.ts', "import { z } from 'zod/v4';"),
    ];
    expect(zodImporters(fixtures)).toEqual([
      'src/hooks/useBad.ts',
      'src/lib/badExport.ts',
      'src/lib/badTypeImport.ts',
      'src/lib/engineTools.ts',
    ]);
  });
});

describe('(c) no non-test module outside the engine modules imports an engine module', () => {
  it('holds for the real sources', () => {
    expect(engineImportsOutsideEngine(ALL_MODULES)).toEqual([]);
  });

  it('sanity: the scanner finds engine-to-engine imports and the test doubles importing engineClient', () => {
    const engineToEngine = resolvedImports(NON_TEST_MODULES.filter((m) => isEngineModule(m.file))).filter(
      ({ target }) => target.kind === 'local' && ENGINE_PATHS.has(target.path),
    );
    expect(engineToEngine.map((i) => [i.file, i.specifier])).toContainEqual(['src/lib/engineTools.ts', './engineClient']);
    expect(engineToEngine.length).toBeGreaterThanOrEqual(ENGINE_MODULES.length);

    // Test-only doubles may import engine modules (allowed: they are test modules).
    const doubles = resolvedImports(ALL_MODULES.filter((m) => m.file.startsWith('src/test/')))
      .filter(({ target }) => target.kind === 'local' && ENGINE_PATHS.has(target.path))
      .map((i) => i.file);
    expect([...new Set(doubles)].sort()).toEqual(['src/test/fakeClock.ts', 'src/test/fakePhysiologyService.ts']);
  });

  it('sanity: the modules reachable from src/app/ include the app components and no engine module, zod or SDK', () => {
    const reachable = reachableFromApp();
    const files = reachable.map((m) => m.file);
    expect(files).toEqual(
      expect.arrayContaining(['src/app/page.tsx', 'src/components/SessionScreen.tsx', 'src/hooks/useSimulationSession.ts']),
    );
    expect(files.filter((f) => isEngineModule(f))).toEqual([]);
    expect(files.filter((f) => isTestModule(f))).toEqual([]);
    const packages = resolvedImports(reachable).flatMap(({ target }) => (target.kind === 'package' ? [target.name] : []));
    expect(packages).toContain('react');
    for (const name of DEV_ONLY_PACKAGES) expect(packages).not.toContain(name);
  });

  it('flags engine imports of in-memory non-engine modules in every spelling', () => {
    const fixtures = [
      mod('src/components/BadPanel.tsx', "import { runScenario } from '@/lib/engineRunner';"),
      mod('src/hooks/useBad.ts', "import { createSessionSlots } from '../lib/engineSlots.ts';"),
      mod('src/lib/badApi.ts', "export * from './calibration';"),
      mod('src/app/badPage.tsx', "import type { EngineDeps } from '@/lib/engineTools/index';"),
      mod('src/lib/badLazy.ts', "const r = () => import('./calibrationRecord');"),
      mod('src/lib/calibrationRecord.ts', "import { EngineError } from './engineClient';"),
      mod('src/lib/fineNames.ts', "import { a } from './engineRunnerExtras';\nimport { b } from './calibrationHelpers';"),
      mod('src/lib/fine.test.ts', "import { runScenario } from './engineRunner';"),
      mod('src/test/fineDouble.ts', "import { EngineError } from '@/lib/engineClient';"),
    ];
    expect(engineImportsOutsideEngine(fixtures)).toEqual([
      "src/components/BadPanel.tsx:1 imports '@/lib/engineRunner'",
      "src/hooks/useBad.ts:1 imports '../lib/engineSlots.ts'",
      "src/lib/badApi.ts:1 imports './calibration'",
      "src/app/badPage.tsx:1 imports '@/lib/engineTools/index'",
      "src/lib/badLazy.ts:1 imports './calibrationRecord'",
    ]);
  });
});

describe('(d) the engine modules import no node: module', () => {
  it('holds for the real sources', () => {
    expect(nodeImportsInEngine(ALL_MODULES)).toEqual([]);
  });

  it('sanity: the scanner sees node: imports in real test modules and imports in every engine module', () => {
    const fixtures = ALL_MODULES.find((m) => m.file === 'src/test/caseFixtures.ts') as SourceModule;
    expect(resolvedImports([fixtures]).map((i) => i.target)).toContainEqual({ kind: 'builtin', name: 'node:fs' });
    for (const name of ENGINE_MODULES) {
      const engine = ALL_MODULES.find((m) => m.file === `src/lib/${name}.ts`) as SourceModule;
      expect(scanImports(engine.file, engine.text).length).toBeGreaterThan(0);
    }
  });

  it('flags node: and bare builtin imports of in-memory engine modules only', () => {
    const fixtures = [
      mod('src/lib/engineClient.ts', "import { readFile } from 'node:fs/promises';"),
      mod('src/lib/engineRunner.ts', "import path from 'path';"),
      mod('src/lib/engineTools.ts', "export async function f() { return import('node:child_process'); }"),
      mod('src/lib/calibration.ts', "const fs = require('fs');"),
      mod('src/lib/engineCalibration.ts', "import { parse } from 'yaml';\n// import fs from 'node:fs';"),
      mod('src/lib/other.ts', "import { readFileSync } from 'node:fs';"),
      mod('src/lib/engineRunner.test.ts', "import { readFileSync } from 'node:fs';"),
    ];
    expect(nodeImportsInEngine(fixtures)).toEqual([
      "src/lib/engineClient.ts:1 imports 'node:fs/promises'",
      "src/lib/engineRunner.ts:1 imports 'path'",
      "src/lib/engineTools.ts:1 imports 'node:child_process'",
      "src/lib/calibration.ts:1 imports 'fs'",
    ]);
  });
});

describe('apps/web/package.json lists the SDK, zod and vite-node only under devDependencies (18.2)', () => {
  it('holds for the real package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(WEB_DIR, 'package.json'), 'utf8')) as PackageJson;
    expect(packageViolations(pkg)).toEqual([]);
    expect(Object.keys(pkg.devDependencies ?? {})).toEqual(expect.arrayContaining([...DEV_ONLY_PACKAGES]));
  });

  it('flags an in-memory package.json with zod in dependencies and the SDK missing', () => {
    const pkg: PackageJson = {
      dependencies: { next: '14.1.0', zod: '4.6.7' },
      devDependencies: { zod: '4.6.7', 'vite-node': '1.6.1' },
      peerDependencies: { 'vite-node': '1.6.1' },
    };
    expect(packageViolations(pkg)).toEqual([
      '@modelcontextprotocol/sdk is missing from devDependencies',
      'zod is listed in dependencies',
      'vite-node is listed in peerDependencies',
    ]);
  });
});
