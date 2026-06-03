'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('yaml');

const DEFAULT_PROVIDER = 'ai-jail';
const DEFAULT_SANDBOX = {
  provider: DEFAULT_PROVIDER,
  required: false,
  default_profile: 'standard',
  profiles: {
    standard: {
      flags: ['--private-home', '--no-docker', '--no-display', '--no-gpu', '--no-save-config'],
      masks: ['.env', '.env.local', 'credentials.json', 'secrets.yml'],
      ro_maps: [],
      rw_maps: [],
      allow_tcp_ports: [],
    },
    lockdown: {
      flags: ['--lockdown', '--no-save-config'],
      masks: ['.env', '.env.local', 'credentials.json', 'secrets.yml'],
      ro_maps: [],
      rw_maps: [],
      allow_tcp_ports: [],
    },
  },
};

function commandExists(command, env = process.env) {
  const envPath = env.PATH || '';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

  for (const entry of envPath.split(path.delimiter)) {
    if (!entry) continue;
    for (const ext of extensions) {
      if (fs.existsSync(path.join(entry, `${command}${ext}`))) return true;
    }
  }

  return false;
}

function readSysctl(relPath) {
  const fullPath = path.join('/proc/sys', relPath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return fs.readFileSync(fullPath, 'utf8').trim();
  } catch {
    return null;
  }
}

function readHseosConfig(projectDir) {
  const configPath = path.join(projectDir, '.hseos', 'config', 'hseos.config.yaml');
  if (!fs.existsSync(configPath)) {
    return { config: {}, configPath, error: null };
  }

  try {
    const config = yaml.parse(fs.readFileSync(configPath, 'utf8')) || {};
    return { config, configPath, error: null };
  } catch (error) {
    return { config: {}, configPath, error };
  }
}

function mergeProfile(defaultProfile, userProfile = {}) {
  return {
    ...defaultProfile,
    ...userProfile,
    flags: userProfile.flags || defaultProfile.flags || [],
    masks: userProfile.masks || defaultProfile.masks || [],
    ro_maps: userProfile.ro_maps || defaultProfile.ro_maps || [],
    rw_maps: userProfile.rw_maps || defaultProfile.rw_maps || [],
    allow_tcp_ports: userProfile.allow_tcp_ports || defaultProfile.allow_tcp_ports || [],
  };
}

function normalizeSandboxConfig(config = {}) {
  const sandbox = config.sandbox || {};
  const profiles = sandbox.profiles || {};
  return {
    ...DEFAULT_SANDBOX,
    ...sandbox,
    profiles: {
      standard: mergeProfile(DEFAULT_SANDBOX.profiles.standard, profiles.standard),
      lockdown: mergeProfile(DEFAULT_SANDBOX.profiles.lockdown, profiles.lockdown),
      ...Object.fromEntries(
        Object.entries(profiles)
          .filter(([name]) => !['standard', 'lockdown'].includes(name))
          .map(([name, profile]) => [name, mergeProfile({}, profile)])
      ),
    },
  };
}

function resolveSandbox(projectDir) {
  const loaded = readHseosConfig(projectDir);
  if (loaded.error) {
    return {
      configPath: loaded.configPath,
      parseError: loaded.error,
      sandbox: normalizeSandboxConfig(),
      configured: false,
    };
  }

  return {
    configPath: loaded.configPath,
    parseError: null,
    sandbox: normalizeSandboxConfig(loaded.config),
    configured: Boolean(loaded.config.sandbox),
  };
}

function getProfile(sandbox, requestedProfile) {
  const profileName = requestedProfile || sandbox.default_profile || DEFAULT_SANDBOX.default_profile;
  const profile = sandbox.profiles?.[profileName];
  if (!profile) {
    throw new Error(`Unknown sandbox profile: ${profileName}`);
  }
  return { profileName, profile };
}

function buildAiJailArgs({ sandbox, profileName, command }) {
  const { profile } = getProfile(sandbox, profileName);
  const args = [...(profile.flags || [])];

  for (const mask of profile.masks || []) args.push('--mask', String(mask));
  for (const roMap of profile.ro_maps || []) args.push('--map', String(roMap));
  for (const rwMap of profile.rw_maps || []) args.push('--rw-map', String(rwMap));
  for (const port of profile.allow_tcp_ports || []) args.push('--allow-tcp-port', String(port));

  args.push('--', ...command);
  return args;
}

function quoteArg(value) {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

function formatCommand(binary, args) {
  return [binary, ...args].map((arg) => quoteArg(String(arg))).join(' ');
}

function buildSandboxCommand({ projectDir, profileName, command }) {
  const { sandbox } = resolveSandbox(projectDir);
  if (sandbox.provider !== DEFAULT_PROVIDER) {
    throw new Error(`Unsupported sandbox provider: ${sandbox.provider}`);
  }
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error('A command is required after `--`.');
  }
  const binary = sandbox.binary || DEFAULT_PROVIDER;
  const args = buildAiJailArgs({ sandbox, profileName, command });
  return { binary, args, display: formatCommand(binary, args) };
}

function runSandbox({ projectDir, profileName, command, dryRun = false, stdio = 'inherit' }) {
  const built = buildSandboxCommand({ projectDir, profileName, command });
  if (dryRun) {
    return { status: 0, dryRun: true, command: built.display };
  }

  const result = spawnSync(built.binary, built.args, {
    cwd: projectDir,
    stdio,
    env: process.env,
  });

  return {
    status: typeof result.status === 'number' ? result.status : 1,
    error: result.error,
    command: built.display,
  };
}

function sandboxDoctor(projectDir, env = process.env) {
  const resolved = resolveSandbox(projectDir);
  const { sandbox, parseError } = resolved;
  const required = sandbox.required === true;
  const checks = [];

  checks.push({
    id: 'sandbox_config',
    title: 'Sandbox config',
    ok: !parseError,
    required: true,
    details: parseError
      ? `hseos.config.yaml parse error: ${parseError.message}`
      : resolved.configured
        ? `Configured provider: ${sandbox.provider}`
        : 'No sandbox block configured; using optional defaults',
    remedy: parseError ? 'Fix YAML syntax in .hseos/config/hseos.config.yaml.' : undefined,
  });

  const providerOk = sandbox.provider === DEFAULT_PROVIDER;
  checks.push({
    id: 'sandbox_provider',
    title: 'Sandbox provider',
    ok: providerOk,
    required,
    details: providerOk ? 'ai-jail external provider selected' : `Unsupported provider: ${sandbox.provider}`,
    remedy: providerOk ? undefined : 'Set sandbox.provider to ai-jail.',
  });

  const binary = sandbox.binary || DEFAULT_PROVIDER;
  const aiJailFound = commandExists(binary, env);
  checks.push({
    id: 'ai_jail_binary',
    title: 'ai-jail binary',
    ok: aiJailFound,
    required,
    details: aiJailFound
      ? `${binary} found on PATH`
      : required
        ? `${binary} not found on PATH`
        : `${binary} not found on PATH; sandbox is optional`,
    remedy: aiJailFound ? undefined : 'Install ai-jail or set sandbox.required=false.',
  });

  if (process.platform === 'linux') {
    const bwrapFound = commandExists('bwrap', env);
    checks.push({
      id: 'bwrap_binary',
      title: 'bubblewrap backend',
      ok: bwrapFound,
      required,
      details: bwrapFound
        ? 'bwrap found on PATH'
        : required
          ? 'bwrap not found on PATH'
          : 'bwrap not found on PATH; needed only for sandboxed runs',
      remedy: bwrapFound ? undefined : 'Install bubblewrap for Linux sandbox support.',
    });

    const userns = readSysctl('kernel/unprivileged_userns_clone');
    if (userns !== null) {
      checks.push({
        id: 'user_namespaces',
        title: 'User namespaces',
        ok: userns === '1',
        required,
        details: `kernel.unprivileged_userns_clone=${userns}`,
        remedy: userns === '1' ? undefined : 'Enable unprivileged user namespaces or keep sandbox.required=false.',
      });
    }

    const apparmorUserns = readSysctl('kernel/apparmor_restrict_unprivileged_userns');
    if (apparmorUserns !== null) {
      checks.push({
        id: 'apparmor_userns',
        title: 'AppArmor userns restriction',
        ok: apparmorUserns === '0',
        required,
        details:
          apparmorUserns === '0'
            ? 'AppArmor is not restricting unprivileged user namespaces'
            : 'AppArmor restricts unprivileged user namespaces; bwrap may need an explicit profile',
        remedy:
          apparmorUserns === '0'
            ? undefined
            : 'Install an AppArmor profile for bwrap or relax the system restriction before requiring sandbox.',
      });
    }
  } else if (process.platform === 'darwin') {
    checks.push({
      id: 'macos_backend',
      title: 'macOS backend',
      ok: false,
      required,
      details: 'ai-jail uses legacy sandbox-exec on macOS; HSEOS treats this as best-effort only',
      remedy: required ? 'Use Linux+bwrap for required sandbox guarantees.' : undefined,
    });
  } else {
    checks.push({
      id: 'platform_backend',
      title: 'Sandbox backend',
      ok: false,
      required,
      details: `Unsupported platform for required sandbox guarantees: ${process.platform}`,
      remedy: required ? 'Use Linux+bwrap or keep sandbox.required=false.' : undefined,
    });
  }

  const failedRequired = checks.filter((check) => check.required && !check.ok);
  return {
    ok: failedRequired.length === 0,
    provider: sandbox.provider,
    required,
    configured: resolved.configured,
    configPath: resolved.configPath,
    checks,
    warnings: checks.filter((check) => !check.ok && !check.required).map((check) => `${check.title}: ${check.details}`),
    errors: failedRequired.map((check) => `${check.title}: ${check.details}`),
  };
}

function sandboxDoctorCheck(projectDir) {
  const result = sandboxDoctor(projectDir);
  const failedRequired = result.checks.filter((check) => check.required && !check.ok);
  const failedOptional = result.checks.filter((check) => !check.required && !check.ok);

  return {
    id: 'sandbox_runtime',
    title: 'Optional OS sandbox runtime',
    ok: failedRequired.length === 0,
    details:
      failedRequired.length > 0
        ? `${failedRequired.length} required sandbox check(s) failed`
        : failedOptional.length > 0
          ? `optional; ${failedOptional.length} readiness warning(s)`
          : `${result.provider} sandbox readiness checks passed`,
    remedy:
      failedRequired.length > 0
        ? failedRequired.map((check) => check.remedy).filter(Boolean).join(' ')
        : undefined,
  };
}

module.exports = {
  DEFAULT_SANDBOX,
  buildSandboxCommand,
  commandExists,
  formatCommand,
  runSandbox,
  sandboxDoctor,
  sandboxDoctorCheck,
};
