# SIDEWAYS V25 – Phase 3A

Türen, Haube und Kofferraum lassen sich bei allen vier vorhandenen Autos in der Garage öffnen. Die Teile können beschädigt werden und abreißen. Nach dem Abriss fehlt die tatsächliche Geometrie am Wagen; Masse, Achslasten und Luftwiderstand ändern sich. Änderungen und Schäden werden gespeichert und lassen sich gezielt reparieren.

## Geänderte Systeme

- `body-layout.js`, `body-hinges.js`, `body-damage.js`: gemeinsame Profile/Anker, Scharniere, getrennte Befestigungs- und Schlosszustände, Save-Migration, Aufprall- und Luftlast. Offene Türen haben einen Kontaktpunkt außerhalb der normalen Fahrzeughülle.
- `car.js`, `car-cosmetics.js`: tatsächliche Trennung der bisherigen Hülle, mitbewegte Fenster/Griffe/Spiegel/Decals und Tuninghauben, passende Meshes für lose Teile. Einfache Türkarten und Motorraum-Unterbau als Grundlage für die späteren Innenraum- und Motorraumphasen.
- `physics.js`, `panel-debris.js`, `aerodynamics.js`: veränderte Masse/Lasten/Trägheit, Luftwiderstand sowie begrenzte Trümmer mit Boden- und Wandkontakt.
- `main.js`, `index.html`, `style.css`, `mechanical.js`, `audio.js`: Garagenbedienung, Speicherung, Diagnose, Reparatur, Kontaktgeräusch und zusätzlicher Wind an offenen/fehlenden Türen.
- `multiplayer.js`, `network-cars.js`: begrenzte Teilezustände in den bisherigen Nachrichten. Protokoll 17; für gemeinsame Lobbys brauchen alle Spieler V25.

## Nachweise

Alle 23 funktionalen Suiten bestehen: 14 bestehende Regressionen, vier weitere native/Build-/Abdeckungsprüfungen und fünf Browserabläufe. Die neue Teileprüfung umfasst neun Gruppen für Migration, Scharniere, Aufprallseite, Masse/Reparatur, Luftlast, Trümmerkontakte, reale Geometrie aller vier Autos, Kontakt einer offenen Tür, Wind/PCM und begrenzte Netzwerkzustände. Vier Browserabläufe prüfen die endgültige HTML-Datei: Garagenbedienung und Reload aller vier Modelle einschließlich Hochformat/kurzem Querformat, erreichbare Tuningkarten bei kleinem Bildschirm, normale Fahrt mit Neustart/Escape sowie zwei Spieler mit Host-Wetter und Wiedereinstieg. Ein weiterer Browserablauf verwendet das echte Netzwerkmodul und hält Host/Gast jeweils 7,5 Sekunden an; geöffnete und fehlende Teile werden übertragen, ohne RATE_LIMIT-Rauswurf. Die bestehenden Physik-, Schadens-, Reparatur-, Tuning-, Renn-, KI- und Audio-Regressionen bestehen. Nachweise und Dateihashes: qa/release-v25.json.

Lokale CPU-Stichprobe mit je 1.200 Schritten nach 120 Warm-up-Schritten: V25 RWD 2,72/2,32/2,39 ms im Mittel (trocken/bergig/nasse Ebene), FWD 2,42/2,21/2,24 ms, AWD 2,26/2,06/2,09 ms. V24 bei denselben trockenen RWD-Eingaben: 2,27/2,26 ms. Gemessen sind ein nativer Motor, ein Chassis und ein synthetischer Bodensampler mit geschlossenen, unbeschädigten Teilen. Welt, Trümmerabfragen, GPU, KI und Audio sind ausgeschlossen. Keine FPS-Garantie; vollständige Messung unter qa/chassis-performance-v25-results.json.

Die Quellprüfung folgt dem angeforderten review-agent-Skill und wurde vom implementierenden Agenten selbst durchgeführt. Sie ist keine unabhängige Zweitprüfung. Screenshots aller vier geöffneten Fahrzeuge und einer fehlenden Tür wurden visuell geprüft. Es werden keine Tests mit physischen Controllern, getrennten PCs oder realen Mobilfunk-/TURN-Verbindungen behauptet.

## Fortschritt und Grenzen

P03.05 und P03.07 sind umgesetzt; P06.01 ist mit der Garagenbedienung teilweise umgesetzt. Alle 156 Anforderungen bleiben mit unverändertem Wortlaut in der Checkliste. Phase 3 insgesamt bleibt teilweise erledigt.

Glasbruch, einzelne funktionslose Leuchten, separat abfallende kleinere Anbauteile sowie Kratzer/Risse fehlen noch. Die vorhandenen Seitenschweller, Kotflügel, Spiegel und Leuchten sind noch nicht alle eigenständige Schadenskomponenten. Die neuen Türkarten sind kein fertiger Innenraum. Der einfache Unterbau unter der Haube hat noch keine motorabhängigen Nebenaggregate oder RPM-Animationen und erfüllt Phase 6 nicht.

Die Karosserie nutzt lokale Deformation und gedämpfte Scharniere. Trümmer verwenden kleine Quader-/Bodenproxies, vereinfachte Rotation und Reibung. Sie kollidieren nicht miteinander; ihre sichtbaren Konturen können vom Kontaktkörper abweichen. Lose Räder behalten vorerst das vorherige Kontaktmodell. Geöffnete Hauben/Kofferraumdeckel haben Luftlast, jedoch keinen vollständigen räumlichen Kollisionskörper. Im Multiplayer werden die am Auto fehlenden/geöffneten Teile übertragen, die losen Trümmer bleiben lokal. Spielmassen und Belastungsgrenzen sind fiktive Kalibrierungen.

Als Nächstes folgt Phase 3B mit Glas, Leuchten und weiteren Anbauteilen. Danach stehen Phase 4 mit Innenräumen, Cockpit und Fahrer sowie die weiteren Phasen aus goal.txt an. Offene Grenzbereichs-/Controller-Prüfungen aus Phase 1 und Kompressortuning aus Phase 2 bleiben vermerkt.
