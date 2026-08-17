export const POLICY_MODES = {
  AUDIT: 'audit',
  OBSERVE: 'observe',
  RECOMMENDATION: 'recommendation',
  DRY_RUN: 'dry-run',
  SUPERVISED: 'supervised',
  AUTONOMOUS: 'autonomous',
  SAFE_MODE: 'safe-mode',
  EMERGENCY_SHUTDOWN: 'emergency-shutdown'
};

export class PolicyEngine {
  constructor(config = {}) {
    this.mode = config.mode || POLICY_MODES.AUTONOMOUS;
    this.maxTotalNodeRSSMB = config.maxTotalNodeRSSMB || 1500;
    this.maxSingleProcessRSSMB = config.maxSingleProcessRSSMB || 600;
    this.memoryPressureThresholdPercent = config.memoryPressureThresholdPercent || 85;
    this.spawnRateLimitPerSec = config.spawnRateLimitPerSec || 5;

    // Explicit Allow and Deny lists
    this.allowlist = new Set(config.allowlist || []);
    this.denylist = new Set(config.denylist || []);
    this.pendingApprovals = new Map(); // id -> proposal
  }

  setMode(newMode) {
    if (Object.values(POLICY_MODES).includes(newMode)) {
      this.mode = newMode;
      return true;
    }
    return false;
  }

  evaluateWorkloadAction(workload, proposedAction) {
    // 1. Invariant Safety Check: Never allow destructive actions on protected workloads
    if (workload.isProtected) {
      return {
        allowed: false,
        reason: `Workload '${workload.friendlyName}' (PID ${workload.pid}) is marked PROTECTED. All mutations rejected.`,
        requiresApproval: false,
        mode: this.mode
      };
    }

    // 2. Mode enforcement
    if (this.mode === POLICY_MODES.AUDIT || this.mode === POLICY_MODES.OBSERVE) {
      return {
        allowed: false,
        reason: `System is in read-only mode (${this.mode}). Mutations disabled.`,
        requiresApproval: false,
        mode: this.mode
      };
    }

    if (this.mode === POLICY_MODES.DRY_RUN) {
      return {
        allowed: false,
        isDryRun: true,
        reason: `Dry-run simulation: action '${proposedAction.type}' on PID ${workload.pid} would be executed.`,
        requiresApproval: false,
        mode: this.mode
      };
    }

    if (this.mode === POLICY_MODES.SAFE_MODE) {
      // Safe mode only permits non-destructive QoS recovery
      if (proposedAction.type === 'qos_background' || proposedAction.type === 'pool_sleep') {
        return { allowed: true, requiresApproval: false, mode: this.mode };
      }
      return {
        allowed: false,
        reason: `System is in safe-mode. Only non-destructive QoS and pool-sleep actions allowed.`,
        requiresApproval: false,
        mode: this.mode
      };
    }

    if (this.mode === POLICY_MODES.SUPERVISED) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Supervised mode active. Action '${proposedAction.type}' requires explicit human approval.`,
        mode: this.mode
      };
    }

    // Autonomous Mode: Capability & Risk Check
    if (proposedAction.type === 'qos_background' || proposedAction.type === 'pool_sleep') {
      return { allowed: true, requiresApproval: false, mode: this.mode };
    }

    if (proposedAction.type === 'pause') {
      if (!workload.pauseSafe) {
        return {
          allowed: false,
          reason: `Workload '${workload.friendlyName}' is NOT pause-safe (SIGSTOP can cause client socket deadlocks).`,
          requiresApproval: true,
          mode: this.mode
        };
      }
      return { allowed: true, requiresApproval: false, mode: this.mode };
    }

    if (proposedAction.type === 'terminate') {
      // Allow autonomous termination ONLY for verified orphaned MCP workers or deduplicated idle workers
      if (workload.isOrphan || proposedAction.reason === 'deduplication') {
        return { allowed: true, requiresApproval: false, mode: this.mode };
      }
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Termination of active workload '${workload.friendlyName}' requires human confirmation.`,
        mode: this.mode
      };
    }

    return { allowed: false, reason: 'Unknown action or unhandled policy boundary.', requiresApproval: true, mode: this.mode };
  }
}
