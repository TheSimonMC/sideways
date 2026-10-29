# SIDEWAYS V19 – Phase 2A

## Bearbeitete Ziele

Vier unabhängige Reifen aus P02.02–P02.04 sind mit Druck, Karkassenzustand, Mischung, Abrieb, Gripverlust, Flatspots, Lecks und Überlastplatzen verbunden. Die Grundlage ergänzt die Reifenfolgen aus Phase 1 sowie Diagnose, Reparatur und Speichern aus Phase 16. P18.04 ist mit dem echten Spiel-Motor-/Chassispfad nachgewiesen. Phase 2 bleibt insgesamt teilweise; alle 156 Anforderungen stehen unverändert in der Fortschrittsliste.

- Druck steigt mit Temperatur und sinkt bei einer beschädigten Karkasse durch ein Leck. Starke Radtreffer können den Reifen beschädigen, ohne die Felge abzureißen. Langer Schlupf erzeugt Wärme und Verschleiß; Überlast kann den jeweiligen Reifen platzen lassen.
- Ein platzer Reifen verliert Druck und Seitenführung, hat einen kleineren wirksamen Radius und mehr Rollwiderstand. Einseitige Schäden ziehen am Auto und verändern Federweg und Karosserielage. Blockierende Räder schleifen einen gerichteten Flatspot, der beim späteren Rollen Radius und Federlast verändert.
- Das Gummi wird sichtbar flacher, die Felge bleibt montiert. Ein frischer Platzer erzeugt ein kurzes Geräusch und zehn Gummipartikel aus dem bestehenden begrenzten Pool. Beschädigte Reifen erzeugen radgebundene Rollimpulse. Rauch reagiert auf Schlupf, Temperatur und Oberfläche.
- Die Fahrzeugdiagnose zeigt für jedes Rad Temperatur, Druck, Karkasse und Flatspot. Gezielter Ersatz setzt den jeweiligen Reifen zurück; vorhandene Aufhängungsschäden bleiben. Wechsel der Reifenmischung heilt Schäden nicht. Laden und Straßenbergung erhalten den Zustand. Neuer Lauf/Restart repariert weiterhin gemäß dem früheren Auftrag; Escape bleibt Pause.

## Geänderte Dateien

Neu: `dist/tyres.js`. `dist/vehicle-state.js` migriert und speichert den Zustand. `dist/mechanical.js` verbindet Belastung, Wärme, Verschleiß, Ausfall, Warnungen und Ersatz. `dist/physics.js` verwendet reale Radius-/Grip-/Rollwiderstandsänderungen. `dist/car.js` stellt Gummi, Rauch und begrenzte Partikel dar. `dist/audio.js` erzeugt Platzen und Rollimpulse aus dem Zustand. `dist/vehicle-panel.js` und `dist/style.css` ergänzen lesbare Radwerte. `dist/main.js`, `dist/index.html`, `dist/multiplayer.js` und der Pages-Workflow tragen V19/Protokoll 15. QA, Kontext, Anleitung und Fortschrittsliste dokumentieren diesen Stand. Vier Fahrzeuge, Karten, MotorLab SDK, vorhandene Teile und Medien bleiben erhalten.

## Nachweise

`qa/release-v19.json` bindet die aktuellen Berichte und ausgelieferten HTML-Bytes per SHA-256. Zehn neue native Gruppen prüfen Migration und ungültige Daten, Druck/Temperatur, Lecks, echten Burnout, Damage-off, einseitigen Platten, Flatspot, Speichern/Mischungswechsel/gezielten Ersatz, alle vier Fahrzeuggeometrien, Partikelbegrenzung sowie PCM-Ereignisse und den Reifenmixer.

Der native Burnout beginnt mit gesunden Reifen und eingebauten Renn-Kupplungs-, Kühlungs- und Motor-Innenteil-Upgrades. Der erste Hinterreifen platzt nach 232,45 simulierten Sekunden bei rund 206,8°C, 37,4% verbleibendem Profil und 8% Karkassenfestigkeit. Vorne bleiben die Reifen intakt; alle Felgen bleiben montiert. Diese Zeit ist das Ergebnis dieses Lastfalls, keine eingebaute Lebensdauer. Ein unbelasteter heißer Reifen platzt im Kontrolltest nicht auf Zeit. Damage-off erhält bleibende Schäden, während Wärme weiter simuliert wird.

Ausrollen aus 90 km/h: Nach zwei Sekunden erreicht das normale Fahrzeug rund 87,45 km/h, das mit linkem vorderem Platten rund 86,13 km/h und zieht zur Seite. Der Radius dieses Rades sinkt von 0,34 auf 0,2584 m. Ein mittlerer Radtreffer erzeugt ein Leck ohne Radverlust; nach zehn Sekunden verbleiben rund 0,27 bar. Gezielter Reifenwechsel erhält die dabei beschädigte Aufhängung. Die Werte stammen aus Spieltests, nicht aus realen Fahrzeugmessungen.

Vierzehn vorhandene Regressionssuiten prüfen Chassis, Physik, Schaden, Thermik, Tuning, Kosmetik, Neustart, Eingaben, Navigation, Rennen, Polizei, Multiplayer, Archipel und Audio. Dazu kommen acht Antriebs-, sieben Straßenkontakt- und acht Aero/Hop-Gruppen, Zielabdeckung und Standalone-Prüfung. Der neue Reifentest ergibt zusammen 24 funktionale Suiten einschließlich vier Browserabläufen.

Die Browserprüfungen laden das fertige Offline-HTML mit blockierten externen Requests. Sie prüfen Teilekauf und Besitz, beschädigte Altstände, echten Seiten-Reload, Neuer Lauf, Fahrt, Pause, Karte und Restart sowie FWD/AWD und Aero-Tuning. Der neue Ablauf prüft Reifenmischungswechsel für 4.800 Punkte ohne Heilung, gespeicherte Reifen-/Aufhängungsschäden, Startreparatur und vier Diagnosezeilen auf Desktop und schmalem Bildschirm. Gezielter Ersatz und der lange Burnout sind im nativen Pfad geprüft; kein vollständiger Burnout über Browser-Tastatureingabe behauptet. Screenshots werden visuell geprüft. Keine JavaScript-Fehler oder zusätzlichen Laufzeitdateien in den bestandenen Abläufen.

CPU-Stichprobe: V19 RWD im Mittel 1,89 ms auf der Ebene und 2,04 ms am Hang; FWD 2,01/2,16 ms, AWD 1,89/1,86 ms. V18 bei denselben RWD-Eingaben: 1,92/1,87 ms. Je Szenario 1.200 gemessene Schritte nach 120 Warm-up-Schritten. Details in qa/chassis-performance-v19-results.json. Ein MotorLab-Spielerchassis mit synthetischem Bodensampler, jeweils RWD/FWD/AWD gegen veröffentlichte V18-RWD-Basis. Keine zusätzlichen Bodenabfragen durch Reifen; normal vier pro Schritt ohne Trümmer. Keine Messung der gesamten Welt/GPU/KI/Audio und keine FPS-Garantie.

## Grenzen und offene Arbeit

Das Reifenmodell ist eine browsergerechte Näherung: fester Volumenbezug, eine gemeinsame Gummi-/Lufttemperatur, ein dominanter gerichteter Flatspot, zusammengefasste Karkassenfestigkeit. Kein FEM-, Gürtel-, mehrzoniges Temperatur- oder detailliertes Rissmodell. Das Gummi schrumpft radial; es bildet keine lastabhängige Kontaktfläche oder aufgerissene Fetzengeometrie. Gummipartikel kollidieren nur mit ihrer lokalen Bodenhöhe und werden aus dem vorhandenen Pool wiederverwendet. Bereits komplett abgerissene Radobjekte behalten die bisherige nominale Form. Eine getrennte Felgenfestigkeit und ein bedienbarer Aufpumpservice fehlen; Reifen-Ersatz nutzt weiterhin auch den vorhandenen Radmontagepfad.

Der zusätzliche Rollwiderstand wirkt entlang der Fahrzeuglängsachse, nicht als vollständiges räumliches Karkassenmodell. Seine abgebaute kinetische Energie wird als Wärme erfasst; das belegt keine globale Energieerhaltung des gesamten Heightfield-/Wheel-Hop-Chassis. Koeffizienten sind eigene fiktive Spielkalibrierung. Die qualitativen Zusammenhänge beruhen auf [Continental zu Reifendruck](https://www.continental-tires.com/tire-knowledge/tire-pressure/), [Michelin zu Druckverlust](https://www.michelinman.com/auto/auto-tips-and-advice/tire-damage/flat-and-damage-problems/symptom-soft-tires) und dem [Continental Technical Data Book](https://www.continental-tires.com/content/dam/conti-tires-cms/continental/market-content/be/truck/fr---nl/Continental__TechnicalDataBook_03_24__Screen_EN.pdf.coredownload.pdf) zu Schäden/Flatspots. Diese Quellen validieren weder unsere Zahlen noch die fiktiven Fahrzeuge.

Neue Medien wurden nicht benötigt; Platzergeräusche sind eigene prozedurale Signale. Software-Rendering und Signal-/Geometrieprüfungen ersetzen keinen Hardware-Wheel-Test oder subjektiven Hörtest. Detaillierte Reifenschäden werden noch nicht an andere Multiplayer-Fahrzeuge übertragen; Protokoll 15 trennt lediglich V19-Spieler. Kein Mehr-PC-Netzwerktest. Die historische SDK-Replay-Abweichung aus qa/sdk-v12-baseline.json bleibt dokumentiert.

Phase 2 fehlen weiter Radlager, eigene Lenkungs-/Bremsleitungszustände, Bremsen-Glow, Riemen, Generator, Lüfter und weitere Nebenaggregate. Phase 1 benötigt Wetter/Nässe sowie breitere Kalibrierung. Cockpit/Fahrer, weitere abfallende Teile, Motorraum, interaktive Garage, Welt/LOD/Verkehr und räumliche Garagenübergänge bleiben gemäß Checkliste offen oder teilweise. Diese Arbeit behauptet keine Fertigstellung dieser Systeme.

## Nächste Phase

Phase 2B ergänzt Radlager, Lenkungs- und Bremskomponenten samt Fahrfolgen, Diagnose, gezieltem Ersatz und Persistenz. Danach folgen die übrigen Nebenaggregate innerhalb Phase 2; ihre sichtbare Animation benötigt später Phase 6.
