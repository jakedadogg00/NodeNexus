import crypto from 'node:crypto';

export class RemoteAgentBridge {
  constructor(options = {}) {
    this.sharedSecret = options.sharedSecret || process.env.SYSGOV_BRIDGE_SECRET || 'dev_local_secret_openclaw_sysgov';
    this.lastIncomingSequenceNumber = 0;
    this.lastOutgoingSequenceNumber = 0;
    this.maxClockDriftMs = 30000; // 30s replay window
    this.connected = false;
    this.remoteHost = options.remoteHost || 'raspberrypi.local';
  }

  // Validate an incoming message from the Raspberry Pi / remote reasoning host
  verifyIncomingMessage(payload, signature, timestamp, sequenceNumber) {
    // 1. Clock drift & replay check
    const now = Date.now();
    const msgTime = new Date(timestamp).getTime();
    if (Math.abs(now - msgTime) > this.maxClockDriftMs) {
      return { valid: false, error: 'Message timestamp expired or clock drift exceeds 30s threshold.' };
    }

    // 2. Sequence number monotonicity
    if (sequenceNumber <= this.lastIncomingSequenceNumber) {
      return { valid: false, error: `Invalid sequence number (${sequenceNumber} <= ${this.lastIncomingSequenceNumber}). Possible replay attack.` };
    }

    // 3. HMAC-SHA256 signature verification
    const expectedSig = crypto
      .createHmac('sha256', this.sharedSecret)
      .update(`${JSON.stringify(payload)}:${timestamp}:${sequenceNumber}`)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSig, 'hex'))) {
      return { valid: false, error: 'HMAC signature verification failed. Untrusted remote sender.' };
    }

    // 4. Invariant: Reject arbitrary shell execution
    if (payload.command || payload.shell || payload.exec) {
      return { valid: false, error: 'Remote arbitrary shell execution is strictly forbidden by sysgov security policy.' };
    }

    this.lastIncomingSequenceNumber = sequenceNumber;
    return { valid: true, payload };
  }

  signOutgoingTelemetry(telemetry) {
    const timestamp = new Date().toISOString();
    const sequenceNumber = ++this.lastOutgoingSequenceNumber;
    const signature = crypto
      .createHmac('sha256', this.sharedSecret)
      .update(`${JSON.stringify(telemetry)}:${timestamp}:${sequenceNumber}`)
      .digest('hex');

    return {
      telemetry,
      timestamp,
      sequenceNumber,
      signature
    };
  }
}
