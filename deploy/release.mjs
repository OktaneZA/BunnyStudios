#!/usr/bin/env node
/**
 * Release Storyboard Studio to the Synology NAS in one command.
 *
 *   npm run release                 test, build, ship, restart, verify
 *   npm run release -- --skip-tests
 *   npm run release -- --no-backup  skip the pre-release database dump
 *   npm run release -- --setup      one-time: install an SSH key and passwordless docker on the NAS
 *   npm run release -- --rollback <tag>   point the NAS back at an earlier image and restart
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
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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

// ---------- rollback / list ----------
function list() {
  console.log(ssh(`${DOCKER_ON_NAS} images ${IMAGE} --format '{{.Tag}}\t{{.CreatedAt}}\t{{.Size}}'`));
}
async function rollback(tag) {
  if (!tag) fail('usage: npm run release -- --rollback <tag>   (see --list)');
  log(`Pointing ${IMAGE}:latest at ${tag} on the NAS`);
  sshRun(`${DOCKER_ON_NAS} tag ${IMAGE}:${tag} ${IMAGE}:latest && cd ${NAS_DIR} && ${DOCKER_ON_NAS} compose -p ${composeProject()} up -d`);
  await verify(tag);
}

// ---------- verification ----------
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
        const local = readFileSync(join(root, 'apps/web/dist/index.html'), 'utf8').match(/\/assets\/index-[^"]+\.js/)?.[0];
        if (local && served !== local) fail(`health is on ${expectedTag} but the web bundle served is ${served}, expected ${local}`);
        log(`Live: build ${h.build}, bundle ${served}`);
        return;
      }
    } catch { /* not up yet */ }
    await sleep(3000);
  }
  fail(`Timed out. Last /health: ${last || 'no response'}. Check: ssh ${target} '${DOCKER_ON_NAS} logs --tail 100 storyboard-studio'`);
}

// ---------- the release ----------
async function release() {
  const sha = (() => { try { return out('git', ['rev-parse', '--short', 'HEAD']); } catch { return 'nogit'; } })();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/T(\d{4})\d{2}\.\d+Z/, '-$1');
  const tag = `${stamp}-${sha}`;
  log(`Release ${IMAGE}:${tag} -> ${target}:${NAS_DIR}`);

  if (!flag('--skip-tests')) {
    log('Tests');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    run(npm, ['test', '-w', '@storyboard/vocabularies'], { shell: process.platform === 'win32' });
    run(npm, ['test', '-w', '@storyboard/api'], { shell: process.platform === 'win32', stdio: ['inherit', 'ignore', 'inherit'] });
  }

  log('Building the image');
  run('docker', ['build', '--build-arg', `BUILD_TAG=${tag}`, '-t', `${IMAGE}:${tag}`, '-t', `${IMAGE}:latest`, '.']);
  // The verification step compares the served bundle to this local build output.
  run('docker', ['run', '--rm', '--entrypoint', 'sh', `${IMAGE}:${tag}`, '-c', 'cat /app/apps/web/dist/index.html'],
    { stdio: ['ignore', 'pipe', 'inherit'] });

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
