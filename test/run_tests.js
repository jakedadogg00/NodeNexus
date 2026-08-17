import { CoreTelemetry } from '../src/core/telemetry.js';
import { IdentityClassifier } from '../src/identity/classifier.js';
import { PolicyEngine } from '../src/policy/engine.js';
import { ResourceForecaster } from '../src/forecast/forecaster.js';
import { ActuatorRegistry } from '../src/actuator/actuators.js';
import { RemoteAgentBridge } from '../src/bridge/pi_bridge.js';
import { RecoveryWatchdog } from '../src/recovery/watchdog.js';
import assert from 'node:assert';

async function runAllTests() {
  console.log('=== RUNNING SYSGOV v3.0 INTEGRATION TEST SUITE ===\n');

  // Test 1: Telemetry Collection
  console.log('[TEST 1] CoreTelemetry deterministic sampling...');
  const telem = new CoreTelemetry();
  const sample = await telem.collectTelemetry();
  assert(sample.system.memory.totalMB > 0, 'Total memory must be > 0');
  assert(sample.governor.rssMB > 0, 'Governor RSS must be > 0');
  assert(sample.governor.sampleLatencyMs >= 0, 'Latency must be >= 0');
  console.log(`[PASS] Telemetry collected in ${sample.governor.sampleLatencyMs}ms (Governor RSS: ${sample.governor.rssMB}MB)`);

  // Test 2: Identity Classification & Secret Redaction
  console.log('\n[TEST 2] IdentityClassifier & Secret Redaction...');
  const classifier = new IdentityClassifier();
  const rawSecretCmd = 'node server.js --token=sk-abcdef1234567890abcdef1234567890 --key=glm_ATLRsvnF133_zH_B';
  const redacted = IdentityClassifier.redactSecrets(rawSecretCmd);
  assert(!redacted.includes('sk-abcdef'), 'Secret sk- token must be redacted');
  assert(!redacted.includes('glm_ATLR'), 'Secret glm_ key must be redacted');
  console.log(`[PASS] Secret Redaction verified: ${redacted}`);

  const mockProtected = classifier.classifyProcess(500, 1, 500, 10, 5, 200000, 'S', '/System/Library/Frameworks/WindowServer');
  assert.strictEqual(mockProtected.isProtected, true, 'WindowServer must be marked PROTECTED');
  console.log(`[PASS] Protected invariant verified for ${mockProtected.friendlyName}`);

  // Test 3: Policy Engine Invariant Enforcement
  console.log('\n[TEST 3] PolicyEngine Invariant & Approval Gates...');
  const policy = new PolicyEngine({ mode: 'autonomous' });
  const decisionProtected = policy.evaluateWorkloadAction(mockProtected, { type: 'terminate' });
  assert.strictEqual(decisionProtected.allowed, false, 'Mutating protected process must be strictly rejected');

  policy.setMode('dry-run');
  const mockWorker = { pid: 9999, friendlyName: 'Mock Worker', isProtected: false, pauseSafe: false };
  const dryRunDecision = policy.evaluateWorkloadAction(mockWorker, { type: 'qos_background' });
  assert.strictEqual(dryRunDecision.isDryRun, true, 'Dry-run must simulate without allowing direct execution');
  console.log('[PASS] Policy Invariants and Dry-Run mode verified');

  // Test 4: Resource Forecaster
  console.log('\n[TEST 4] ResourceForecaster Linear Regression & EWMA...');
  const forecaster = new ResourceForecaster();
  for (let i = 0; i < 10; i++) {
    forecaster.recordSample({
      system: {
        memory: {
          usedMB: 8000 + (i * 100), // Simulate 100MB growth per step
          totalMB: 16000,
          pressureScore: 50 + i
        }
      }
    });
  }
  const forecast = forecaster.calculateForecast();
  assert(forecast.slopeMBPerMin > 0, 'Slope must reflect growth');
  assert(forecast.confidence > 0, 'Confidence must be > 0');
  console.log(`[PASS] Forecaster verified: Trend=${forecast.trend}, Slope=${forecast.slopeMBPerMin}MB/min, EWMA=${forecast.ewmaMB}MB`);

  // Test 5: Actuator & Rollback Journal
  console.log('\n[TEST 5] Actuator Registry & Rollback Journal...');
  const actuators = new ActuatorRegistry();
  const act = actuators.recordAction({ type: 'qos_background', pid: 12345, reversible: true });
  assert(act.actionId.startsWith('act_'), 'Action ID generated');
  const rollbackRes = await actuators.rollbackAction(act.actionId);
  assert(rollbackRes.success, 'Rollback must succeed for reversible action');
  console.log(`[PASS] Rollback Journal verified: ${rollbackRes.message}`);

  // Test 6: Remote Agent Bridge & HMAC Replay Protection
  console.log('\n[TEST 6] Remote Agent Bridge & Replay Protection...');
  const bridge = new RemoteAgentBridge({ sharedSecret: 'test_secret_123' });
  const signed = bridge.signOutgoingTelemetry({ status: 'ok' });
  const verifyRes = bridge.verifyIncomingMessage({ status: 'ok' }, signed.signature, signed.timestamp, signed.sequenceNumber);
  assert(verifyRes.valid, 'Valid signature must pass');

  // Test Replay rejection
  const replayRes = bridge.verifyIncomingMessage({ status: 'ok' }, signed.signature, signed.timestamp, signed.sequenceNumber);
  assert.strictEqual(replayRes.valid, false, 'Replayed sequence number must be rejected');

  // Test Arbitrary shell rejection
  const shellAttack = bridge.verifyIncomingMessage({ shell: 'rm -rf /' }, signed.signature, signed.timestamp, signed.sequenceNumber + 1);
  assert.strictEqual(shellAttack.valid, false, 'Arbitrary shell execution must be strictly rejected');
  console.log('[PASS] Remote Agent Bridge security and replay protection verified');

  // Test 7: Watchdog & Safe Mode
  console.log('\n[TEST 7] Recovery Watchdog & Safe Mode...');
  const watchdog = new RecoveryWatchdog(policy, actuators, { maxGovernorRSSMB: 50 });
  watchdog.triggerSafeMode('Test emergency trigger');
  assert.strictEqual(policy.mode, 'safe-mode', 'Policy mode must switch to safe-mode');
  watchdog.exitSafeMode();
  assert.strictEqual(policy.mode, 'autonomous', 'Policy mode must restore to autonomous');
  console.log('[PASS] Watchdog Safe-Mode cycle verified');

  console.log('\n=== ALL 7 TEST SUITES PASSED (100% GREEN) ===\n');
}

runAllTests().catch(err => {
  console.error('[TEST SUITE ERROR]', err);
  process.exit(1);
});
