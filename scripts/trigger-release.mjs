import { spawnSync } from 'node:child_process';

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit' });
  if (result.error) {
    console.error(`Не удалось запустить ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const tag = process.argv[2];
if (tag && !/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag)) {
  console.error('Укажите тег версии в формате v0.1.14.');
  process.exit(1);
}

const repository = 'BohdanKrakoviatskyi/BSC---BetterSoundCloud';
run('gh', ['auth', 'status', '--hostname', 'github.com']);

let selectedTag = tag;
if (!selectedTag) {
  const result = spawnSync('gh', ['release', 'list', '--repo', repository, '--limit', '100', '--json', 'tagName', '--jq', '.[].tagName'], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? result.stderr);
    process.exit(result.status ?? 1);
  }
  selectedTag = result.stdout.trim().split(/\r?\n/).filter(Boolean)[0];
}

if (!selectedTag) {
  console.error('Не найден GitHub Release. Передайте существующий тег: npm run release -- v0.1.14');
  process.exit(1);
}

console.log(`Запускаю сборку релиза ${selectedTag} для Linux, Windows и macOS…`);
const existingRun = spawnSync('gh', [
  'run', 'list',
  '--repo', repository,
  '--workflow', 'release.yml',
  '--branch', selectedTag,
  '--limit', '1',
  '--json', 'databaseId,headBranch',
], { encoding: 'utf8' });

if (existingRun.error || existingRun.status !== 0) {
  console.error(existingRun.error?.message ?? existingRun.stderr);
  process.exit(existingRun.status ?? 1);
}

let runs;
try {
  runs = JSON.parse(existingRun.stdout);
} catch {
  console.error('Не удалось прочитать ответ GitHub CLI при поиске прошлой сборки.');
  process.exit(1);
}

const matchingRun = runs.find((run) => run.headBranch === selectedTag);
if (matchingRun) {
  run('gh', ['run', 'rerun', String(matchingRun.databaseId), '--repo', repository]);
} else {
  run('gh', [
    'workflow', 'run', 'release.yml',
    '--repo', repository,
    '--ref', 'main',
    '-f', `tag=${selectedTag}`,
  ]);
}

console.log('Workflow отправлен. Ссылка на запуски: https://github.com/BohdanKrakoviatskyi/BSC---BetterSoundCloud/actions/workflows/release.yml');
