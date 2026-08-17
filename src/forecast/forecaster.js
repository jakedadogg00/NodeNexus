export class ResourceForecaster {
  constructor(options = {}) {
    this.historyLimit = options.historyLimit || 60;
    this.memorySamples = [];
    this.ewmaMemory = null;
    this.alpha = 0.2;
  }

  recordSample(sample, customTimestamp = null) {
    const timestamp = customTimestamp || Date.now();
    const usedMB = sample.system?.memory?.usedMB ?? (sample.usedMB || 0);
    const totalMB = sample.system?.memory?.totalMB ?? (sample.totalMB || 16000);

    if (this.ewmaMemory === null) {
      this.ewmaMemory = usedMB;
    } else {
      this.ewmaMemory = (this.alpha * usedMB) + ((1 - this.alpha) * this.ewmaMemory);
    }

    const entry = {
      timestamp,
      usedMB,
      totalMB,
      ewmaMB: Math.round(this.ewmaMemory)
    };

    this.memorySamples.push(entry);
    if (this.memorySamples.length > this.historyLimit) {
      this.memorySamples.shift();
    }

    return this.calculateForecast();
  }

  calculateForecast() {
    if (this.memorySamples.length < 5) {
      return {
        trend: 'stabilizing',
        slopeMBPerMin: 0,
        minutesUntilCritical: null,
        confidence: 0.1,
        ewmaMB: this.ewmaMemory ? Math.round(this.ewmaMemory) : 0
      };
    }

    const n = Math.min(20, this.memorySamples.length);
    const recent = this.memorySamples.slice(-n);

    const firstTime = recent[0].timestamp;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      // If timestamps are identical in tight loops, fallback to index-based intervals (e.g. 4s per sample)
      let xSec = (recent[i].timestamp - firstTime) / 1000;
      if (recent[recent.length - 1].timestamp === firstTime) {
        xSec = i * 4;
      }

      const y = recent[i].usedMB;
      sumX += xSec;
      sumY += y;
      sumXY += (xSec * y);
      sumX2 += (xSec * xSec);
    }

    const denominator = (n * sumX2) - (sumX * sumX);
    let slopeMBPerSec = 0;
    if (denominator !== 0) {
      slopeMBPerSec = ((n * sumXY) - (sumX * sumY)) / denominator;
    }

    const slopeMBPerMin = Math.round(slopeMBPerSec * 60 * 10) / 10;
    const currentSample = recent[recent.length - 1];
    const criticalThresholdMB = currentSample.totalMB * 0.88;

    let minutesUntilCritical = null;
    let trend = 'stable';

    if (slopeMBPerMin > 50) {
      trend = 'rapidly_growing';
      const remainingMB = criticalThresholdMB - currentSample.usedMB;
      if (remainingMB > 0 && slopeMBPerMin > 0) {
        minutesUntilCritical = Math.max(1, Math.round(remainingMB / slopeMBPerMin));
      } else {
        minutesUntilCritical = 0;
      }
    } else if (slopeMBPerMin > 10) {
      trend = 'slowly_rising';
    } else if (slopeMBPerMin < -10) {
      trend = 'recovering';
    }

    const confidence = Math.min(0.95, (n / 20) * 0.9);

    return {
      trend,
      slopeMBPerMin,
      minutesUntilCritical,
      confidence: Math.round(confidence * 100) / 100,
      ewmaMB: Math.round(this.ewmaMemory)
    };
  }
}
