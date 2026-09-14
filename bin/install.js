#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

function findSkills() {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, 'SKILL.md')))
    .map((d) => d.name);
}

function parseArgs(argv) {
  const args = { frameworks: [], project: false, dir: null, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--project' || arg === '-p') args.project = true;
    else if (arg.startsWith('--dir=')) args.dir = arg.slice('--dir='.length);
    else if (!arg.startsWith('-')) args.frameworks.push(arg);
  }
  return args;
}

function targetBase(args) {
  if (args.dir) return path.resolve(args.dir);
  if (args.project) return path.join(process.cwd(), '.claude', 'skills');
  return path.join(os.homedir(), '.claude', 'skills');
}

function install(framework, base) {
  const src = path.join(ROOT, framework, 'SKILL.md');
  const destDir = path.join(base, `mobile-app-setup-${framework}`);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, 'SKILL.md'));
  console.log(`Installed "${framework}" skill -> ${path.join(destDir, 'SKILL.md')}`);
}

function printHelp(available) {
  console.log(`mobile-app-setup — install SKILL.md reference guides into Claude Code

Usage:
  npx github:ejjat0909/mobile-app-setup [framework...] [options]

Frameworks available: ${available.join(', ')}
  (omit to install all of them)

Options:
  --project      Install to ./.claude/skills instead of ~/.claude/skills
  --dir=<path>   Install to a custom directory
  -h, --help     Show this help

Examples:
  npx github:ejjat0909/mobile-app-setup
  npx github:ejjat0909/mobile-app-setup flutter
  npx github:ejjat0909/mobile-app-setup flutter --project
`);
}

function main() {
  const available = findSkills();
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp(available);
    return;
  }

  const frameworks = args.frameworks.length ? args.frameworks : available;
  const unknown = frameworks.filter((f) => !available.includes(f));
  if (unknown.length) {
    console.error(`Unknown framework(s): ${unknown.join(', ')}. Available: ${available.join(', ')}`);
    process.exit(1);
  }

  const base = targetBase(args);
  for (const framework of frameworks) install(framework, base);
}

main();
