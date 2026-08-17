import os from 'node:os';
import { exec } from 'node:child_process';
import util from 'node:util';

const execPromise = util.promisify(exec);

export class CoreTelemetry {
  constructor(options = {}) {
    this.baseIntervalMs = options.baseIntervalMs || 4000;
    this.minIntervalMs = 1000;
    this.maxIntervalMs = 10000;
    this.currentIntervalMs = this.baseIntervalMs;
    this.lastSample = null;
    this.history = [];
    this.maxHistory = 120; // 120 data points (~8-10 mins)
  }

  async collectTelemetry() {
    const startHrTime = process.hrtime.bigint();
    const timestamp = new Date().toISOString();

    // 1. Governor Self-Footprint
    const memUsage = process.memoryUsage();
    const governorFootprint = {
      rssMB: Math.round(memUsage.rss / (1024 * 1024)),
      heapUsedMB: Math.round(memUsage.heapUsed / (1024 * 1024)),
      heapTotalMB: Math.round(memUsage.heapTotal / (1024 * 1024)),
      externalMB: Math.round(memUsage.external / (1024 * 1024)),
      uptimeSec: Math.round(process.uptime())
    };

    // 2. Memory & Virtual Memory (vm_stat + swap)
    let memoryStats = await this.getMemoryStats();

    // 3. System Load & Thermal / Power
    const loadAvg = os.loadavg();
    const cpus = os.cpus();
    const cpuCount = cpus.length;

    let powerThermal = await this.getPowerThermalStats();

    // 4. WindowServer Health Metric
    let windowServerStats = await this.getWindowServerStats();

    const sampleDurationMs = Number((process.hrtime.bigint() - startHrTime) / 1000000n);

    const sample = {
      timestamp,
      governor: {
        ...governorFootprint,
        sampleLatencyMs: sampleDurationMs
      },
      system: {
        cpuCount,
        loadAvg,
        memory: memoryStats,
        powerThermal,
        windowServer: windowServerStats
      }
    };

    this.lastSample = sample;
    this.history.push(sample);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Adaptive Sampling Adjustment
    this.adjustSamplingRate(memoryStats, loadAvg[0], cpuCount);

    return sample;
  }

  adjustSamplingRate(memoryStats, load1m, cpuCount) {
    const isPressureHigh = memoryStats.pressureScore > 75 || load1m > cpuCount * 0.85;
    const isPressureLow = memoryStats.pressureScore < 30 && load1m < cpuCount * 0.3;

    if (isPressureHigh) {
      this.currentIntervalMs = Math.max(this.minIntervalMs, this.currentIntervalMs - 1000);
    } else if (isPressureLow) {
      this.currentIntervalMs = Math.min(this.maxIntervalMs, this.currentIntervalMs + 500);
    } else {
      this.currentIntervalMs = this.baseIntervalMs;
    }
  }

  async getMemoryStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    let pageStats = {
      free: 0,
      active: 0,
      inactive: 0,
      speculative: 0,
      wired: 0,
      compressed: 0,
      pageins: 0,
      pageouts: 0,
      swapins: 0,
      swapouts: 0
    };

    const pageSize = 16384; // 16KB on Apple Silicon (or 4096 on Intel)

    try {
      const { stdout } = await execPromise('vm_stat');
      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.split(':');
        if (parts.length < 2) continue;
        const key = parts[0].trim();
        const val = parseInt(parts[1].trim().replace('.', ''), 10) || 0;

        if (key.includes('Pages free')) pageStats.free = val * pageSize;
        else if (key.includes('Pages active')) pageStats.active = val * pageSize;
        else if (key.includes('Pages inactive')) pageStats.inactive = val * pageSize;
        else if (key.includes('Pages speculative')) pageStats.speculative = val * pageSize;
        else if (key.includes('Pages wired down')) pageStats.wired = val * pageSize;
        else if (key.includes('Pages occupied by compressor')) pageStats.compressed = val * pageSize;
        else if (key.includes('Pageins')) pageStats.pageins = val;
        else if (key.includes('Pageouts')) pageStats.pageouts = val;
        else if (key.includes('Swapins')) pageStats.swapins = val;
        else if (key.includes('Swapouts')) pageStats.swapouts = val;
      }
    } catch (e) {}

    let swapUsedMB = 0;
    let swapTotalMB = 0;
    try {
      const { stdout: swapOut } = await execPromise('sysctl -n vm.swapusage');
      const match = swapOut.match(/total\s*=\s*([\d.]+)M\s+used\s*=\s*([\d.]+)M\s+free\s*=\s*([\d.]+)M/);
      if (match) {
        swapTotalMB = parseFloat(match[1]);
        swapUsedMB = parseFloat(match[2]);
      }
    } catch (e) {}

    const usedBytes = totalMem - (pageStats.free || freeMem);
    const pressureScore = Math.min(100, Math.round((usedBytes / totalMem) * 100));

    return {
      totalMB: Math.round(totalMem / (1024 * 1024)),
      usedMB: Math.round(usedBytes / (1024 * 1024)),
      freeMB: Math.round((pageStats.free || freeMem) / (1024 * 1024)),
      activeMB: Math.round(pageStats.active / (1024 * 1024)),
      inactiveMB: Math.round(pageStats.inactive / (1024 * 1024)),
      wiredMB: Math.round(pageStats.wired / (1024 * 1024)),
      compressedMB: Math.round(pageStats.compressed / (1024 * 1024)),
      swapUsedMB,
      swapTotalMB,
      pressureScore,
      pressureState: pressureScore > 85 ? 'critical' : pressureScore > 70 ? 'warn' : 'nominal',
      pageins: pageStats.pageins,
      pageouts: pageStats.pageouts
    };
  }

  async getPowerThermalStats() {
    let onBattery = false;
    let batteryPercent = 100;
    let thermalLevel = 'nominal';

    try {
      const { stdout } = await execPromise('pmset -g batt 2>/dev/null || true');
      if (stdout.includes('Battery Power')) onBattery = true;
      const match = stdout.match(/(\d+)%/);
      if (match) batteryPercent = parseInt(match[1], 10);
    } catch (e) {}

    return {
      onBattery,
      batteryPercent,
      thermalLevel
    };
  }

  async getWindowServerStats() {
    try {
      const { stdout } = await execPromise('ps -eo pid,ppid,%cpu,%mem,rss,stat,command | grep WindowServer | grep -v grep || true');
      if (!stdout.trim()) return { running: false, cpu: 0, rssMB: 0, responsive: false };

      const parts = stdout.trim().split('\n')[0].split(/\s+/);
      const cpu = parseFloat(parts[2]) || 0;
      const rssKB = parseInt(parts[4], 10) || 0;

      return {
        running: true,
        pid: parseInt(parts[0], 10),
        cpu,
        rssMB: Math.round(rssKB / 1024),
        responsive: cpu < 95 // If WindowServer pegged at 100% CPU, UI event loop is starved
      };
    } catch (e) {
      return { running: false, cpu: 0, rssMB: 0, responsive: false };
    }
  }
}
