# Phase 0 – Bestandsaufnahme und Erweiterungspunkte

Untersucht: lokaler Git-Quellcode von TheSimonMC/sideways, Basis V14 `e6610f6`. Vollständiger Schreibzugriff im Arbeitsverzeichnis. Die V14-HTML ist ein aus denselben Modulen gebautes Offline-Bundle. Kein Neubau und kein Austausch der Spielidentität.

## Vorhandene Systeme

| System | Tatsächliche Quellen | Vorhanden und Erweiterungsstelle |
| --- | --- | --- |
| Fahrzeugdaten und Tuning | dist/catalog.js, cosmetics.js, career.js | Vier RWD-Chassis, acht Motoren, getrennte Teileauswahl, Preise/Besitz. resolveBuild erzeugt Physik, Audio, Stats und Netzwerksignatur. |
| Fahrzeugphysik | dist/physics.js, sdk/motor-engine.mjs | MotorLab 1.6.3 ist die einzige Kurbelwellen-/Verbrennungsuhr. 120-Hz-Chassis mit vier Radkontakten, Feder/Dämpfer, Radimpulsen, Kupplung, Differential, ABS, Handbremse und Lastwechseln. Bisher zusätzlich künstliche Gierhilfe und ein freier Handling-Schalter. |
| Zustand/Schäden | dist/vehicle-state.js, mechanical.js, body-damage.js | Je Fahrzeug gespeicherte Condition, mechanische Unterbaugruppen, Temperaturen, Arbeitsenergie, lokale Verformungszonen, Räder und Stoßstangen-Trümmer. Noch keine getrennte Reifenkarkasse/Luftdruck oder Montagezustände. |
| Fahrzeugmodell | dist/car.js, car-cosmetics.js | Modellabhängige prozedurale Cartoon-Karosserien, bewegte Räder, sichtbare kosmetische Teile, lokale Deformation. Keine vollständigen Innenräume/Fahrer/Motorräume. |
| Rendering/Licht | dist/main.js, post.js, environment.js | Three.js 0.170.0/WebGL, Comic-Nachbearbeitung, Schatten, Qualitätsstufen, Tageszeit, Himmel und begrenzter Lichtpool. |
| Kamera | dist/main.js, presentation.js | Pose-Interpolation, Top-down/Chase/Hood, Blickbewegung und Kameraeffekte. Hood ist keine Cockpitkamera. |
| Eingabe | dist/input.js, controls-ui.js, haptics.js, navigation.js | Tastatur, Touch, Gamepad, erkannte Wheels über Browser-API; Remapping, Profile, Kalibrierung, Schalter und Menünavigation. Keine behauptete universelle Force-Feedback-Schnittstelle. |
| Garage/Services | dist/garage.js, vehicle-panel.js, main.js, career.js | Kaufvorschau und atomare Installation, Diagnose, Einzelreparatur, Tankstellen und Markierungen. Kein räumliches Einfahren oder mechanischer Ausbau. |
| Welt | dist/region.js, city.js, county-layout.js, county-junctions.js, county-architecture.js, world.js | V14-Inselwelt und separate Dock-09-Strecke, Straßen-/Servicegraph, Terrainabtastung, Instancing und räumliche Kollision. Eine befahrbare Höhe je X/Z; keine Unterführungsnavigation. |
| KI | dist/traffic.js, police.js, race.js, enforcement.js | Zivile Spuren/Signale/Reservierungen, Polizei-Suche und Verfolgung, fünf Renngegner. Noch kein umfassendes Fern-KI-LOD oder bezirksabhängiges Streaming. |
| Audio | dist/audio.js, audio/*, music.js, audio-anchors.js | Native Motorquellen, Räder, Wind, Mechanik, Radiofunk, Reflexionen und Fahr-/Verfolgungsmusik. Lizenz-/Bearbeitungsnachweise in dist/audio/ATTRIBUTION.txt. Kein bedienbares In-Car-Radio. |
| Speichern | dist/main.js, career.js, vehicle-state.js, mechanical.js, input.js | localStorage sideways-v1 plus Eingabeprofile; installierte Auswahl, Besitz, Fortschritt, Garagezustände je Auto und Einstellungen. Zustand beim Wechsel und bei R erhalten; neuer Lauf/Restart repariert bewusst nach früherem Auftrag. |
| Multiplayer | dist/multiplayer.js, network-cars.js, agent-snapshot.js | PeerJS, Host-KI, lokaler Spielerantrieb, validierte Build-/Pose-Daten. Neue Teile gehen über resolveBuild durch denselben Transport. V15 trennt sich per Protokoll 11 von alten Solverständen. |
| Build/Tests | build.mjs, qa/*, .github/workflows/pages.yml | esbuild-Standalone, Node-Simulation, DOM-/Protokolltests und Playwright. Veröffentlichung gleicht die HTML mit dem getesteten SHA-256 ab. Historische Reports sind keine aktuellen Testergebnisse. |

## Gemeinsame Datenbasis

`catalog.resolveBuild(selection)` bleibt die Quelle für montierte Teile und deren physikalische Daten. `chassis-setup.js` ergänzt definierte Lenkungs-/Achsgeometrie-/Stabi-Teile und wird von Katalog und Karriere verwendet. Renderer und Physik erhalten denselben aufgelösten Build; Teileauswahl wird nicht als zweites Physikprofil gespeichert.

`vehicle-state.createVehicleCondition` besitzt den Zustand pro Auto. `MechanicalSystem` besitzt thermische/energetische Veränderungen und daraus abgeleitete Diagnosen. Darstellung, Geräusche und Warnungen lesen diese Werte. Neue Reifendruck-, Montage- und Lichtzustände gehören später mit Versionsmigration hierher; kein paralleler Zustand nur für Animationen. `repairComponents` bleibt der gezielte Reparaturpfad, `Career.purchase` der Kaufpfad.

Die bestehenden VEHICLES-Spezifikationen und Motoroptionen werden nicht ersetzt. Eine V14-Fahrzeugdaten-Fixture sichert die vier Originalmodelle ab. Alte Spielstände erhalten die drei neuen Slots als Serie; die frühere handling-Einstellung wird verworfen, ohne Geld, Besitz, Fahrzeugzustand oder Eingabeprofile zu löschen. Bestehende Drift-Reifen/LSD bleiben gewählt. Der frühere kostenlose Modus wird nicht heimlich in gekaufte Teile umgewandelt.

## Erste Umsetzung: Phase 1 Teil A

Entfernen des freien Handling-Schalters und der künstlichen Gierimpulse. Lenkung nutzt Fahrzeug-/Rackdaten und geräteabhängige Filterung; ein kalibriertes Wheel behält seinen Lenkwinkel auch bei Tempo. Reifen besitzen einen sanften Übergang zum Gleiten, Lastempfindlichkeit und lesen weiterhin vorhandene Temperatur und Verschleiß. Drei kaufbare Kategorien ergänzen die bisherigen Reifen/Fahrwerke/Differentiale: Lenkung, Achsvermessung, Stabilisatoren. Camber ist sichtbar; Lenkgrenze, Ackermann, Masse und vordere/hintere Rollsteifigkeit beeinflussen den Solver. Traktionskontrolle nimmt nur Gas zurück, ABS regelt Radbremsdruck.

Phase 1 ist damit nicht vollständig. FWD/AWD, gezielter Wheel Hop, Druck-/Flatspotmodell, Wetter, abgestimmte Aero-Teile und umfassende Unebenheitskalibrierung fehlen. Dafür gelten die unveränderten Anforderungen in goal.txt und die vollständige Fortschrittsliste.
