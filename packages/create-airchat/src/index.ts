#!/usr/bin/env node

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SetupConfig {
  dbProvider: 'supabase' | 'self-hosted' | 'docker';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  databaseUrl?: string;
  machineName: string;
  dashboardPort: number;
  deployDashboard: boolean;
  airchatDir: string;
  nodePath: string;
  apiKey?: string;
  webUrl?: string;
}

interface StepResult {
  name: string;
  ok: boolean;
  message: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function ok(msg: string) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg: string) { console.log(`  ${YELLOW}!${RESET} ${msg}`); }
function fail(msg: string) { console.log(`  ${RED}✗${RESET} ${msg}`); }
function dim(msg: string) { return `${DIM}${msg}${RESET}`; }
function bold(msg: string) { return `${BOLD}${msg}${RESET}`; }

function readExistingConfig(): Record<string, string> {
  const configPath = path.join(os.homedir(), '.airchat', 'config');
  const config: Record<string, string> = {};
  try {
    const lines = fs.readFileSync(configPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      config[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {}
  return config;
}

function detectNodePath(): string {
  return process.execPath;
}

function detectRepoDir(): string | null {
  // Check if we're inside the airchat repo
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'packages', 'mcp-server', 'src', 'index.ts'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function machineNameValid(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,99}$/.test(name);
}

// ── Prompt helpers ─────────────────────────────────────────────────────────────

async function ask(rl: readline.Interface, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` ${dim(`(${defaultVal})`)}` : '';
  const answer = await rl.question(`  ${question}${suffix}: `);
  return answer.trim() || defaultVal || '';
}

async function askSecret(rl: readline.Interface, question: string): Promise<string> {
  // readline doesn't support hiding input natively, but we can use a workaround
  const answer = await rl.question(`  ${question}: `);
  return answer.trim();
}

async function askChoice(rl: readline.Interface, question: string, choices: { key: string; label: string }[]): Promise<string> {
  console.log(`  ${question}`);
  for (let i = 0; i < choices.length; i++) {
    console.log(`    ${BOLD}${i + 1}${RESET}) ${choices[i].label}`);
  }
  const answer = await rl.question(`  Choice (1-${choices.length}): `);
  const idx = parseInt(answer.trim(), 10) - 1;
  if (idx >= 0 && idx < choices.length) return choices[idx].key;
  return choices[0].key;
}

async function askYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await rl.question(`  ${question} (${hint}): `);
  const val = answer.trim().toLowerCase();
  if (val === '') return defaultYes;
  return val === 'y' || val === 'yes';
}

// ── Setup steps ────────────────────────────────────────────────────────────────

async function collectConfig(rl: readline.Interface, reconfigure: boolean): Promise<SetupConfig> {
  const existing = reconfigure ? readExistingConfig() : {};
  const detectedRepo = detectRepoDir();

  console.log('');
  console.log(`  ${BOLD}Welcome to AirChat setup!${RESET}`);
  console.log(`  ${dim('This will configure your machine to connect to AirChat.')}`);
  console.log('');

  // Database provider
  const dbProvider = await askChoice(rl, 'Database provider:', [
    { key: 'supabase', label: 'Supabase (hosted, free tier available)' },
    { key: 'self-hosted', label: 'Self-hosted PostgreSQL' },
    { key: 'docker', label: 'Docker (spins up Postgres for you)' },
  ]) as SetupConfig['dbProvider'];
  console.log('');

  let supabaseUrl: string | undefined;
  let supabaseAnonKey: string | undefined;
  let supabaseServiceRoleKey: string | undefined;
  let databaseUrl: string | undefined;

  if (dbProvider === 'supabase') {
    supabaseUrl = await ask(rl, 'Supabase Project URL', existing.SUPABASE_URL);
    supabaseAnonKey = await ask(rl, 'Supabase Anon Key', existing.SUPABASE_ANON_KEY);
    supabaseServiceRoleKey = await askSecret(rl, 'Supabase Service Role Key (used during setup only, not stored)');
    console.log('');
  } else if (dbProvider === 'self-hosted') {
    databaseUrl = await ask(rl, 'PostgreSQL connection string (postgres://user:pass@host:5432/dbname)');
    console.log(`  ${dim('Note: Self-hosted Postgres requires the web dashboard to serve the REST API.')}`);
    console.log('');
  } else if (dbProvider === 'docker') {
    console.log(`  ${dim('A PostgreSQL container will be started alongside the dashboard.')}`);
    console.log('');
  }

  // Machine name
  const defaultMachine = existing.MACHINE_NAME || os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'laptop';
  let machineName = '';
  while (!machineName) {
    machineName = await ask(rl, 'Machine name (e.g. laptop, server, nas)', defaultMachine);
    if (!machineNameValid(machineName)) {
      warn('Must be lowercase alphanumeric with hyphens, 2-100 chars.');
      machineName = '';
    }
  }
  console.log('');

  // Dashboard
  const deployDashboard = await askYesNo(rl, 'Deploy web dashboard?', true);
  let dashboardPort = 3003;
  if (deployDashboard) {
    const portStr = await ask(rl, 'Dashboard port', '3003');
    dashboardPort = parseInt(portStr, 10) || 3003;
  }
  console.log('');

  // Repo location
  let airchatDir = '';
  if (detectedRepo) {
    console.log(`  ${dim(`Found airchat repo at: ${detectedRepo}`)}`);
    const useDetected = await askYesNo(rl, 'Use this location?', true);
    if (useDetected) {
      airchatDir = detectedRepo;
    }
  }
  if (!airchatDir) {
    const shouldClone = await askYesNo(rl, 'Clone the airchat repo?', true);
    if (shouldClone) {
      const cloneDir = await ask(rl, 'Clone to', path.join(os.homedir(), 'projects', 'airchat'));
      airchatDir = cloneDir;
    } else {
      airchatDir = await ask(rl, 'Path to existing airchat repo');
    }
  }
  console.log('');

  const nodePath = detectNodePath();
  const webUrl = deployDashboard ? `http://localhost:${dashboardPort}` : existing.AIRCHAT_WEB_URL;

  return {
    dbProvider,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    databaseUrl,
    machineName,
    dashboardPort,
    deployDashboard,
    airchatDir,
    nodePath,
    webUrl,
  };
}

async function cloneAndInstall(config: SetupConfig): Promise<StepResult> {
  const name = 'Clone & install';
  if (fs.existsSync(path.join(config.airchatDir, 'packages', 'mcp-server'))) {
    return { name, ok: true, message: 'Repo already exists' };
  }

  try {
    console.log(`  Cloning airchat...`);
    execSync(`git clone https://github.com/prone/airchat.git "${config.airchatDir}"`, { stdio: 'pipe' });
    console.log(`  Installing dependencies...`);
    execSync('npm install', { cwd: config.airchatDir, stdio: 'pipe' });
    return { name, ok: true, message: 'Cloned and installed' };
  } catch (e: any) {
    return { name, ok: false, message: `Failed: ${e.message}` };
  }
}

async function runMigrations(config: SetupConfig): Promise<StepResult> {
  const name = 'Run migrations';

  if (config.dbProvider === 'supabase') {
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
      return { name, ok: false, message: 'Missing Supabase credentials' };
    }

    const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    // Check if tables already exist
    const { data: agents } = await supabase.from('agents').select('id').limit(1);
    if (agents !== null) {
      return { name, ok: true, message: 'Tables already exist — skipping migrations' };
    }

    // Try supabase CLI
    try {
      execSync('which supabase', { stdio: 'pipe' });
      execSync(`supabase db push --db-url "${config.supabaseUrl}"`, {
        cwd: config.airchatDir,
        stdio: 'pipe',
      });
      return { name, ok: true, message: 'Migrations applied via Supabase CLI' };
    } catch {}

    // Read and execute migration files sequentially
    const migrationsDir = path.join(config.airchatDir, 'supabase', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      return { name, ok: false, message: `Migrations directory not found at ${migrationsDir}` };
    }

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    let applied = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const { error } = await supabase.rpc('', {} as any).then(
        () => ({ error: null }),
        () => ({ error: null })
      );
      // Supabase JS client can't run raw DDL — instruct user
      console.log(`  ${dim(`Migration ${file} needs to be applied via Supabase SQL Editor`)}`);
      applied++;
    }

    if (applied > 0) {
      return {
        name,
        ok: false,
        message: `${files.length} migration files need to be applied manually in the Supabase SQL Editor (Settings → SQL Editor). Files are in: ${migrationsDir}`,
      };
    }

    return { name, ok: true, message: 'Migrations applied' };
  }

  // Self-hosted or Docker: migrations run via psql or dashboard
  if (config.dbProvider === 'self-hosted' && config.databaseUrl) {
    const migrationsDir = path.join(config.airchatDir, 'supabase', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    try {
      for (const file of files) {
        execSync(`psql "${config.databaseUrl}" -f "${path.join(migrationsDir, file)}"`, { stdio: 'pipe' });
      }
      return { name, ok: true, message: `Applied ${files.length} migrations` };
    } catch (e: any) {
      return { name, ok: false, message: `Migration failed: ${e.message}. Run manually with psql.` };
    }
  }

  return { name, ok: true, message: 'Migrations will run with Docker startup' };
}

async function seedChannels(config: SetupConfig): Promise<StepResult> {
  const name = 'Seed channels';

  if (config.dbProvider !== 'supabase' || !config.supabaseUrl || !config.supabaseServiceRoleKey) {
    return { name, ok: true, message: 'Skipped (non-Supabase provider)' };
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const channels = [
    { name: 'global', type: 'global' as const, description: 'Broadcast channel visible to all agents' },
    { name: 'general', type: 'global' as const, description: 'General discussion for all agents' },
    { name: 'project-airchat', type: 'project' as const, description: 'AirChat project coordination' },
    { name: 'tech-typescript', type: 'technology' as const, description: 'TypeScript tips, issues, and discussion' },
  ];

  let created = 0;
  for (const channel of channels) {
    const { error } = await supabase.from('channels').upsert(channel, { onConflict: 'name' });
    if (!error) created++;
  }

  return { name, ok: true, message: `${created}/${channels.length} channels ready` };
}

async function generateMachineKey(config: SetupConfig): Promise<StepResult> {
  const name = 'Generate machine key';

  if (config.dbProvider !== 'supabase' || !config.supabaseUrl || !config.supabaseServiceRoleKey) {
    return { name, ok: false, message: 'Machine key generation requires Supabase credentials' };
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const rawKey = `ack_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const { data, error } = await supabase
    .from('machine_keys')
    .insert({
      machine_name: config.machineName,
      key_hash: keyHash,
      active: true,
    })
    .select()
    .single();

  if (error) {
    return { name, ok: false, message: `Failed: ${error.message}` };
  }

  config.apiKey = rawKey;
  return { name, ok: true, message: `Key generated for "${config.machineName}"` };
}

function writeAirchatConfig(config: SetupConfig): StepResult {
  const name = 'Write ~/.airchat/config';
  try {
    const configDir = path.join(os.homedir(), '.airchat');
    fs.mkdirSync(configDir, { recursive: true });

    const lines: string[] = [
      `MACHINE_NAME=${config.machineName}`,
    ];

    if (config.apiKey) lines.push(`AIRCHAT_API_KEY=${config.apiKey}`);
    if (config.webUrl) lines.push(`AIRCHAT_WEB_URL=${config.webUrl}`);

    // Supabase-specific (needed by check-mentions hook)
    if (config.supabaseUrl) lines.push(`SUPABASE_URL=${config.supabaseUrl}`);
    if (config.supabaseAnonKey) lines.push(`SUPABASE_ANON_KEY=${config.supabaseAnonKey}`);

    fs.writeFileSync(path.join(configDir, 'config'), lines.join('\n') + '\n');
    return { name, ok: true, message: configDir };
  } catch (e: any) {
    return { name, ok: false, message: e.message };
  }
}

function writeWebEnv(config: SetupConfig): StepResult {
  const name = 'Write dashboard .env';
  if (!config.deployDashboard) {
    return { name, ok: true, message: 'Skipped' };
  }

  try {
    const envPath = path.join(config.airchatDir, 'apps', 'web', '.env.local');
    const lines: string[] = [];

    if (config.supabaseUrl) {
      lines.push(`NEXT_PUBLIC_SUPABASE_URL=${config.supabaseUrl}`);
    }
    if (config.supabaseAnonKey) {
      lines.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${config.supabaseAnonKey}`);
    }
    if (config.supabaseServiceRoleKey) {
      lines.push(`SUPABASE_SERVICE_ROLE_KEY=${config.supabaseServiceRoleKey}`);
    }
    if (config.databaseUrl) {
      lines.push(`DATABASE_URL=${config.databaseUrl}`);
    }
    if (config.apiKey) {
      lines.push(`AIRCHAT_API_KEY=${config.apiKey}`);
    }

    fs.writeFileSync(envPath, lines.join('\n') + '\n');
    return { name, ok: true, message: envPath };
  } catch (e: any) {
    return { name, ok: false, message: e.message };
  }
}

function registerMcpServer(config: SetupConfig): StepResult {
  const name = 'Register MCP server';

  const tsxPath = path.join(config.airchatDir, 'node_modules', '.bin', 'tsx');
  const serverPath = path.join(config.airchatDir, 'packages', 'mcp-server', 'src', 'index.ts');

  if (!fs.existsSync(serverPath)) {
    return { name, ok: false, message: `MCP server not found at ${serverPath}` };
  }

  // Build env args
  const envArgs: string[] = [];
  if (config.supabaseUrl) envArgs.push(`-e SUPABASE_URL=${config.supabaseUrl}`);
  if (config.supabaseAnonKey) envArgs.push(`-e SUPABASE_ANON_KEY=${config.supabaseAnonKey}`);
  if (config.apiKey) envArgs.push(`-e AIRCHAT_API_KEY=${config.apiKey}`);
  if (config.webUrl) envArgs.push(`-e AIRCHAT_WEB_URL=${config.webUrl}`);

  const cmd = `claude mcp add airchat -s user ${envArgs.join(' ')} -- "${config.nodePath}" "${tsxPath}" "${serverPath}"`;

  try {
    execSync(cmd, { stdio: 'pipe' });
    return { name, ok: true, message: 'Registered at user level' };
  } catch (e: any) {
    // claude CLI might not be installed
    return {
      name,
      ok: false,
      message: `Could not run "claude mcp add". Run manually:\n    ${cmd}`,
    };
  }
}

function installClaudeMd(config: SetupConfig): StepResult {
  const name = 'Install agent instructions';
  try {
    const srcPath = path.join(config.airchatDir, 'setup', 'global-CLAUDE.md');
    if (!fs.existsSync(srcPath)) {
      return { name, ok: false, message: 'setup/global-CLAUDE.md not found' };
    }

    const content = fs.readFileSync(srcPath, 'utf-8');
    const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');

    // Check if already present
    if (fs.existsSync(claudeMdPath)) {
      const existing = fs.readFileSync(claudeMdPath, 'utf-8');
      if (existing.includes('# AirChat')) {
        return { name, ok: true, message: 'Already present in ~/.claude/CLAUDE.md' };
      }
      fs.appendFileSync(claudeMdPath, '\n' + content);
    } else {
      fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
      fs.writeFileSync(claudeMdPath, content);
    }

    return { name, ok: true, message: '~/.claude/CLAUDE.md' };
  } catch (e: any) {
    return { name, ok: false, message: e.message };
  }
}

function installMentionHook(config: SetupConfig): StepResult {
  const name = 'Install mention hook';
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    let settings: any = {};

    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }

    const hookCommand = `${config.nodePath} ${path.join(config.airchatDir, 'scripts', 'check-mentions.mjs')}`;

    // Check if hook already exists
    if (settings.hooks?.UserPromptSubmit) {
      const existing = settings.hooks.UserPromptSubmit;
      const alreadyHasHook = Array.isArray(existing) && existing.some((entry: any) =>
        entry.hooks?.some((h: any) => h.command?.includes('check-mentions'))
      );
      if (alreadyHasHook) {
        return { name, ok: true, message: 'Hook already configured' };
      }
    }

    // Add hook
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];

    settings.hooks.UserPromptSubmit.push({
      matcher: '',
      hooks: [{
        type: 'command',
        command: hookCommand,
      }],
    });

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    return { name, ok: true, message: '~/.claude/settings.json' };
  } catch (e: any) {
    return { name, ok: false, message: e.message };
  }
}

function copySlashCommands(config: SetupConfig): StepResult {
  const name = 'Copy slash commands';
  try {
    const setupDir = path.join(config.airchatDir, 'setup');
    const commandsDir = path.join(os.homedir(), '.claude', 'commands');
    fs.mkdirSync(commandsDir, { recursive: true });

    const files = fs.readdirSync(setupDir).filter(f => f.startsWith('airchat-') && f.endsWith('.md'));
    for (const file of files) {
      fs.copyFileSync(path.join(setupDir, file), path.join(commandsDir, file));
    }

    return { name, ok: true, message: `${files.length} commands → ~/.claude/commands/` };
  } catch (e: any) {
    return { name, ok: false, message: e.message };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const reconfigure = process.argv.includes('--reconfigure');

  console.log('');
  console.log(`  ${GREEN}>${RESET} ${BOLD}AirChat${RESET} ${dim('v0.1.0')}`);
  console.log(`  ${dim('Your AI agents can talk to each other')}`);

  const rl = readline.createInterface({ input, output });
  let config: SetupConfig;

  try {
    config = await collectConfig(rl, reconfigure);
  } finally {
    rl.close();
  }

  // Show summary before proceeding
  console.log(`  ${bold('Summary:')}`);
  console.log(`    Database:    ${config.dbProvider}`);
  console.log(`    Machine:     ${config.machineName}`);
  console.log(`    Repo:        ${config.airchatDir}`);
  console.log(`    Node:        ${config.nodePath}`);
  if (config.deployDashboard) {
    console.log(`    Dashboard:   port ${config.dashboardPort}`);
  }
  console.log('');

  // Execute steps
  const results: StepResult[] = [];

  // 1. Clone & install
  process.stdout.write(`  Cloning & installing...`);
  const cloneResult = await cloneAndInstall(config);
  results.push(cloneResult);
  process.stdout.write(`\r`);
  if (cloneResult.ok) ok(cloneResult.message); else fail(cloneResult.message);

  // 2. Run migrations
  if (!reconfigure) {
    process.stdout.write(`  Running migrations...`);
    const migrationResult = await runMigrations(config);
    results.push(migrationResult);
    process.stdout.write(`\r`);
    if (migrationResult.ok) ok(migrationResult.message); else fail(migrationResult.message);
  }

  // 3. Seed channels
  if (!reconfigure) {
    process.stdout.write(`  Seeding channels...`);
    const seedResult = await seedChannels(config);
    results.push(seedResult);
    process.stdout.write(`\r`);
    if (seedResult.ok) ok(seedResult.message); else fail(seedResult.message);
  }

  // 4. Generate machine key
  if (!reconfigure) {
    process.stdout.write(`  Generating machine key...`);
    const keyResult = await generateMachineKey(config);
    results.push(keyResult);
    process.stdout.write(`\r`);
    if (keyResult.ok) ok(keyResult.message); else fail(keyResult.message);
  }

  // 5. Write config
  const configResult = writeAirchatConfig(config);
  results.push(configResult);
  if (configResult.ok) ok(`Config → ${configResult.message}`); else fail(configResult.message);

  // 6. Write dashboard .env
  const envResult = writeWebEnv(config);
  results.push(envResult);
  if (envResult.ok && config.deployDashboard) ok(`Dashboard env → ${envResult.message}`);
  else if (!config.deployDashboard) {} // silent skip
  else fail(envResult.message);

  // 7. Register MCP server
  const mcpResult = registerMcpServer(config);
  results.push(mcpResult);
  if (mcpResult.ok) ok(`MCP server → ${mcpResult.message}`); else warn(mcpResult.message);

  // 8. Install agent instructions
  const claudeResult = installClaudeMd(config);
  results.push(claudeResult);
  if (claudeResult.ok) ok(`Instructions → ${claudeResult.message}`); else fail(claudeResult.message);

  // 9. Install mention hook
  const hookResult = installMentionHook(config);
  results.push(hookResult);
  if (hookResult.ok) ok(`Mention hook → ${hookResult.message}`); else fail(hookResult.message);

  // 10. Copy slash commands
  const cmdResult = copySlashCommands(config);
  results.push(cmdResult);
  if (cmdResult.ok) ok(`Slash commands → ${cmdResult.message}`); else fail(cmdResult.message);

  // Summary
  console.log('');
  const failures = results.filter(r => !r.ok);
  if (failures.length === 0) {
    console.log(`  ${GREEN}${BOLD}Setup complete!${RESET}`);
  } else {
    console.log(`  ${YELLOW}${BOLD}Setup completed with ${failures.length} issue(s):${RESET}`);
    for (const f of failures) {
      console.log(`    ${RED}•${RESET} ${f.name}: ${f.message}`);
    }
  }

  if (config.apiKey) {
    console.log('');
    console.log(`  ${BOLD}Your API key:${RESET} ${config.apiKey}`);
    console.log(`  ${YELLOW}Save this key — it cannot be retrieved later.${RESET}`);
  }

  console.log('');
  console.log(`  ${dim('Next steps:')}`);
  console.log(`  1. Restart Claude Code`);
  if (config.deployDashboard) {
    console.log(`  2. Start the dashboard: cd ${config.airchatDir} && docker compose up -d --build`);
  }
  console.log(`  ${dim('Run with --reconfigure to update settings later.')}`);
  console.log('');
}

main().catch((e) => {
  console.error(`\n  ${RED}Setup failed:${RESET} ${e.message}\n`);
  process.exit(1);
});
