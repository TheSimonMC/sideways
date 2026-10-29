  // One independently owned acoustic voice. This class is also serialized into
  // the Worklet and SDK module, so it has no outer-scope runtime dependencies.
  // Parameters supplied to process() are already smoothed by MotorAcoustics.
  class AcousticLayer {
    constructor(sr, options = {}) {
      if (!(Number.isFinite(sr) && sr >= 8000)) throw new RangeError('Ungültige Layer-Abtastrate.');
      const budget = options.budget === undefined ? .1 : options.budget;
      const outputNorm = options.outputKernelNorm === undefined ? 1 : options.outputKernelNorm;
      if (!(Number.isFinite(budget) && budget > 0 && Number.isFinite(outputNorm) && outputNorm >= 1))
        throw new RangeError('Ungültige Layer-Spitzenreserve.');
      this.sr = sr;
      this.name = typeof options.name === 'string' ? options.name : '';
      this.index = Number.isInteger(options.index) ? options.index : 0;
      this.budget = budget;
      this.outputKernelNorm = outputNorm;
      this.bound = budget / outputNorm;
      this.oversample = options.oversample === 4 ? 4 : 2;
      // Both rates retain the same four-device-sample FIR group delay. ADAA
      // averages one oversampled interval and contributes another half of it.
      this.latencySamples = 4 + .5 / this.oversample;
      this.kernelLength = 8 * this.oversample + 1;
      const middle = (this.kernelLength - 1) / 2;
      this.kernel = new Float64Array(this.kernelLength);
      this.dryHistory = new Float64Array(this.kernelLength);
      this.wetHistory = new Float64Array(this.kernelLength);
      let sum = 0;
      for (let i = 0; i < this.kernelLength; i++) {
        const x = i - middle;
        const window = .42 - .5 * Math.cos(2 * Math.PI * i / (this.kernelLength - 1)) +
          .08 * Math.cos(4 * Math.PI * i / (this.kernelLength - 1));
        const value = x === 0 ? 1 / this.oversample : x % this.oversample === 0 ? 0 :
          Math.sin(Math.PI * x / this.oversample) / (Math.PI * x) * window;
        this.kernel[i] = value;
        sum += value;
      }
      this.kernelNorm = 0;
      for (let i = 0; i < this.kernelLength; i++) {
        this.kernel[i] /= sum;
        this.kernelNorm += Math.abs(this.kernel[i]);
      }
      // Sparse symmetric convolution: two histories, one set of coefficients.
      // Exact sinc zeros are omitted rather than multiplied in the sample loop.
      let pairCount = 0;
      for (let i = 0; i < middle; i++) if (Math.abs(this.kernel[i]) > 1e-16) pairCount++;
      this.pairOffsets = new Int32Array(pairCount);
      this.pairWeights = new Float64Array(pairCount);
      for (let i = 0, p = 0; i < middle; i++) if (Math.abs(this.kernel[i]) > 1e-16) {
        this.pairOffsets[p] = i;
        this.pairWeights[p++] = this.kernel[i];
      }
      this.middle = middle;
      this.centerWeight = this.kernel[middle];
      // A convex dry/wet mix cannot exceed either branch's bound. The local
      // FIR absolute coefficient sum and the subsequent output norm are both
      // reserved here, independent of the number or state of other voices.
      this.clipLevel = this.bound / this.kernelNorm;
      this.dcPole = Math.exp(-2 * Math.PI * 12 / sr);
      // The nonlinear loop's effective slope falls during strong asymmetric
      // saturation. A nominal 12 Hz servo still acts on low-frequency bias,
      // but settles within the actual startup/analysis window in that case.
      this.biasPole = 1 - Math.exp(-2 * Math.PI * 12 / sr);
      this.clear();
    }
    clear() {
      this.dryHistory.fill(0);
      this.wetHistory.fill(0);
      this.historyIndex = 0;
      this.dcInput = this.dcOutput = this.bias = 0;
      this.previousInput = this.previousDry = this.previousWet = 0;
      this.preSample = this.drySample = this.distortedSample = this.output = 0;
      this.wetAmount = 0;
      // A clear voice has no input, DC, FIR or nonlinear history. This flag
      // only remains true until its first nonzero amplified input; it never
      // becomes a silence detector and cannot truncate an acoustic tail.
      this.initialZeroState = true;
    }
    clipAverage(a, b, level) {
      // Exact first-order antiderivative antialiasing of hard clip. Integrate
      // the piecewise-linear function directly, avoiding subtraction of two
      // large, almost equal primitives. The three common regions are cheap.
      if (a >= level && b >= level) return level;
      if (a <= -level && b <= -level) return -level;
      if (a <= level && a >= -level && b <= level && b >= -level) return .5 * (a + b);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      let area = 0;
      if (lo < -level) area -= level * (Math.min(hi, -level) - lo);
      if (hi > level) area += level * (hi - Math.max(lo, level));
      const innerLo = Math.max(lo, -level), innerHi = Math.min(hi, level);
      if (innerHi > innerLo) area += .5 * (innerHi - innerLo) * (innerHi + innerLo);
      return area / (hi - lo);
    }
    process(input, preGain = 1, distortion = 0, bite = .6) {
      if (!(Number.isFinite(input) && Number.isFinite(preGain) && Number.isFinite(distortion) && Number.isFinite(bite)))
        throw new RangeError('Nicht endlicher Layer-Eingang.');
      const gain = Math.max(0, preGain);
      // This finite-domain guard only catches otherwise overflowing numeric
      // faults. Ordinary acoustic input is many orders of magnitude smaller.
      const amplified = Math.max(-1e100, Math.min(1e100, input * gain));
      const ac = amplified - this.dcInput + this.dcPole * this.dcOutput;
      this.dcInput = amplified;
      this.dcOutput = ac;
      this.preSample = ac;
      const amount = Math.max(0, Math.min(1, distortion));
      const edge = Math.max(0, Math.min(1, bite));
      const wet = amount * edge, dry = 1 - wet;
      const drive = 1 + 7 * edge;
      this.wetAmount = wet;
      const current = ac - this.bias, before = this.previousInput;
      this.previousInput = current;
      let previousDry = this.previousDry, previousWet = this.previousWet;
      let head = this.historyIndex, mean = 0;
      const count = this.kernelLength, rate = this.oversample, level = this.clipLevel;
      if (this.initialZeroState) {
        if (amplified === 0) {
          // Every omitted multiplication would operate on exact zero. Keep
          // the same FIR clock, validated controls and exposed diagnostics;
          // the first nonzero input executes the full original path below.
          head += rate;
          if (head >= count) head -= count;
          this.historyIndex = head;
          return this.output;
        }
        this.initialZeroState = false;
      }
      for (let step = 1; step <= rate; step++) {
        const x = before + (current - before) * (step / rate), driven = x * drive;
        const a = this.clipAverage(x, previousDry, level);
        const b = this.clipAverage(driven, previousWet, level);
        this.dryHistory[head] = a;
        this.wetHistory[head] = b;
        mean += dry * a + wet * b;
        previousDry = x;
        previousWet = driven;
        if (++head === count) head = 0;
      }
      this.previousDry = previousDry;
      this.previousWet = previousWet;
      this.historyIndex = head;
      // A genuinely slow, voice-local servo corrects saturation-generated DC.
      // It is not the former 500-Hz voicing filter and has no other-layer input.
      this.bias += this.biasPole * mean / rate;
      let newest = head - 1;
      if (newest < 0) newest += count;
      let center = newest - this.middle;
      if (center < 0) center += count;
      let dryOut = this.centerWeight * this.dryHistory[center];
      let wetOut = this.centerWeight * this.wetHistory[center];
      for (let i = 0; i < this.pairOffsets.length; i++) {
        const offset = this.pairOffsets[i];
        let a = newest - offset, b = newest - (count - 1 - offset);
        if (a < 0) a += count;
        if (b < 0) b += count;
        const weight = this.pairWeights[i];
        dryOut += weight * (this.dryHistory[a] + this.dryHistory[b]);
        wetOut += weight * (this.wetHistory[a] + this.wetHistory[b]);
      }
      // All three exposed samples are after the same local FIR. A dry bypass
      // therefore retains the same delay as the distortion branch. Master and
      // source faders are deliberately absent and must be applied downstream.
      this.drySample = dryOut;
      this.distortedSample = wetOut;
      this.output = dry * dryOut + wet * wetOut;
      return this.output;
    }
  }

