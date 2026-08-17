export class RecoveryWatchdog {
  constructor(policyEngine, actuatorRegistry, options = {}) {
    this.policy = policyEngine;
    this.actuators = actuatorRegistry;
    this.maxMemoryRSSMB = options.maxGovernorRSSMB || 120; // If governor itself exceeds 120MB, trigger GC / safe mode
    this.consecutiveFailures = 0;
    this.maxAllowedFailures = 3;
    this.inSafeMode = false;
  }

  checkHealth(governorFootprint) {
    // 1. Self-health check
    if (governorFootprint.rssMB > this.maxMemoryRSSMB) {
      console.warn(`[RecoveryWatchdog] Governor memory footprint (${governorFootprint.rssMB}MB) exceeded safety SLA. Triggering Safe Mode.`);
      this.triggerSafeMode('Governor high memory footprint');
      if (global.gc) global.gc();
      return false;
    }

    return true;
  }

  recordFailure(err) {
    this.consecutiveFailures++;
    console.error(`[RecoveryWatchdog] Failure recorded (${this.consecutiveFailures}/${this.maxAllowedFailures}): ${err.message}`);

    if (this.consecutiveFailures >= this.maxAllowedFailures && !this.inSafeMode) {
      this.triggerSafeMode(`Exceeded ${this.maxAllowedFailures} consecutive cycle failures.`);
    }
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
  }

  triggerSafeMode(reason) {
    this.inSafeMode = true;
    this.policy.setMode('safe-mode');
    console.warn(`[RecoveryWatchdog] SAFE MODE ACTIVATED: ${reason}. Autonomous mutations locked.`);
  }

  exitSafeMode() {
    this.inSafeMode = false;
    this.consecutiveFailures = 0;
    this.policy.setMode('autonomous');
    console.log(`[RecoveryWatchdog] Safe Mode deactivated. Returned to Autonomous mode.`);
  }

  triggerEmergencyShutdown() {
    this.policy.setMode('emergency-shutdown');
    console.error(`[RecoveryWatchdog] EMERGENCY SHUTDOWN ACTIVATED. Terminating non-essential pool workers.`);
  }
}
