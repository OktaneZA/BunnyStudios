#!/usr/bin/env node
/**
 * Release Storyboard Studio to the Synology NAS in one command.
 *
 *   npm version minor && git push --follow-tags     bump: 0.1.0 -> 0.2.0, commit, tag v0.2.0
 *   npm run release                 test, build, ship, restart, verify (image v<version>-<commit>)
 *   npm run release -- --skip-tests
 *   npm run release -- --skip-e2e   skip the browser tests against the built image
 *   npm run release -- --skip-apk   do not build the Fire tablet app
 *   npm run release -- --dry-run    test and build everything, ship nothing
 *   npm run release -- --no-backup  skip the pre-release database dump
 *   npm run release -- --allow-dirty  ship uncommitted work, tagged -dirty
 *   npm run release -- --setup      one-time: install an SSH key on the NAS
 *   npm run release -- --rollback <tag | vX.Y.Z>   point the NAS back at an earlier build
 *   npm run release -- --list       show the image tags present on the NAS
 *
 * Reads deploy/release.env (see release.env.example). Everything runs from this PC over SSH;
 * nothing is installed on the NAS beyond Container Manager. Steps:
 *
 *   1. npm test (vocabularies + api, against the local Postgres)
 *   2. docker build, tagged storyboard-studio:<date>-<git sha> and :latest
 *   3. backup.sh against the live database (migrations run on the next start, so this is
 *      the point to keep a copy of the pre-migration state)
 *   4. docker save | ssh nas sudo docker load   (streams; no tarball on disk)
 *   5. scp docker-compose.yml, .env, backup.sh, restore.sh to the NAS project folder
 *   6. ssh nas sudo docker compose up -d       (recreates only if the image changed)
 *   7. poll /health until it reports the new build tag, then check the web bundle matches
 *
 * Needs: docker, ssh, scp on this PC (Windows ships OpenSSH); SSH enabled on the NAS.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const synology = join(here, 'synology');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const IMAGE = 'storyboard-studio';

// ---------- configuration ----------
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8').split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
  );
}
const cfg = { ...loadEnvFile(join(here, 'release.env')), ...process.env };
const NAS_HOST = cfg.NAS_HOST || '192.168.1.73';
const NAS_USER = cfg.NAS_USER;
const NAS_SSH_PORT = cfg.NAS_SSH_PORT || '22';
const NAS_DIR = cfg.NAS_DIR || '/volume1/docker/storyboard';
const NAS_KEY = cfg.NAS_KEY || join(process.env.USERPROFILE || process.env.HOME || '', '.ssh', 'storyboard_nas');
const APP_URL = cfg.APP_URL || `http://${NAS_HOST}:3001`;
// Container Manager's engine. /usr/local/bin is not on PATH in a non-interactive SSH session,
// and a DSM user in the "docker" group can use it without sudo.
const DOCKER_ON_NAS = cfg.NAS_DOCKER || '/usr/local/bin/docker';

if (!NAS_USER) {
  fail('NAS_USER is not set. Copy deploy/release.env.example to deploy/release.env and fill it in.');
}
if (NAS_USER.includes('@')) {
  fail(`NAS_USER should be just the DSM user name (got "${NAS_USER}"). Put the host in NAS_HOST.`);
}

// ---------- helpers ----------
function log(msg) { console.log(`\x1b[36mrelease ›\x1b[0m ${msg}`); }
function fail(msg) { console.error(`\x1b[31mrelease ✗\x1b[0m ${msg}`); process.exit(1); }

/** Run a command, inherit output, throw on failure. */
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: root, shell: false, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} exited ${r.status}`);
}
/** Run a command and capture stdout. */
function out(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', cwd: root, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} exited ${r.status}: ${r.stderr}`);
  return r.stdout.trim();
}
const sshBase = ['-p', NAS_SSH_PORT, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
const sshKeyArgs = existsSync(NAS_KEY) ? ['-i', NAS_KEY] : [];
const target = `${NAS_USER}@${NAS_HOST}`;
function ssh(remote, opts = {}) { return out('ssh', [...sshBase, ...sshKeyArgs, target, remote], opts); }
function sshRun(remote) { run('ssh', [...sshBase, ...sshKeyArgs, target, remote]); }
/**
 * Copy one local file to a path on the NAS over plain SSH. DSM's sshd has no SFTP subsystem
 * unless SFTP is enabled in File Services, and modern scp needs it; streaming through stdin
 * works on any sshd.
 */
function upload(file, dest) {
  const r = spawnSync('ssh', [...sshBase, ...sshKeyArgs, target, `cat > '${dest}'`], { input: readFileSync(file), stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`upload of ${file} to ${dest} exited ${r.status}`);
}

/**
 * The Compose project name Container Manager gave the app when it was first created in the
 * DSM UI (it is not the folder name). Reusing it keeps the release inside that same project,
 * so Container Manager's Project page keeps showing and controlling it. Read from the
 * running container's labels; NAS_PROJECT in release.env overrides; folder name otherwise.
 */
function composeProject() {
  if (cfg.NAS_PROJECT) return cfg.NAS_PROJECT;
  try {
    const p = ssh(`${DOCKER_ON_NAS} inspect storyboard-studio --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true`);
    if (p) return p;
  } catch { /* no container yet */ }
  return NAS_DIR.split('/').filter(Boolean).pop();
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}
async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- one-time setup ----------
function setup() {
  log(`One-time setup for ${target}. You will be asked for the NAS password a few times.`);
  const interactive = { stdio: 'inherit' };
  if (!existsSync(NAS_KEY)) {
    log(`Generating an SSH key at ${NAS_KEY}`);
    mkdirSync(dirname(NAS_KEY), { recursive: true });
    run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'storyboard-release', '-f', NAS_KEY]);
  }
  const pub = readFileSync(`${NAS_KEY}.pub`, 'utf8').trim();
  log('Installing the public key on the NAS');
  run('ssh', ['-p', NAS_SSH_PORT, '-o', 'StrictHostKeyChecking=accept-new', target,
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qF '${pub}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys`], interactive);
  log('Checking whether this user can use Docker directly (DSM "docker" group)');
  let direct = true;
  try { ssh(`${DOCKER_ON_NAS} version --format '{{.Server.Version}}'`); }
  catch { direct = false; }
  if (!direct) {
    log('Not in the docker group. Allowing sudo for the docker binary only (no password). The name must match exactly as DSM knows it.');
    const dsmUser = ssh('id -un');
    run('ssh', ['-t', '-p', NAS_SSH_PORT, '-i', NAS_KEY, target,
      `echo "${dsmUser} ALL=(root) NOPASSWD: /usr/local/bin/docker" | sudo tee /etc/sudoers.d/storyboard-release >/dev/null && sudo chmod 440 /etc/sudoers.d/storyboard-release && echo sudoers-ok`], interactive);
    log('Add NAS_DOCKER="sudo /usr/local/bin/docker" to deploy/release.env, then re-run --setup to confirm.');
    return;
  }
  ssh(`mkdir -p ${NAS_DIR}/backups`);
  const v = ssh(`${DOCKER_ON_NAS} version --format '{{.Server.Version}}'`);
  log(`Docker on the NAS: ${v}. Setup complete. Run: npm run release`);
}

// ---------- version identity ----------
/**
 * One semantic version, from the root package.json, bumped with `npm version <bump>` (which
 * also commits and tags v<version>). The image tag pins the commit too, so `v0.2.0-59b7124`
 * is both a human version and an exact build. A dirty tree is refused unless --allow-dirty,
 * and then it is marked so it can never be mistaken for a release.
 */
function versionIdentity() {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const sha = (() => { try { return out('git', ['rev-parse', '--short', 'HEAD']); } catch { return 'nogit'; } })();
  const dirty = (() => { try { return out('git', ['status', '--porcelain']).length > 0; } catch { return false; } })();
  if (dirty && !flag('--allow-dirty')) {
    fail('Uncommitted changes. Commit them (or pass --allow-dirty to ship a build marked -dirty).');
  }
  try {
    const tagged = out('git', ['tag', '--points-at', 'HEAD']).split(/\r?\n/).includes(`v${version}`);
    if (!tagged) console.warn(`\x1b[33mrelease !\x1b[0m HEAD is not tagged v${version}. Usual flow: npm version <patch|minor|major> && git push --follow-tags && npm run release`);
  } catch { /* no git */ }
  return { version, sha, tag: `v${version}-${sha}${dirty ? '-dirty' : ''}` };
}

// ---------- rollback / list ----------
function nasTags() {
  return ssh(`${DOCKER_ON_NAS} images ${IMAGE} --format '{{.Tag}}\t{{.CreatedAt}}\t{{.Size}}'`)
    .split(/\r?\n/).filter(Boolean).map((l) => { const [tag, created, size] = l.split('\t'); return { tag, created, size }; });
}
function list() {
  for (const t of nasTags()) console.log(`${t.tag.padEnd(28)} ${t.created}  ${t.size}`);
}
async function rollback(want) {
  if (!want) fail('usage: npm run release -- --rollback <tag | vX.Y.Z>   (see --list)');
  const tags = nasTags().map((t) => t.tag).filter((t) => t !== 'latest');
  // Accept a full image tag, or just a version: the newest build of that version wins.
  const tag = tags.includes(want) ? want : tags.filter((t) => t.startsWith(`${want}-`)).sort().reverse()[0];
  if (!tag) fail(`No image for "${want}" on the NAS. Available: ${tags.join(', ') || 'none'}`);
  log(`Pointing ${IMAGE}:latest at ${tag} on the NAS`);
  sshRun(`${DOCKER_ON_NAS} tag ${IMAGE}:${tag} ${IMAGE}:latest && cd ${NAS_DIR} && ${DOCKER_ON_NAS} compose -p ${composeProject()} up -d`);
  await verify(tag);
}

// ---------- Android app ----------
const apkOut = join(root, 'apps/web/public/downloads/bunny-studios.apk');
/**
 * Builds the Fire tablet app (apps/android) and places the APK where the web build will serve
 * it at /downloads/bunny-studios.apk. Needs JAVA_HOME and ANDROID_HOME (release.env). The
 * APK's version comes from package.json, so it always matches the server it ships with.
 * Without a toolchain the step is skipped and any stale APK is removed, never shipped.
 */
function buildApk(version) {
  if (flag('--skip-apk') || !cfg.JAVA_HOME || !cfg.ANDROID_HOME) {
    if (existsSync(apkOut)) rmSync(apkOut);
    log(flag('--skip-apk') ? 'Skipping the tablet app (--skip-apk)' : 'No JAVA_HOME/ANDROID_HOME in release.env; tablet app not built');
    return null;
  }
  log(`Building the tablet app v${version}`);
  const android = join(root, 'apps/android');
  const gradlew = join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const serverUrl = cfg.APK_SERVER_URL || APP_URL;
  run(gradlew, ['assembleRelease', '-q', '--warning-mode', 'none', `-PserverUrl=${serverUrl}`], {
    cwd: android, shell: process.platform === 'win32',
    env: { ...process.env, JAVA_HOME: cfg.JAVA_HOME, ANDROID_HOME: cfg.ANDROID_HOME,
      ...(cfg.ANDROID_KEYSTORE_PATH ? { ANDROID_KEYSTORE_PATH: cfg.ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD: cfg.ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS: cfg.ANDROID_KEY_ALIAS || 'bunny' } : {}) },
  });
  const built = join(android, 'app/build/outputs/apk/release/app-release.apk');
  if (!existsSync(built)) fail('gradle finished but no APK was produced');
  if (!cfg.ANDROID_KEYSTORE_PATH) console.warn('\x1b[33mrelease !\x1b[0m APK is debug-signed (no ANDROID_KEYSTORE_PATH); a later signed build cannot update it in place.');
  mkdirSync(dirname(apkOut), { recursive: true });
  copyFileSync(built, apkOut);
  log(`Tablet app ready (${(readFileSync(apkOut).length / 1024 / 1024).toFixed(1)} MB), server ${serverUrl}`);
  return apkOut;
}

// ---------- browser tests against the built image ----------
function lanAddress() {
  if (cfg.E2E_HOST) return cfg.E2E_HOST;
  // Prefer a physical adapter on a home subnet over Hyper-V / WSL / Docker virtual ones. Any
  // non-loopback address is an insecure origin, which is the point, but the real LAN address
  // is what the tablet uses and what a person will paste into a browser to look.
  const candidates = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254')) continue;
      const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|Loopback/i.test(name);
      const home = /^(192\.168\.|10\.)/.test(i.address);
      candidates.push({ address: i.address, score: (home ? 2 : 0) + (virtual ? 0 : 1) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? '127.0.0.1';
}
/**
 * Starts the freshly built image on this PC against a scratch database, reached through the
 * PC's LAN IP so the browser treats the origin as insecure exactly like the NAS, and runs
 * the Playwright suite in apps/web/e2e. Any failure stops the release before anything ships.
 */
async function e2e(tag) {
  if (flag('--skip-e2e')) { log('Skipping browser tests (--skip-e2e)'); return; }
  const dbContainer = cfg.E2E_DB_CONTAINER || 'storyboard-db';
  const dbName = 'storyboard_e2e';
  const port = cfg.E2E_PORT || '3999';
  const host = lanAddress();
  const base = `http://${host}:${port}`;
  const name = 'storyboard-e2e';
  const psql = (sql) => run('docker', ['exec', dbContainer, 'psql', '-U', 'storyboard', '-d', 'storyboard', '-q', '-c', sql], { stdio: ['ignore', 'ignore', 'inherit'] });
  const hash = (pw) => out('node', ['--experimental-strip-types', 'apps/api/src/db/hash-password.ts', pw]);
  const adult = { email: 'adult@example.com', password: 'e2e-adult-password' };
  const teen = { email: 'teen@example.com', password: 'e2e-teen-password' };

  log(`Browser tests: ${IMAGE}:${tag} at ${base} (scratch database ${dbName} on ${dbContainer})`);
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  psql(`DROP DATABASE IF EXISTS ${dbName}`);
  psql(`CREATE DATABASE ${dbName} OWNER storyboard`);
  try {
    run('docker', ['run', '-d', '--name', name, '-p', `${port}:3001`,
      '-e', `DATABASE_URL=postgres://storyboard:localdev@host.docker.internal:5433/${dbName}`,
      '-e', `MIGRATION_DATABASE_URL=postgres://storyboard:localdev@host.docker.internal:5433/${dbName}`,
      '-e', 'JWT_SECRET=e2e-only-secret-that-is-at-least-32-characters-long',
      '-e', `AUTH_ADULT_EMAIL=${adult.email}`, '-e', `AUTH_ADULT_PASSWORD_HASH=${hash(adult.password)}`, '-e', 'AUTH_ADULT_DISPLAY_NAME=Test adult',
      '-e', `AUTH_TEEN_EMAIL=${teen.email}`, '-e', `AUTH_TEEN_PASSWORD_HASH=${hash(teen.password)}`, '-e', 'AUTH_TEEN_DISPLAY_NAME=Test teen',
      '-e', 'ANTHROPIC_API_KEY=',
      `${IMAGE}:${tag}`], { stdio: ['ignore', 'ignore', 'inherit'] });
    const deadline = Date.now() + 60_000;
    let up = false;
    while (Date.now() < deadline && !up) {
      try { up = (await fetchJson(`${base}/health`)).status === 'ok'; } catch { await sleep(1000); }
    }
    if (!up) { spawnSync('docker', ['logs', '--tail', '30', name], { stdio: 'inherit' }); fail(`${base}/health never answered`); }
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    run(npx, ['playwright', 'test', '-c', 'apps/web/e2e'], {
      shell: process.platform === 'win32',
      env: { ...process.env, E2E_BASE_URL: base, E2E_ADULT_EMAIL: adult.email, E2E_ADULT_PASSWORD: adult.password, E2E_TEEN_EMAIL: teen.email, E2E_TEEN_PASSWORD: teen.password },
    });
    log('Browser tests passed');
  } finally {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    try { psql(`DROP DATABASE IF EXISTS ${dbName}`); } catch { /* best effort */ }
  }
}

// ---------- verification ----------
/** Bundle filename inside the image just built; null for a rollback, where only the tag is checked. */
let expectedBundle = null;
async function verify(expectedTag) {
  log(`Waiting for ${APP_URL}/health to report build ${expectedTag}`);
  const deadline = Date.now() + 120_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const h = await fetchJson(`${APP_URL}/health`);
      last = JSON.stringify(h);
      if (h.status === 'ok' && h.build === expectedTag) {
        const html = await fetchText(`${APP_URL}/`);
        const served = html.match(/\/assets\/index-[^"]+\.js/)?.[0];
        if (expectedBundle && served !== expectedBundle) fail(`health is on ${expectedTag} but the web bundle served is ${served}, expected ${expectedBundle}`);
        log(`Live: v${h.version} (${h.commit}), build ${h.build}, bundle ${served}`);
        return;
      }
    } catch { /* not up yet */ }
    await sleep(3000);
  }
  fail(`Timed out. Last /health: ${last || 'no response'}. Check: ssh ${target} '${DOCKER_ON_NAS} logs --tail 100 storyboard-studio'`);
}

// ---------- the release ----------
async function release() {
  const { version, sha, tag } = versionIdentity();
  log(`Release v${version} (${IMAGE}:${tag}) -> ${target}:${NAS_DIR}`);

  if (!flag('--skip-tests')) {
    log('Tests');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    run(npm, ['test', '-w', '@storyboard/vocabularies'], { shell: process.platform === 'win32' });
    run(npm, ['test', '-w', '@storyboard/models'], { shell: process.platform === 'win32' });
    run(npm, ['test', '-w', '@storyboard/compiler'], { shell: process.platform === 'win32' });
    run(npm, ['test', '-w', '@storyboard/api'], { shell: process.platform === 'win32', stdio: ['inherit', 'ignore', 'inherit'] });
  }

  buildApk(version);

  log('Building the image');
  run('docker', ['build',
    '--build-arg', `BUILD_TAG=${tag}`, '--build-arg', `APP_VERSION=${version}`, '--build-arg', `GIT_COMMIT=${sha}`,
    '-t', `${IMAGE}:${tag}`, '-t', `${IMAGE}:latest`, '.']);
  // The verification step compares the served bundle to the one inside this exact image
  // (never to a local apps/web/dist, which the release does not rebuild and may be stale).
  expectedBundle = out('docker', ['run', '--rm', '--entrypoint', 'sh', `${IMAGE}:${tag}`, '-c', 'cat /app/apps/web/dist/index.html'])
    .match(/\/assets\/index-[^"]+\.js/)?.[0] ?? null;
  if (!expectedBundle) fail('the built image has no web bundle in apps/web/dist/index.html');

  await e2e(tag);
  if (flag('--dry-run')) { log(`Dry run: ${IMAGE}:${tag} built and tested; nothing shipped.`); return; }

  log('Checking SSH access');
  ssh('true');

  if (!flag('--no-backup')) {
    log('Backing up the live database before the release');
    run('sh', [join(synology, 'backup.sh'), join(synology, 'backups')]);
  }

  log('Streaming the image to the NAS (this is the slow step)');
  await new Promise((resolveP, reject) => {
    const save = spawn('docker', ['save', `${IMAGE}:${tag}`, `${IMAGE}:latest`], { stdio: ['ignore', 'pipe', 'inherit'] });
    const load = spawn('ssh', [...sshBase, ...sshKeyArgs, target, `${DOCKER_ON_NAS} load`], { stdio: ['pipe', 'inherit', 'inherit'] });
    save.stdout.pipe(load.stdin);
    load.on('exit', (code) => (code === 0 ? resolveP() : reject(new Error(`docker load on the NAS exited ${code}`))));
    save.on('exit', (code) => { if (code !== 0) reject(new Error(`docker save exited ${code}`)); });
  });

  log('Uploading compose file, env and scripts');
  sshRun(`mkdir -p ${NAS_DIR}/backups`);
  for (const f of ['.env', 'backup.sh', 'restore.sh']) upload(join(synology, f), `${NAS_DIR}/${f}`);
  // Container Manager saves a project's file as compose.yaml, and `docker compose` prefers
  // that name over docker-compose.yml when both exist, so the upload must replace it.
  upload(join(synology, 'docker-compose.yml'), `${NAS_DIR}/compose.yaml`);

  log('Restarting the container');
  sshRun(`cd ${NAS_DIR} && ${DOCKER_ON_NAS} compose -p ${composeProject()} up -d --remove-orphans`);

  await verify(tag);

  log('Pruning images older than the newest 5 on the NAS');
  ssh(`${DOCKER_ON_NAS} images ${IMAGE} --format '{{.Tag}}' | grep -v latest | sort -r | tail -n +6 | xargs -r -I{} ${DOCKER_ON_NAS} rmi ${IMAGE}:{} >/dev/null 2>&1 || true`);
  // Each release untags the previous :latest; remove those dangling layers, but only ours.
  ssh(`${DOCKER_ON_NAS} image prune -f --filter label=app=${IMAGE} >/dev/null 2>&1 || true`);
  log(`Done. Rollback with: npm run release -- --rollback <tag>   (npm run release -- --list)`);
}

try {
  if (flag('--setup')) setup();
  else if (flag('--list')) list();
  else if (flag('--rollback')) await rollback(args[args.indexOf('--rollback') + 1]);
  else await release();
} catch (err) {
  fail(err.message);
}
