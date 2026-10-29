# SIDEWAYS spatial audio extension

This copy extends the supplied MotorLab 1.6.3 audio adapter. It is not a new upstream SDK release. Engine and vehicle physics sources are unchanged. Original SDK ZIPs remain in the user's supplied Gesamtpaket; this V12 archive contains the extended sources and bundles.

`setAudio({listener: {scene}})` accepts an explicit listener position, camera-right vector and up to 24 named emitters. Each emitter identifies a native source layer, world position, radiation direction and gain. Several outlets share one exhaust layer with gains summing to at most one. `scene: null` restores the existing generic listener.

Each native layer is generated once per synth sample. Its history feeds each outlet's separate propagation delay, distance loss, air filter and two-ear head shadow. Source-specific image-source paths approximate reflections from four measured facade directions. Reflection budgets are deducted from direct output, and generic engine early reflections are disabled to avoid duplication. The existing diffuse street tail remains.

All coordinate triples must be finite. Reflection gains are bounded and each source's emitter gains must sum to at most one. The public wrapper, direct synth and worklet use the same validation. The engine still advances exactly once through `renderAudio`; no second engine, stem rerender or hidden time step is used.

Chase and hood modes use the camera position and orientation. Top-down uses a microphone limited to 5.5 metres from the car, retaining camera orientation. The geometry hook supplies damaged, transformed outlet positions. Gearbox, starter, differential, nitrous and wheel foley use their own anchors.

This is a generic two-ear approximation, not measured HRTF or wave tracing. Both visible outlets reproduce the same exhaust layer; individual cylinder-bank recordings are not inferred. Four sampled facade distances approximate planes, not full mesh occlusion. Wind remains a listener-wide sound. NPCs retain lightweight recorded engine profiles.

Rebuild after source edits with `python sdk/build_game_extension.py`. Check `qa/audio-v12-check.mjs` plus the existing SDK and audio regression checks. Automated PCM tests cannot replace listening on real headphones or speakers.
