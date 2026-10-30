# V29: Phase 4 – Cockpit und Innenräume

V29 erweitert alle vier vorhandenen Fahrzeuge. Phase 4 mit ihren zwölf Punkten sowie P18.08/P18.09 ist umgesetzt. Das Gesamtziel bleibt aktiv; alle 156 Anforderungen stehen weiterhin in goal-progress.md/.json. Fahrzeuge, Karten, bestehende Teile, MotorLab SDK und Speicherbasis wurden beibehalten.

## Umsetzung

Hachi erhält ein dunkles Rechtslenker-Cockpit mit zwei analogen Instrumenten, Atlas eine braune Linkslenker-Kabine mit klassischen Rundinstrumenten und externem Navi-Halter. Kitsune hat ein enges zweisitziges Rechtslenker-Cockpit mit zentralem Drehzahlmesser; Vector eine Linkslenker-Kabine mit digitaler Anzeige. Sitze, Rücksitze soweit passend, Türverkleidungen, Dachhimmel, Mittelkonsole, Pedale, Schalthebel, Handbremse, Radio, Spiegel und Innenlicht sind echte Geometrie. Die vorhandenen transparenten Scheiben und beschädigbaren Türen bleiben verbunden.

Die vierte Kamera sitzt an der realen Chassispose. Sitzhöhe und Abstand, 55–95 Grad vertikales FOV und die zusätzliche Kopfbewegung lassen sich einstellen. Blicksteuerung und die drei bisherigen Kameraindizes bleiben erhalten. Der schwebende Tacho verschwindet im Cockpit; außerhalb ist er abschaltbar. Die Telefonanzeige wechselt bei Rechtslenkern die Seite, damit das Navi bedienbar bleibt.

Geschwindigkeit, Drehzahl, Gang, Tank, Kühlmittel-/Öltemperatur, Öldruck und Warnungen kommen aus dem laufenden Fahrzeugzustand. Der eingebaute Motor bestimmt die Drehzahlskala. Bei fehlender elektrischer Versorgung schaltet das Display ab; die Musik folgt derselben Stromversorgung. Navigation verwendet den vorhandenen Router und die Fahrzeugposition. Display-Schaltflächen öffnen die Karte und steuern Musik/Lautstärke. U und die Klammer-Tasten sowie frei belegbare Controllerbuttons bedienen dieselben Funktionen.

Der Fahrer hat Kopf, Körper, Ober-/Unterarme, Hände, Beine und Füße. Hände greifen den Lenkradring; bei großen Winkeln greift jeweils eine Hand um. Die zur Mittelkonsole liegende Hand schaltet und zieht die Handbremse. Pedale und Füße folgen den tatsächlichen Eingaben; Last und Federbewegung beeinflussen die Pose. Kopf/Kappe werden nur in der eigenen Cockpitkamera ausgeblendet. Wheel-Nutzer können Lenkrad und Arme getrennt verbergen.

Der Hardware-Lenkwinkel ergänzt die vorhandene Browser-Gamepad-Kalibrierung. 180–1440 Grad Gesamtweg werden über die eingebaute Lenkübersetzung in Radwinkel umgesetzt und am realen Anschlag begrenzt. Factory Range bewahrt das bisherige Verhalten. Tastatur/Gamepad ändern sich dadurch nicht. Es wird keine Browser-Force-Feedback-Funktion behauptet.

## Dateien und Integration

- Neu: dist/cockpit-state.js, interior.js, driver.js und cockpit-mirrors.js.
- Geändert: car.js für Montage, Animation und Entsorgung; main.js, index.html und style.css für Kamera, Bedienung und Speichern.
- input.js, controls-ui.js, chassis-setup.js und physics.js verbinden den Hardware-Lenkwinkel mit dem bestehenden Solver.
- audio.js ergänzt die Kabinenmischung. Offene/fehlende Türen und Scheiben verändern Wind, Höhenanteil und Lautstärke.
- multiplayer.js und network-cars.js übertragen/interpolieren begrenzte Fahrerbedienung und Instrumentwerte im vorhandenen Protokoll-18-Strom. Die Nachrichtenrate bleibt unverändert.

## Nachweise

26 funktionale Suiten bestehen auf den ausgelieferten Quellen beziehungsweise den exakt ausgelieferten HTML-Bytes. Dazu gehören 15 bestehende Regressionen, gezielte Cockpitprüfungen, Unterboden-/Paneelprüfungen, der native Netzwerk-Bursttest und der Standalone-Buildcheck. Sechs Browserabläufe prüfen die Quellmodelle samt echten Spiegelpixeln, das vollständige Cockpit aller vier Autos bei Tag/Nacht, Radio-Klicks, Navigation, Sitz-/Wheel-Einstellungen, Reload, die Offline-Fahrt mit Garage/Neustart/Escape, schmale Garagenlayouts und Multiplayer.

Der Multiplayer-Nachweis verwendet zwei lokale Chromium-Prozesse über echtes PeerJS/WebRTC einschließlich Wiedereintritt. Ein separater Lauf staut den Empfang jeweils 7,5 Sekunden auf Host und Gast; beide bleiben ohne RATE_LIMIT verbunden. Keine Abnahme auf getrennten physischen PCs oder über Mobilfunk/TURN.

Die Quellfixture rendert eine kleine Straße mit echten Fahrzeugmeshes. Eine hinter dem Wagen geänderte Farbfläche verändert die Spiegelpixel. Je 40 gemessene Frames nach Aufwärmen, einschließlich gl.finish() im lokalen Software-Renderer: Spiegel aus: 1.83 ms Mittel, 6.60 ms p95; Spiegel an: 1.94 ms Mittel, 4.40 ms p95. Das ist keine Aussage über GPU-Zeit auf Spielhardware oder die gesamte Open World. Der vollständige Spieltest protokolliert zusätzliche Drawcall- und Spiegel-Beobachtungen in qa/cockpit-game-browser-v29-results.json. Dessen bestehendes fps-Feld wird aus dem begrenzten Simulationszeitschritt berechnet und misst keine tatsächliche Bildrate; es dient deshalb nicht als Leistungsnachweis.

## Grenzen und nächste Arbeit

Spiegel nutzen drei 256×128-Targets, höchstens einen zusätzlichen Pass pro Frame und einen nach Qualität/CPU-Abgabezeit begrenzten Takt. Ihr Sichtbereich beträgt 140 bzw. 220 Meter. Der eigene Wagen wird aus dem Spiegelpass ausgeblendet; der entfernte Himmel wird durch die aktuelle Nebelfarbe angenähert. Fehlende Spiegel werden übersprungen; abgeschaltete Spiegel zeigen kein eingefrorenes Bild.

Der Fahrer verwendet stilisierte Zweigelenk-Kinematik, keine biomechanische Simulation. Innenraumteile folgen den Tür-/Chassisbaugruppen, besitzen aber noch kein eigenständiges Innenraum-Tuning oder Materialdeformationssystem. Instrumente aktualisieren im Cockpit mit bis zu 30 Hz, die Karte mit bis zu 8 Hz; außerhalb seltener. Die Spiegel-Helligkeit und volle Cockpitsicht wurden visuell kontrolliert. Physische Wheels, mobile GPUs und subjektives Hören wurden nicht getestet.

Nächste Phase ist 5: vorhandene Exterieurteile ergänzen, Interieur-Tuning, Tönung, Kompressor und weitere mechanische Optionen mit Preisen, Befestigungen und Kompatibilität verbinden. Der detaillierte animierte Motorraum und gezielter Ausbau bleiben Phase 6. Spätere Grafik-, Welt-, KI-, Audio- und Garagenphasen sowie frühere ausdrücklich teilweise Punkte bleiben in der vollständigen Checkliste.
