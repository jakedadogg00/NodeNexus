import { exec } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';

const execPromise = util.promisify(exec);

// Explicitly protected process signatures that MUST NEVER be killed or paused
const PROTECTED_SIGNATURES = [
  'WindowServer',
  'coreaudiod',
  'launchd',
  'loginwindow',
  'Finder',
  'Dock',
  'SystemUIServer',
  'securityd',
  'trustd',
  'keychain',
  'tccd',
  'Raycast',
  'CleanShot X',
  'TextSniper',
  'com.outercorner.Secrets',
  'iCloud',
  'bird',
  'cloudd',
  'postgres',
  'mysqld',
  'redis-server'
];

export class IdentityClassifier {
  constructor() {
    this.workloadCache = new Map(); // pid -> classified workload
  }

  // Redacts sensitive keys, tokens, and passwords from command strings
  static redactSecrets(cmd) {
    if (!cmd) return '';
    return cmd
      .replace(/(sk-[a-zA-Z0-9_-]{20,})/g, 'sk-***REDACTED***')
      .replace(/(gh[pousr]-[a-zA-Z0-9]{20,})/g, 'gh*-***REDACTED***')
      .replace(/(fc-[a-zA-Z0-9_-]{20,})/g, 'fc-***REDACTED***')
      .replace(/(napi_[a-zA-Z0-9_-]{20,})/g, 'napi_***REDACTED***')
      .replace(/(glm_[a-zA-Z0-9_-]{20,})/g, 'glm_***REDACTED***')
      .replace(/(ctx7sk-[a-zA-Z0-9_-]{20,})/g, 'ctx7sk-***REDACTED***')
      .replace(/(Bearer\s+[a-zA-Z0-9_.-]{16,})/gi, 'Bearer ***REDACTED***')
      .replace(/(--password|--token|--key|--secret)[=\s]+([^\s]+)/gi, '$1=***REDACTED***');
  }

  async scanAndClassifyAll() {
    try {
      const { stdout } = await execPromise('ps -eo pid,ppid,pgid,%cpu,%mem,rss,stat,command');
      const lines = stdout.trim().split('\n');
      const workloads = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 8) continue;

        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        const pgid = parseInt(parts[2], 10);
        const cpu = parseFloat(parts[3]) || 0;
        const mem = parseFloat(parts[4]) || 0;
        const rssKB = parseInt(parts[5], 10) || 0;
        const stat = parts[6];
        const rawCommand = parts.slice(7).join(' ');

        if (pid === process.pid) continue; // Skip self

        const classified = this.classifyProcess(pid, ppid, pgid, cpu, mem, rssKB, stat, rawCommand);
        workloads.push(classified);
      }

      return workloads;
    } catch (err) {
      console.error(`[IdentityClassifier] Scan error: ${err.message}`);
      return [];
    }
  }

  classifyProcess(pid, ppid, pgid, cpu, mem, rssKB, stat, rawCommand) {
    const redactedCommand = IdentityClassifier.redactSecrets(rawCommand);
    const rssMB = Math.round(rssKB / 1024);

    let workloadType = 'other';
    let friendlyName = 'Unknown Process';
    let isProtected = false;
    let pauseSafe = false;
    let projectScope = 'system';

    // 1. Check Protected Systems
    for (const prot of PROTECTED_SIGNATURES) {
      if (rawCommand.includes(prot)) {
        isProtected = true;
        workloadType = 'protected-system';
        friendlyName = prot;
        break;
      }
    }

    if (!isProtected) {
      if (rawCommand.includes('WindowServer')) {
        isProtected = true;
        workloadType = 'system-ui';
        friendlyName = 'macOS WindowServer';
      } else if (rawCommand.includes('mcp-') || rawCommand.includes('mcpmux') || rawCommand.includes('mcpfinder') || rawCommand.includes('server-filesystem') || rawCommand.includes('server-sequential-thinking') || rawCommand.includes('firecrawl-mcp')) {
        workloadType = 'mcp-worker';
        const match = rawCommand.match(/server-[a-zA-Z0-9_-]+|[a-zA-Z0-9_-]+-mcp|mcpmux|mcpfinder/i);
        friendlyName = match ? match[0] : 'MCP Server Worker';
        pauseSafe = false; // MCP relies on active stdio/IPC; SIGSTOP can cause client timeouts
      } else if (rawCommand.includes('openclaw')) {
        workloadType = 'openclaw-agent';
        friendlyName = 'OpenClaw Agent Runtime';
      } else if (rawCommand.includes('camofox')) {
        workloadType = 'browser-automation';
        friendlyName = 'Camofox Browser Engine';
      } else if (rawCommand.includes('node') || rawCommand.includes('npx') || rawCommand.includes('bun') || rawCommand.includes('deno')) {
        workloadType = 'node-runtime';
        const parts = rawCommand.split(' ');
        const script = parts.find(p => p.endsWith('.js') || p.endsWith('.ts') || p.includes('/bin/')) || 'node';
        friendlyName = `Node (${path.basename(script)})`;
      } else if (rawCommand.includes('python') || rawCommand.includes('uvicorn') || rawCommand.includes('gunicorn')) {
        workloadType = 'python-worker';
        friendlyName = 'Python Process';
      } else if (rawCommand.includes('iTerm') || rawCommand.includes('Terminal') || rawCommand.includes('zsh') || rawCommand.includes('bash')) {
        workloadType = 'interactive-shell';
        friendlyName = 'Shell / Terminal Session';
        isProtected = true; // Never kill user interactive shells
      }
    }

    // Detect Project Repo Scope from command string
    const matchRepo = rawCommand.match(/\/Users\/maxbutler\/([a-zA-Z0-9_.-]+)/);
    if (matchRepo && matchRepo[1]) {
      projectScope = matchRepo[1];
    }

    const isPaused = stat.includes('T');
    const isOrphan = (ppid === 1 && (workloadType === 'mcp-worker' || workloadType === 'node-runtime') && !isProtected);

    return {
      workloadId: `${workloadType}::${pid}::${friendlyName.replace(/\s+/g, '_')}`,
      pid,
      ppid,
      pgid,
      cpu,
      mem,
      rssMB,
      stat,
      isPaused,
      isOrphan,
      isProtected,
      pauseSafe,
      workloadType,
      friendlyName,
      projectScope,
      command: redactedCommand
    };
  }
}
