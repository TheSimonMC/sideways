# SIDEWAYS V28 – Phase 3D

V28 ergänzt echte Unterbodenbaugruppen an den vier vorhandenen Fahrzeugen: vier Querlenker, vier Federbeine, zwei Spurstangen und drei Auspuffabschnitte. Die alte durchgehende Bodenplatte wurde um die Achsen geöffnet; Rahmen und zentraler Boden bleiben sichtbar. Die Fahrzeughüllen und Spezifikationen bleiben erhalten.

Treffer schädigen die räumlich passenden Befestigungen. Abgerissene Teile fehlen am Wagen und laufen als Originalmesh im vorhandenen begrenzten Trümmersystem. Ein fehlender Querlenker löst bei einem Unfall das Rad; ohne Querlenker oder Federbein fehlt Radabstützung. Eine abgerissene Spurstange trennt das betroffene Rad vom Lenkbefehl. Baugruppen und fehlende Räder verändern Masse, Schwerpunkt, Achslasten und Gierträgheit.

Die Auspuffführung reicht vom Motorraum über Mittelrohr/Resonator zum Endschalldämpfer und zu den vorhandenen Endrohren. Gequetschte verbundene Rohre erzeugen Pumpverluste. Ein früher Rohrabriss umgeht dahinter liegende Verengungen und verschiebt Abgasgeräusch/Rauch an die Öffnung. Flammen am ursprünglichen Endrohr bleiben bei unterbrochener Führung aus. Die vorhandene Krümmergesundheit bleibt ein eigener Zustand.

Die Diagnose enthält 13 zusätzliche Baugruppen. Einzelreparaturen restaurieren die gewählte Baugruppe, lassen andere Schäden bestehen und räumen zugehörige Trümmer ab. Alte Speicherstände erhalten intakte neue Befestigungen. Körperzustand Version 4 enthält feste, begrenzte Schlüssel. Netzwerkprotokoll 18 bleibt kompatibel; ältere Clients ignorieren die zusätzlichen Unterbodendetails. Die neuen Clients übertragen fehlende Teile, Biegung und Radsturz ohne zusätzliche Nachrichten. Lose Trümmer bleiben lokal.

## Geänderte Dateien

- `underbody.js`, `underbody-view.js`: gemeinsame Formen und Zustände, Kollisionsschaden, Aufhängungsabstützung, Abgasweg und 13 zusammengefasste sichtbare Baugruppen.
- `physics.js`, `mechanical.js`, `body-damage.js`, `body-hinges.js`, `part-shapes.js`: Fahrkräfte, Trümmer, Masse, Reparatur, Diagnose und Speicherung.
- `car.js`, `exterior-damage.js`: offener Achsbereich, animierte und fehlende Baugruppen, Auspuffabhängigkeit, Geräusch-/Rauchanker.
- `multiplayer.js`, `network-cars.js`: begrenzte Strukturzustände, Radsturz, Spurstangen und passende Fahrzeugmassen.
- `main.js`, `index.html`, Pages-Workflow: V28, Diagnose und getestete Veröffentlichung.

## Nachweise

Alle 38 funktionalen Suiten bestehen: 14 allgemeine Regressionen, neun weitergeführte Prüfungen für Reifen, Kontaktflächen, Wetter, Antrieb, Aero/Wheel Hop, Bremsen, Fahrwerksschäden, Nebenaggregate und Motorbauteile, sieben weitere native/Build-/Abdeckungsprüfungen sowie acht Browserabläufe. Acht neue native Prüfgruppen decken alle 13 Baugruppen an allen vier Autos ab, außerdem lokalen Abriss, Masse, fehlende Abstützung, Lenkverlust, Pumpverluste, Abgasöffnung, Reparatur, Speicherung und begrenzte Netzwerkdaten. Fünf Browserabläufe verwenden exakt die ausgelieferte HTML-Datei: fehlende Teile/Diagnose, Garage/Speichern, mobile Bedienung, Offline-Fahrt/Neustart/Escape sowie Multiplayer mit Wetter und Wiedereintritt. Drei Browserfixtures prüfen Unterbodenmeshes/Abriss, räumliche Kontakte und den 7,5-Sekunden-WebRTC-Burst gegen RATE_LIMIT. Die Unterbodenansichten wurden visuell kontrolliert. Einschränkungen: lokale Chromium-Instanzen mit Software-Rendering, keine getrennten physischen PCs, Mobilfunk-/TURN-, Hardware-Wheel- oder Hörabnahme.

Lokale CPU-Stichprobe, je 1.200 Schritte: V28 RWD 1,71/1,77/1,77 ms im Mittel (trocken/bergig/nass), FWD 1,77/1,73/1,72 ms, AWD 1,73/1,66/1,69 ms. Vergleich V27 trocken RWD 1,75/1,74 ms. Separater Trümmerlauf mit acht Paneelen, 24 Splittern, acht Rädern und 90 Dock-Hindernissen: 0,59 ms Mittelwert, 0,98 ms 95. Perzentil. Eine Baugruppe verwendet ein zusammengefasstes Mesh, insgesamt 13 neue Baugruppen. Die Messungen sind Einzelstichproben, keine allgemeine FPS-Aussage; GPU, Welt/KI und Audio sind im Chassisvergleich ausgeschlossen.

## Grenzen und nächste Phase

Die Baugruppen verwenden bewusst vereinfachte Starrkörper und vorgegebene Federbein-/Lenkerbewegungen. Rohrabrieb stützt sich auf die vorhandene, aus vier Radpunkten ermittelte Straßenebene; er ist kein zusätzlicher vollständiger Unterboden-Raycaster. Eine flexible Auspuffkette, exakte Gelenksimulation und sich gegenseitig treffende Trümmer sind nicht implementiert. Die maximal acht Karosserie-/Fahrwerkstrümmer teilen sich einen Pool; entfernt liegende oder alte Teile verschwinden. Keine Bildratengarantie.

Als Nächstes folgt Phase 4: passende Innenräume für alle vier Modelle, Cockpitkamera, Instrumente, Navigation, nutzbare Spiegel und Fahreranimation. Motorraumdetails/Ausbau gehören weiterhin zu Phase 6. Der gesamte Zielumfang von 156 Anforderungen bleibt aktiv; offene Kalibrierungs- und spätere Phasen werden nicht als erledigt gemeldet.

Die Prüfung nach review-agent ist eine Selbstprüfung des implementierenden Agenten. Eine unabhängige Zweitprüfung, Hardware-Lenkradtest oder Hörabnahme wird nicht behauptet.
