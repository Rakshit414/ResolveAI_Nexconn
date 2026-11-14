// server/src/services/translationCircuitBreaker.js

export class TranslationCircuitBreaker {
  constructor({ threshold = 3, resetTimeout = 60000 } = {}) {
    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.failureCount = 0;
    this.threshold = threshold; // Exactly 3 consecutive transient failures trip breaker
    this.resetTimeout = resetTimeout; // 60s cooldown
    this.nextProbeAt = 0;
    this.probeInFlight = false; // Mutex: allows exactly ONE real translation call during HALF_OPEN
  }

  // Non-mutating status check for routing decisions (CLOSED only)
  // Routing decisions must NEVER consume or bypass the single recovery probe!
  isOperational() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '' || apiKey.includes('your_')) {
      if (process.env.NODE_ENV !== 'test') return false;
    }
    // Strictly CLOSED only! While OPEN or HALF_OPEN, English-bridge routing is disabled!
    return this.state === 'CLOSED';
  }

  // Invoked before initiating an actual translation request to Gemini
  canAttemptTranslation() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '' || apiKey.includes('your_')) {
      if (process.env.NODE_ENV !== 'test') return false;
    }
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextProbeAt) {
        this.state = 'HALF_OPEN';
        this.probeInFlight = false;
      } else {
        return false;
      }
    }
    if (this.state === 'HALF_OPEN') {
      if (this.probeInFlight) return false; // Mutex: block concurrent probe requests!
      this.probeInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
    this.probeInFlight = false;
  }

  recordFailure(error = {}) {
    this.failureCount++;
    this.probeInFlight = false;

    const errMsg = error?.message || String(error);
    const errCode = error?.code;

    // Immediate OPEN on non-transient auth errors (24 hour cooldown)
    if (errCode === 'ERR_AUTH_INVALID' || errCode === 'ERR_AUTH_MISSING' || errMsg.includes('API_KEY_INVALID')) {
      this.state = 'OPEN';
      this.nextProbeAt = Date.now() + 86400000; // 24 hours
      console.warn(`[Translation Circuit Breaker OPEN] Non-transient auth error: ${errMsg}. Cooldown: 24 hours.`);
      return;
    }

    // Standard threshold: 3 consecutive transient failures trip breaker
    if (this.failureCount >= this.threshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextProbeAt = Date.now() + this.resetTimeout; // 60 seconds
      console.warn(`[Translation Circuit Breaker OPEN] Upstream threshold reached (${this.failureCount}/${this.threshold}): ${errMsg}. Cooldown: ${this.resetTimeout / 1000}s.`);
    } else {
      console.warn(`[Translation Failure Note] Upstream transient failure (${this.failureCount}/${this.threshold}): ${errMsg}. Breaker remains ${this.state}.`);
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.nextProbeAt = 0;
    this.probeInFlight = false;
  }
}

export const translationBreaker = new TranslationCircuitBreaker();
export default translationBreaker;
