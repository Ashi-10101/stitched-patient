// Python_Test_Hook (Requirement 15.4, design "Hooks", F2, F3, D21, D22).
//
// When a .py file under services/physiology/ is saved: runs the fast physiology suite on the
// current source in a one-off container (`docker compose run -T --rm --no-deps`, no port
// publishing, no image build). The source is mounted read-only at /src and `-w /src` puts it
// first on sys.path; no bytecode, pytest cache or Hypothesis files are written to the checkout.

import { REPO_ROOT, requireImage, runSteps, savedPathMatching } from './hookLib.mjs';

const SAVED_PATH = /^services\/physiology\/.+\.py$/;

async function main() {
  await savedPathMatching(SAVED_PATH);
  await requireImage();

  await runSteps([
    {
      cmd: 'docker',
      args: [
        'compose', 'run', '-T', '--rm', '--no-deps',
        '-v', `${REPO_ROOT}/services/physiology:/src:ro`,
        '-w', '/src',
        '-e', 'PYTHONDONTWRITEBYTECODE=1',
        '-e', 'HYPOTHESIS_STORAGE_DIRECTORY=/tmp/hyp',
        'physiology',
        'python3', '-m', 'pytest', '-p', 'no:cacheprovider', '-q', '-m', 'not pulse',
      ],
      cwd: REPO_ROOT,
    },
  ]);
}

main();
