# SIDEWAYS V21 – Radlager, Lenkung und Bremskomponenten

V21 erweitert das vorhandene Spiel in Phase 2B. Fahrzeuge, Karten, Teilebesitz, Eingabeprofile und alte Schäden bleiben erhalten. P02.09 und P02.10 sind mit den unten beschriebenen Näherungen umgesetzt; Phase 2 bleibt wegen fehlender Motor-Nebenaggregate teilweise. Grundlage bleibt goal.txt mit allen 156 Anforderungen.

## Was sich im Spiel ändert

Vier Radlager besitzen eigene Zustände, Temperaturen und Reibarbeit. Schäden durch Aufprall und Überlast erhöhen ihren Widerstand. Ein festes Lager blockiert sein Rad über den Radsolver; die Reifen reagieren auf dessen Schlupf. Wärme entsteht aus der berechneten Lagerreibung, getrennt von den Bremsen. Lagerluft verändert Radwinkel und sichtbaren Sturz. Das Rumpeln folgt dem betroffenen rotierenden Rad, seiner Last und seinem Schaden.

Lenkgetriebe und zwei Spurstangen sind getrennt. Ein beschädigtes Getriebe bekommt Spiel und reagiert langsamer; ein blockiertes hält seine Stellung. Verbogene Spurstangen verändern den Radwinkel. Bei Bruch folgt das Rad vereinfacht seiner örtlichen Bewegungsrichtung statt der Lenkung. Alle vier Modelle zeigen ein bewegliches Gestänge; ein Bruch trennt dessen Hälften.

Die Bremskreise aus V20 erhalten Hauptbremszylinder, Bremskraftverstärker und vier ABS-Kanäle. Fehler reduzieren die tatsächliche Bremskraft beziehungsweise deaktivieren die ABS-Druckfreigabe am betroffenen Rad. Die normale hydraulische Bremse bleibt bei einem ABS-Ausfall verfügbar. Heiße Scheiben erwärmen die Flüssigkeit zeitverzögert. Gealterte Flüssigkeit siedet früher; Dampf reduziert Druck und erhöht den normierten Pedalweg. Nach Leerlaufen eines Kreises bleibt Luft darin. Nachfüllen, Flüssigkeitswechsel und Entlüften sind getrennte Serviceaktionen.

Einzelreparaturen erhalten andere Schäden. Reifenwechsel heilt weder Radlager noch Spurstange oder Leitung; Spurstangenersatz heilt keine verbogene Aufhängung. Tuning, Recovery und Speichern erhalten alle neuen Zustände. Neuer Lauf und Restart reparieren das Fahrzeug wie bisher. Der V20-Fix für RATE_LIMIT und den langsamen Multiplayer-Wiedereintritt bleibt unverändert.

## Geänderte Dateien und Systeme

- `dist/chassis-damage.js`: Zustandsmigration, Lagerreibung/-wärme, Lenkspiel, Spurstangen und Aufprallschäden.
- `dist/brake-hydraulics.js`, `dist/mechanical.js`: Bremskomponenten, Flüssigkeit, Diagnose, Warnungen, Einzelservice und tiefe Speicherkopien; Mechanical-Zustandsversion 4.
- `dist/physics.js`: separate Lagerimpulse, tatsächliche Lenkwinkel, ABS-Ausfall und lokale Kollisionsfolgen.
- `dist/car.js`, `dist/audio.js`, `dist/vehicle-panel.js`: sichtbare Gestänge/Radspiel, positionsabhängiges Rumpeln und passende Serviceaktionen.
- `dist/main.js`, `dist/index.html`, Pages-Workflow: Versionskennung und Prüfung des verifizierten V21-HTML.
- `qa/*v21*`, Fortschrittsliste, README und Kontext: aktuelle Prüfungen, nachvollziehbare Teilstände und Auslieferung.

## Nachweise

Die zehn neuen nativen Prüfgruppen testen den tatsächlichen Solver einschließlich Energieabnahme bei blockiertem Lager, seitlichem Zug, Lenkungsbruch, lokaler Kollision, Einzelreparatur, Tuning/Recovery, Speicher-Rundlauf, Bremskraft, ABS, Sieden, Abkühlen, Luft/Entlüften, deaktiviertem Verschleiß, Geometrie und endlichem PCM. Aus 25 m/s verbleiben nach zwei Sekunden Fußbremsung 3,51 m/s mit intaktem System, 13,96 m/s bei einem ausgefallenen Hauptzylinderkreis und 16,18 m/s ohne Bremskraftverstärker. Diese künstlich gesetzte Anfangsgeschwindigkeit ist ein Testzustand.

Beim Rollen aus 25 m/s erzeugt das beschädigte linke vordere Lager in vier Sekunden 9,36 kJ Reibarbeit, erreicht 32,90 °C und verursacht gegenüber dem intakten Fall 1,14 m seitlichen Versatz. Ein blockiertes Lager reduziert im separaten Versuch die gemessene Fahrzeug-/Radbewegungsenergie von 136,92 auf 92,27 kJ. Diese Werte dienen der Regression der Spielkoeffizienten, nicht dem Vergleich mit einem realen Auto.

Alle 31 aktuellen funktionalen Suiten bestehen. Dazu gehören 14 etablierte Regressionssuiten, Antrieb/Straßenkontakt/Aero/Reifen/Bremsen, die neue Schadenssuite, Multiplayer-Stauprüfung sowie Dokument- und Standalone-Prüfung. Sieben Browserabläufe verwenden die endgültige HTML-Datei: sechs Offline-Abläufe und das vollständige Multiplayer-Spiel. Ein zusätzlicher WebRTC-Modultest blockiert Host/Gast jeweils 7,5 Sekunden. Der neue Service-Harness prüft zusätzlich echte Reparaturbuttons, Einzelersatz und die Darstellung bei 390 Pixeln Breite. JavaScript-Fehler und unerwartete Offline-Netzwerkzugriffe wurden nicht festgestellt. Aktuelle Dateihashes und einzelne Ergebnisse: qa/release-v21.json.

CPU-Stichprobe: V21 RWD im Mittel 2,17 ms auf der Ebene und 2,22 ms am Hang; FWD 2,18/2,09 ms, AWD 2,08/2,05 ms. V20 bei denselben RWD-Eingaben: 2,17/2,33 ms. Je Szenario 1.200 gemessene Schritte nach 120 Warm-up-Schritten. Diese lokale Node-Messung umfasst einen nativen Motor und ein Chassis mit synthetischer Bodenabfrage, ohne Welt, GPU, KI und Audio; sie ist keine FPS-Garantie. Details: qa/chassis-performance-v21-results.json.

## Grenzen und verbleibende Arbeit

Die Modelle sind begrenzte, selbst geschriebene Spielnäherungen. Alle Fahrzeuge teilen die diagonale Bremskreisanordnung. Belag und Scheibe behalten je Rad einen gemeinsamen Gesundheitswert. Es gibt keine Strömungssimulation der Leitungen, kein Unterdruckreservoir, keine vollständigen Aufhängungsgelenke und keine Mehrkörpersimulation der Spurstangen. Der Pedalweg steht in der Diagnose-Telemetrie; das Cockpit mit animiertem Pedal existiert noch nicht. Die diskrete Lager-Reibarbeit nähert Drehimpuls mal Enddrehzahl an. Direkte Schmierungs-/Schmutzzustände der Radlager fehlen. Exakte mechanische Schäden und Temperaturen werden noch nicht auf Remote-Fahrzeugmodelle übertragen.

Der Browser-Service-Harness verbindet das originale VehiclePanel mit CarPhysics. Er prüft Reparaturbuttons und Darstellung, jedoch nicht die Fahrt in eine Werkstatt und den Zeitablauf des Hauptcontrollers. Tests mit echtem Multiplayer verwenden lokale Browser über öffentliche Signalisierung/WebRTC. Getrennte PCs, Mobilfunk, restriktive NAT-/TURN-Wege, ein physisches Lenkrad und subjektive Hörtests wurden nicht geprüft.

Als Nächstes folgt Phase 2C: Riemen, Lichtmaschine/Batterie, eigenständiger Kühlerlüfter und weitere fehlende Motor-Nebenaggregate mit Ausfallfolgen, Diagnose, Reparatur und Speichern. Danach folgen die restlichen Phasen in Dokumentreihenfolge. Innenräume/Cockpit/Fahrer, Motorraum, Wetter, zusätzliche Nachtbeleuchtung, Welt/LOD/KI und räumliche Garagenübergänge bleiben ausdrücklich offen beziehungsweise teilweise umgesetzt. Die Fortschrittsliste führt jeden ursprünglichen Punkt weiter.

## Fachliche Orientierung

Lagerreibung, Hitze und Spiel orientieren sich qualitativ an [SKFs Hinweisen zu Radlagerschäden](https://automotive.skf.com/nam/fr/blog/blog-heat-is-a-warning-sign). Für verbogene/lose Lenkungsteile dient [ZF Aftermarkets Prüfhinweis](https://press.zf.com/press/media/en/press_media/2019_3/pdf/releases_5/global_2/tx2019-11-28_ZF_Aftermarket_CV_Steering_Suspension_Checks_EN.pdf) als qualitative Orientierung; dessen Nutzfahrzeugwerte werden nicht übernommen. Den Zusammenhang zwischen alternder Bremsflüssigkeit, Dampf und längerem Pedal erläutert [Brembo](https://asia.bremboparts.com/europe/en/news/brake-fluid-when-changing-it-saves-the-whole-team-90475). Keine dieser Quellen validiert die verwendeten Spielkoeffizienten. Neue Geometrie und Audiosynthese sind selbst erstellt; es kamen keine fremden Assets hinzu.
