// Case_Check_Hook (Requirement 15.2, design "Hooks", D21, D22).
//
// When a file under cases/ is saved: validates every cases/*.yaml in a one-off physiology
// container (`docker compose run -T --rm --no-deps`, no port publishing, no image build), then
// runs the case-content Vitest checks. Every step runs even if an earlier one fails.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, requireImage, runSteps, savedPathMatching } from './hookLib.mjs';

const SAVED_PATH = /^cases\//;

async function main() {
  await savedPathMatching(SAVED_PATH);
  await requireImage();

  const caseFiles = readdirSync(path.join(REPO_ROOT, 'cases'))
    .filter((name) => name.endsWith('.yaml'))
    .sort();

  const steps = caseFiles.map((name) => ({
    cmd: 'docker',
    args: [
      'compose', 'run', '-T', '--rm', '--no-deps',
      '-v', `${REPO_ROOT}:/repo:ro`,
      '-w', '/repo',
      '-e', 'PYTHONDONTWRITEBYTECODE=1',
      'physiology',
      'python3', 'scripts/validate-case.py', `cases/${name}`,
    ],
    cwd: REPO_ROOT,
  }));
  steps.push({
    cmd: 'npx',
    args: ['vitest', '--run', 'src/lib/caseContent.test.ts'],
    cwd: path.join(REPO_ROOT, 'apps', 'web'),
  });

  await runSteps(steps);
}

main();
