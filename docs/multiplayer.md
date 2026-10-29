# SIDEWAYS multiplayer

Up to four friends can drive in the same city. The host creates a lobby and shares its eight-character code. Guests enter that code, choose Ready and wait for the host to start. A guest can also join a running session when a slot is free. The code lasts while that host keeps the room open.

## Hosting the game

The game files work on a static HTTPS host, including GitHub Pages. Copy the contents of `dist/` to the publishing folder, or publish the standalone HTML as `index.html`. The bundled PeerJS library does not require a CDN download during play.

A short code needs a signaling service so browsers can find each other. By default, SIDEWAYS uses the public PeerJS Cloud service for that handshake. Game state then travels over WebRTC data channels. A TURN relay may carry the data if a network cannot establish a direct connection. GitHub Pages hosts the files; it does not run the signaling or relay service.

No microphone, camera, voice chat or account is requested. Do not put private TURN server credentials into a public repository. Supply temporary credentials through the optional configuration when using your own relay.

The public signaling service can be unavailable or rate-limited. Some router and firewall combinations need a TURN relay. A failed connection produces an explanation and can be retried. The game does not promise that direct WebRTC will connect every network.

## Room rules

Only the host changes rules, and only in the lobby:

| Rule | Choices |
| :--- | :--- |
| Players | 2, 3 or 4 |
| Traffic | Off, Light or Normal |
| Police | On or Off |
| Damage | On or Off |
| Time | Cycle, Day, Sunset or Night |
| Player contact | Ghost or Solid |

Changing rules clears guest readiness. The host cannot start until every joined guest is ready. Ghost contact is the default. Solid contact uses each driver's local collision solver against remote vehicle poses. It has no rollback correction, so latency can make two drivers see different contact timing.

Each browser runs its own player's drivetrain. The host runs the shared traffic, police and clock. Guests receive those world snapshots and do not independently advance the same AI. The host is a participating player's browser, not a dedicated game server. It is intended for private sessions with friends; it is not an anti-cheat system.

If the host leaves, the session ends. Guests can leave independently. Connection loss removes stale remote cars and sounds. There is no host migration.

## Start failures and disconnect reports

V9 retains the last session error in the lobby after returning to the menu. Copy Details includes the code, loading/transport stage, role and sanitized explanation. It omits lobby codes, peer IDs and connection credentials. A new create/join attempt clears it.

| Code | Meaning |
| :--- | :--- |
| `HOST_START_FAILED` | The host could not load the city, vehicle or shaders; the reason is sent before shutdown. |
| `PLAYER_START_FAILED` | This guest could not load the drive; the host can continue. |
| `SEND_FAILED` | The data channel rejected a message; details identify its type and size. |
| `CONNECTION_CLOSED` | The channel closed without a deliberate host-end message. |
| `CONNECTION_TIMEOUT` | The peer stopped answering within the timeout. |
| `HOST_LEFT` | The host deliberately ended the session. |
| `TRANSPORT_OUTDATED` | An older JSON client must reload the updated game. |

## Integration API

`dist/multiplayer.js` exports `MultiplayerSession`, `DEFAULT_LOBBY_RULES`, code/rule helpers and finite packet validators. `dist/network-cars.js` exports `createNetworkCars(scene)`.

```js
const session = new MultiplayerSession();

await session.host({
  name: 'Driver',
  build: activeBuild.selection,
  color: '#d8fa50',
  rules: {
    maxPlayers: 4,
    traffic: 'normal',
    police: true,
    damage: true,
    time: 'cycle',
    collisions: 'ghost'
  }
});

// On another browser:
await session.join(code, {
  name: 'Guest',
  build: activeBuild.selection,
  color: '#66aadd'
});
session.setReady(true);

// On the host:
session.start();
```

The host's `start()` and the guest's received start packet both produce a `start` event. Use that event to load the city. Starting a room is separate from the game finishing its map-loading sequence.

Call `session.update()` once per display frame, including while menus are open:

```js
session.update(dt, {
  state: { ...physics.state, horn: controls.horn },
  build: activeBuild.selection,
  color: currentPaint,
  active: world.kind === 'city' && phase === 'playing' && !document.hidden,
  world: session.isHost ? {
    traffic: traffic.captureSnapshot(),
    police: police.captureSnapshot(),
    hour: environment.hour,
    trafficTime: world.trafficTime,
    hostPaused: false
  } : undefined
});
```

`active` means the player's car is present in the city. A reading or pause overlay keeps the car present and the host's shared AI and clock ticking for guests. Loading, the main menu and an away tab use `false`. `setAway()` sends an immediate inactive notice. Before a host loses focus or hides the tab, send a final world update with `hostPaused: true`; guests hold until the host resumes. The main loop handles this before animation frames stop.

Do not call `leave()` for an ordinary map or settings overlay. Call it when the player chooses Leave Lobby or returns to the single-player main menu. `leave()` ends the whole room on a host and removes only the caller on a guest.

Read events once per frame:

```js
for (const event of session.consumeEvents()) {
  // status, room, start, playerJoined, playerLeft,
  // warning, error, gameEvent, sessionEnded
}

const snapshot = session.takeWorldSnapshot();
if (snapshot && !session.isHost) {
  traffic.applySnapshot(snapshot.traffic);
  police.applySnapshot(snapshot.police);
  environment.hour = snapshot.hour;
  world.setTrafficTime(snapshot.trafficTime);
}
traffic.advanceSnapshot?.(dt);
police.advanceSnapshot?.(dt);
```

Only the latest world snapshot is retained. It is consumed through `takeWorldSnapshot()`. The host can call `broadcastEvent(type, payload)` for `arrest`, `escaped`, `pursuit`, `radio`, `search`, `speedCamera`, `nearMiss`, `checkpoint` or `sessionNotice`. A guest receives `{ type: 'gameEvent', event: { type, payload } }`. Route individual arrests by the payload's `targetId` and completed close passes by `playerId`.

`session.getState()` returns:

```js
{
  status,        // offline, connecting, lobby, playing, error
  id, code, isHost, hostId, rules,
  players,       // id, name, build, color, ready, active
  ping, error, runId, worldAgeMs
}
```

`session.getRemotePlayers()` adds each remote state, its local receipt timestamp (`updatedAt`) and `ageMs`. Host AI should consume those current poses with `playerId: member.id`. Do not use delayed rendering poses for authoritative detection.

### Remote vehicles

```js
const remoteCars = createNetworkCars(scene);
remoteCars.sync(session.getRemotePlayers());
remoteCars.update(dt, totalTime);

const sounds = remoteCars.getNearbyAudio(physics.state);
const contacts = session.rules.collisions === 'solid'
  ? remoteCars.getColliders(physics.state)
  : [];
```

The renderer uses the actual vehicle model and build. It interpolates about 100 ms behind received data, predicts at most 120 ms, and snaps a large relocation. Buffers hold at most eight poses per car. Damage, missing wheels, steering, wheel rotation, lights, brake lamps and NOS follow transmitted state. Stale cars stop supplying audio and contacts.

Call `remoteCars.reset()` when leaving the city. `dispose()` also releases owned geometry, materials, decals and labels. `getStates()` supplies rendered poses for map markers; host simulation should use the session's current poses instead.

## Own signaling or TURN service

Pass the same optional `config` to `host()` and `join()`:

```js
{
  host: 'lobby.example.com',
  port: 443,
  path: '/peer',
  iceServers: [
    { urls: 'stun:stun.example.com:3478' },
    {
      urls: 'turns:relay.example.com:5349?transport=tcp',
      username: temporaryUsername,
      credential: temporaryCredential
    }
  ]
}
```

`host`, `port` and `path` are optional. Omit them to use PeerJS Cloud. Omitting `iceServers` leaves the library's default STUN configuration in use. Custom ICE servers must be ones you own or are authorized to use. TURN credentials stay in the session and are not included in lobby packets or diagnostics.

## Transport limits

V9 requests `serialization: 'binary'`. PeerJS 1.5.5's JSON serializer rejects encoded messages at 16,300 bytes; the populated first city frame exceeded that limit in V8. BinaryPack reduces the common frame size and uses PeerJS's built-in fragmentation for larger packets. Game-level packet bounds, sender validation and queue limits still apply after serialization. The eight-character room code and protocol namespace are retained, while incompatible JSON connections receive an explicit update message.


The network protocol uses a room identifier, protocol version and monotonic sender sequence. Guests cannot send host rules, shared AI state or authoritative game events. Poses are reduced to finite known fields; car and engine selections are resolved through the existing catalog. Shared snapshots have bounded depth, list lengths, keys and total size. Unknown object/prototype keys are rejected.

Player poses send at 20 Hz. The host includes world data at 10 Hz. Slow data channels skip replaceable pose frames. If an essential lobby message cannot be sent without exceeding the queue limit, that connection closes with an explanation instead of silently leaving room rules out of sync. Heartbeats detect lost connections, and session teardown clears timers, event queues and peer objects.

## Validation

Run:

```sh
node qa/multiplayer-v9-check.mjs
node qa/peerjs-codec-v9-check.mjs
node qa/integration-v9-check.mjs
```

The suite exercises a host and three guests through a controlled PeerJS-compatible transport. It covers joining, capacity, readiness, rules, late join, poses, world state, event authority, replay rejection, invalid data, slow transport, away state, timeout, cancellation and cleanup. Remote vehicle checks use actual Three.js objects and `createCar()`.

The codec check executes the vendored PeerJS implementation: it reproduces the old JSON rejection, round-trips real city frames, and verifies chunking/reassembly. The game integration checks use a controlled PeerJS-compatible transport and CPU geometry. They do not establish a live ICE connection, test different internet connections, render the vehicles on a GPU or verify the public signaling service's current uptime.

## Sources and dependency

- [PeerJS 1.5.5 release](https://github.com/peers/peerjs/releases/tag/v1.5.5), pinned vendored client.
- [PeerJS API](https://peerjs.com/client/api/peer), data connections, lifecycle and configuration.
- [PeerJS FAQ](https://peerjs.com/client/faq), signaling and TURN requirements.
- [MDN WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity), offer/answer, ICE and connection paths.
- [GitHub Pages site creation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site), static hosting.

PeerJS uses the MIT license. Its license is included in `dist/vendor/PEERJS-LICENSE.txt`.

## V14 map and visual builds

V14 uses protocol 10 and the sideways-v10 room namespace. Every participant must use V14. Player, traffic and police coordinate validation covers the archipelago. Sanitized build profiles include hood, spoiler, sideSkirts, rims, frontBumper and rearBumper; invalid or missing choices resolve to stock. This protocol version does not change wallet ownership or physics authority.
