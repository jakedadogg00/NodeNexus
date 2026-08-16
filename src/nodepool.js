import { spawn } from 'node:child_process';
import EventEmitter from 'node:events';
import util from 'node:util';
import { exec } from 'node:child_process';

const execPromise = util.promisify(exec);

export class NodePoolManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.defaultIdleTimeoutMs = options.defaultIdleTimeoutMs || 60000; // 60s idle timeout
    this.servers = new Map(); // name -> server definition
    this.instances = new Map(); // key -> active instance object
    this.metrics = {
      totalSpawns: 0,
      totalRequests: 0,
      memorySavedMB: 0
    };

    this.registerDefaultCatalog();
  }

  registerDefaultCatalog() {
    this.registerServer('filesystem', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/maxbutler'],
      description: 'Filesystem MCP Server (Lazy On-Demand)'
    });

    this.registerServer('memory', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      description: 'Knowledge Graph Memory MCP Server'
    });

    this.registerServer('sequential-thinking', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      description: 'Sequential Thinking Dynamic Reasoning Server'
    });

    this.registerServer('puppeteer', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
      description: 'Puppeteer Headless Browser Automation'
    });

    this.registerServer('firecrawl', {
      command: 'npx',
      args: ['-y', 'firecrawl-mcp'],
      description: 'Firecrawl Deep Web Scraper'
    });

    this.registerServer('pinecone', {
      command: 'npx',
      args: ['-y', 'pinecone-mcp'],
      description: 'Pinecone Vector Database Server'
    });

    this.registerServer('supabase', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-supabase'],
      description: 'Supabase Database & Edge Functions Server'
    });

    this.registerServer('agentweb', {
      command: 'npx',
      args: ['-y', 'agentweb-mcp'],
      description: 'AgentWeb Browser Automation MCP'
    });

    this.registerServer('github', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      description: 'GitHub Issues & PRs MCP Server'
    });
  }

  registerServer(name, config) {
    this.servers.set(name, {
      name,
      command: config.command || 'node',
      args: config.args || [],
      env: config.env || {},
      idleTimeoutMs: config.idleTimeoutMs || this.defaultIdleTimeoutMs,
      description: config.description || `MCP Server (${name})`
    });
  }

  async acquireServer(name, extraArgs = []) {
    this.metrics.totalRequests++;
    const key = extraArgs.length > 0 ? `${name}_${extraArgs.join('_')}` : name;
    let instance = this.instances.get(key);

    if (instance && instance.process && !instance.process.killed) {
      this.clearIdleTimer(key);
      this.emit('log', `Reusing warm shared instance for '${key}' (PID: ${instance.process.pid})`, 'action');
      return instance;
    }

    return await this.spawnOnDemand(name, extraArgs, key);
  }

  async spawnOnDemand(name, extraArgs = [], key = null) {
    const instanceKey = key || (extraArgs.length > 0 ? `${name}_${extraArgs.join('_')}` : name);
    let config = this.servers.get(name);

    let command = 'npx';
    let args = ['-y', name];

    if (config) {
      command = config.command;
      args = extraArgs.length > 0 ? [...config.args, ...extraArgs] : [...config.args];
    } else {
      // Dynamic fallback for custom commands
      if (name.startsWith('npx') || name.startsWith('node')) {
        const parts = name.split(' ');
        command = parts[0];
        args = [...parts.slice(1), ...extraArgs];
      } else {
        command = 'npx';
        args = ['-y', name, ...extraArgs];
      }
      this.registerServer(name, { command, args, description: `Dynamic MCP Server (${name})` });
    }

    this.emit('log', `Spinning up on-demand server '${instanceKey}' (${command} ${args.join(' ')})...`, 'start');

    const startTime = Date.now();
    const child = spawn(command, args, {
      env: { ...process.env, ...(config?.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.metrics.totalSpawns++;

    const instance = {
      name: instanceKey,
      baseName: name,
      process: child,
      pid: child.pid,
      spawnedAt: new Date().toISOString(),
      lastActiveAt: Date.now(),
      requestCount: 1,
      idleTimer: null,
      idleCountdown: Math.round((config?.idleTimeoutMs || this.defaultIdleTimeoutMs) / 1000),
      status: 'warm'
    };

    // Apply macOS Efficiency Core QoS
    try {
      await execPromise(`taskpolicy -b -p ${child.pid} 2>/dev/null || true`);
    } catch (e) {}

    child.on('error', (err) => {
      this.emit('log', `Process error on '${instanceKey}' (PID ${child.pid}): ${err.message}`, 'error');
      this.instances.delete(instanceKey);
    });

    child.on('exit', (code, signal) => {
      this.emit('log', `Server '${instanceKey}' (PID ${child.pid}) spun down (exit code: ${code || signal || 0})`, 'stop');
      this.instances.delete(instanceKey);
    });

    this.instances.set(instanceKey, instance);
    const latency = Date.now() - startTime;
    this.emit('log', `Server '${instanceKey}' is warm and ready (PID: ${child.pid}, spawn latency: ${latency}ms)`, 'success');

    return instance;
  }

  touchServer(key) {
    const instance = this.instances.get(key);
    if (!instance) return;

    instance.lastActiveAt = Date.now();
    instance.requestCount++;
    this.resetIdleTimer(key);
  }

  clearIdleTimer(key) {
    const instance = this.instances.get(key);
    if (instance && instance.idleTimer) {
      clearTimeout(instance.idleTimer);
      instance.idleTimer = null;
    }
  }

  resetIdleTimer(key) {
    const instance = this.instances.get(key);
    if (!instance) return;

    this.clearIdleTimer(key);
    const config = this.servers.get(instance.baseName || key);
    const timeout = (config && config.idleTimeoutMs) || this.defaultIdleTimeoutMs;

    instance.idleTimer = setTimeout(() => {
      this.spinDownServer(key, 'idle timeout');
    }, timeout);
  }

  async spinDownServer(key, reason = 'manual') {
    const instance = this.instances.get(key);
    if (!instance || !instance.process) return;

    this.emit('log', `Spinning down server '${key}' (PID: ${instance.pid}) due to: ${reason}`, 'reap');
    try {
      instance.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.instances.has(key)) {
          try { instance.process.kill('SIGKILL'); } catch (e) {}
          this.instances.delete(key);
        }
      }, 2000);
    } catch (e) {
      this.instances.delete(key);
    }
  }

  async spinDownAll() {
    this.emit('log', 'Spinning down all warm pool instances...', 'action');
    const keys = Array.from(this.instances.keys());
    for (const key of keys) {
      await this.spinDownServer(key, 'shutdown');
    }
  }

  getStatus() {
    const catalog = [];
    for (const [name, cfg] of this.servers.entries()) {
      const active = this.instances.get(name);
      let idleRemainingSec = 0;
      if (active) {
        const timeout = cfg.idleTimeoutMs || this.defaultIdleTimeoutMs;
        const elapsed = Date.now() - active.lastActiveAt;
        idleRemainingSec = Math.max(0, Math.round((timeout - elapsed) / 1000));
      }

      catalog.push({
        name,
        description: cfg.description,
        command: `${cfg.command} ${cfg.args.join(' ')}`,
        status: active ? 'warm' : 'idle_sleeping',
        pid: active ? active.pid : null,
        spawnedAt: active ? active.spawnedAt : null,
        requestCount: active ? active.requestCount : 0,
        idleRemainingSec: active ? idleRemainingSec : 0
      });
    }

    const warmCount = this.instances.size;
    const sleepingCount = this.servers.size - warmCount;
    const estimatedSavedMB = sleepingCount * 65;

    return {
      totalCatalogServers: this.servers.size,
      warmInstancesCount: warmCount,
      sleepingInstancesCount: sleepingCount,
      estimatedSavedMB,
      metrics: this.metrics,
      servers: catalog
    };
  }
}
