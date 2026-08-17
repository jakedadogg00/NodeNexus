import { exec } from 'node:child_process';
import util from 'node:util';

const execPromise = util.promisify(exec);

export class ActuatorRegistry {
  constructor() {
    this.actionJournal = [];
    this.maxJournal = 200;
  }

  // Record an action in the rollback journal
  recordAction(action) {
    const entry = {
      actionId: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...action,
      status: 'executed',
      rolledBack: false
    };
    this.actionJournal.unshift(entry);
    if (this.actionJournal.length > this.maxJournal) {
      this.actionJournal.pop();
    }
    return entry;
  }

  // Actuator 1: Apple Silicon Background QoS (taskpolicy -b)
  async applyQoSEfficiency(pid, reason = 'background_tier') {
    try {
      await execPromise(`taskpolicy -b -p ${pid} 2>/dev/null || true`);
      return this.recordAction({
        type: 'qos_background',
        pid,
        reversible: true,
        rollbackCmd: `taskpolicy -B -p ${pid}`,
        reason
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Actuator 2: Revert QoS to standard priority (taskpolicy -B)
  async revertQoSPriority(pid) {
    try {
      await execPromise(`taskpolicy -B -p ${pid} 2>/dev/null || true`);
      return { success: true, pid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Actuator 3: Graceful Process Termination (SIGTERM with fallback)
  async terminateProcess(pid, force = false, reason = 'orphan_cleanup') {
    try {
      const sig = force ? 'SIGKILL' : 'SIGTERM';
      process.kill(pid, sig);
      return this.recordAction({
        type: 'terminate',
        pid,
        force,
        reversible: false,
        reason
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Actuator 4: Rollback an executed action
  async rollbackAction(actionId) {
    const entry = this.actionJournal.find(a => a.actionId === actionId);
    if (!entry) {
      return { success: false, error: `Action ID '${actionId}' not found in journal.` };
    }

    if (entry.rolledBack) {
      return { success: false, error: `Action ID '${actionId}' has already been rolled back.` };
    }

    if (!entry.reversible) {
      return { success: false, error: `Action '${entry.type}' is marked non-reversible.` };
    }

    if (entry.type === 'qos_background') {
      const res = await this.revertQoSPriority(entry.pid);
      if (res.success) {
        entry.rolledBack = true;
        entry.rollbackTimestamp = new Date().toISOString();
        return { success: true, message: `Successfully rolled back QoS on PID ${entry.pid}.`, entry };
      }
      return res;
    }

    return { success: false, error: `No rollback handler implemented for action type '${entry.type}'.` };
  }

  getJournal(limit = 50) {
    return this.actionJournal.slice(0, limit);
  }
}
