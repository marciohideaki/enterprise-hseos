'use strict';
/**
 * W5-CO1 — coordination service: registration, typed reservations, overlap detection, version-reservation check and
 * inbox delivery. Works on its own store; adapters (axon, ...) are optional mirrors and can only degrade with a warning.
 *
 * Inbox entry contract (`coordination-inbox/v1`): `{kind:'coordination', schema, recipient, reason, reason_code,
 * created_at, event}`. It deliberately has no `session`/`agent` fields, so a liveness wake reader never takes it for a
 * wake request. Files are written atomically (tmp + rename), mode 0600, under a 0700 directory.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('./config');
const { openStore } = require('./store');
const paths = require('./paths');

const INBOX_RELATIVE_PATH = path.join('.hseos', 'state', 'liveness', 'inbox');
const INBOX_SCHEMA = 'coordination-inbox/v1';
const MAX_INBOX_BYTES = 65_536;
const MAX_DIFF_FILES = 2000;
const NPM_CACHE_TTL_MS = 60_000;
const NPM_TIMEOUT_MS = 8000;

/** `git@host:org/repo.git`, `https://user@host/org/repo.git` -> `host/org/repo` (lowercase). */
function normalizeRepo(remote) {
  if (!remote) return null;
  let value = String(remote)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  value = value
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(/^([^/:]+):(?!\d+\/)/, '$1/');
  return paths.sanitizeText(value.toLowerCase(), 200) || null;
}

/**
 * Parses and canonicalises a reservation key. `contracts` and `@org/contracts` are different npm packages and stay
 * different keys (that is npm semantics, not a missed conflict); only case and `+build` metadata are folded.
 */
function parseKey(key) {
  if (typeof key !== 'string' || key.length > 400) return null;
  let match = /^path:([^:]+):(.+)$/.exec(key);
  if (match) {
    const repo = normalizeRepo(match[1]);
    const glob = paths.normalizePathExpr(match[2]);
    return repo && glob ? { kind: 'path', parts: [repo, glob], key: `path:${repo}:${glob}` } : null;
  }
  match = /^version:(.+)@([^@]+)$/.exec(key);
  if (match) {
    const pkg = match[1].toLowerCase();
    const version = paths.canonicalVersion(match[2]);
    return paths.validPackage(pkg) && version ? { kind: 'version', parts: [pkg, version], key: `version:${pkg}@${version}` } : null;
  }
  match = /^name:(.+)$/.exec(key);
  if (match) {
    const pkg = match[1].toLowerCase();
    return paths.validPackage(pkg) ? { kind: 'name', parts: [pkg], key: `name:${pkg}` } : null;
  }
  return null;
}

function defaultGit(cwd, args) {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8', timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** `npm view` with the package after `--` (a name can never be read as an option); short disk cache; failure throws. */
function createNpmRegistry(cachePath, { spawn = spawnSync, now = Date.now } = {}) {
  const readCache = () => {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch {
      return {};
    }
  };
  return (pkg) => {
    const cached = readCache()[pkg];
    if (cached && now() - cached.at < NPM_CACHE_TTL_MS) return cached.versions;
    const result = spawn('npm', ['view', '--json', '--', pkg, 'versions'], { encoding: 'utf8', timeout: NPM_TIMEOUT_MS });
    if (result.status !== 0) {
      if (/E404|404 Not Found/.test(`${result.stderr}`)) return [];
      throw new Error(result.error ? result.error.message : `npm view exited ${result.status}`);
    }
    const parsed = JSON.parse(result.stdout || '[]');
    const versions = Array.isArray(parsed) ? parsed : [parsed];
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(cachePath, JSON.stringify({ ...readCache(), [pkg]: { at: now(), versions } }), { mode: 0o600 });
    } catch {
      /* cache is an optimisation */
    }
    return versions;
  };
}

class Coordination {
  constructor({ directory, config, store, registry, git = defaultGit, adapters = [], now = Date.now }) {
    this.directory = directory;
    this.config = config;
    this.store = store;
    this.git = git;
    this.registry = registry || createNpmRegistry(path.join(path.dirname(config.store.path), 'npm-versions-cache.json'));
    this.adapters = adapters.filter((adapter) => config.store.adapters.includes(adapter.name));
    this.now = now;
    this.warnings = [];
  }

  close() {
    this.store.close();
  }

  warn(message) {
    const text = paths.sanitizeText(message, 300);
    if (!this.warnings.includes(text)) this.warnings.push(text);
  }

  /** Warns once per session (recorded in the store), so a recurring condition does not repeat on every prompt. */
  warnOnce(activity, code, message) {
    const first =
      this.store.persistsEvents === false ||
      this.store.recordEvent(
        'activity_warning',
        code,
        activity.id,
        { message: paths.sanitizeText(message, 200) },
        `warn:${activity.id}:${code}`,
      );
    if (first) this.warn(message);
  }

  /** A session that is unknown or silent for longer than the TTL gets an explicit notice, never a silent empty result. */
  noticeSession(session) {
    if (!this.store.get) return;
    if (!this.store.get(session)) this.warn(`session ${session} is not registered; register it first`);
    else if (this.store.listStale().some((activity) => activity.id === session)) {
      this.warn(`session ${session} is stale (no heartbeat for more than reservations.ttl_s); run heartbeat to resume`);
    }
  }

  out(result) {
    return { ...result, warnings: [...this.warnings] };
  }

  refuse(reasonCode, extra = {}) {
    return this.out({ ok: false, reason_code: reasonCode, ...extra });
  }

  mirror(event) {
    for (const adapter of this.adapters) {
      try {
        adapter.mirror(event);
      } catch (error) {
        this.warn(`adapter ${adapter.name} failed: ${error.message.split('\n')[0]}`);
      }
    }
  }

  /** A worktree recorded by another session is only used as cwd or write root when it is a worktree of the same repo. */
  trustedWorktree(activity) {
    const worktree = activity && activity.worktree;
    if (!worktree || !path.isAbsolute(worktree)) return null;
    try {
      if (!fs.lstatSync(worktree).isDirectory() || !fs.existsSync(path.join(worktree, '.git'))) return null;
    } catch {
      return null;
    }
    if (activity.repo && normalizeRepo(this.git(worktree, ['remote', 'get-url', 'origin'])) !== activity.repo) return null;
    return worktree;
  }

  inboxDirFor(activity) {
    const worktree = this.trustedWorktree(activity);
    return worktree ? path.join(worktree, INBOX_RELATIVE_PATH) : path.join(path.dirname(this.config.store.path), 'inbox');
  }

  notify(activity, { type, reasonCode, reason, details }) {
    if (!activity) return;
    try {
      const dir = this.inboxDirFor(activity);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const entry = {
        kind: 'coordination',
        schema: INBOX_SCHEMA,
        recipient: activity.id,
        reason: paths.sanitizeText(reason, 400),
        reason_code: reasonCode,
        created_at: new Date(this.now()).toISOString(),
        event: { type, ...details },
      };
      const name = `${activity.id}-coordination-${this.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
      const temporary = path.join(dir, `.${name}.tmp`);
      fs.writeFileSync(temporary, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, path.join(dir, name));
      this.mirror(entry);
    } catch (error) {
      this.warn(`inbox delivery failed for ${activity.id}: ${error.message.split('\n')[0]}`);
    }
  }

  /** Drains (or peeks at) the coordination entries addressed to `session`; symlinks and oversized files are ignored. */
  readInbox(session, { consume = true } = {}) {
    if (!paths.validIdent(session)) return [];
    const activity = this.store.get ? this.store.get(session) : null;
    const dir = this.inboxDirFor(activity || { id: session });
    const pattern = new RegExp(String.raw`^${session.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}-coordination-\d+-[\da-z]+\.json$`);
    const entries = [];
    let names = [];
    try {
      names = fs
        .readdirSync(dir)
        .filter((name) => pattern.test(name))
        .sort();
    } catch {
      return entries;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      let source = file;
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > MAX_INBOX_BYTES) continue;
        if (consume) {
          source = `${file}.claimed-${process.pid}`;
          fs.renameSync(file, source); // atomic claim: a concurrent reader gets ENOENT and skips the entry
        }
        const entry = JSON.parse(fs.readFileSync(source, 'utf8'));
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) this.warn(`inbox entry ${name} is not an object; ignored`);
        else if (entry.kind === 'coordination' && entry.recipient === session) entries.push(entry);
      } catch (error) {
        if (error.code !== 'ENOENT') this.warn(`unreadable inbox entry ${name}`);
      } finally {
        if (consume && source !== file) fs.rmSync(source, { force: true });
      }
    }
    return entries;
  }

  badSession(session) {
    return paths.validIdent(session) ? null : this.refuse('invalid_session');
  }

  validatePaths(list) {
    const normalized = [];
    for (const raw of list || []) {
      const value = paths.normalizePathExpr(raw);
      if (!value) return { error: paths.sanitizeText(raw, 80) };
      normalized.push(value);
    }
    return { normalized };
  }

  register(input) {
    const invalid = this.badSession(input.session);
    if (invalid) return invalid;
    if (!paths.validTool(input.tool)) return this.refuse('invalid_tool');
    const declared = this.validatePaths(input.paths);
    if (declared.error !== undefined || declared.normalized.length > paths.MAX_PATHS)
      return this.refuse('invalid_path', { path: declared.error });
    const worktree = input.worktree ? path.resolve(input.worktree) : this.directory;
    const probe = (args) => (fs.existsSync(worktree) ? this.git(worktree, args) : null);
    const activity = this.store.register({
      id: input.session,
      tool: input.tool,
      host: paths.sanitizeText(input.host || os.hostname(), 100),
      repo: normalizeRepo(input.repo || probe(['remote', 'get-url', 'origin'])),
      worktree,
      branch: paths.sanitizeText(input.branch || probe(['rev-parse', '--abbrev-ref', 'HEAD']) || '', 200) || null,
      base: input.base ? paths.sanitizeText(input.base, 200) : null,
      intent: input.intent ? paths.sanitizeText(input.intent, 500) : null,
      paths_declared: declared.normalized,
      identifiers_declared: (input.identifiers || []).map((value) => paths.sanitizeText(value, 120)),
    });
    if (activity && activity.id) this.mirror({ type: 'activity_registered', session: activity.id });
    const overlaps = activity && activity.id ? this.overlaps(activity.id).overlaps : [];
    return this.out({ ok: Boolean(activity), activity, overlaps });
  }

  heartbeat(session) {
    const invalid = this.badSession(session);
    if (invalid) return invalid;
    return this.out({ ...this.store.heartbeat(session, this.config.reservations.ttl_s), overdue: this.store.sweepOverdue() });
  }

  declare(session, input) {
    const invalid = this.badSession(session);
    if (invalid) return invalid;
    const declared = this.validatePaths(input.paths);
    if (declared.error !== undefined) return this.refuse('invalid_path', { path: declared.error });
    const known = this.store.get ? this.store.get(session) : null;
    if (known && new Set([...known.paths_declared, ...declared.normalized]).size > paths.MAX_PATHS) return this.refuse('too_many_paths');
    const result = this.store.declare(session, {
      paths: declared.normalized,
      identifiers: (input.identifiers || []).map((value) => paths.sanitizeText(value, 120)),
      intent: input.intent ? paths.sanitizeText(input.intent, 500) : undefined,
    });
    if (result.ok) this.mirror({ type: 'activity_declared', session, paths: declared.normalized, identifiers: input.identifiers || [] });
    return this.out({ ...result, overlaps: result.ok ? this.overlaps(session).overlaps : [] });
  }

  end(session) {
    return this.badSession(session) || this.out(this.store.end(session));
  }

  list(session) {
    this.store.sweepOverdue();
    if (session) this.noticeSession(session);
    return this.out({ activities: this.store.listActive(), stale: this.store.listStale(), claims: this.store.listClaims() });
  }

  diffFiles(activity) {
    if (!this.config.overlap.include_git_diff) return [];
    const worktree = this.trustedWorktree(activity);
    if (!worktree) {
      if (activity.worktree) {
        this.warnOnce(
          activity,
          'diff_worktree_untrusted',
          `git diff ignored for ${activity.id}: worktree missing, not a git worktree, or origin differs from the recorded repo`,
        );
      }
      return [];
    }
    const base = activity.base || 'origin/HEAD';
    if (!paths.validRef(base)) {
      this.warnOnce(activity, 'diff_invalid_base', `git diff skipped for ${activity.id}: invalid base ref`);
      return [];
    }
    const output = this.git(worktree, ['diff', '--name-only', `${base}...HEAD`, '--']);
    if (output === null) {
      this.warnOnce(activity, 'diff_failed', `git diff failed for ${activity.id} against ${base}; diff overlap not checked`);
      return [];
    }
    return output
      .split('\n')
      .slice(0, MAX_DIFF_FILES)
      .map((file) => paths.normalizePathExpr(file))
      .filter(Boolean);
  }

  pathItems(activity) {
    return [
      ...activity.paths_declared.map((value) => ({ value, from: 'declared' })),
      ...this.diffFiles(activity).map((value) => ({ value, from: 'diff' })),
    ];
  }

  /** Paths of other active activities of the same repo that overlap with `session`, by severity. */
  overlaps(session) {
    const activities = this.store.listActive();
    const me = activities.find((activity) => activity.id === session);
    if (!me) return this.out({ overlaps: [], reason_code: 'unknown_activity' });
    const mine = this.pathItems(me);
    const found = [];
    const add = (other, file, severity) => {
      if (!found.some((item) => item.with === other.id && item.file === file && item.severity === severity)) {
        found.push({ with: other.id, tool: other.tool, branch: other.branch, file, severity });
      }
    };
    for (const other of activities) {
      if (other.id === me.id || !me.repo || other.repo !== me.repo) continue;
      const theirs = this.pathItems(other);
      const literals = new Map(theirs.filter((item) => paths.isLiteral(item.value)).map((item) => [item.value, item]));
      const severityOf = (file, a, b) =>
        this.config.hot_files.some((hot) => paths.matchGlob(hot, file))
          ? 'hot_file'
          : a.from === 'declared' && b.from === 'declared'
            ? 'declared'
            : 'diff';
      for (const a of mine) {
        if (paths.isLiteral(a.value)) {
          const hit = literals.get(a.value);
          if (hit) add(other, a.value, severityOf(a.value, a, hit));
          for (const b of theirs)
            if (!paths.isLiteral(b.value) && paths.matchGlob(b.value, a.value)) add(other, a.value, severityOf(a.value, a, b));
          continue;
        }
        for (const b of theirs) {
          if (!paths.globsOverlap(a.value, b.value)) continue;
          if (paths.isLiteral(b.value)) add(other, b.value, severityOf(b.value, a, b));
          else add(other, a.value, 'declared'); // glob against glob: potential overlap, never hot_file
        }
      }
    }
    for (const item of found) {
      const pair = [me.id, item.with].sort().join('|');
      const recorded = this.store.recordEvent(
        'overlap_detected',
        item.severity,
        me.id,
        { with: item.with, file: item.file, severity: item.severity },
        `overlap:${pair}:${item.severity}:${item.file}`,
      );
      if (recorded) {
        const other = activities.find((activity) => activity.id === item.with);
        const text = `overlap (${item.severity}) on ${item.file} between ${me.tool}:${me.id} and ${other.tool}:${other.id}`;
        this.notify(other, {
          type: 'overlap_detected',
          reasonCode: item.severity,
          reason: text,
          details: { with: me.id, tool: me.tool, file: item.file, severity: item.severity },
        });
      }
    }
    return this.out({ overlaps: found });
  }

  /** Conflicts of a version against published versions, git tags and the repo candidate.json (never the claims). */
  versionConflicts(pkg, version, activity) {
    const conflicts = [];
    try {
      const published = this.registry(pkg);
      if (published.includes(version)) conflicts.push({ source: 'published', detail: `${pkg}@${version} is already published` });
    } catch (error) {
      this.warn(`registry unavailable for ${pkg} (${error.message.split('\n')[0]}); published versions not checked`);
    }
    const worktree = this.trustedWorktree(activity);
    if (worktree) {
      const tags = this.git(worktree, ['tag', '--list']);
      const short = pkg.replace(/^@[^/]+\//, '');
      const names = new Set([`v${version}`, version, `${pkg}@${version}`, `${short}@${version}`, `${short}-v${version}`]);
      const hit = (tags ? tags.split('\n') : []).find((tag) => names.has(tag.trim()));
      if (hit) conflicts.push({ source: 'tag', detail: `git tag ${paths.sanitizeText(hit, 100)} exists` });
      const candidate = this.readCandidate(worktree);
      if (candidate && JSON.stringify(candidate).includes(`"${version}"`)) {
        const named = candidate.name || candidate.package;
        if (!named || named === pkg || named.endsWith(`/${pkg}`) || pkg.endsWith(named))
          conflicts.push({ source: 'candidate', detail: `candidate.json already references ${version}` });
      }
    }
    return conflicts;
  }

  readCandidate(worktree) {
    try {
      return JSON.parse(fs.readFileSync(path.join(worktree, 'candidate.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Held `path:` claims of the same repo whose glob overlaps the requested one (different keys, same files). */
  overlappingPathClaims(parsed, session) {
    return this.store
      .listClaims()
      .filter((claim) => claim.kind === 'path' && claim.owner !== session && claim.key !== parsed.key)
      .filter((claim) => {
        const other = parseKey(claim.key);
        return other && other.parts[0] === parsed.parts[0] && paths.globsOverlap(other.parts[1], parsed.parts[1]);
      })
      .map((claim) => ({
        source: 'claim',
        held_by: claim.owner,
        fence: claim.fence,
        key: claim.key,
        overlap: true,
        overdue: claim.overdue,
      }));
  }

  reserve(session, key) {
    const invalid = this.badSession(session);
    if (invalid) return invalid;
    const parsed = parseKey(key);
    if (!parsed) return this.refuse('invalid_key', { key: paths.sanitizeText(key, 120) });
    if (!this.config.reservations.kinds.includes(parsed.kind)) return this.refuse('kind_not_enabled', { kind: parsed.kind });
    const me = this.store.get ? this.store.get(session) : null;
    this.store.sweepOverdue();
    const conflicts = [];
    if (parsed.kind === 'version') {
      for (const conflict of this.versionConflicts(parsed.parts[0], parsed.parts[1], me)) {
        conflicts.push(conflict);
        this.store.recordEvent(
          'reservation_conflict',
          `${conflict.source}_version`,
          session,
          { key: parsed.key, source: conflict.source, detail: conflict.detail },
          `conflict:${parsed.key}:${session}:${conflict.source}`,
        );
      }
      if (conflicts.length > 0 && this.config.enforce.publish_guard) return this.refuse('version_unavailable', { conflicts });
    }
    const result = this.store.reserve({ owner: session, kind: parsed.kind, key: parsed.key, ttlS: this.config.reservations.ttl_s });
    const holders = [];
    if (!result.ok && result.conflict) {
      conflicts.push(result.conflict);
      holders.push(result.conflict.held_by);
    }
    if (result.ok && parsed.kind === 'path') {
      for (const overlap of this.overlappingPathClaims(parsed, session)) {
        conflicts.push(overlap);
        holders.push(overlap.held_by);
        this.store.recordEvent(
          'reservation_conflict',
          'claim_overlap',
          session,
          { key: parsed.key, source: 'claim', held_by: overlap.held_by, held_key: overlap.key },
          `conflict:${parsed.key}:${session}:${overlap.fence}`,
        );
      }
    }
    for (const holder of new Set(holders)) {
      this.notify(this.store.get ? this.store.get(holder) : null, {
        type: 'reservation_conflict',
        reasonCode: 'claim_held',
        reason: `${me ? me.tool : 'another tool'}:${session} tried to reserve ${parsed.key} that overlaps what you hold`,
        details: { key: parsed.key, source: 'claim', requested_by: session },
      });
    }
    if (result.warning) this.warn(result.warning);
    if (conflicts.length > 0)
      this.mirror({ type: 'reservation_conflict', session, key: parsed.key, conflicts, acquired: Boolean(result.ok) });
    // Acquired despite a published/tag/candidate/overlap conflict (advisory mode): flagged so scripts notice it.
    return this.out({ ...result, key: parsed.key, conflicts, conflicted: Boolean(result.ok) && conflicts.length > 0 });
  }

  release(key, fence) {
    if (!Number.isInteger(fence)) return this.refuse('invalid_fence');
    return this.out(this.store.release({ key, fence }));
  }

  /**
   * Active reservations held by OTHER sessions that overlap what `session` declared: `path:` claims against its
   * declared paths (same repo) and `version:`/`name:` claims against its declared identifiers (`version:pkg@x.y.z`,
   * `pkg@x.y.z` or the bare package name). This is what warns the session that is about to reserve, not the holder.
   */
  foreignReservations(session) {
    const me = this.store.get ? this.store.get(session) : null;
    if (!me) return [];
    const wanted = new Set();
    for (const identifier of me.identifiers_declared) {
      const parsed = parseKey(identifier) || parseKey(`version:${identifier}`) || parseKey(`name:${identifier}`);
      if (parsed) {
        wanted.add(parsed.key);
        wanted.add(`pkg:${parsed.parts[0]}`);
      }
    }
    const found = [];
    for (const claim of this.store.listClaims()) {
      if (claim.owner === session) continue;
      const parsed = parseKey(claim.key);
      if (!parsed) continue;
      let matched = null;
      if (parsed.kind === 'path') {
        if (me.repo && parsed.parts[0] === me.repo)
          matched = me.paths_declared.find((declared) => paths.globsOverlap(declared, parsed.parts[1])) || null;
      } else if (wanted.has(claim.key) || (parsed.kind === 'name' && wanted.has(`pkg:${parsed.parts[0]}`))) matched = claim.key;
      if (!matched) continue;
      const holder = this.store.get ? this.store.get(claim.owner) : null;
      found.push({
        key: claim.key,
        owner: claim.owner,
        tool: holder ? holder.tool : null,
        fence: claim.fence,
        overdue: claim.overdue,
        matched,
      });
    }
    return found;
  }

  /** Session-start check: sweeps overdue leases, evaluates overlaps and drains the inbox. */
  check(session, { consume = true } = {}) {
    const invalid = this.badSession(session);
    if (invalid) return invalid;
    const overdue = this.store.sweepOverdue();
    this.noticeSession(session);
    const overlaps = this.store.get && this.store.get(session) ? this.overlaps(session).overlaps : [];
    const inbox = this.readInbox(session, { consume });
    return this.out({ session, overlaps, foreign_reservations: this.foreignReservations(session), overdue_claims: overdue, inbox });
  }
}

/** Returns a null coordination (no effect at all) when the contract is absent or disabled. */
function createCoordination(directory, options = {}) {
  const loaded = loadConfig(directory);
  if (!loaded.enabled) return { coordination: null, loaded };
  const store = options.store || openStore(loaded.config, options);
  const coordination = new Coordination({ directory, config: loaded.config, store, ...options });
  coordination.warnings.push(...loaded.warnings);
  const installed = new Set((options.adapters || []).map((adapter) => adapter.name));
  for (const name of loaded.config.store.adapters) if (!installed.has(name)) coordination.warn(`adapter ${name} is not installed; skipped`);
  const backend = loaded.config.store.backend;
  if (backend.startsWith('adapter:') && !(options.adapters || []).some((adapter) => `adapter:${adapter.name}` === backend)) {
    coordination.warn(`${backend} is not installed; using the machine store`);
  }
  return { coordination, loaded };
}

module.exports = { Coordination, createCoordination, createNpmRegistry, parseKey, normalizeRepo, INBOX_RELATIVE_PATH, INBOX_SCHEMA };
