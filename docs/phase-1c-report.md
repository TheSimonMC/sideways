# SIDEWAYS V17 – Phase 1C

## Bearbeiteter Umfang

Phase 1, insbesondere P01.04/P01.06: Antrieb und Differenzial wirken tatsächlich auf die vier Radkräfte. Kauf, Komponenten und Persistenz greifen dazu auf die vorhandenen Grundlagen von Phase 2/8/15 zurück. Phase 0 bleibt abgeschlossen, Phase 1 und alle späteren Phasen bleiben in ihrem bisherigen Teil-/Offen-Status. Kein Punkt aus goal.txt wurde entfernt oder umformuliert.

- Die vier originalen Serienautos bleiben RWD. Ihre Daten, Motoren, Karten, Optik und früheren Ausbauteile bleiben erhalten.
- Vector mit I4/V6 kann auf FWD umgebaut werden. Hachi, Kitsune und Vector erlauben AWD, ausgenommen V10/V12. Umbauten kosten Punkte und erhöhen die Masse; Garage blockiert inkompatible Teile und erklärt den Rückfall auf RWD beim ungeeigneten Motorswap.
- AWD verteilt das offene Eingangsmoment nominal 40:60. Zwei träge Achsausgänge und endliche Wellenkapazitäten koppeln Räder und Motor. Achs- und Mittelsperren begrenzen Drehzahlunterschiede. Defekte Wellen verlieren ihren Kraftpfad; ein freier Ausgang bekommt keine erfundene Ersatztraktion.
- AWD-Vorderachsdifferenzial, Vorderachswellen und Mitteldifferenzial erhalten eigenen Zustand, Wärme/Warnungen und Einzelreparatur. Reale Schlupfarbeit erwärmt die Baugruppe; Überhitzung bewirkt Verschleiß. Der vorhandene Hauptdifferenzial-Slot gilt bei FWD vorn, sonst hinten.
- Kupplung, Schaltbelastung, Motorbremspfad und TC verwenden den eingebauten Antrieb. Reifenrauch/Spuren entstehen an den tatsächlichen vier Kontakten. Differenzialgeräusch und Verschleiß berücksichtigen die eingebauten Baugruppen. Pools bleiben bei 160 Partikeln und 400 Reifenspuren.
- Neue Teile bleiben bezahlt und gespeichert. Entfernen eines Umbaus heilt dessen gespeicherte Schäden nicht. Neue Fahrt/Pause → Restart repariert weiterhin vollständig; R behält Zustand. Multiplayer-Protokoll 13 trennt V17 von älteren Solvern.

## Geänderte Dateien und Systeme

`dist/drivetrain.js` ist die neue gemeinsame Teile-/Kraftpfaddefinition. `physics.js` integriert sie in den bestehenden Iterationslöser. `mechanical.js` erweitert Zustand, thermische Arbeit, Schäden, Diagnose und Reparatur. `catalog.js`, `career.js`, `garage.js` verbinden Kompatibilität, Masse, Preise und Installation. `car.js`, `audio.js`, `audio-anchors.js` koppeln Effekte und Klang an Räder und Baugruppen. `main.js`, `index.html`, `multiplayer.js` und die Pages-Workflow-Datei tragen Anzeige/Versionskennung. `goal-progress`, Kontext und neue QA-Dateien dokumentieren den Stand. SDK und Fahrzeug-/Weltdefinitionen bleiben erhalten.

## Nachweise

`qa/release-v17.json` führt ausschließlich aktuelle Berichte samt Hash auf. Die Tests verwenden den echten MotorLab-Motor und reale Spielmodule. `qa/drivetrain-v17-check.mjs` deckt acht Gruppen ab: V16-Vergleich der vier Serienautos; Vorwärts/Rückwärts/Kupplung; defekte Achsen/Sperren/Einzelreparatur; Energiedissipation/Front-LSD; Schlupfwärme/Verschleiß/Schaden aus; Kombinationen aus vier Fahrzeugen/acht Motoren und Migration/Kauf; Frontreifenrauch/Audio-Anker; TC/Frontantrieb-Schaltbelastung.

Vierzehn bestehende Regressionssuiten werden erneut ausgeführt: Chassis, Physik, Schaden, Thermik, modulares Tuning, Kosmetik, Neustart, kurze Eingaben, Navigation, Rennen, Polizei, Multiplayer, Archipel und räumliches PCM-Audio. Historische Assertions bleiben erhalten; nur ausdrücklich geänderte Inhaltszahl (28 statt 25 Kategorien), Protokoll 13 und Berichtskennungen werden angepasst. Sieben Bodenkontaktgruppen prüfen Steigungen, Bremsen, Energie, Luftfahrt, Wellen und eine bestehende Skyline-Hills-Straße. Alle 156 Zielpunkte werden gegen goal.txt geprüft.

Zwei Chromium-Prüfungen verwenden dieselben ausgelieferten Offline-HTML-Bytes: ursprünglicher Spielablauf mit Kauf, beschädigtem Altstand, Reparatur beim Start, Escape, Karte, Fahren und Restart; zusätzlich AWD-Kauf, gesicherte Beschädigung, echtes Neuladen, Besitz ohne Doppelkauf, inkompatibler V12 und fahrbarer FWD-Umbau. Externe Requests werden blockiert und als Fehler gewertet. Screenshots werden zusätzlich visuell kontrolliert. Kein Hörtest behauptet.

CPU-Stichprobe: V17 RWD im Mittel 1,60 ms auf der Ebene und 1,80 ms am Hang; FWD 1,78/1,79 ms, AWD 1,77/1,84 ms. V16 mit denselben RWD-Eingaben: 1,74/1,74 ms. Je Szenario 1.200 gemessene Schritte nach 120 Warm-up-Schritten. Details in qa/chassis-performance-v17-results.json. Gemessen wird der native Motor mit einem Spielerchassis und einem synthetischen Bodensampler, jeweils RWD/FWD/AWD und veröffentlichte V16-Basis. Vier Bodenabfragen pro Schritt. Das ist kein vollständiger Welt-/GPU-/Audio-/KI-Benchmark und keine FPS-Garantie.

## Grenzen und offener Umfang

Die Modellparameter und Kompatibilitäten sind Spielkalibrierungen für fiktive Autos, keine Messdaten realer Umbauten. Wellen und Differenziale verwenden träge Achsträger/Clutch-Constraints, keine einzelnen CV-Gelenke, frei schwingenden elastischen Wellen oder vollständige Bauraumprüfung. Der Differenzialsound bündelt AWD räumlich in der Wagenmitte. Visuelle Antriebswellen/Transaxle und Motorraumdetails werden hier nicht behauptet. Das Heightfield-Chassis aus V16 ist weiterhin kein freier 6-DOF-Körper.

Phase 1 bleibt offen für spezifischen Wheel Hop, abstimmbare Aerodynamik, Wetterkopplung, Reifenluftdruck/Flatspots sowie breitere Fahrzeugkalibrierung. Reifendruck, Karkasse und Blowout brauchen das Phase-2-Schema; Wetterkopplung die Phase-7-Umgebung. Cockpit/Fahrer, weitere Karosseriemodule, Motorraum, individuelle Weltverfeinerung und echte Garagenfahrten bleiben unverändert in der vollständigen Checkliste stehen. Es wurden keine neuen Medienassets eingeführt.

Tests nutzen Software-Chromium und synthetische Eingaben. Kein physisches Lenkrad/Gamepad, subjektiver Hörtest, echter Mehr-PC-Multiplayer oder manuelles Abfahren aller Straßen. Review wurde vom umsetzenden Agenten anhand des vollständigen Quelldiffs durchgeführt, nicht von einem unabhängigen Reviewer. Eine fehlende Warnung bei ausgefallener AWD-Hinterachse wurde dabei behoben.

## Nächster Abschnitt

Phase 1D: Wheel Hop und abstimmbare Aero-Grundlagen, gekoppelt an vorhandene Teile und Bodenkontakt. Danach die erforderliche Reifen-/Druckgrundlage in Phase 2. Bis dahin bleiben die genannten Punkte ausdrücklich teilweise oder offen.
