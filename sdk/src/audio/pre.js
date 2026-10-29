  // Fixed linear source calibration before AcousticLayer. The raw solver and
  // radiation signals have different numerical reference units; these static
  // factors are engineering calibration, not an SPL or OEM microphone model.
  // No RMS detector, other voice, throttle clock or free oscillator is used.
  class AcousticPre {
    constructor(sr, options = {}) {
      if (!(Number.isFinite(sr) && sr >= 8000)) throw new RangeError('Ungültige Pre-Abtastrate.');
      const names = ['exhaust','intake','combustion','valve','bearing','boost','manifold','mechanical','gearbox','chain'];
      const index = Number.isInteger(options.index) ? options.index : names.indexOf(options.name);
      if (index < 0 || index >= names.length) throw new RangeError('Unbekannte Pre-Quelle.');
      const c = options.config || {}, temperature = Math.max(150, Math.min(350, Number.isFinite(c.ambientT) ? c.ambientT : 293.15));
      const soundSpeed = Math.sqrt(1.4 * 287 * temperature);
      const exhaustDiameter = Math.max(.015, Number.isFinite(c.exhaustDiameter) ? c.exhaustDiameter : .06);
      const intakeDiameter = Math.max(.015, Number.isFinite(c.intakeDiameter) ? c.intakeDiameter : .06);
      const structureSize = Math.max(.025, c.kind === 'rotary' ? 2 * (c.rotorRadius || .1) : (c.bore || .086));
      // Presence is a named shelf, followed for exhaust/collector pressure by
      // a second bounded differentiating section. This explicit engineering
      // radiation profile keeps slow gas displacement from masking the fronts.
      // Its corner follows aperture/structure size within a finite useful band;
      // it is not a measured OEM transfer function or additional gas dynamics.
      // Contacts have zero DC weight, so an isolated contact has no lasting area.
      const gains = [3,.30,.10,.08,1,.10,4,.06,.50,.25];
      const low = [.06,.22,.18,0,1,.82,.10,.12,.28,.40];
      const corners = [
        Math.max(650, Math.min(2000, 1.6 * soundSpeed / (2 * Math.PI * exhaustDiameter))),
        Math.max(300, Math.min(1000, .55 * soundSpeed / (2 * Math.PI * intakeDiameter))),
        Math.max(350, Math.min(850, 45 / structureSize)),
        Math.max(600, Math.min(1800, 80 / structureSize)),
        100, 2200,
        Math.max(650, Math.min(2000, 1.6 * soundSpeed / (2 * Math.PI * exhaustDiameter))),
        Math.max(400, Math.min(1200, 55 / structureSize)),
        600, 1800
      ];
      this.sr = sr; this.name = names[index]; this.index = index;
      this.bankCount = c.kind !== 'rotary' && ['v','boxer','w'].includes(c.layout) ? (c.layout === 'w' ? 4 : 2) : 1;
      this.referenceGain = gains[index] / (index === 0 ? this.bankCount : 1);
      // The mechanical compressor's sustained transport texture uses the
      // established reference. The higher turbo reference exposes its relief
      // flow without also doubling supercharger hiss; shaft phase stays clean.
      if (index === 5 && c.boost === 'supercharger') this.referenceGain = .05;
      this.radiationStages = index === 0 || index === 6 ? 2 : 1;
      this.lowWeight = low[index];
      this.cornerHz = Math.min(.35 * sr, corners[index]);
      // The optional force-presence voice owns a separate fixed transfer.
      // Six broad, nonresonant sections keep its small independent peak
      // allowance on pressure-front detail rather than slow displacement.
      // This is authored digital calibration, not six physical derivatives
      // or an OEM acoustic measurement. The original source Pre stays exact.
      this.presenceReference = index === 0 && options.profile === 'exhaust-presence';
      if (this.presenceReference) {
        this.referenceGain = 1359.375 / this.bankCount;
        this.cornerHz = Math.min(.35 * sr, 1500);
        this.radiationStages = 6;
        this.presenceLow = new Float64Array(6);
      }
      this.pole = 1 - Math.exp(-2 * Math.PI * this.cornerHz / sr);
      this.linearBoundGain = this.presenceReference ? this.referenceGain * 64 :
        this.referenceGain * (2 - this.lowWeight) * (this.radiationStages === 2 ? 2 : 1);
      this.clear();
    }
    clear() { this.low2 = this.low = this.input = this.output = 0; this.presenceLow?.fill(0); }
    process(raw) {
      if (!Number.isFinite(raw)) throw new RangeError('Nicht endlicher Pre-Eingang.');
      this.input = raw;
      if (this.presenceReference) {
        for (let i = 0; i < this.presenceLow.length; i++) {
          this.presenceLow[i] += this.pole * (raw - this.presenceLow[i]);
          raw -= this.presenceLow[i];
        }
        this.output = this.referenceGain * raw;
        return this.output;
      }
      this.low += this.pole * (raw - this.low);
      let shaped = raw - (1 - this.lowWeight) * this.low;
      if (this.radiationStages === 2) { this.low2 += this.pole * (shaped - this.low2); shaped -= this.low2; }
      this.output = this.referenceGain * shaped;
      return this.output;
    }
    describe() {
      return {name: this.name, model: 'fixed-linear-source-reference', sourceReference: this.presenceReference ? 'additive-jet-force-presence' : 'legacy-flow', referenceGain: this.referenceGain,
        presenceCornerHz: this.cornerHz, radiationStages: this.radiationStages,
        dcWeight: this.radiationStages >= 2 ? 0 : this.lowWeight, lowWeight: this.presenceReference ? 0 : this.lowWeight, highWeight: 1,
        maximumLinearGainBound: this.linearBoundGain, adaptive: false, calibratedSPL: false};
    }
  }

