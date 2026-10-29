# SIDEWAYS V7 audio verification

## Implemented

The player still has one native MotorLab session. Engine audio is produced by
that session's renderAudio call, which owns the engine clock. No world, music,
radio or reverb method updates the engine or vehicle.

- A separate licensed 118 BPM pursuit composition replaces the cruising arrangement
  during a chase. Two synchronized eight-bar sections crossfade with heat,
  proximity, speed events and NOS. Search removes the cruising band and narrows
  the pursuit arrangement. Escape has a real ten-second release with the cruising
  arrangement returning gradually; a new chase can interrupt it immediately.
- Sirens reserve up to three of six active world voices before civilian sorting.
  The total voice set, including release tails, is capped at ten. Source range is
  330 m, gain rolls off over practical pursuit distances, and emergency audio has
  its own mix control. Engine/music ducking makes room for sirens and dispatch.
- Civilian recorded engine beds follow load, RPM, distance, camera-right position,
  rear filtering and bounded Doppler. Horns and sirens retain independent sample
  phases. These are NPC beds, not second player-engine simulations.
- Player-engine and world-source reflection buses use measured facade distances,
  reflectivity and enclosure. Four early reflection paths position echoes at the
  correct camera side; a damped stereo tail fades without a growing feedback loop.
- Three authored CC0 radio speech snippets use a serialized queue capped at three,
  per-code cooldowns and priority interruption for arrest/escape. Tactical captions
  are summaries supplied by game AI, not claimed verbatim speech transcripts.
- Stereo birds and evening insects blend with district and day/night context.
  Wind, water and industrial textures remain procedural broadband beds.
- Settings have short siren and recorded radio previews. Both work when ordinary
  driving/world transport is suspended. The master, mute and separate siren/radio
  gains still apply. Speed cameras have a short click/shutter cue.
- resetWorldFeedback clears sources, pending radio, preview events, cooldowns,
  delayed buffers and reflections on restart/map changes, without engine steps.

## Tests run

1. `node qa/audio-v7-check.mjs`: all nine groups passed. The result data is in
   `qa/audio-v7-results.json`.
2. `node qa/audio-v3-physics-check.mjs`: passed. Actual rendered PCM and silent
   physics match at each 120 Hz step through acceleration, stall, restart, stationary
   burnout, pause/resume, mute and eight engine swaps.
3. `node qa/audio-v4-check.mjs`: passed. Existing native engine, saturation,
   tyre/contact, mechanical and bounded transport regressions remain green.
4. JavaScript syntax checks and `git diff --check`: passed for the owned files.
5. The embedded chase MP3 was decoded with ffmpeg, not just represented by a fake
   Web Audio buffer. It decoded to 32.542375 s of finite
   stereo PCM. Radio and ambience PCM hashes were also reconstructed and checked.

V5/V6 audio scripts assert the old four-active/eight-total voice cap, one music
asset and the old escape behavior. V7 replaces those intentional behavior checks;
the native-clock and V4 engine/foley regression checks remain applicable.

## Measured signals

| Fixture | Measured result |
| --- | --- |
| Siren at 100 m | RMS 0.05845 |
| Siren at 200 m | RMS 0.02765 |
| Siren at 320 m | RMS 0.01453 |
| Actual full-load native engine mix | Stereo RMS 0.10066 |
| Nearby civilian car | RMS 0.01301 |
| More distant civilian car | RMS 0.00314 |
| Recorded radio fixture | RMS 0.05954 |
| Close left facade reflection | Left early energy 27.9 times right |
| Mirrored right facade reflection | Right early energy 27.9 times left |
| Reverb off | Zero delayed tail energy |
| World scheduling | Maximum 5 buffers; zero native engine steps |
| Sampled music notes | Maximum 12 concurrent voices; bound 48 |

The siren/native comparison is a signal-level proxy before final stereo/master
and music/limiter processing. It does not establish perceived loudness on every
speaker, headphone or listening volume.

At escape, pursuit gain was 0.773 after one second, 0.267 after four seconds,
0.052 after eight seconds and 0.022 after ten seconds. Cruising gain rose to 0.824.
Pausing froze both loop position and the release envelope. Missed animation frames
did not schedule a burst of stale percussion events.

## Sources and limits

`dist/audio/ATTRIBUTION.txt` lists all authors, primary source URLs, licenses,
adaptations and exact source names. `qa/audio-v7-assets.json` records hashes, sample
rates and selected durations. The added assets are CC0. The existing MotorLab SDK
keeps its own supplied license. No sound requires runtime network access.

These checks exercise DSP, actual native engine output, transport scheduling,
source prioritization and lifecycle with a mocked Web Audio host. No browser GPU,
real AudioContext autoplay, sound-device listening, controller or wheel hardware
claim is made. Music codec decoding was independently checked through ffmpeg.
