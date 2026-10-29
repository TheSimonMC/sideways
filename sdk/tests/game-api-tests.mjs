/* Real legacy physics and in-memory PCM. Device lifecycle uses explicit mocks;
   no speaker, hearing, browser or native-device verification is claimed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {release8State} from './legacy-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcNames = ['core.js', 'vehicle.js', 'audio.js', 'game-api.js'];
const sources = Object.fromEntries(srcNames.map(name => [name, fs.readFileSync(path.join(root, 'src', name), 'utf8')]));
const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const sourceSHA256 = Object.fromEntries(srcNames.map(name => [name, sha(sources[name])]));
const artifactPaths = ['tests/game-api-tests.mjs', 'tests/legacy-state.mjs', 'tests/sdk-legacy-v7-fixture.json', 'tests/core-v8-baseline.js', 'tests/vehicle-v10-baseline.js'];
const artifactSHA256 = Object.fromEntries(artifactPaths.map(name => [name, sha(fs.readFileSync(path.join(root, name)))]));
const baselineCore=fs.readFileSync(path.join(root,'tests/core-v8-baseline.js'),'utf8');
const baselineVehicle=fs.readFileSync(path.join(root,'tests/vehicle-v10-baseline.js'),'utf8');
const baselineRealm=vm.createContext({console});
vm.runInContext(baselineCore+'\n'+baselineVehicle+'\nthis.E=EngineCore;this.V=VehicleCore;',baselineRealm);
const plain = value => JSON.parse(JSON.stringify(value));
const context = vm.createContext({console, setTimeout, clearTimeout, performance, Math, Number, Float32Array, Float64Array, Uint32Array});
vm.runInContext(srcNames.map(name => sources[name]).join('\n') + '\nglobalThis.SDK = MotorLab;', context);
const SDK = context.SDK, E = SDK.legacy.EngineCore, V = SDK.legacy.VehicleCore, DT = SDK.stepSeconds;
const results = [];
const near = (a, b, tolerance = 2e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);
const equalCore = (session, raw, label = 'complete legacy serialization') => assert.equal(sha(session.save().coreState), sha(raw.serialize()), label);
async function test(name, fn) {
  const start = performance.now();
  try { await fn(); results.push({name, pass: true, milliseconds: performance.now() - start}); console.log('PASS ' + name); }
  catch (error) { results.push({name, pass: false, milliseconds: performance.now() - start, error: String(error.stack || error)}); console.error('FAIL ' + name + '\n' + error.stack); }
}
function steps(model, count) { for (let i = 0; i < count; i++) model.step(DT); }
function drained(session, seconds) { session.update(seconds); while (session.getTiming().pendingSeconds >= DT - 1e-14) session.update(0); }
function restoredRaw(document) {
  const raw = document.kind === 'vehicle' ? new V.Simulation(document.coreState.configuration) : new E.Engine(document.coreState.config);
  raw.restore(document.coreState); return raw;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; };
function fakeContext(options = {}) {
  const nodes = [];
  const ctx = {state: options.state ?? 'suspended', sampleRate: 48000, destination: {}, resumes: 0, closes: 0, nodes,
    resume() { this.resumes++; if (options.resume) return options.resume.call(this); this.state = 'running'; return Promise.resolve(); },
    close() { this.closes++; this.state = 'closed'; return Promise.resolve(); },
    createScriptProcessor(bufferSize, input, output) {
      const node = {bufferSize, input, output, connects: 0, disconnects: 0, onaudioprocess: null,
        connect() {this.connects++;}, disconnect() {this.disconnects++;},
        render(length = bufferSize) {
          const left = new Float32Array(length), right = new Float32Array(length);
          this.onaudioprocess?.({outputBuffer: {getChannelData: channel => channel ? right : left}});
          return [left, right];
        }};
      nodes.push(node); return node;
    }};
  return ctx;
}

await test('immutable old core and vehicle references anchor the compatible release-14 SDK', () => {
  assert.equal(sha(baselineCore), 'efd882f510d5bff174aafa7dfe929c90598c05a9ed92996a678a1e2258bcd57f');
  assert.equal(sha(baselineVehicle), '9a4db840ce4a9b8542a7033e427222206726c8f23220b5e27d23f99854398f98');
  assert.equal(SDK.version,'1.6.3');assert.equal(SDK.physicsRelease,14);assert.equal(SDK.audioRelease,14);
});
await test('headless construction preserves complete cold legacy state for engine and vehicle', () => {
  const engine = SDK.createEngine('i4'); equalCore(engine, new E.Engine(E.defaults('i4')));
  const cfg = E.defaults('bestia50'); equalCore(SDK.createVehicle('bestia50'), new V.Simulation({engine: cfg, drivetrain: V.defaults(cfg)}));
  assert.equal(engine.getState().speedMps, null); assert.equal(engine.getState().speedKph, null);
});
await test('all advertised presets build actual validated engines, including 12-litre V8 and typo rejection', () => {
  for (const preset of SDK.presets()) assert.ok(SDK.createEngine(preset).getState().chamberCount > 0, preset);
  const large = SDK.createEngine({preset: 'v8', displacementCc: 12000}).getState();
  near(large.displacement, .012, 1e-8); assert.equal(large.config.cylinderCount, 8); assert.equal(large.config.layout, 'v');
  assert.equal(SDK.createEngine('v16').getState().config.cylinderCount, 16);
  assert.equal(SDK.createEngine('rotary4').getState().chamberCount, 12);
  assert.throws(() => SDK.createEngine('bmw-typo'), /Unbekannt/);
});
await test('timed start and loadNm alias match full legacy trajectory without rearming starter', () => {
  const session = SDK.createEngine('single4'), raw = new E.Engine(E.defaults('single4'));
  session.start({starterSeconds: .03}); raw.setControls({fuel: true, ignition: true, starter: true, starterSeconds: .03});
  session.setInputs({throttle: .35, loadNm: 2}); raw.setControls({throttle: .35, load: 2});
  session.update(.05); steps(raw, 1200); equalCore(session, raw);
  assert.equal(session.save().coreState.controls.starter, false);
  session.setInputs({throttle: .2}); raw.setControls({throttle: .2});
  session.update(.01); steps(raw, 240); equalCore(session, raw);
  assert.throws(() => session.setInputs({load: 1, loadNm: 2}), /gemeinsam/);
});
await test('vehicle aliases and the physical shift path match all serialized legacy fields', () => {
  const c = E.defaults('bestia50'), raw = new V.Simulation({engine: c, drivetrain: V.defaults(c)}), session = SDK.createVehicle('bestia50');
  session.start({starterSeconds: .2}); raw.setControls({fuel: true, ignition: true, starter: true, starterSeconds: .2});
  const commands = [
    [{throttle: .4, clutch: 1, parking: false, gear: 1}, 2400],
    [{clutch: 0}, 4800], [{clutch: 1, gear: 2}, 2400], [{clutch: 0, throttle: .7}, 2400]];
  for (const [command, count] of commands) {
    session.setInputs(command); const patch = {...command}; if ('gear' in patch) {patch.gearRequest = patch.gear; delete patch.gear;}
    raw.setControls(patch); drained(session, count * DT); steps(raw, count); equalCore(session, raw);
  }
  const s = session.getState(); near(s.speedKph, s.speedMps * 3.6); near(s.speedMps, s.drive.v);
  assert.throws(() => session.setInputs({externalTorqueNm: 0}), /Antriebsstrang/);
  assert.throws(() => session.applyShaftImpulse(1), /createEngine/);
});
await test('saved v7 fixture hashes verify complete raw and wrapped replay paths', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/sdk-legacy-v7-fixture.json'), 'utf8'));
  assert.equal(sha(baselineCore),fixture.sourceSHA256['core.js']);
  assert.equal(sha(baselineVehicle),fixture.sourceSHA256['vehicle.js']);
  for (const scenario of fixture.scenarios) {
    const config = E.defaults(scenario.preset);
    const raw = scenario.kind === 'vehicle' ? new V.Simulation({engine: config, drivetrain: V.defaults(config)}) : new E.Engine(config);
    const session = scenario.kind === 'vehicle' ? SDK.createVehicle(scenario.preset) : SDK.createEngine(scenario.preset);
    const oldConfig=baselineRealm.E.defaults(scenario.preset);
    const old=scenario.kind==='vehicle'?new baselineRealm.V.Simulation({engine:oldConfig,drivetrain:baselineRealm.V.defaults(oldConfig)}):new baselineRealm.E.Engine(oldConfig);
    for (const command of scenario.commands) {
      raw.setControls(command.inputs); session.setInputs(command.inputs);old.setControls(command.inputs);
      steps(raw, command.steps);steps(old,command.steps);drained(session, command.steps * DT);
    }
    assert.equal(sha(old.serialize()), scenario.expectedStateSHA256, 'immutable raw v7 fixture ' + scenario.preset);
    assert.deepEqual(release8State(raw.serialize()),plain(old.serialize()),'all original fields '+scenario.preset);
    equalCore(session, raw, 'wrapper fixture ' + scenario.preset);
  }
});
await test('bounded updates retain unpaid time, report actual work and drain explicitly', () => {
  const session = SDK.createEngine({preset: 'single4', maxStepsPerUpdate: 120});
  const state = session.update(.04);
  assert.equal(state.timing.totalSteps, 120); near(state.timing.lastUpdate.simulatedSeconds, .005); near(state.timing.pendingSeconds, .035);
  session.update(0, {maxSteps: 840}); assert.equal(session.getTiming().totalSteps, 960); near(session.getTiming().pendingSeconds, 0);
  near(session.getTiming().acceptedSeconds, .04); near(session.getTiming().simulatedSeconds, .04);
  assert.throws(() => session.update(-1), /deltaSeconds/); assert.throws(() => session.update(1, {maxSteps: 0}), /maxSteps/);
});
await test('irregular frame partitions keep the same physical step count and complete state', () => {
  const a = SDK.createEngine('single4'), b = SDK.createEngine('single4'); a.start(); b.start();
  const deltas = [.00417, .000021, .013, .0001, .023751, .0069];
  for (const dt of deltas) a.update(dt);
  b.update(deltas.reduce((x, y) => x + y, 0));
  assert.equal(sha(a.save().coreState), sha(b.save().coreState)); near(a.getTiming().pendingSeconds, b.getTiming().pendingSeconds);
});
await test('pause retains existing debt and explicit discard reports the lost duration', () => {
  const s = SDK.createEngine({preset: 'single4', maxStepsPerUpdate: 10}); s.update(.01); const before = s.getTiming();
  s.pause(); s.update(3); near(s.getTiming().pendingSeconds, before.pendingSeconds); near(s.getTiming().acceptedSeconds, .01);
  s.pause(false); const discarded = s.discardPendingTime(); near(discarded, before.pendingSeconds);
  near(s.getTiming().discardedSeconds, discarded); near(s.getTiming().pendingSeconds, 0);
});
await test('SDK save-load restores immutable opaque legacy state plus fraction and starter deadline', () => {
  const source = SDK.createEngine('single4'); source.start({starterSeconds: .08}); source.update(.017 + DT / 4);
  const document = plain(source.save()), unchanged = JSON.stringify(document), raw = restoredRaw(document);
  const resumed = SDK.fromState(document); assert.equal(JSON.stringify(document), unchanged); equalCore(resumed, raw);
  near(resumed.getTiming().pendingSeconds, document.timing.pendingSeconds);
  assert.equal(resumed.save().coreState._starterUntil, document.coreState._starterUntil);
  resumed.setInputs({throttle: .3}); raw.setControls({throttle: .3}); resumed.update(.003); steps(raw, 72); equalCore(resumed, raw);
  assert.equal(resumed.save().coreState._starterUntil, document.coreState._starterUntil);
});
await test('bare legacy vehicle restore follows the same original restore and replay path', () => {
  const source = SDK.createVehicle('bestia50'); source.start(); source.setInputs({parking: false, clutch: 1, gear: 1}); source.update(.04);
  const raw = restoredRaw(source.save()), resumed = SDK.createVehicle('i4'); resumed.loadCoreState(source.save().coreState);
  equalCore(resumed, raw); resumed.update(.02); steps(raw, 480); equalCore(resumed, raw);
  assert.equal(resumed.getTiming().totalSteps, 480);
});
await test('invalid load is atomic, rejects JSON poison and does not alter existing legacy state', () => {
  const s = SDK.createEngine('i4'); s.start(); s.update(.005); const before = JSON.stringify(s.save());
  const bad = s.save(); bad.coreState.config.bore = -1; assert.throws(() => s.load(bad)); assert.equal(JSON.stringify(s.save()), before);
  const overwrite = s.save(); overwrite.coreState.step = 17; assert.throws(() => s.load(overwrite), /Motorzustandsfeld/); assert.equal(JSON.stringify(s.save()), before);
  const poison = JSON.parse('{"__proto__":{"polluted":true}}'); assert.throws(() => s.loadCoreState(poison), /Schlüssel/);
  assert.equal({}.polluted, undefined);
});
await test('external torque is a booked legacy shaft impulse, with no hidden test drive', () => {
  const s = SDK.createEngine('single4'), raw = new E.Engine(E.defaults('single4'));
  s.setInputs({fuel: false, ignition: false, externalTorqueNm: 4}); raw.setControls({fuel: false, ignition: false});
  s.update(.01); for (let i = 0; i < 240; i++) {raw.step(DT); raw.applyShaftImpulse(4 * DT);}
  equalCore(s, raw); assert.equal(s.save().coreState.totals.driveWork, 0); assert.notEqual(s.save().coreState.totals.couplingWork, 0);
  const impulse = s.applyShaftImpulse(-.01), expected = raw.applyShaftImpulse(-.01); assert.deepEqual(plain(impulse), plain(expected)); equalCore(s, raw);
});
await test('snapshots are detached and reset constructs the same cold validated motor', () => {
  const s = SDK.createEngine('turbo'); const state = s.getState(); state.config.bore = 7; state.signal.exhaustFlows[0] = 1e50;
  assert.notEqual(s.getState().config.bore, 7); assert.notEqual(s.getState().signal.exhaustFlows[0], 1e50);
  s.start(); s.update(.01); s.reset(); equalCore(s, new E.Engine(E.defaults('turbo'))); assert.equal(s.getTiming().totalSteps, 0);
});
await test('manual PCM and browser audio are exclusive clocks; disconnect also releases direct PCM', async () => {
  const s = SDK.createEngine('single4'); s.update(DT / 4); s.setRate(.25);
  s.renderAudio(new Float32Array(1), new Float32Array(1), {sampleRate: 48000});
  const before = s.getTiming(); assert.equal(before.clock, 'pcm'); near(before.pendingSeconds, DT / 4 + .25 / 48000);
  assert.throws(() => s.update(.01), /Simulationstakt/); assert.throws(() => s.reset(), /Simulationstakt/); assert.throws(() => s.load(s.save()), /Simulationstakt/);
  await s.disconnectAudio(); assert.equal(s.getTiming().clock, 'manual'); near(s.getTiming().pendingSeconds, before.pendingSeconds);
  s.setRate(1); s.update(DT - before.pendingSeconds); assert.equal(s.getTiming().totalSteps, 1); near(s.getTiming().pendingSeconds, 0);
});
await test('whole pending steps block audio claim without dropping time or clock ownership', async () => {
  const s = SDK.createEngine({preset: 'single4', maxStepsPerUpdate: 1}); s.update(.01); const before = s.getTiming();
  assert.throws(() => s.renderAudio(new Float32Array(1), new Float32Array(1)), /ausstehende Zeit/);
  await assert.rejects(s.connectAudio({context: fakeContext()}), /ausstehende Zeit/);
  assert.equal(s.getTiming().clock, 'manual'); near(s.getTiming().pendingSeconds, before.pendingSeconds);
  s.discardPendingTime(); s.renderAudio(new Float32Array(2), new Float32Array(2)); await s.disconnectAudio();
});
await test('real PCM is finite and block partition leaves identical samples and complete physics', async () => {
  const a = SDK.createEngine('single4'), b = SDK.createEngine('single4'); a.start(); b.start();
  const frames = 12000, left = new Float32Array(frames), right = new Float32Array(frames); a.renderAudio(left, right);
  const splits = [17, 301, 4096, 333, 7253], joinedL = new Float32Array(frames), joinedR = new Float32Array(frames); let offset = 0;
  for (const n of splits) {const l = new Float32Array(n), r = new Float32Array(n); b.renderAudio(l, r); joinedL.set(l, offset); joinedR.set(r, offset); offset += n;}
  assert.equal(offset, frames); assert.deepEqual(left, joinedL); assert.deepEqual(right, joinedR);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite)); assert.ok(left.some(x => x !== 0));
  assert.equal(sha(a.save().coreState), sha(b.save().coreState)); assert.equal(a.getTiming().totalSteps, 6000);
  await a.disconnectAudio(); await b.disconnectAudio();
});
await test('slow-motion PCM advances the same original physics duration without a second clock', async () => {
  const slow = SDK.createEngine('single4'), raw = new E.Engine(E.defaults('single4'));
  slow.start(); raw.setControls({fuel: true, ignition: true, starter: true, starterSeconds: 1.5}); slow.setRate(.25);
  slow.renderAudio(new Float32Array(4800), new Float32Array(4800)); steps(raw, 600); equalCore(slow, raw);
  near(slow.getTiming().simulatedSeconds, .025); near(slow.getTiming().acceptedSeconds, .025); await slow.disconnectAudio();
});
await test('zero volume reaches real zero samples while preserving engine progression', async () => {
  const s = SDK.createEngine('single4'); s.start(); s.renderAudio(new Float32Array(2400), new Float32Array(2400));
  s.setVolume(0); const l = new Float32Array(2000), r = new Float32Array(2000); const before = s.getTiming().totalSteps;
  s.renderAudio(l, r); assert.ok(l.slice(1000).every(x => x === 0) && r.slice(1000).every(x => x === 0));
  assert.equal(s.getTiming().totalSteps - before, 1000); await s.disconnectAudio();
});
await test('audio connect resumes synchronously, uses real session PCM, and preserves borrowed context', async () => {
  const s = SDK.createEngine('single4'), ctx = fakeContext(); s.start();
  const promise = s.connectAudio({context: ctx}); assert.equal(ctx.resumes, 1); await promise;
  assert.equal(s.getAudioStatus().backend, 'script-processor'); assert.throws(() => s.update(.02), /Simulationstakt/);
  ctx.nodes[0].render(1024); assert.equal(s.getTiming().totalSteps, 512);
  assert.throws(() => s.renderAudio(new Float32Array(1), new Float32Array(1)), /zweite/);
  await s.disconnectAudio(); assert.equal(ctx.closes, 0); assert.equal(ctx.nodes[0].disconnects, 1); s.update(.001);
});
await test('failed audio retry clears prior error and suspended connection can resume again', async () => {
  const s = SDK.createEngine('single4'), bad = fakeContext({resume() {return Promise.reject(new Error('blocked'));}});
  await assert.rejects(s.connectAudio({context: bad}), /blocked/); assert.equal(s.getTiming().clock, 'manual');
  const good = fakeContext(); s.start(); await s.connectAudio({context: good}); assert.equal(s.getAudioStatus().error, null);
  good.nodes[0].render(128); assert.equal(s.getTiming().totalSteps, 64);
  good.state = 'suspended'; const resumed = s.enableAudio(); assert.equal(good.resumes, 2); await resumed;
  good.state = 'closed'; await assert.rejects(s.connectAudio(), /disconnectAudio/); await s.disconnectAudio();
});
await test('dispose invalidates pending owned audio and cannot reconnect after delayed resume', async () => {
  const wait = deferred(), ctx = fakeContext({resume() {return wait.promise;}});
  context.AudioContext = function () {return ctx;};
  const s = SDK.createEngine('single4'), pending = s.connectAudio(), rejected = assert.rejects(pending, /abgebrochen/);
  assert.throws(() => s.load(s.save()), /Simulationstakt/); await s.dispose(); assert.equal(ctx.closes, 1);
  ctx.state = 'running'; wait.resolve(); await rejected; assert.equal(ctx.nodes.length, 0);
  assert.equal(s.getTiming().clock, 'disposed'); assert.throws(() => s.start(), /dispose/); await s.dispose(); delete context.AudioContext;
});
await test('audio timeout cleans failed ownership and leaves manual updates available', async () => {
  const wait = deferred(), ctx = fakeContext({resume() {return wait.promise;}}), s = SDK.createEngine('single4');
  await assert.rejects(s.connectAudio({context: ctx, timeoutMs: 5}), /lange/);
  assert.equal(s.getTiming().clock, 'manual'); s.update(.001); assert.equal(s.getTiming().totalSteps, 24);
  ctx.state = 'running'; wait.resolve(); await Promise.resolve(); assert.equal(ctx.nodes.length, 0); await s.dispose();
});
await test('live cam targets use the same bounded physical actuator through the game wrapper', () => {
  const session=SDK.createEngine('i4'),raw=new E.Engine(E.defaults('i4'));
  session.setInputs({intakeCamAdvance:20,exhaustCamAdvance:-10});raw.setControls({intakeCamAdvance:20,exhaustCamAdvance:-10});
  near(session.getState().camPhaser.intakeAdvance,0);
  session.update(.025);steps(raw,600);equalCore(session,raw);
  near(session.getState().camPhaser.intakeAdvance,4.5,1e-10);near(session.getState().camPhaser.exhaustAdvance,-4.5,1e-10);
  const saved=plain(session.save()),restored=SDK.fromState(saved),reference=restoredRaw(saved);
  restored.update(.025);steps(reference,600);equalCore(restored,reference);
  assert.throws(()=>SDK.createEngine('renesis').setInputs({intakeCamAdvance:1}),/Viertakt/);
  assert.throws(()=>session.setInputs({intakeCamAdvance:Infinity}));
});
await test('boost targets control the existing valves without setting a pressure or creating an audio clock', () => {
  const session=SDK.createEngine('turbo'),before=session.getState();
  session.setInputs({boostTarget:120000});const commanded=session.getState();
  near(commanded.controls.boostTarget,120000);near(commanded.charge.p,before.charge.p);near(commanded.boost.rpm,before.boost.rpm);
  assert.equal(commanded.config.boostTarget,before.config.boostTarget);assert.equal(session.getTiming().clock,'manual');
  const reference=new E.Engine(E.defaults('turbo'));reference.setControls({boostTarget:120000});
  session.update(.01);steps(reference,240);equalCore(session,reference);
  assert.throws(()=>session.setInputs({boostTarget:500001}));
});
await test('parallel twin family uses two real shafts through the existing create and update API', () => {
  const family={kind:'four',layout:'v',cylinderCount:8,boost:'turbo',turboCount:2};
  const session=SDK.createEngine({family,displacementCc:6000});
  const initial=session.getState(),raw=new E.Engine(initial.config);
  assert.equal(initial.config.turboCount,2);assert.equal(initial.boost.units.length,2);
  near(initial.displacement,.006,1e-10);
  session.start({starterSeconds:.08});raw.setControls({fuel:true,ignition:true,starter:true,starterSeconds:.08});
  session.setInputs({throttle:.4});raw.setControls({throttle:.4});session.update(.1);steps(raw,2400);equalCore(session,raw);
  const s=session.getState();assert.ok(s.boost.units.every(u=>Number.isFinite(u.rpm)));
  near(s.boost.compressorFlow,s.boost.units.reduce((sum,u)=>sum+u.compressorFlow,0));
  assert.equal(s.signal.turboUnits.length,2);
  s.boost.units[0].rpm=-1;assert.ok(session.getState().boost.units[0].rpm>=0,'Snapshot must not expose mutable physical units');
});
await test('parallel twin save restore preserves both shafts through engine and vehicle sessions', () => {
  for(const kind of ['engine','vehicle']){
    const options={family:{boost:'turbo',turboCount:2}};
    const session=kind==='engine'?SDK.createEngine(options):SDK.createVehicle(options);
    session.start({starterSeconds:.1});session.setInputs({throttle:.35});session.update(.05);
    const saved=session.save(),before=sha(saved),restored=SDK.fromState(saved);
    assert.equal(sha(saved),before);
    // Restore recomputes residual diagnostics; compare the complete state with
    // the same real core restore and all physical turbo values with the save.
    equalCore(restored,restoredRaw(saved));
    assert.deepEqual(plain(restored.getState().boost.units),plain(session.getState().boost.units));
    session.update(.025);restored.update(.025);
    assert.equal(sha(session.save().coreState),sha(restored.save().coreState));
    assert.equal(restored.getState().boost.units.length,2);
  }
});
await test('parallel twin PCM is deterministic across block partitions with one physical clock', () => {
  const options={family:{boost:'turbo',turboCount:2}},a=SDK.createEngine(options),b=SDK.createEngine(options);
  for(const s of [a,b]){s.start({starterSeconds:.2});s.setInputs({throttle:.4});}
  const left=new Float32Array(4800),right=new Float32Array(4800);a.renderAudio(left,right);
  const joined=new Float32Array(4800);let offset=0;
  for(const n of [1,127,1024,17,2048,1583]){
    const l=new Float32Array(n),r=new Float32Array(n);b.renderAudio(l,r);joined.set(l,offset);offset+=n;
  }
  assert.equal(offset,left.length);assert.deepEqual(left,joined);assert.ok(left.every(Number.isFinite));
  assert.ok(left.some(x=>x!==0));assert.equal(sha(a.save().coreState),sha(b.save().coreState));
  near(a.getState().time,.1,1e-10);assert.equal(a.getTiming().clock,'pcm');
});
await test('disabled RPM cut preserves real over-threshold shaft motion independently of the redline marker', () => {
  const options={preset:'single4',overrides:{redlineRpm:1500,revLimitRpm:1700,revLimiterEnabled:false,redlineEnabled:false}};
  const session=SDK.createEngine(options),raw=new E.Engine(session.getState().config);
  const marked=SDK.createEngine({...options,overrides:{...options.overrides,redlineEnabled:true}});
  for(const model of [session,marked]){
    model.setInputs({throttle:.5});
    model.applyShaftImpulse(model.getState().config.inertia*3200*Math.PI/30);
  }
  raw.setControls({throttle:.5});raw.applyShaftImpulse(raw.config.inertia*3200*Math.PI/30);
  session.update(.004);marked.update(.004);steps(raw,96);equalCore(session,raw);
  assert.ok(session.getState().rpm>1700,'Actual shaft motion must remain above the disabled cutoff');
  assert.equal(session.getState().revCut,false);assert.equal(session.getState().controls.ignition,true);assert.equal(session.getState().controls.fuel,true);
  const a=plain(session.save().coreState),b=plain(marked.save().coreState);
  delete a.config.redlineEnabled;delete b.config.redlineEnabled;
  assert.deepEqual(a,b,'Display marker alone must not change any physical state');
  assert(session.save().coreState.testDrive==null,'No diagnostic fixed-RPM drive may be active');
});
await test('separate RPM cut threshold survives SDK save restore and uses the actual core cutoff', () => {
  const session=SDK.createEngine({preset:'single4',overrides:{redlineRpm:1500,revLimitRpm:2600,redlineEnabled:false,revLimiterEnabled:true}});
  const raw=new E.Engine(session.getState().config),impulse=raw.config.inertia*2100*Math.PI/30;
  session.applyShaftImpulse(impulse);raw.applyShaftImpulse(impulse);
  session.update(.001);steps(raw,24);equalCore(session,raw);
  assert.ok(session.getState().rpm>1500);assert.equal(session.getState().revCut,false);
  const boost=raw.config.inertia*1500*Math.PI/30;session.applyShaftImpulse(boost);raw.applyShaftImpulse(boost);
  session.update(.001);steps(raw,24);equalCore(session,raw);assert.equal(session.getState().revCut,true);
  const saved=session.save(),unchanged=sha(saved),restored=SDK.fromState(saved),reference=restoredRaw(saved);
  assert.equal(sha(saved),unchanged);equalCore(restored,reference);
  assert.equal(restored.getState().config.revLimitRpm,2600);assert.equal(restored.getState().config.redlineEnabled,false);
  restored.update(.002);steps(reference,48);equalCore(restored,reference);
  assert.equal(restored.getState().config.revLimiterEnabled,true);
});
await test('twelve-gear vehicle and its saved continuation use the same actual drivetrain as the raw core', () => {
  const engine=E.defaults('i4'),drivetrain=V.defaults(engine);
  drivetrain.gears=Array.from({length:12},(_,i)=>4*.84**i);
  const config={engine,drivetrain},session=SDK.createVehicle({configuration:config}),raw=new V.Simulation(config);
  assert.equal(V.MAX_GEARS,12);assert.equal(session.getState().drive.gearCount,12);
  session.setInputs({clutch:1,gear:12});raw.setControls({clutch:1,gearRequest:12});
  drained(session,.3);steps(raw,7200);equalCore(session,raw);
  assert.equal(session.getState().drive.gear,12);assert.equal(session.getState().drive.gearRatio,drivetrain.gears[11]);
  const saved=session.save(),restored=SDK.fromState(saved),reference=restoredRaw(saved);
  restored.setInputs({gear:11});reference.setControls({gearRequest:11});drained(restored,.3);steps(reference,7200);equalCore(restored,reference);
  assert.equal(restored.getState().drive.gear,11);
  assert.throws(()=>restored.setInputs({gear:13}),/Gang/);
});
await test('classic bundle coexists with old lexical globals, ESM and CJS expose the same engine', async () => {
  const sdkRoot = fs.existsSync(path.join(root, 'sdk/motor-engine.cjs')) ? path.join(root, 'sdk') : root;
  const classic = fs.readFileSync(path.join(sdkRoot, 'motor-engine.js'), 'utf8');
  const realm = vm.createContext({console, setTimeout, clearTimeout, performance});
  vm.runInContext(sources['core.js'] + '\n' + sources['vehicle.js'] + '\nglobalThis.oldCore=EngineCore; globalThis.oldVehicle=VehicleCore;', realm);
  const oldCore = realm.oldCore, oldVehicle = realm.oldVehicle, oldKeys = Object.keys(oldCore), oldProto = Object.getOwnPropertyNames(oldCore.Engine.prototype);
  vm.runInContext(classic, realm); assert.equal(realm.oldCore, oldCore); assert.equal(realm.oldVehicle, oldVehicle);
  assert.deepEqual(Object.keys(oldCore), oldKeys); assert.deepEqual(Object.getOwnPropertyNames(oldCore.Engine.prototype), oldProto);
  assert.equal(vm.runInContext('EngineCore === oldCore && VehicleCore === oldVehicle', realm), true);
  assert.equal(realm.EngineCore, undefined); assert.equal(realm.VehicleCore, undefined);
  const require = createRequire(import.meta.url), cjs = require(path.join(sdkRoot, 'motor-engine.cjs'));
  const esm = await import(pathToFileURL(path.join(sdkRoot, 'motor-engine.mjs')).href + '?sdk-test=' + Date.now());
  assert.equal(esm.default, esm.MotorLab); assert.equal(esm.EngineCore, esm.MotorLab.legacy.EngineCore);
  for (const api of [realm.MotorLab, cjs, esm.default]) assert.equal(sha(api.createEngine('i4').save().coreState), sha(SDK.createEngine('i4').save().coreState));
});

const finalSourceSHA256 = Object.fromEntries(srcNames.map(name => [name, sha(fs.readFileSync(path.join(root, 'src', name)))]));
const finalArtifactSHA256 = Object.fromEntries(artifactPaths.map(name => [name, sha(fs.readFileSync(path.join(root, name)))]));
const unchanged = srcNames.every(name => finalSourceSHA256[name] === sourceSHA256[name]) &&
  artifactPaths.every(name => finalArtifactSHA256[name] === artifactSHA256[name]);
const report = {suite: 'additive-game-api', version: 14, sourceSHA256, artifactSHA256, finalSourceSHA256, finalArtifactSHA256,
  baselineCoreSHA256:sha(baselineCore), baselineVehicleSHA256:sha(baselineVehicle), sourceUnchangedDuringRun: unchanged,
  filter: null, checks: results.length, passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length,
  verificationScope: ['immutable legacy core and vehicle reference bytes', 'every original serialized state field and additional optional controls', 'optional physical RPM limits and independent marker', 'twelve-gear vehicle path', 'fixed-step debt', 'real in-memory PCM', 'mocked device lifecycle', 'bundle coexistence'],
  exclusions: ['native browser device playback', 'auditory judgment', 'arbitrary third-party game physics'], results};
fs.mkdirSync(path.join(root, 'qa'), {recursive: true}); fs.writeFileSync(path.join(root, 'qa/game-api-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${report.passed}/${report.checks} SDK checks passed; sources unchanged: ${unchanged}`);
if (report.failed || !unchanged) process.exitCode = 1;
