import { CoreTelemetry } from './core/telemetry.js';
import { IdentityClassifier } from './identity/classifier.js';
import { PolicyEngine, POLICY_MODES } from './policy/engine.js';
import { ResourceForecaster } from './forecast/forecaster.js';
import { ActuatorRegistry } from './actuator/actuators.js';
import { AIAdvisor } from './ai/advisor.js';
import { RemoteAgentBridge } from './bridge/pi_bridge.js';
import { RecoveryWatchdog } from './recovery/watchdog.js';

export class SystemGovernor {
  constructor(options = {}) {
    this.pollIntervalMs = options.pollIntervalMs || 4000;
    this.isGoverning = false;
    this.timer = null;
    this.logs = [];

    // Core Modular Subsystems
    this.telemetry = new CoreTelemetry({ baseIntervalMs: this.pollIntervalMs });
    this.identity = new IdentityClassifier();
    this.policy = new PolicyEngine(options.policyConfig || {});
    this.forecaster = new ResourceForecaster();
    this.actuators = new ActuatorRegistry();
    this.ai = new AIAdvisor({ enabled: options.enableAI || false });
    this.bridge = new RemoteAgentBridge();
    this.watchdog = new RecoveryWatchdog(this.policy, this.actuators);

    this.latestState = {
      telemetry: null,
      workloads: [],
      forecast: null,
      mode: this.policy.mode,
      activeIncidents: []
    };
  }

  log(message, type = 'info') {
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      message
    };
    this.logs.unshift(entry);
    if (this.logs.length > 250) this.logs.pop();
    console.log(`[SysGov][${type.toUpperCase()}] ${message}`);
  }

  async runCycle() {
    try {
      // 1. Collect Telemetry
      const telem = await this.telemetry.collectTelemetry();
      this.latestState.telemetry = telem;

      // 2. Watchdog Self-Check
      this.watchdog.checkHealth(telem.governor);

      // 3. Scan & Classify Workloads
      const workloads = await this.identity.scanAndClassifyAll();
      this.latestState.workloads = workloads;

      // 4. Calculate Resource Forecast
      const forecast = this.forecaster.recordSample(telem);
      this.latestState.forecast = forecast;
      this.latestState.mode = this.policy.mode;

      // 5. Check Invariants & Apply Policy-Governed Optimizations
      await this.evaluateAndAct(telem, workloads, forecast);

      this.watchdog.recordSuccess();
    } catch (err) {
      this.log(`Cycle execution error: ${err.message}`, 'error');
      this.watchdog.recordFailure(err);
    }
  }

  async evaluateAndAct(telem, workloads, forecast) {
    const nodeWorkloads = workloads.filter(w => w.workloadType.includes('mcp') || w.workloadType.includes('node'));
    const totalNodeRSSMB = nodeWorkloads.reduce((sum, w) => sum + w.rssMB, 0);

    const isSystemCritical = telem.system.memory.pressureScore > this.policy.memoryPressureThresholdPercent;
    const isNodeBudgetExceeded = totalNodeRSSMB > this.policy.maxTotalNodeRSSMB;

    if (isSystemCritical || isNodeBudgetExceeded || forecast.trend === 'rapidly_growing') {
      this.log(`Resource pressure threshold triggered (Node: ${totalNodeRSSMB}MB / ${this.policy.maxTotalNodeRSSMB}MB, Pressure: ${telem.system.memory.pressureScore}%, Forecast: ${forecast.trend})`, 'warn');

      for (const workload of nodeWorkloads) {
        // Skip protected workloads
        if (workload.isProtected) continue;

        // Policy Check 1: QoS Backgrounding for heavy background workers
        const qosDecision = this.policy.evaluateWorkloadAction(workload, { type: 'qos_background' });
        if (qosDecision.allowed) {
          await this.actuators.applyQoSEfficiency(workload.pid, 'memory_pressure_mitigation');
        }

        // Policy Check 2: Orphan Reaping
        if (workload.isOrphan) {
          const termDecision = this.policy.evaluateWorkloadAction(workload, { type: 'terminate' });
          if (termDecision.allowed) {
            this.log(`Reaping verified orphaned worker: ${workload.friendlyName} (PID ${workload.pid})`, 'reap');
            await this.actuators.terminateProcess(workload.pid, false, 'orphan_reap');
          }
        }
      }
    }
  }

  async optimizeAll(dryRun = false) {
    this.log(`Running comprehensive optimization pass (Dry-Run: ${dryRun})...`, 'optimize');
    const workloads = await this.identity.scanAndClassifyAll();
    let qosApplied = 0;
    let orphansReaped = 0;
    const actionsTaken = [];

    for (const w of workloads) {
      if (w.isProtected) continue;

      if (w.workloadType === 'mcp-worker' || w.workloadType === 'python-worker') {
        const decision = this.policy.evaluateWorkloadAction(w, { type: 'qos_background' });
        if (decision.allowed && !dryRun) {
          await this.actuators.applyQoSEfficiency(w.pid, 'manual_optimize');
          qosApplied++;
          actionsTaken.push({ pid: w.pid, action: 'qos_background', target: w.friendlyName });
        } else if (decision.isDryRun || dryRun) {
          actionsTaken.push({ pid: w.pid, action: 'dry_run_qos', target: w.friendlyName });
        }
      }

      if (w.isOrphan) {
        const decision = this.policy.evaluateWorkloadAction(w, { type: 'terminate' });
        if (decision.allowed && !dryRun) {
          await this.actuators.terminateProcess(w.pid, false, 'orphan_cleanup');
          orphansReaped++;
          actionsTaken.push({ pid: w.pid, action: 'reap_orphan', target: w.friendlyName });
        } else if (decision.isDryRun || dryRun) {
          actionsTaken.push({ pid: w.pid, action: 'dry_run_reap_orphan', target: w.friendlyName });
        }
      }
    }

    const summary = `Optimization completed: ${qosApplied} processes scheduled on Efficiency Cores, ${orphansReaped} orphans safely reaped.`;
    this.log(summary, 'success');

    return {
      success: true,
      dryRun,
      qosApplied,
      orphansReaped,
      actionsTaken,
      summary
    };
  }

  startGoverning() {
    if (this.isGoverning) return;
    this.isGoverning = true;
    this.log(`OpenClaw System Governor v3.0 active (Mode: ${this.policy.mode}, Interval: ${this.pollIntervalMs}ms)`, 'start');

    this.runCycle().catch(e => this.log(`Initial cycle error: ${e.message}`, 'error'));

    this.timer = setInterval(async () => {
      await this.runCycle();
    }, this.pollIntervalMs);
  }

  stopGoverning() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isGoverning = false;
    this.log('System Governor stopped.', 'stop');
  }

  getStatus() {
    return {
      status: this.watchdog.inSafeMode ? 'safe-mode' : 'healthy',
      mode: this.policy.mode,
      uptimeSec: Math.round(process.uptime()),
      telemetry: this.latestState.telemetry,
      forecast: this.latestState.forecast,
      workloadsCount: this.latestState.workloads.length,
      recentActions: this.actuators.getJournal(10),
      logs: this.logs.slice(0, 30)
    };
  }
}
