import { exec, execSync, spawn } from 'node:child_process';
import os from 'node:os';
import util from 'node:util';

const execPromise = util.promisify(exec);

export class SystemGovernor {
  constructor(options = {}) {
    this.maxNodeRSSMB = options.maxNodeRSSMB || 1500; // max total RSS threshold
    this.perProcessMaxMB = options.perProcessMaxMB || 600;
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.managedPids = new Map(); // pid -> { state, name, category, qosApplied, lastSeen }
    this.timer = null;
    this.isGoverning = false;
    this.logs = [];
  }

  log(message, type = 'info') {
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      message
    };
    this.logs.unshift(entry);
    if (this.logs.length > 200) this.logs.pop();
    console.log(`[SysGov][${type.toUpperCase()}] ${message}`);
  }

  async getSystemMemoryStats() {
    try {
      const totalMemBytes = os.totalmem();
      const freeMemBytes = os.freemem();
      const loadAvg = os.loadavg();

      // vm_stat for accurate macOS page breakdown
      let pageStats = { active: 0, wired: 0, compressed: 0, free: 0 };
      try {
        const { stdout } = await execPromise('vm_stat');
        const lines = stdout.split('\n');
        const pageSize = 4096; // 4KB pages
        for (const line of lines) {
          if (line.includes('Pages free:')) {
            pageStats.free = parseInt(line.split(':')[1].trim().replace('.', ''), 10) * pageSize;
          } else if (line.includes('Pages active:')) {
            pageStats.active = parseInt(line.split(':')[1].trim().replace('.', ''), 10) * pageSize;
          } else if (line.includes('Pages wired down:')) {
            pageStats.wired = parseInt(line.split(':')[1].trim().replace('.', ''), 10) * pageSize;
          } else if (line.includes('Pages occupied by compressor:')) {
            pageStats.compressed = parseInt(line.split(':')[1].trim().replace('.', ''), 10) * pageSize;
          }
        }
      } catch (e) {
        // Fallback
      }

      const usedMemBytes = totalMemBytes - freeMemBytes;
      const memPressurePercent = Math.round(((totalMemBytes - (pageStats.free || freeMemBytes)) / totalMemBytes) * 100);

      return {
        totalGB: (totalMemBytes / (1024 ** 3)).toFixed(2),
        freeGB: (freeMemBytes / (1024 ** 3)).toFixed(2),
        usedGB: (usedMemBytes / (1024 ** 3)).toFixed(2),
        memPressurePercent,
        loadAvg,
        pageStats: {
          activeMB: Math.round(pageStats.active / (1024 ** 2)),
          wiredMB: Math.round(pageStats.wired / (1024 ** 2)),
          compressedMB: Math.round(pageStats.compressed / (1024 ** 2)),
        }
      };
    } catch (err) {
      return { totalGB: '0', freeGB: '0', usedGB: '0', memPressurePercent: 0, loadAvg: [0, 0, 0] };
    }
  }

  async scanProcesses() {
    try {
      // Get all processes with PID, PPID, %CPU, %MEM, RSS (KB), STAT, and COMMAND
      const { stdout } = await execPromise('ps -eo pid,ppid,%cpu,%mem,rss,stat,command');
      const lines = stdout.trim().split('\n');
      const processes = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 7) continue;

        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        const cpu = parseFloat(parts[2]);
        const mem = parseFloat(parts[3]);
        const rssKB = parseInt(parts[4], 10);
        const stat = parts[5];
        const command = parts.slice(6).join(' ');

        const isNode = command.includes('node') || command.includes('npx') || command.includes('bun') || command.includes('deno');
        const isPython = command.includes('python') || command.includes('uvicorn') || command.includes('gunicorn');
        const isWindowServer = command.includes('WindowServer');
        const isMCP = command.includes('mcp-') || command.includes('mcpmux') || command.includes('mcpfinder') || command.includes('firecrawl-mcp') || command.includes('pinecone-mcp') || command.includes('n8n-mcp');

        if (!isNode && !isPython && !isWindowServer && !isMCP) continue;
        if (pid === process.pid) continue; // Don't manage self

        const rssMB = Math.round(rssKB / 1024);
        let category = 'other';
        let friendlyName = 'Process';

        if (isWindowServer) {
          category = 'system-ui';
          friendlyName = 'macOS WindowServer';
        } else if (isMCP) {
          category = 'mcp-server';
          const match = command.match(/mcp-server-[a-zA-Z0-9_-]+|[a-zA-Z0-9_-]+-mcp|mcpmux|mcpfinder|firecrawl-mcp|pinecone-mcp|n8n-mcp/i);
          friendlyName = match ? match[0] : 'MCP Server';
        } else if (command.includes('openclaw')) {
          category = 'openclaw-agent';
          friendlyName = 'OpenClaw Agent Core';
        } else if (command.includes('camofox')) {
          category = 'browser-automation';
          friendlyName = 'Camofox Browser Server';
        } else if (isNode) {
          category = 'node-runtime';
          const parts = command.split(' ');
          const script = parts.find(p => p.endsWith('.js') || p.endsWith('.ts') || p.includes('/bin/')) || 'node';
          friendlyName = `Node (${script.split('/').pop()})`;
        } else if (isPython) {
          category = 'python-runtime';
          friendlyName = 'Python Worker';
        }

        const isPaused = stat.includes('T');
        const isOrphan = (ppid === 1 && category === 'mcp-server');

        processes.push({
          pid,
          ppid,
          cpu,
          mem,
          rssMB,
          stat,
          command,
          category,
          friendlyName,
          isPaused,
          isOrphan
        });
      }

      return processes;
    } catch (err) {
      this.log(`Failed to scan processes: ${err.message}`, 'error');
      return [];
    }
  }

  async applyQoSEfficiency(pid) {
    try {
      // macOS taskpolicy -b -p <pid> puts process in background QoS (efficiency cores)
      await execPromise(`taskpolicy -b -p ${pid} 2>/dev/null || true`);
      return true;
    } catch (e) {
      return false;
    }
  }

  async pauseProcess(pid) {
    try {
      process.kill(pid, 'SIGSTOP');
      this.log(`Paused process PID ${pid} (SIGSTOP)`, 'action');
      return true;
    } catch (err) {
      this.log(`Failed to pause PID ${pid}: ${err.message}`, 'error');
      return false;
    }
  }

  async resumeProcess(pid) {
    try {
      process.kill(pid, 'SIGCONT');
      this.log(`Resumed process PID ${pid} (SIGCONT)`, 'action');
      return true;
    } catch (err) {
      this.log(`Failed to resume PID ${pid}: ${err.message}`, 'error');
      return false;
    }
  }

  async terminateProcess(pid, force = false) {
    try {
      const sig = force ? 'SIGKILL' : 'SIGTERM';
      process.kill(pid, sig);
      this.log(`Terminated process PID ${pid} (${sig})`, 'action');
      return true;
    } catch (err) {
      this.log(`Failed to terminate PID ${pid}: ${err.message}`, 'error');
      return false;
    }
  }

  async optimizeAll() {
    this.log('Running automatic comprehensive optimization pass...', 'optimize');
    const processes = await this.scanProcesses();
    let optimizedCount = 0;
    let reapedCount = 0;
    let deduplicatedCount = 0;

    const seenMCPs = new Map(); // name -> pid

    for (const proc of processes) {
      // 1. Move background MCP and Node processes to Apple Silicon Efficiency Cores (taskpolicy -b)
      if (proc.category === 'mcp-server' || proc.category === 'python-runtime') {
        await this.applyQoSEfficiency(proc.pid);
        optimizedCount++;
      }

      // 2. Reaping orphaned stateless MCP servers
      if (proc.isOrphan) {
        this.log(`Reaping orphaned MCP process: ${proc.friendlyName} (PID ${proc.pid})`, 'reap');
        await this.terminateProcess(proc.pid, false);
        reapedCount++;
        continue;
      }

      // 3. Deduplication of identical filesystem/memory MCPs if spawned by dead subagents
      if (proc.category === 'mcp-server') {
        const key = `${proc.friendlyName}_${proc.command.replace(/--parent-pid=\d+/, '')}`;
        if (seenMCPs.has(key)) {
          // If we have duplicate identical servers running and PPID is 1 or identical
          const olderPid = seenMCPs.get(key);
          if (proc.ppid === 1 || proc.rssMB < 10) {
            this.log(`Deduplicating redundant MCP instance: ${proc.friendlyName} (PID ${proc.pid})`, 'dedup');
            await this.terminateProcess(proc.pid, false);
            deduplicatedCount++;
            continue;
          }
        } else {
          seenMCPs.set(key, proc.pid);
        }
      }

      // 4. Memory governor: If an individual process is exceeding perProcessMaxMB while idle
      if (proc.rssMB > this.perProcessMaxMB && proc.cpu < 0.5 && !proc.isPaused && proc.category !== 'system-ui' && proc.category !== 'openclaw-agent') {
        this.log(`Throttling high-RAM idle process: ${proc.friendlyName} (PID ${proc.pid}, ${proc.rssMB}MB RSS)`, 'throttle');
        await this.applyQoSEfficiency(proc.pid);
      }
    }

    const summary = `Optimization complete: ${optimizedCount} processes assigned to Efficiency Cores, ${reapedCount} orphans reaped, ${deduplicatedCount} duplicates consolidated.`;
    this.log(summary, 'success');
    return {
      optimizedCount,
      reapedCount,
      deduplicatedCount,
      summary
    };
  }

  startGoverning() {
    if (this.isGoverning) return;
    this.isGoverning = true;
    this.log(`Autonomous System Governor started (interval: ${this.pollIntervalMs / 1000}s, RSS Limit: ${this.maxNodeRSSMB}MB)`, 'start');

    // Run initial optimize pass
    this.optimizeAll().catch(e => this.log(`Initial optimize error: ${e.message}`, 'error'));

    this.timer = setInterval(async () => {
      try {
        const memStats = await this.getSystemMemoryStats();
        const processes = await this.scanProcesses();

        const totalNodeRSS = processes
          .filter(p => p.category.includes('node') || p.category.includes('mcp'))
          .reduce((sum, p) => sum + p.rssMB, 0);

        // If total node memory pressure exceeds threshold or system pressure is critical (>85%)
        if (totalNodeRSS > this.maxNodeRSSMB || memStats.memPressurePercent > 85) {
          this.log(`High memory pressure detected (Node Total: ${totalNodeRSS}MB, System: ${memStats.memPressurePercent}%). Applying auto-throttling...`, 'warn');
          await this.optimizeAll();
        }
      } catch (err) {
        this.log(`Governor cycle error: ${err.message}`, 'error');
      }
    }, this.pollIntervalMs);
  }

  stopGoverning() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isGoverning = false;
    this.log('Autonomous System Governor stopped.', 'stop');
  }
}
