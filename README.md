# SIDEWAYS V12

[Play in your browser](https://thesimonmc.github.io/sideways/) · [Download ZIP or offline HTML](https://github.com/TheSimonMC/sideways/releases/latest)

GitHub Pages publishes the tested `SIDEWAYS.html` on every push to `main`. To publish source changes, rebuild and rerun the standalone checks described below, then copy `dist/SIDEWAYS.html` to `SIDEWAYS.html` and commit it with the updated browser report. The deployment verifies that their SHA-256 values match.

Start with **READ-ME-V12.txt** for the current UI, controls, audio extension and verification limits.

## SIDEWAYS / City Sessions

SIDEWAYS is a 3D driving game with low-poly comic graphics, a top-down camera, a manual drivetrain and a city to explore. Earn points from close passes, drifts and jobs, then buy cars, engine swaps and parts. Up to four friends can share a city through an eight-character lobby code.

The player engine and its sound use the supplied MotorLab SDK 1.6.3, Physics Release 14 and Audio Release 14. The game has four fictional cars and eight engine families, with 16 independently selected part categories. City Free Roam uses Neon District; Time Attack and Drift Rush use the separate Dock 09 track. Chase and hood cameras are available alongside the default top-down view.

## Play the downloaded game

Open `SIDEWAYS-v12.html` from the chat attachment. The complete ZIP includes the same game as `SIDEWAYS.html` at its root, along with the editable project, SDK, credits and instructions. Extract the ZIP before opening its HTML. Single-player, including NPC racing, needs no server or network download. Multiplayer still needs internet access to signaling and peers.

The HTML includes code, fonts, models and sound. No Sites address is used by the game. Progress stays in the browser and origin where you played. Copying the HTML to another PC copies the game assets; it does not copy browser storage. Click or press a key to enable sound. A browser must expose a controller or wheel through its Gamepad API before the game can bind it.

For source edits, the modular browser entry is `dist/index.html`. To rebuild the standalone file with Node.js 24:

```sh
npm ci
node build.mjs
```

This creates `dist/SIDEWAYS.html`. After running `node qa/standalone-v12-check.mjs` and `node qa/standalone-browser-v12.cjs` on that build, `node qa/package-v12.mjs` creates `release/SIDEWAYS-v12.html` and `release/SIDEWAYS-v12.zip`. The browser check needs Playwright; dependency and browser path options are in READ-ME-V12.txt. Packaging verifies that the tested HTML matches the delivered bytes. These commands do not publish a Site or push a repository.

## V12 changes

The garage now uses a large vehicle stage, category rail, priced part cards and explicit purchase/installation. Menus restore focus when returning, contain keyboard navigation within dialogs, and provide controller text entry. Settings include contextual explanations, and the map pairs a visible route and cursor with service filters and destination details. The circular instrument includes RPM, gear, NOS and a brief critical-damage transition.

Vehicle audio follows model-space engine, intake, drivetrain, wheel and exhaust points, with an individual propagation path for each outlet. Actual camera position and orientation drive the listener, except for the deliberately closer overhead microphone. The MotorLab 1.6.3 adapter extension is documented in `sdk/SIDEWAYS-EXTENSION.md`; it is not an official new SDK release.

## V11 changes

MotorLab 1.6.3 supplies the player engine and pressure-driven exhaust sound. Its native source layers, calibrated per-engine levels and camera-relative stereo stay connected to the one physical engine clock. Recorded NPC engine beds now have four native engine families. Directional early reflections use city walls and the Dock 09 containers and buildings. The radio has eight recorded spoken clips with event-specific choices and a no-repeat rule; short English captions give the current location and tactical context.

Club Race adds five AI rivals on Dock 09. Choose Rookie, Club or Pro and one, three or five laps. Rivals brake for bends, choose passing lanes, react to nearby cars and recover by reversing when blocked. Body contacts change their motion and condition. Ordered checkpoints and continuous track progress determine laps and standings. There is no distance-based catch-up boost or teleport recovery for opponents. A track reset returns the player to the last valid sector and holds the car for five seconds while rivals continue.

The garage now has 16 independent part categories and 48 choices. Intake, radiator, oil cooler, engine internals, gearset, final drive, chassis and wheel width join the previous parts. Their prices and ownership use the existing career wallet. Parts affect native hardware, heat rejection, gearing, strength, mass and tyre behavior. New fields default to stock when loading an older save.

Seven body zones retain local crush after impacts. Front and rear bumpers can detach and become short-lived debris. Mechanics can replace each panel. Damage, fuel and temperatures survive a reset or a change of setup. This remains rigid-body contact with persistent visual deformation and component damage; it does not reproduce a full soft-body structure. Exact dents are local to each player, while existing multiplayer state still carries overall condition.

Police searches now distribute patrols across the last known area and its likely exits. Observed heading and speed guide intercept routes. Junction approach speeds, nearby vehicles and blocked routes affect their driving. Losing sight stops direct position updates; officers have to find the car again. Patrol and pursuit radio events use several short variants.

## Earlier drivetrain and multiplayer fixes

The start-of-drive disconnect is fixed. The previous PeerJS JSON serializer rejected the populated city packet at its 16,300-byte limit. Connections now use PeerJS binary serialization and its chunking. The regression checks execute the shipped library's actual codecs, including interleaved chunk assembly, as well as the game protocol. Older JSON clients get an update message before the drive starts.

Connection errors, loading errors and an intentional host exit have distinct retained messages. The lobby shows the stage, error code and sanitized details with a Copy Details button. A host loading failure reaches guests before the room closes. A guest loading failure removes that guest without ending the host's drive. Starting a new connection clears the previous report.

Engine internals, cooling, lubrication and drivetrain parts have separate health. A wheel-driven overrev can damage the valvetrain, pistons, bearings and pumps despite the fuel limiter. Clutch heat comes from slip work; engine heat comes from MotorLab's measured wall heat and friction work. Lost coolant reduces heat transfer, low oil pressure damages bearings, hot brakes fade, and a stripped gear or broken shaft can disconnect drive.

Vehicle Condition is available in the pause menu and from the temperature strip. A mechanic can replace one part or repair the whole car. Oil and coolant top-ups are separate from leak repairs. Temperatures, fluids and damage survive road resets, menu visits and car changes. Bearing knock, coolant hiss, smoke, steam and controller feedback follow component state.

## City Sessions features

The city has bending streets, smaller blocks, alleys and five named districts. Civilian traffic keeps left. Street lamps sit outside the carriageway. The 2D map follows the street geometry, supports waypoints and draws routes along the road graph. The round minimap turns with the car while its north marker stays tied to world north. Nearby services, officers, cameras, friends and the current destination appear on it.

A phone shows dispatch messages and jobs. Completed close passes earn points and can build a short chain. Drift banks, deliveries and escaped pursuits also pay. The garage shows the cost before a purchase, keeps owned parts available for later builds and retains the installed setup when migrating from earlier editions.

Private multiplayer lobbies have host-controlled traffic, police, damage, time, capacity and player-contact rules. The host runs the shared traffic, police and clock. Each driver runs their own drivetrain locally; remote models interpolate received poses.

Cruising now uses Umplix's rock arrangement, Super Wreck Roadway. A separate pursuit arrangement, percussion, search filtering and an escape release follow police state. Reading and pause screens lower and filter the music. Hidden tabs stop world and interface sounds immediately; optional background music uses a separate quiet mix. Reward, job, delivery and waypoint events have sound and supported-controller feedback.

## Points, jobs and the garage

A new career starts with 3,500 points, the HACHI 09, its turbo six and the starter parts. Points and purchases are saved in this browser. Clearing site data removes that save; a different browser or origin has a separate career. Multiplayer does not share wallets or transfer purchases.

Press Interact away from a service bay to accept the phone's offer. Delivery jobs mark the pickup first, then the destination. Stop in the marked area to load or unload. Damage reduces the cargo payout; running out of time or recovering the car cancels the job. Other offers ask for five close passes, 5,000 banked drift points, an escaped pursuit, two kilometres of city driving or 30 seconds above 80 km/h without a collision. A collision resets the clean-run streak.

| Activity | Payment |
| :--- | :--- |
| Completed close pass at 50 km/h or more | Starts at 120 points; speed and a chain of up to five passes increase it |
| Banked drift | The banked drift points |
| Escaped pursuit | 1,200 plus 900 per recorded heat level, after a pursuit lasting at least five seconds |
| Delivery | 3,600 plus a distance allowance, reduced by cargo damage |
| Other phone objectives | 2,400 to 3,800 points, depending on the job |

Repeated reports from the same nearby traffic car have a cooldown. A close pass pays after the bodies have cleared; a collision during the pass invalidates it. Recovery resets distance tracking and cancels the current job. City objectives do not advance on Dock 09, though drift points can still be banked there.

| Car | Stock engine | Price |
| :--- | :--- | ---: |
| HACHI 09 | I6 3.0 Turbo | Starter car |
| VECTOR GT | I4 2.0 NA | 32,000 |
| KITSUNE R | 13R twin rotor | 46,000 |
| ATLAS V8 | V8 5.0 NA | 58,000 |

A new car includes its stock engine. Owned engines and parts can be reused across cars without another purchase.

| Engine swap | Price |
| :--- | ---: |
| I4 2.0 NA | 12,000 |
| 13R twin rotor | 22,000 |
| I6 3.0 Turbo | 24,000 |
| V6 3.2 NA | 26,000 |
| V8 5.0 NA | 29,000 |
| Flat-six 3.8 NA | 33,000 |
| V10 5.0 NA | 48,000 |
| V12 6.0 NA | 62,000 |

| Part | Upgrades and prices |
| :--- | :--- |
| ECU | Sport 3,600; Track 6,800 |
| Turbo | Street 6,200; Race 11,500 |
| Exhaust | Sport 2,900; Open 5,400 |
| Tyres | Drift 3,400; Sport 4,800 |
| Suspension | Coilovers 5,600; Track 9,200 |
| Brakes | Sport 4,200; Track 7,800 |
| Differential | 1.5-way LSD 4,500; 2-way LSD 6,500 |
| Clutch | Sport 3,200; Race 6,100 |

Intake, cooling, engine internals, gearset, final drive, chassis and wheel width have their own priced choices in the garage. The displayed quote includes every newly selected unowned part. The starter setup already includes the 1.5-way LSD. Stock parts cost no points. Turbo hardware is disabled for naturally aspirated engines. Prices and ownership appear beside the choices in the garage. A preview changes the displayed car; Buy & Install commits the purchase and build. Closing the garage discards the preview. Installing at a mechanic keeps the current city and multiplayer session, then resumes driving.

Parts affect the solver: engine mass and configuration, boost targets, redline, tyre grip, spring and damper rates, brake torque and bias, differential locking and clutch capacity. The garage lists mass, displacement, redline, boost, brake bias and clutch capacity. Telemetry reads simulated torque and power.

## Club Race

Select Club Race on the main menu, choose the difficulty and distance, then Join the Grid. Race settings also work through the controller's menu controls. The field has six drivers including you. The HUD shows position, lap, estimated gaps and a wrong-way warning. Standings classify finished drivers by crossing time; gaps for drivers still racing are estimates from track distance and pace.

Pass all eight gates in order. Driving backwards over a line, cutting across the infield or jumping to a later sector cannot complete a lap. Reset returns you just after the last valid gate, keeps car condition, and applies a five-second hold. Pause or losing window focus freezes the race. Garage changes and service are unavailable during an active race. Use Pause > Retire from Race to end a damaged or abandoned run; retirement pays no finish award. Repair the car in Free Roam before starting another race.

For a three-lap Club event, first through sixth pay 8,000, 6,200, 4,700, 3,500, 2,400 and 1,600 points. Rookie pays 75% and Pro 130%; one- and five-lap events scale with their distance. A completion pays once. Drift points remain separate. The result screen shows standings at your finish, including opponents still on track.

## Driving

Four wheels have separate rotation, slip, load and contact. Spring/damper contacts and anti-roll forces produce heave, pitch and roll. Longitudinal and lateral tyre forces share grip. Brakes have pressure response, front/rear bias, ABS and temperature effects. The handbrake applies rear-wheel braking torque without opening the clutch for you.

Automatic, sequential and H-pattern shifting are available. Downshifts and reverse have no speed lock. An engaged clutch with a badly mismatched gear can stall or over-rev the engine and damage the drivetrain. An open clutch separates the engine from that wheel-driven load.

For a burnout, enable manual clutch and turn driving assists off. Select first, open the clutch, build revs, then release the clutch and balance the front-biased footbrake. Rear wheelspin depends on drive torque and tyre grip. Holding the rear handbrake can stall the engine or make the clutch slip. If the engine stops, open the clutch or select neutral, then hold the starter.

NOS opens whenever its button is held and charge remains, including at rest, in neutral, in reverse and while braking. It consumes the bottle while held. A stopped or fuel-starved engine receives no extra combustion torque. Added torque enters the engine crankshaft and passes through the clutch, gears, differential and tyres. Driving and drifting recharge NOS; a mechanic can refill it.

Condition is tracked for pistons/rings (or rotor seals), crank bearings, the valvetrain where fitted, head gasket, radiator, water pump, oil pump, oil pan, clutch plate, gearbox bearings, every forward gear and reverse, differential, driveshaft and turbo where fitted. Each corner also has its own brake, tyre and suspension condition. Body panels retain aggregate damage. Severe wheel impacts can detach a wheel, removing its tyre, spring and brake forces. Fuel use follows injected fuel mass, with extra demand during NOS.

The cooling and lubrication model uses separate engine, coolant, oil, clutch, gearbox, differential and turbo temperatures, plus four brake and tyre temperatures. Heat follows measured work; thermal mass, heat exchange, airflow and coolant flow govern temperature. Leaks consume fluid. Worn or overheated components alter clutch capacity, torque transmission, differential locking, boost, friction and combustion. These are tuned fictional vehicle parameters; they are not measured replicas of real engines.

The limiter cuts fuel, but cannot hold the crank below redline if the wheels drive it through a low gear. Depressing the clutch disconnects that load. Damage scales with excess rotational load and exposure rather than a fixed failed-shift timer. A broken clutch or selected gear can leave the engine running while the car no longer receives drive.

The simulation uses a planar driving body with four spring contacts. Full suspension linkage geometry, rollovers, separate unsprung masses, soft-body crashes and measured vehicle-specific tyre data are outside its scope. The component model does not simulate every bolt, bearing surface or flexible part. It is not a 1:1 reproduction of BeamNG. NPCs use lighter traffic bodies rather than a native engine session for every car.

## The city and police

Neon District has 81 junctions and 144 two-way street segments, plus alleys. The districts are Old Town, Garden Heights, Midtown, Downtown and Ironworks. Thirty-six civilian cars in normal traffic use left-hand lanes, signals, braking and turn indicators. They react to approaching cars, horns and emergency vehicles. Traffic and rendered signal lamps use the same clock.

Only the selected map is constructed. Changing worlds disposes the previous map, traffic and police. The title screen uses a separate showroom.

Three police units patrol by day; three more leave the station at night. Officers react to offenses they can observe. Buildings can block their view. Twelve directional speed cameras measure crossings and report serious speeding. Officers investigate the recorded location, then need to find the driver.

Break line of sight to begin a search. The map shows the last known position, search area and officers. Stay hidden until the search ends to escape. Stay nearly stopped for three seconds beside a nearby stopped officer in sight and you are arrested. Release places a roadworthy car outside the station with enough fuel to leave. Recovery is unavailable during pursuit and search.

Two mechanics, two fuel stations and the police station have map markers. Stop in a marked service court and press Interact. Fuel is added over time; mechanics offer full repair, individual component replacements, oil/coolant top-ups, tuning and a NOS refill. Dock 09 has a combined pit. These service actions are free. Leaving the service bay cancels unfinished work while keeping fuel already added. Returning from the component inspector to the service menu keeps the selected repair running. Repair, fuel and NOS are separate actions.

Fuel, oil, coolant, temperatures, component damage and NOS are retained per car. Returning to the menu, changing maps or resetting to the road does not repair or refill the car. Recovery takes a stranded car to a suitable service location and preserves its condition.

## Controls

| Action | Keyboard | Xbox / PlayStation |
| :--- | :--- | :--- |
| Steer | A / D or left / right arrows | Left stick |
| Throttle | W or up arrow | RT / R2 |
| Brake | S or down arrow | LT / L2 |
| Handbrake | Space | B / Circle |
| NOS | Hold Shift | Hold A / Cross |
| Camera | C | Y / Triangle |
| Look around | Numpad 4 / 6 / 8 / 2 | Right stick |
| Rear view | Hold B | Hold R3 |
| Downshift / upshift | Q / E | LB / L1, RB / R1 |
| Clutch | Hold Ctrl | Hold L3 |
| Starter | Hold I | Hold D-pad up |
| Neutral | N | D-pad down |
| Horn | Hold H | Hold D-pad left |
| Headlights | L | D-pad right |
| Service / accept phone job | F | X / Square |
| Map | Tab | View / Share |
| Pause | P | Start / Options |
| Main menu from driving | Escape | Pause, then Main Menu |
| Reset to road | R | Recovery menu or custom binding |
| Transmission mode | T | Settings |
| Settings / garage | O / G | Menus |
| Menu confirm / back | Enter / Escape | A / Cross, B / Circle |

Q/E or paddles select sequential mode. Shift down from first through neutral to reverse. In manual transmission, throttle remains throttle in reverse and brake remains brake.

Prompts follow the last actively used device. Small stick noise does not switch them. Menus use directional focus, and lobby codes can be entered through an on-screen controller keypad. The map supports a pointer or a directional cursor with confirm to mark a destination.

Controls includes keyboard remapping, button bindings, calibration, live signals and saved profiles. Wheels, pedals and H-pattern shifters use the axes/buttons reported by the browser. Capture steering centre/endpoints, pedal rest/full travel and each gear slot. Inverted pedals, combined pedals and a two-axis shifter are supported. No active gear signal means neutral. Browser or driver limitations can prevent a G920 or its shifter from exposing every signal.

Supported controllers receive vibration for continuous NOS, tyre work, drifting, braking, road contact, suspension impulses, shifts, collisions and game events. Reading and pause screens stop driving rumble, while purchases, waypoints and objectives can give a short cue. Lost focus, disconnect and disabled feedback stop output. Steering-wheel torque force feedback is not included. No physical G920 or wheel was tested for this release.

## Camera, graphics and sound

Right-stick look follows the screen and returns smoothly when released. Hold R3 for rear view. Look sensitivity and optional horizontal inversion are in Drive settings. Chase distance increases with speed; NOS adds distance, field of view and blue peripheral effects. World motion blur follows camera motion while a depth-aware mask keeps the car readable.

The scene has a sun, moon, stars, clouds, fog, ambient light, street lights and headlights. Day length and fixed day, sunset or night are configurable. Bloom, contact shading, vignette and blur have separate controls. PSX, Balanced and High presets keep the comic palette. Ultrawide framing and HUD inset controls let you bring the driving display closer to the centre; physical monitor curvature is not detected.

Trees have moving crowns and separate leaves. Cars can shed leaves, bend grass and throw loose material from loaded wheels. Surface sounds and tracks follow contact and tyre work.

The player's engine sound and physics share one MotorLab engine session. Native exhaust distortion, intake and mechanical sources follow engine state; the output mix adds only linear tone and level shaping before final peak protection. Recorded tyre squeal needs meaningful slip and dissipated work, so normal rolling stays quiet. Nearby engines, horns, sirens and impacts use stereo position and distance. Facade reflections vary between open spaces and enclosed streets.

Recorded police calls accompany short game-generated summaries. Three siren voices are reserved before civilian sources are selected. Sirens, radio, ambience, reflections and music have separate controls. Test Siren and Test Radio work from Audio settings. The audio combines native synthesis, licensed recordings and procedural effects; the NOS layer is an arcade effect.

## Multiplayer

Create a lobby, share its eight-character code and have guests choose Ready. The host starts when everyone is ready. Guests can join an ongoing city if a slot is free. The code lasts for that host session. Changing a lobby rule clears guest readiness.

Rules cover two to four players, traffic off/light/normal, police, damage, cycling or fixed time, and ghost/solid player contact. Ghost contact is the default. Solid contact uses local collision responses against received poses and can differ between players under latency.

The game uses vendored PeerJS 1.5.5 and WebRTC data channels. The default PeerJS Cloud service introduces peers; GitHub Pages only hosts the game files. Some networks require a TURN relay. Advanced connection settings support a custom signaling host and temporary TURN credentials. Public signaling availability and direct connections across every router/firewall are not guaranteed.

The host owns shared AI, pursuit events and time; each player owns their local driving simulation. Wallets and jobs remain local. Opening a host menu keeps AI and the clock running for guests. If the host switches away or hides the tab, the host sends a pause notice and guests wait until it returns. Host departure ends the room, with no host migration. Inactive or stale cars stop supplying sound and collisions. The protocol has bounded packets and queues, sender checks and timeouts, but does not provide server-side anti-cheat or rollback. No microphone or camera access is requested. [Multiplayer details](docs/multiplayer.md) cover configuration and the integration API.

## Validation

`qa/release-v12.json` identifies the current verification evidence and its limits. Use Node.js 24 for the JavaScript suites. Examples for this edition:

```sh
node qa/navigation-v12-check.mjs
node qa/navigation-main-v12-check.mjs
node qa/map-v12-check.mjs
node qa/instruments-v12-check.mjs
node qa/audio-v12-check.mjs
node qa/modular-v11-check.mjs
node qa/race-v11-check.mjs
node qa/police-v11-check.mjs
node qa/mechanical-regression-v11-check.mjs
node build.mjs
node qa/standalone-v12-check.mjs
node qa/standalone-browser-v12.cjs
node qa/package-v12.mjs
```

The SDK tests run all eight native engine families, old-session migration, layer meters, stereo perspective and PCM/manual clock parity. Modular tests exercise real tuning effects, impact locations, damage persistence and Three.js geometry. Circuit tests run actual rivals through complete races and test ordered gates, recovery and contact. Main integration runs actual event handlers and frame logic in a functional DOM. The mechanical regression keeps the established overrev, heat and repair scenarios. Audio checks include real PCM, recordings, sound focus and reflection geometry.

The final standalone browser run loads the file with external HTTP(S) blocked, checks a purchase and ownership, and starts and drives Club Race. Browser tests use Chromium software rendering; they do not establish GPU quality on other hardware, listening quality, physical controller behavior or live cross-network WebRTC. The package checks verify exact built files and ZIP integrity. Earlier reports are retained, and some older suites were rerun: consult `qa/release-v12.json` rather than inferring currency from a filename. The SDK's V7 replay hash differs on this runtime in both the original and modified SDK; `qa/sdk-v12-baseline.json` records the comparison.

## Credits and licenses

Full recording credits, source URLs, edits and licenses are in [audio/ATTRIBUTION.txt](dist/audio/ATTRIBUTION.txt). Source hashes are recorded in the audio QA asset reports.

- MotorLab SDK 1.6.3, Physics Release 14 and Audio Release 14, supplied by the user. It retains its supplied terms; this project does not assign it a new license.
- Three.js r170 and PeerJS 1.5.5, MIT. License files are in `dist/vendor/` in the complete ZIP.
- Barlow and Barlow Condensed by Jeremy Tribby, SIL Open Font License 1.1. License files are in `dist/fonts/`.
- Tyres: audible-edge / Tom Haigh, loop by qubodup, [Car tire squeal / skid loop](https://opengameart.org/content/car-tire-squeal-skid-loop), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- Cruising music: Umplix, [Super Wreck Roadway](https://opengameart.org/content/super-wreck-roadway), CC0. This replaces the earlier Joth cruising phrase.
- Pursuit music: bertsz, [Skateboard-car-chase](https://opengameart.org/content/skateboard-car-chase), CC0.
- Acoustic drums, metal and piano: Versilian Studios / Sam Gossner, [VCSL](https://github.com/sgossner/VCSL), CC0.
- Police radio: bluelinevibes, ciaranm758 and alean; birds and crickets: synth2 and RyanKingArt; switches: Kenney; horn: hsaunier10; siren: guitarguy1985. These recordings use CC0. Exact sources and adaptations are listed in the audio attribution file.

The game text is in English. Vehicle names, bodies and the escape cue are original to SIDEWAYS. SIDEWAYS is not affiliated with Need for Speed, Electronic Arts or Grand Theft Auto.

