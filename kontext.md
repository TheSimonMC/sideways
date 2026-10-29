# SIDEWAYS V14 – aktueller Stand

Stand: 29. Oktober 2026. Grundlage ist der veröffentlichte V13-Stand in TheSimonMC/sideways. Der Nutzer möchte eine viel größere, dichtere Free-Roam-Welt mit mehreren verbundenen Inseln, abwechslungsreichen Stadtvierteln und Gassen sowie sichtbares modulares Fahrzeugtuning. Direkter Upload und Veröffentlichung auf GitHub Pages sind ausdrücklich beauftragt.

Neon Archipelago: vier Landmassen, fünf Brücken, 103,1 km² Kartenfläche einschließlich Wasser, etwa 52,5 km² Land und 266 km Straßen einschließlich Gassen. 17 Services, 1.625 Graphknoten, drei gerichtete Kreisverkehre und Fahrbahnen bis 210 m Höhe. Sechs zusätzliche Viertel ergänzen Innenstadt, Expressway und Skyline Hills. Palm Beach, Westhaven und Sunset Keys haben unterschiedliche Fassaden und Gebäudetypen. 2.244 zusätzliche modulare Gebäude, 1.934 Palmen und 1.451 Straßenausstattungen. Eigene Low-Poly-Welt mit GTA-/Vice-City-/San-Andreas-Inspiration; kein Nachbau und keine gleichwertige AAA-Detaildichte.

Neue Dateien: county-layout.js beschreibt Küsten und Straßennetz; county-junctions.js verbindet ebenerdige Kreuzungen; county-architecture.js erzeugt Fassaden, Dächer, Balkone, Straßenobjekte und Brücken. region.js verbindet diese mit dem bisherigen Stadtkern, Terrain, Straßenabtastung und Services. Straßen und Reifen teilen dieselben Dreiecke, das Terrain liegt darunter. Brücken haben eigene Deckhöhen; das System unterstützt keine befahrbaren Unterführungen. Details werden in der Entfernung ausgeblendet. Wasser ist an der Küste ausgeschnitten, unter Wasser liegende Terrainflächen werden nicht gerendert.

Optisches Tuning: Motorhaube, Spoiler, Seitenschweller, Felgen sowie Front-/Heckstoßstange sind unabhängig auswählbar. cosmetics.js enthält Optionen/Preise; car-cosmetics.js baut die sichtbaren Module für alle vier Fahrzeuge. Kauf, Besitz und Speicherung nutzen die Karriere. Alte Spielstände erhalten Serienteile. Optische Teile verändern keine Physik- oder Audiowerte. Insgesamt 22 Teilekategorien.

Ein neuer Lauf und Pause > Restart reparieren das Auto vollständig und füllen Kraftstoff/NOS. R und automatische Wasserbergung erhalten Schäden. Escape öffnet Pause und führt beim zweiten Druck zurück ins Spiel. Hauptmenü bleibt eine ausdrückliche Auswahl.

Multiplayer-Protokoll 10 trennt V14 von älteren Kartenständen. Koordinatenvalidierung unterstützt die Inseln; visuelle Auswahl wird übertragen. Alle Teilnehmer benötigen V14. SDK und Audio bleiben MotorLab 1.6.3 mit der bestehenden SIDEWAYS-Erweiterung.

Build: npm ci; node build.mjs. READ-ME-V14.txt erklärt Bedienung und Grenzen. qa/release-v14.json listet die auf diesem Stand ausgeführten Prüfungen; andere QA-Dateien sind historisch. Automatisierte Geometrie-/Routing-/Fahrzeugtests und Chromium-Browsertests prüfen die finale HTML. Physische Geräte, Hörtests und echte Mehr-PC-Verbindungen sind nicht geprüft. Der vorhandene SDK-Replay-Hashfehler ist in qa/sdk-v12-baseline.json dokumentiert.

GitHub Pages veröffentlicht SIDEWAYS.html aus dem Repository-Hauptordner. Der Workflow gleicht den SHA-256 mit qa/standalone-browser-v14-results.json ab. Das Release enthält die identische HTML, Quellen, SDK, Dokumentation und Prüfungen. Keine Sites-Veröffentlichung. Historie: docs/kontext-v11-historisch.md bis docs/kontext-v13-historisch.md.
