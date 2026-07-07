#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const frontendDir = path.join(root, 'frontend');
const backendDir = path.join(root, 'backend');
const docsDir = path.join(root, 'docs');
const reportPath = path.join(docsDir, 'PROJECT_HEALTH.md');

function rel(file) { return path.relative(root, file).replace(/\\/g, '/'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function read(file) { return fs.readFileSync(file, 'utf8'); }
function exists(file) { return fs.existsSync(file); }

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return {
    command: [command, ...args].join(' '),
    cwd: rel(cwd),
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function detectPackageManager(dir) {
  if (exists(path.join(dir, 'package-lock.json'))) return ['npm', ['install', '--no-package-lock'], ['run', 'build']];
  if (exists(path.join(dir, 'yarn.lock'))) return ['yarn', ['install', '--frozen-lockfile'], ['build']];
  if (exists(path.join(dir, 'pnpm-lock.yaml'))) return ['pnpm', ['install', '--frozen-lockfile'], ['build']];
  return ['npm', ['install'], ['run', 'build']];
}

function directorySize(dir) {
  if (!exists(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) { files += 1; bytes += fs.statSync(full).size; }
    }
  }
  return { files, bytes };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function extractMounts() {
  const serverPath = path.join(backendDir, 'server.js');
  const source = read(serverPath);
  const requireMap = new Map();
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*require\(["'](.\/routes\/[^"']+)["']\)/g)) {
    requireMap.set(match[1], match[2]);
  }
  const mounts = [];
  for (const match of source.matchAll(/app\.use\(["']([^"']+)["']\s*,\s*(\w+)\s*\)/g)) {
    const routePath = requireMap.get(match[2]);
    if (routePath) mounts.push({ base: match[1], varName: match[2], file: path.join(backendDir, `${routePath.replace(/^\.\//, '')}.js`) });
  }
  return mounts.sort((a, b) => a.base.localeCompare(b.base));
}

function extractRoutes() {
  const mounts = extractMounts();
  const routes = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  const methodPattern = methods.join('|');
  for (const mount of mounts) {
    const source = read(mount.file);
    const regex = new RegExp(`router\\.(${methodPattern})\\(\\s*["']([^"']*)["']\\s*,([^;]+)`, 'g');
    for (const match of source.matchAll(regex)) {
      const handlers = match[3]
        .replace(/\n/g, ' ')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.replace(/\)+$/g, '').trim());
      const subPath = match[2] === '/' ? '' : match[2];
      routes.push({
        method: match[1].toUpperCase(),
        path: `${mount.base}${subPath}` || '/',
        file: rel(mount.file),
        auth: handlers.includes('protect') ? 'protected' : 'public',
        handlers,
      });
    }
  }
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function dependencyRows(pkg) {
  const deps = Object.keys(pkg.dependencies || {}).length;
  const devDeps = Object.keys(pkg.devDependencies || {}).length;
  return `| ${pkg.name || 'package'} | ${pkg.version || 'n/a'} | ${deps} | ${devDeps} |`;
}

const frontendPkg = readJson(path.join(frontendDir, 'package.json'));
const backendPkg = readJson(path.join(backendDir, 'package.json'));
const [pm, installArgs, buildArgs] = detectPackageManager(frontendDir);

const allowBuildFailure = process.env.PROJECT_HEALTH_ALLOW_BUILD_FAILURE === '1';
const install = run(pm, installArgs, frontendDir, { CI: 'true' });
if (!install.ok) {
  console.error(install.stdout);
  console.error(install.stderr);
  if (!allowBuildFailure) throw new Error(`Frontend dependency install failed: ${install.command}`);
}
const build = install.ok ? run(pm, buildArgs, frontendDir, { CI: 'true' }) : { command: [pm, ...buildArgs].join(' '), cwd: rel(frontendDir), status: null, ok: false, stdout: '', stderr: 'Skipped because dependency installation failed.' };
if (!build.ok) {
  console.error(build.stdout);
  console.error(build.stderr);
  if (!allowBuildFailure) throw new Error(`Frontend production build failed: ${build.command}`);
}

const buildDir = path.join(frontendDir, process.env.BUILD_PATH || 'build');
const buildStats = directorySize(buildDir);
const routes = extractRoutes();
const protectedCount = routes.filter((route) => route.auth === 'protected').length;
const publicCount = routes.filter((route) => route.auth === 'public').length;

const report = `# Project Health

This file is generated by \`scripts/generate-project-health.js\`. It intentionally omits timestamps so the automated workflow only commits when project-health state changes.

## Frontend production build

| Check | Result |
| --- | --- |
| Package | \`${frontendPkg.name}\` |
| Build command | \`(cd frontend && ${build.command})\` |
| Dependency install | ${install.ok ? '✅ Passed' : '⚠️ Failed in current environment'} |
| Production build | ${build.ok ? '✅ Passed' : '⚠️ Not completed in current environment'} |
| Output directory | \`${rel(buildDir)}\` |
| Output files | ${buildStats.files} |
| Output size | ${formatBytes(buildStats.bytes)} |

## Package inventory

| Package | Version | Runtime dependencies | Development dependencies |
| --- | ---: | ---: | ---: |
${[dependencyRows(frontendPkg), dependencyRows(backendPkg)].join('\n')}

## Backend API route structure

Routes are discovered from \`backend/server.js\` Express mounts and \`backend/routes/*.js\` router declarations.

| Method | Route | Auth | Source | Handlers |
| --- | --- | --- | --- | --- |
${routes.map((route) => `| ${route.method} | \`${route.path}\` | ${route.auth} | \`${route.file}\` | ${route.handlers.map((handler) => `\`${handler}\``).join(', ')} |`).join('\n')}

## Backend route summary

| Metric | Count |
| --- | ---: |
| Mounted API groups | ${extractMounts().length} |
| Total routes | ${routes.length} |
| Protected routes | ${protectedCount} |
| Public routes | ${publicCount} |

## Automation behavior

The GitHub Actions workflow runs this same health generator, verifies the frontend production build with the repository's package scripts, refreshes this report, and commits the report back with the repository GitHub Actions token only when \`docs/PROJECT_HEALTH.md\` changes.
`;

fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(reportPath, report);
console.log(`Wrote ${rel(reportPath)}`);
