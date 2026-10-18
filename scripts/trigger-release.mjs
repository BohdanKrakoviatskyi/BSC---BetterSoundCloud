import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

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
  console.error('Укажите тег версии в формате v0.3.4.');
  process.exit(1);
}

const repository = process.env.GITHUB_REPOSITORY || 'BohdanKrakoviatskyi/BSC---BetterSoundCloud';
run('gh', ['auth', 'status', '--hostname', 'github.com']);

// Get current git branch
const branchCmd = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
const currentBranch = branchCmd.stdout?.trim() || 'main';

let selectedTag = tag;
if (!selectedTag) {
  const remoteTags = spawnSync('gh', [
    'api',
    '--paginate',
    `repos/${repository}/git/matching-refs/tags/v`,
    '--jq',
    '.[].ref',
  ], {
    encoding: 'utf8',
  });
  if (remoteTags.error || remoteTags.status !== 0) {
    console.warn(`Внимание: не удалось получить удаленные теги (${remoteTags.stderr?.trim()}). Используем локальные.`);
  }

  const localTags = spawnSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' });
  if (localTags.error || localTags.status !== 0) {
    console.error(localTags.error?.message ?? localTags.stderr);
    process.exit(localTags.status ?? 1);
  }

  const parseVersion = (value) => {
    const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/);
    return match ? match.slice(1, 4).map(Number) : null;
  };

  const compareVersions = (left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  };

  let packageVersion;
  try {
    const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    packageVersion = packageJson.version;
  } catch {
    console.error('Не удалось прочитать version из package.json.');
    process.exit(1);
  }

  if (!packageVersion) {
    console.error('В package.json нет поля version.');
    process.exit(1);
  }

  const remoteLines = (remoteTags.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((ref) => ref.replace(/^refs\/tags\//, ''));

  const localLines = (localTags.stdout || '').split(/\r?\n/).filter(Boolean);

  const candidates = [
    packageVersion,
    ...remoteLines,
    ...localLines,
  ].map(parseVersion).filter(Boolean);

  const latestVersion = candidates.sort(compareVersions).at(-1);
  if (!latestVersion) {
    console.error('Не удалось определить текущую версию из package.json или Git-тегов.');
    process.exit(1);
  }

  latestVersion[2] += 1;
  selectedTag = `v${latestVersion.join('.')}`;
  console.log(`Новая версия: ${selectedTag} (увеличен patch)`);
}

console.log(`Запускаю сборку релиза ${selectedTag} для ${repository} (ветка ${currentBranch})…`);

const existingRun = spawnSync('gh', [
  'run', 'list',
  '--repo', repository,
  '--workflow', 'release.yml',
  '--branch', selectedTag,
  '--limit', '1',
  '--json', 'databaseId,headBranch',
], { encoding: 'utf8' });

let runs = [];
if (!existingRun.error && existingRun.status === 0) {
  try {
    runs = JSON.parse(existingRun.stdout);
  } catch {}
}

const matchingRun = runs.find((r) => r.headBranch === selectedTag);
if (matchingRun) {
  run('gh', ['run', 'rerun', String(matchingRun.databaseId), '--repo', repository]);
} else {
  run('gh', [
    'workflow', 'run', 'release.yml',
    '--repo', repository,
    '--ref', currentBranch,
    '-f', `tag=${selectedTag}`,
  ]);
}

console.log(`Workflow отправлен. Ссылка на запуски: https://github.com/${repository}/actions/workflows/release.yml`);
