// Web_Test_Hook (Requirement 15.3, design "Hooks", D21).
//
// When a .ts or .tsx file under apps/web/src/ is saved: runs the Vitest tests related to it.
// `--passWithNoTests` keeps a file with no related tests from failing the hook (C2).

import path from 'node:path';
import { REPO_ROOT, runSteps, savedPathMatching } from './hookLib.mjs';

const SAVED_PATH = /^apps\/web\/src\/.+\.tsx?$/;
const WEB_PREFIX = 'apps/web/';

async function main() {
  const repoPath = await savedPathMatching(SAVED_PATH);
  const webPath = repoPath.slice(WEB_PREFIX.length);

  await runSteps([
    {
      cmd: 'npx',
      args: ['vitest', 'related', '--run', '--passWithNoTests', webPath],
      cwd: path.join(REPO_ROOT, 'apps', 'web'),
    },
  ]);
}

main();
