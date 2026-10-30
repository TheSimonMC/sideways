# SIDEWAYS V31

[Play in your browser](https://thesimonmc.github.io/sideways/) · [Download ZIP or offline HTML](https://github.com/TheSimonMC/sideways/releases/latest)

GitHub Pages publishes the tested `SIDEWAYS.html` on every push to `main`. To publish source changes, rebuild and rerun the standalone checks described below, then copy `dist/SIDEWAYS.html` to `SIDEWAYS.html` and commit it with the updated browser report. The deployment verifies that their SHA-256 values match.

Start with **READ-ME-V31.txt** for this update, offline setup and verification limits.

V31 adds model-fitted interior tuning: steering wheels, seats, upholstery, colours, seams, dash decor, controls, cages, harnesses, instruments, live auxiliary gauges and powered ambient lighting. The garage previews the cabin directly. Mass, centre of gravity, driver contacts, restraint and hydraulic handbrake faults follow the installed parts. Supercharger and full mounting/removal integration remain next.

## SIDEWAYS / City Sessions

SIDEWAYS is a 3D driving game with low-poly comic graphics, a top-down camera, a manual drivetrain and a city to explore. Earn points from close passes, drifts and jobs, then buy cars, engine swaps and parts. Up to four friends can share a city through an eight-character lobby code.

The player engine and its sound use the supplied MotorLab SDK 1.6.3, Physics Release 14 and Audio Release 14. The game has four fictional cars and eight engine families, with 54 independently selected part categories, including seventeen exterior and thirteen interior categories. City Free Roam uses Neon Archipelago; Time Attack and Drift Rush use the separate Dock 09 track. Chase, hood and cockpit cameras are available alongside the default top-down view.

## Play the downloaded game

Open `SIDEWAYS-v31.html` from the chat attachment. The complete ZIP includes the same game as `SIDEWAYS.html` at its root, along with the editable project, SDK, credits and instructions. Extract the ZIP before opening its HTML. Single-player, including NPC racing, needs no server or network download. Multiplayer still needs internet access to signaling and peers.

The HTML includes code, fonts, models and sound. No Sites address is used by the game. Progress stays in the browser and origin where you played. Copying the HTML to another PC copies the game assets; it does not copy browser storage. Click or press a key to enable sound. A browser must expose a controller or wheel through its Gamepad API before the game can bind it.

For source edits, the modular browser entry is `dist/index.html`. To rebuild the standalone file with Node.js 24:

```sh
npm ci
node build.mjs
```

This creates `dist/SIDEWAYS.html`. After running `node qa/standalone-v31-check.mjs` and `node qa/standalone-browser-v31.cjs` on that build, `node qa/package-v31.mjs` creates `release/SIDEWAYS-v31.html` and `release/SIDEWAYS-v31.zip`. The browser check needs Playwright; dependency and browser path options are in READ-ME-V31.txt. Packaging verifies that the tested HTML matches the delivered bytes. These commands do not publish a Site or push a repository.

## V31: Interior tuning and cabin inspection

See [the Phase 5B report](docs/phase-5b-interior-report.md), [all 156 requirements](docs/goal-progress.md) and qa/release-v31.json. Twenty-two native/build suites and ten browser flows cover the delivered code. Multiplayer uses protocol 20; all players must reload V31. Individual cabin-part removal/detachment remains Phase 6. The following sections describe historical releases.

## V30: Exterior tuning and tinted glass

See [the Phase 5A report](docs/phase-5a-exterior-report.md), [all 156 requirements](docs/goal-progress.md) and qa/release-v30.json. Twenty-one native/build suites and eight browser flows cover the delivered code. Multiplayer uses protocol 19; all players must reload V30. Glass and collision approximations are documented. The following sections describe historical releases.

## V29: Cockpits and interiors

See [the Phase 4 report](docs/phase-4-cockpit-report.md), [all 156 requirements](docs/goal-progress.md) and qa/release-v29.json. Six browser flows and twenty native/build suites cover the delivered code. Mirror range/resolution and driver motion are documented browser approximations. Physical wheels and mobile GPUs remain unverified. Next is Phase 5 expanded tuning. The following sections describe historical releases.

## V28: Underbody assemblies and exhaust routing

Thirteen visible assemblies connect damage, missing support, steering, exhaust flow, sound, mass and individual repairs. See [the V28 report](docs/phase-3d-underbody-report.md), [the complete checklist](docs/goal-progress.md) and qa/release-v28.json. Phase 4 interiors, cockpit, navigation, mirrors and driver are next. Older sections describe their historical releases.

## V27: Spatial contacts and loose wheels

Open panels catch height-aware static obstacles and transfer impulses to hinges and the car. Loose wheels roll, bounce, slide and settle on their side; spin and motion interact through friction. Existing bridges and buildings provide their physical heights. Pools remain bounded. See [the V27 report](docs/phase-3c-contacts-report.md), [the complete checklist](docs/goal-progress.md) and qa/release-v27.json. Separate suspension members and full exhaust routing remain before Phase 4. Older sections describe their historical releases.

## V26: Glass, lamps and smaller attachments

Each of the four cars has twenty additional exterior components. Cracked or missing glass changes wind, a broken headlamp loses its own light beam, and missing splitters/diffusers change downforce. Mirrors, skirts, fenders, grille and exhaust outlets detach as separate meshes. Small local glass fragments use a bounded pool. Inspect and replace each damaged component at a mechanic; recovery and reload preserve damage, while a new run begins serviced.

Network protocol 18 shares component states through the existing pose messages. All players need V26. The RATE_LIMIT fix remains; loose fragments stay local. See [the V26 report](docs/phase-3b-exterior-report.md), [the complete checklist](docs/goal-progress.md) and qa/release-v26.json. Remaining Phase 3 contacts and suspension/exhaust pieces precede Phase 4 interiors. Older release notes below describe their historical versions.

## V25: Opening panels and detachable bodywork

Use the four panel buttons in the Garage on your installed car. Doors, hood and trunk use separate geometry, hinges, latches and mounts. Impacts can tear them away; loose parts keep their mesh and collide through bounded proxies. Missing parts change vehicle mass, axle loads and inertia, while openings affect drag and wind. Recovery preserves the condition; individual replacement repairs it, and a new run starts serviced.

Network protocol 17 carries the bounded panel states inside the existing pose messages. The RATE_LIMIT queue/coalescing fix remains. All players must reload V25. Loose debris stays local; missing, open and deformed parts are shared.

See [the V25 report](docs/phase-3a-body-panels-report.md), [all 156 requirements](docs/goal-progress.md) and `qa/release-v25.json`. Next is Phase 3B: individual glass, lamps and smaller appendages. Interiors, detailed animated engine bays and later phases remain open. The following release notes describe their historical versions.

## V24: Rain and wet roads

Rain now wets the road and leaves moisture that dries gradually. Each wheel responds to wet material and puddles using speed, tread, compound and pressure. One-sided puddles can pull the car; wet contact cools tyres. Spray, road sheen, fog and rain sound follow the same weather state. Traffic and race opponents adjust to wet grip.

Choose changing weather, clear skies or rain in Settings. The host sets weather in a multiplayer lobby; joining drivers receive current moisture. All players need V24 (network protocol 16). The RATE_LIMIT fix remains in place.

See [the V24 report](docs/phase-1e-weather-report.md), [all 156 requirements](docs/goal-progress.md) and `qa/release-v24.json`. Next: Phase 3 doors, hoods, glass, lights and detachable modules. Broader driving calibration and later interior/garage/world phases remain open. Older release notes below are historical.

## V23: Engine components and consequential damage

Ten additional components now affect the running engine: block, head, rods, crankshaft, timing chain, intake, exhaust, thermostat, fuel pump and ignition. Leaks, lost cooling, restricted airflow, lean mixture, misfires and failed timing have separate causes and repair actions. Replacing a chain or thermostat preserves damage already caused to valves or the head. Rotary engines use housing/shaft labels and do not acquire fictional rods or valve chains.

Save restoration, recovery and tuning preserve these faults. A failed pump or ignition cannot inherit a warm running engine. Intake/exhaust leaks have mechanical sound. Existing cars, maps, saves and the multiplayer RATE_LIMIT fix remain.

See [the V23 report](docs/phase-2d-engine-report.md), [all 156 requirements](docs/goal-progress.md) and `qa/release-v23.json`. Next: close the wet-road gap in Phase 1, then extend Phase 3 body parts. Interiors, engine-bay visuals and garage transitions remain later work. Older release notes below are historical.

## V22: Engine auxiliaries and electrical faults

The accessory belt, tensioner, alternator, battery, starter and radiator fan now have separate condition and repair actions. A broken belt stops alternator and water-pump drive. Battery charge, voltage, electrical demand and alternator output affect starting, ignition, lights and cooling. Slipping belts and prolonged cranking create heat and wear, with matching mechanical sound.

At a mechanic, Vehicle Condition offers CHARGE for battery charge and REPLACE for a damaged component. Charging does not repair the alternator or battery. Recovery, tuning and saved garages retain these faults; a new run services the car. Existing cars, maps and the multiplayer RATE_LIMIT fix remain.

See [the V22 report](docs/phase-2c-auxiliaries-report.md), [all 156 requirements](docs/goal-progress.md) and `qa/release-v22.json`. Phase 2 is still partial. Remaining engine components are next; a visible engine bay is planned in Phase 6. Earlier sections below describe historical releases.

## V21: Wheel bearings, steering and brake internals

Four wheel bearings now develop friction, heat, play and a wheel-specific rumble; a seized bearing can lock its wheel. Bent or broken tie rods and a damaged steering rack change actual steering. Every existing car has moving steering links, and the measured wheel alignment drives its model.

The dual brake circuits now include master-cylinder seals, booster assistance, fail-passive ABS faults, fluid heat/ageing, boiling and trapped air. Replace individual parts, refill, change fluid or bleed a circuit in Vehicle Condition at a mechanic. Refilling alone cannot remove trapped air. Upgrades and recovery preserve damage; a new run/restart restores the car. The V20 RATE_LIMIT fix remains in place; both players should load the latest build.

See [the current report](docs/phase-2b-chassis-report.md), [all 156 requirements](docs/goal-progress.md) and `qa/release-v21.json`. Phase 2 remains partial: engine auxiliaries are next. These are bounded game models, with shared pad/disc condition and no real-car calibration. Earlier sections below describe historical increments.

## V20: Multiplayer recovery and Phase 2B brakes

Fixes a reproduced RATE_LIMIT disconnect: valid RTC position updates can arrive together after loading blocks the receiver. Excess snapshots now coalesce into a bounded latest state, while control-message flood protection remains. Two real browser players and a deliberate 7.5-second stall on each receiving side are tested. Slow rejoining now gets separate channel-opening and lobby-handshake deadlines, with finite timeouts. Both players should reload V20; the compatible wire protocol stays at 15.

Four brake hoses and two diagonal hydraulic circuits now carry persistent damage and fluid levels. Leaks reduce actual braking; hose replacement and fluid refill are separate operations. Mechanical handbraking remains available. Each disc glows from its calculated temperature. Tuning does not repair damaged hoses.

See [the current report](docs/phase-2b-brakes-report.md), [all 156 requirements](docs/goal-progress.md) and `qa/release-v20.json`. Phase 2B is partial: wheel bearings and steering components are next; master-cylinder, pedal-travel and fluid-boiling models remain outside this increment. Current tests use the V20 scripts under `qa/`. Earlier release sections below are historical.

## V19: Phase 2A – tyres

Each tyre now stores pressure charge, casing damage, a flat spot, puncture and blowout state. Slip work and heat can rupture a loaded tyre. Deflation affects grip, rolling resistance, radius and suspension; the rubber changes shape around the retained rim. Burst particles and procedural sound follow that same state. The condition panel shows the measured values. Selective replacement preserves other damage, and changing compounds does not repair a casing.

See [the Phase 2A report](docs/phase-2a-report.md) and [all 156 requirements](docs/goal-progress.md). Phase 1 and Phase 2 remain partial. Next: wheel bearings, steering/brake components and their repair paths. This is a lumped fictional model, not a validated real tyre simulation. All peers need V19 (protocol 15); detailed remote tyre damage is not replicated.

Current checks: `node qa/regressions-v19.mjs`, the tyre/drivetrain/road-contact/aero-hop V19 checks, goal coverage, standalone and all four `*browser-v19.cjs` tests. `qa/release-v19.json` records current evidence and limits. The following release notes are historical, including their then-open work.

## V18: Phase 1D – aero and wheel hop

Spoilers, splitters and diffusers now affect downforce, drag, axle loads and fitted mass. Three GT wing angles are visible and functional. Attachment damage reduces aero; a severe rear impact can detach the fitted wing, leaving it missing until repaired. State survives saving, reloading and tuning changes. Braced axle links reduce a slip-work-limited wheel-hop mode that changes actual wheel loads and suspension audio signals.

See [the Phase 1D report](docs/phase-1d-report.md) and [all 156 requirements](docs/goal-progress.md). Phase 1 remains partial: tyre pressure/carcass/flatspots, weather and broader calibration are unfinished. Next is the required tyre foundation in Phase 2A. The hop model is a reduced approximation; detached mass is not yet subtracted. All peers need V18 (protocol 14).

Current checks: `node qa/regressions-v18.mjs`, `node qa/aero-hop-v18-check.mjs`, `node qa/drivetrain-v18-check.mjs`, `node qa/road-contact-v18-check.mjs`, `node qa/goal-coverage-v18-check.mjs`, all three `*browser-v18.cjs` tests and the standalone check. `qa/release-v18.json` records current evidence and limits. Release notes below describe historical scope and next steps at those dates.

## V17: Phase 1C – drivetrains and differentials

The original four cars remain RWD. Paid compatible garage conversions add FWD for Vector with I4/V6 and AWD for Hachi/Kitsune/Vector without V10/V12. Open AWD uses nominal 40:60 torque split. Front and center differential upgrades act through finite shaft impulses; broken axles, clutch slip, heat, wear and selective repairs affect the actual power path. TC, wheel smoke, spatial differential sound, ownership and saved condition follow the fitted drivetrain. No free handling mode is added.

See [the Phase 1C report](docs/phase-1c-report.md) and [all 156 requirements](docs/goal-progress.md). Phase 1 remains partial: wheel hop, aero tuning, tyre pressure/flatspots, weather and broader calibration are unfinished. Next is Phase 1D. All peers need V17 (protocol 13).

Current checks: `node qa/regressions-v17.mjs`, `node qa/drivetrain-v17-check.mjs`, `node qa/road-contact-v17-check.mjs`, `node qa/goal-coverage-v17-check.mjs`, both `*browser-v17.cjs` tests and the standalone check. `qa/release-v17.json` records verified evidence and limits. Earlier release notes below describe their historical scope.

## V16: Phase 1B – road contact and hills

Existing hill roads now exert real support forces on the car. Releasing the brakes in neutral allows rollback; uphill acceleration and braking differ from downhill. Tangent tyre forces include their vertical component, preventing incorrect wheel loading under hill braking. Four existing wheel samples define the local road plane without additional world lookups per simulation step.

Recovery and reset align the body and wheels to the road and initialize suspension history without a false impact. Suspension limits are relative to the road, low-speed lateral grip holds on a crossfall, and brake settling requires spare tyre/brake force. Individual bumps still reach each spring and the existing wheel animation and damper/impact audio. Airborne wheels receive no horizontal force from terrain below.

The cars, engines, maps, tuning parts and persistent condition are retained. This is a height-field chassis approximation, not a full 6-DOF rigid body. FWD/AWD, wheel hop, weather, tyre pressure and aero parts remain open in Phase 1. Next is Phase 1C; no later phase is marked complete. All peers need V16 (protocol 12). See the [phase report](docs/phase-1b-report.md) and [complete checklist](docs/goal-progress.md).

Run `node qa/regressions-v16.mjs` for current regressions and `node qa/road-contact-v16-check.mjs` for slope/uneven-road scenarios. They write V16 reports while retaining historical evidence. `qa/release-v16.json` lists the current verified reports and test limitations.

## V15: Phase 0 and Phase 1A

The complete user specification is preserved in [goal.txt](docs/goal.txt). [The inventory](docs/phase-0-bestandsaufnahme.md) maps the existing systems; [the progress checklist](docs/goal-progress.md) tracks all 156 requirements from Phases 0–18. Phase 0 is complete. Phase 1 is partial, and this release does not claim to complete the larger roadmap.

The free Street/Drift/Grip handling selector has been removed. Tyre forces now use a continuous adhesion-to-sliding transition and load sensitivity; yaw comes from wheel and collision forces rather than an artificial steering impulse. Factory steering lock and ratio differ across the four preserved chassis. Calibrated wheel input retains full lock at speed; keyboard and gamepad input use steering filtering. The remaining assist toggle is throttle-based traction control; fitted ABS continues regulating brake pressure.

Three garage categories add quick racks/angle kits, wheel alignment and front/rear anti-roll-bar setups. They change real rack travel, Ackermann, visible camber, toe, mass and roll stiffness through the existing build, purchase and save systems. Together with tyres, springs and differential parts they define the handling. Old saves default the new slots to stock and retain purchased parts, damage, fluids and input profiles. The old free handling setting is ignored without granting or buying upgrades.

Still open in Phase 1: FWD/AWD support, wheel hop, pressure/flatspots, weather coupling, aero-part effects and broader road/suspension calibration. Existing cars remain RWD. No cockpit, driver, engine-bay interaction or garage cutscene is claimed in this release. Multiplayer protocol 11 separates this solver/build schema from V14.

## V14 changes

Neon Archipelago connects four landmasses with five bridges. Its bounds cover 103.1 km² including water; approximately 52.5 km² are land. About 266 km of roads include the original downtown, expressway and hill routes, new coastal loops, six additional districts and narrow mid-block alleys. Seventeen fuel and garage destinations are reachable through the shared road graph. The northern roads reach 210 m.

Palm Beach uses pastel Art Deco buildings, Westhaven has brick apartments and industrial docks, and Sunset Keys has low-rise resorts. Palm Junction, Eastport and Orchard Village add suburbs and industry around the mainland. The expansion adds 2,244 buildings assembled from separate façade, roof, window, awning and balcony components, plus palms, street furniture and landmarks. Distant architectural details are culled to limit rendering work. These are original low-poly districts; the map area does not imply GTA-level asset density or simulation.

The garage now offers independently selected hoods, spoilers, side skirts, rims, front bumpers and rear bumpers on all four cars. Previewing is free; Buy & Install charges the displayed price and retains ownership. Older saves load factory visual parts. Cosmetic changes preserve engine and drivetrain behavior. V14 multiplayer uses protocol 10 and carries the visual selections; all participants need V14.

Road crossings share navigation nodes. Lane offsets and civilian speeds account for narrow streets, and the map can zoom far enough to select individual roads. Water recovery returns the car to asphalt while preserving damage. The V13 restart and Escape fixes remain in place.

## V13 changes

Starting a new run or choosing Pause > Restart now repairs the car, restores its wheels, clears mechanical faults and refills fuel and NOS. Road recovery (R) still keeps damage. Escape opens Pause during driving; pressing it again resumes. Main Menu remains an explicit pause-menu button.

Neon County covers 24.6 km². Its roughly 64 km of roads include the downtown street grid, a four-lane expressway, country and coastal roads, Harbor District, three connected roundabouts and Skyline Hills. The hill roads rise to about 158 m, with switchbacks, villas and two additional fuel/mechanic destinations in the hills. Nine service locations share the road-routing graph.

Roads shape the surrounding terrain. Rendering and tyre contact use the same road triangles, and bends share edge vertices to avoid gaps. NPC wheels follow slopes; the multiplayer coordinate limits include the whole county. Everyone in a room needs V13 (protocol 9). The expressway currently uses surface junctions, without elevated interchanges.

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

The county combines a straight downtown grid and alleys with curved regional roads and hills. Civilian traffic keeps left. Street lamps sit outside the carriageway. The 2D map follows the street geometry, supports waypoints and draws routes along the road graph. The round minimap turns with the car while its north marker stays tied to world north. Nearby services, officers, cameras, friends and the current destination appear on it.

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

Pass all eight gates in order. Driving backwards over a line, cutting across the infield or jumping to a later sector cannot complete a lap. Reset returns you just after the last valid gate, keeps car condition, and applies a five-second hold. Pause or losing window focus freezes the race. Garage changes and service are unavailable during an active race. Use Pause > Retire from Race to end a damaged or abandoned run; retirement pays no finish award. Starting the next race restores the car.

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

Neon County has 120 graph nodes. Downtown retains Old Town, Garden Heights, Midtown, Downtown and Ironworks; regional roads connect the coast, harbor, country and hills. Thirty-six civilian cars in normal traffic use left-hand lanes, signals, braking and turn indicators. They react to approaching cars, horns and emergency vehicles. Traffic and rendered signal lamps use the same clock.

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
| Pause / resume | Escape or P | Menu / Start |
| Main menu from driving | Pause, then Main Menu | Pause, then Main Menu |
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

## Historical V13 validation

`qa/release-v13.json` lists the checks run for V13 and their limits. Node.js 24 commands:

```sh
node qa/county-v13-check.mjs
node qa/county-agents-v13-check.mjs
node qa/restart-v13-check.mjs
node qa/navigation-main-v13-check.mjs
node qa/input-taps-v12-check.mjs
node qa/multiplayer-v9-check.mjs
node qa/police-v11-check.mjs
node qa/race-v11-check.mjs
node build.mjs
node qa/standalone-v15-check.mjs
node qa/standalone-browser-v15.cjs
node qa/county-browser-v13.cjs
node qa/package-v15.mjs
```

The county checks cover connectivity, directed roundabouts, lane clearances, grades, service routes, all regional turn guides and 642 raycast wheel positions. The agent checks drive NPCs on hills and verify wheel heights and remote police search coordinates. The standalone browser test starts with a severely damaged save, starts Free Roam, exercises Escape, map, driving and Restart, and records the exact HTML SHA-256. Separate rendered views cover hills, highway, roundabout and overview.

Browser checks use Chromium software rendering. Physical controllers/wheels, speaker listening and live cross-network multiplayer were not tested for V13. Earlier QA files remain as history; only reports listed in `qa/release-v13.json` were run for this build. The existing SDK V7 replay-fixture mismatch is documented in `qa/sdk-v12-baseline.json`; the SDK was unchanged in V13.

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

