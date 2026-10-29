# V6 audio verification

The audio implementation is complete. Verification used deterministic PCM,
the actual MotorLab and vehicle solver, a bounded Web Audio scheduling test
host, source inspection and media probing. No listening or browser execution
is claimed.

## Changes

- Tyre squeal requires meaningful contact slip angle or ratio, slip speed and
  dissipated work. Ordinary and mild corner fixtures stay silent. Severe skid
  and stationary burnout retain the attributed tyre recording, at a lower
  level, with a 4.5 kHz low-pass and smoother attack/release.
- World positions use the actual camera-right basis. Traffic, recorded horns,
  police sirens, individual wheels, engine position and mechanical effects
  follow stereo position. Distance, rear filtering, bounded Doppler and a small
  interaural delay apply to traffic. There are no extra live NPC engine sessions.
- Held horns, sirens, fuel-pump and repair beds, damaged-engine rattle, detached
  wheel scrape and event cues use a world transport independent of engine time.
  NOS airflow follows the valve even when combustion has stopped.
- Music uses one embedded 12-bar stereo band phrase by Joth, with recorded
  VCSL drum samples scheduled over it. Menu, drive, chase and escape modes
  change arrangement, level and filtering. Pause preserves musical position;
  off and mute stop all music sources. The escape piano cue is original.
- Short recorded interface cues and world events have bounded queues. Rendered
  tails drain naturally. New events can play while driving is suspended, and
  servicing can explicitly keep world sound active.

## Results

`node qa/audio-v6-check.mjs` passed all seven scenario groups. Results are in
`qa/audio-v6-results.json`.

At the saved V5 tyre mix of 0.85, the stationary burnout fixture measured
0.0271 RMS, compared with the captured V5 result of 0.0894 RMS, a reduction
of approximately 10.4 dB. This improvement does not depend on the new UI
default. Ordinary and mild corner squeal measured zero.

The independent world transport rendered more than 245,000 frames while
the native engine step count remained unchanged. It queued at most five
world blocks in the test. Chase music scheduled 39 drum hits over four
seconds versus 18 in the drive arrangement, with a maximum of nine
simultaneous percussion voices. The implementation caps music voices at
48, world event samples at 32 and traffic at four active/eight fading voices.

The following regression suites also passed:

- `node qa/audio-v4-check.mjs` — materials, contact work, drivetrain, output
  bounds, coupled vehicle parity, independent interface cues and reset/mute.
- `node qa/audio-v5-check.mjs` — SDK consistency, V6 engine configuration,
  native source bite, source-local components, traffic bounds and NOS.
  The NOS assertion now follows the V6 open-valve behavior, and stereo checks
  use the new equal-power pan law.
- `node qa/audio-v3-physics-check.mjs` — manual and PCM-owned native engine
  clocks agree at every 120 Hz vehicle step, including acceleration, stall,
  restart, burnout, reset, mute and all eight engine swaps.

Syntax and whitespace checks passed for the changed audio modules. FFprobe
verified the embedded music source as stereo 44.1 kHz MP3; the encoded file
is 530,852 bytes. The intended loop is 33.103448 seconds at 87 BPM, with
container padding excluded by the explicit loop end.

## Integration contract

Call `setWorldContext` and `setMusic`, then `updateWorld(dt)` once per display
frame. This does not call MotorLab or advance driving physics. `setTraffic`
and `setTrafficSources` are aliases. Source descriptors can include `x`, `z`,
`distance`, `pan`, `rpm`, `throttle`, `horn`, `siren` and `sirenPhase`.

`listenerPosition` and `listenerRight` define world stereo. `cameraHeading`
is the fallback basis. `playerHorn` is held state. `servicing` is `null`,
`fuel` or `repair`; `worldActive` explicitly permits continuous world sound
while driving is suspended. Engine-health, wheel attachment and body-scrape
work default to the current vehicle state. `bodyScrape` is measured in watts.

`playEvent(type, detail)` supports `lightToggle`, `horn`, `engineHurt`,
`wheelLoss`, `refuel`, `service`, `escape`, `arrest`, `pursuit` and `ui`.
Optional world `x`/`z`, `intensity` and service `phase` specialize the cue.
`impact` accepts world `x`/`z`; its `pan` fallback is already camera projected.

`setMusic` accepts `enabled`, `volume`, `mode`, `intensity` and `paused`.
Modes are `menu`, `drive`, `chase` and `escape`. The global mute and volume
control driving, world, interface and music buses together. Engine, tyres,
mechanical and environment mixes remain independent.

## Provenance and limits

Full source URLs, authors, licenses and modifications are in
`dist/audio/ATTRIBUTION.txt`; the exact CC0 license is in
`dist/audio/CC0-LICENSE.txt`. `qa/audio-v6-assets.json` records source and
adapted hashes, rates, frames and selections. Audio data is embedded in
`dist/audio/kit.js`, `dist/audio/music-track.js` and the existing tyre/traffic
module. No runtime download is required.

The siren is a licensed designed sound. The band source does not establish
whether each instrument was performed live. Wind, rolling textures, NOS,
pump bed and some mechanical layers remain procedural acoustic effects.
Actual headphone/speaker balance and browser device latency still require
human listening on the target device.
