import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStatus } from './lib/status.mjs';

const portalDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(portalDir, '..');
const curatedPath = resolve(repoDir, 'docs/PROJECT_STATUS.json');
const planPath = resolve(repoDir, 'docs/WINTER_RELEASE_PLAN.md');
const progressPath = resolve(repoDir, 'REALM_PROGRESS.md');
const outputPath = resolve(portalDir, 'generated/status.json');

function gitValue(args) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
}

export async function build() {
  const [curatedText, plan, progress] = await Promise.all([
    readFile(curatedPath, 'utf8'),
    readFile(planPath, 'utf8'),
    readFile(progressPath, 'utf8')
  ]);
  const source = {
    commit: gitValue(['rev-parse', '--short=8', 'HEAD']),
    dirty: Boolean(gitValue(['status', '--porcelain'])),
    planUrl: 'https://github.com/hhGrotDev95/Realm/blob/main/docs/WINTER_RELEASE_PLAN.md',
    progressUrl: 'https://github.com/hhGrotDev95/Realm/blob/main/REALM_PROGRESS.md'
  };
  const status = buildStatus({
    curated: JSON.parse(curatedText),
    plan,
    progress,
    generatedAt: new Date().toISOString(),
    source
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  return outputPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then(path => console.log(`Built ${path}`)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
