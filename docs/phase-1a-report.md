# SIDEWAYS V15 – Bericht zu Phase 0 und Phase 1A

Phase 0 ist abgeschlossen. Phase 1 ist teilweise umgesetzt. V15 erweitert die vorhandene V14-Codebasis; es ist keine vollständige Umsetzung der Phasen 0–18.

## Bearbeitete Ziele

Alle Anforderungen aus dem vollständig gelesenen Zieldokument sind unverändert in `docs/goal.txt` erhalten. Die Fortschrittsliste erfasst 156 Punkte aus 19 Phasen mit Status und technischen Lücken. Die Bestandsaufnahme benennt vorhandene Systeme, Datenflüsse und Erweiterungsstellen.

Die erste Umsetzung entfernt den kostenlosen Handling-Modus und künstliche Gierimpulse. Serienfahrzeuge verwenden fahrzeugspezifische Lenkgrenzen und Übersetzungen. Reifenkräfte gehen kontinuierlich von Haftung zu Gleiten über und berücksichtigen Radlast, vorhandene Temperatur und Verschleiß. Traktionskontrolle reduziert Gas, statt das Fahrzeug künstlich zu drehen.

Lenkung/Winkelkit, Achsvermessung und Stabilisatoren sind drei neue kaufbare Teilekategorien. Sie verändern tatsächliche Lenkgeometrie, Camber, Masse und Rollsteifigkeit. Bestehende Reifen-, Fahrwerks- und Differenzialteile bleiben eingebunden. Vorschau, Kaufpreis, Besitz, Darstellung, Physik und Speichern nutzen denselben Build. Die vier Fahrzeugdaten und acht Motoroptionen bleiben erhalten; neue Slots werden in alten Speicherständen als Serienteile ergänzt.

## Geänderte Dateien und Systeme

| Dateien | Änderung |
| --- | --- |
| `dist/chassis-setup.js` | Gemeinsame Teiledefinitionen, Lenkung und Reifenkennlinie. |
| `dist/physics.js` | Teileabhängige Lenkung, Reifenkräfte, Achsgeometrie und Stabilisatoren; künstliche Gierhilfe entfernt. |
| `dist/catalog.js`, `dist/career.js` | Aufgelöste Fahrzeugdaten, Preise, Kauf und Besitz der neuen Teile. |
| `dist/car.js`, `dist/garage.js` | Sichtbarer Camber, Teilevorschau und Vergleich der Fahrwerkswerte. |
| `dist/main.js`, `dist/index.html` | Handling-Auswahl entfernt, Eingabegerät an die Lenkung übergeben, Speicherung und V15-Anzeige. |
| `dist/multiplayer.js` | Protokoll 11 für den geänderten Build; alle Teilnehmer brauchen V15. |
| `docs/goal*`, `docs/phase-0-bestandsaufnahme.md`, `kontext.md` | Verbindlicher Umfang, vollständige Checkliste, Bestandsaufnahme und Fortsetzungsstand. |
| `qa/*v15*`, `.github/workflows/pages.yml`, `SIDEWAYS.html`, `package-manifest.json` | Regressionen, reproduzierbarer Standalone-Build und Veröffentlichung mit Hash-Prüfung. |

## Nachgewiesene Funktion und Tests

- Simulation aller vier Serienautos: geradeaus beschleunigen ohne selbst ausgelösten Drift, Kurven mit dynamischem Lasttransfer, Bremsen und geringere Oberflächenhaftung. Synthetische Bremsung von 100 km/h: etwa 35–38 m; dies sind Spielmesswerte auf ebener Testfläche, keine Messdaten realer Autos.
- Drift-Teile verändern Radgeometrie und Ausbrechen messbar. Alte Modusnamen ergeben identische Simulationen. Lenken erzeugt beim frei fliegenden Fahrzeug keine Gierkraft. Ein Wheel behält seinen vollen Lenkwinkel bei Tempo; Tastatur/Pad werden gefiltert.
- Migration, Eigentum und Zustand: fünf gekaufte Drift-Teile kosten zusammen 18.500 Punkte, werden nur einmal berechnet und überleben erneutes Laden. Vorhandene Schäden, Hitze und Kraftstoff bleiben beim Umbau erhalten.
- Aktuelle Regressionen für mechanischen Schaden, Thermik, lokale Karosserieschäden, kosmetische Teile, Neustart, Eingabe, Navigation, Weltgeometrie, Rennen, Polizei und Multiplayer-Transport bestanden. Die jeweiligen Berichte sind in `qa/release-v15.json` mit Hash aufgeführt.
- Die endgültige Offline-HTML wurde in Chromium getestet: Teilevorschau/Kauf/Speichern, neuer Free-Roam-Lauf, Pause mit Escape, Fortsetzen, Karte, Fahren und Neustart. Keine JavaScript-Fehler oder externen Laufzeitabrufe in diesem Test. Der SHA-256 bindet den Test an exakt die ausgelieferte HTML.
- CPU-Stichprobe mit 1.200 Simulationsschritten: im Mittel 2,55 ms pro Schritt gegenüber 3,33 ms bei V14 auf demselben Rechner. Das misst nur Spielerchassis und Motor; es ist kein GPU-/Gesamtspiel-Benchmark und keine FPS-Garantie.

Ein bestehender Überdrehzahl-Test erwartete über 5 % Ventilschaden. Mit den neuen Reifenkräften entstehen im gleichen Ablauf etwa 4,8 %. Der V15-Test verlangt weiterhin tatsächlichen Schaden, Überdrehzahl, Kolben-/Gangfolgen und einen schadensfreien Pfad bei offener Kupplung, aber keine starre 5-%-Grenze. Der historische V14-Test bleibt erhalten.

Nicht nachgewiesen sind physische Controller/Wheels, eine Hörprüfung und Multiplayer über mehrere echte Rechner. Der Motor-SDK wurde nicht verändert; die bereits bekannte Abweichung seiner Replay-Fixture bleibt in `qa/sdk-v12-baseline.json` dokumentiert.

## Offen und nächste Phase

Phase 1B steht als Nächstes an: Steigungskräfte und Unebenheiten vertiefen, Chassis weiter abstimmen, FWD/AWD-Antriebspfade ergänzen. Alle vorhandenen Autos bleiben in V15 RWD. Wheel Hop, Wetterkopplung, Reifendruck/Flatspots und abstimmbare Aerodynamik sind noch offen; dafür fehlen getrennte Zustandsgrößen und entsprechende Kraftpfade.

Danach folgt Phase 2 mit erweitertem Komponenten- und Reifenzustand. Reifenplatzen braucht eine eigene Karkassen-/Drucksimulation statt des bisherigen gemeinsamen Radzustands. Abfallende Türen und Spoiler brauchen getrennte Befestigungen im Modell. Cockpit, Fahrer und Motorraum erfordern passende Modellhierarchien je Fahrzeug. Räumliche Garagenübergänge benötigen koordinierte Tor-, Fahrzeug- und Kamerazustände mit sicheren Spawnpunkten. Diese Systeme werden nicht als fertig ausgegeben.

Die vollständige Liste einschließlich aller späteren Welt-, Grafik-, KI-, Audio- und Testanforderungen steht in [goal-progress.md](https://github.com/TheSimonMC/sideways/blob/main/docs/goal-progress.md). Spielen: [Sideways](https://thesimonmc.github.io/sideways/).
