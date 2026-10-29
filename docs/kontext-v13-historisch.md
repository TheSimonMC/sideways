# SIDEWAYS V13 – aktueller Stand

Stand: 29. Oktober 2026. Grundlage ist der veröffentlichte V12-Stand in TheSimonMC/sideways. Der Nutzer hat Neustart- und Escape-Fixes, eine deutlich größere und abwechslungsreichere Free-Roam-Karte sowie direkten Upload auf GitHub Pages beauftragt.

Ein neuer Lauf und Pause > Restart reparieren das Auto vollständig und füllen Kraftstoff/NOS. R bleibt die Straßenbergung mit erhaltenem Schaden. Escape öffnet Pause und führt beim zweiten Druck zurück ins Spiel. Hauptmenü ist eine bewusste Auswahl im Pausemenü.

Neon County hat 24,576 km², etwa 64 km Straßen und 120 Graphknoten: Innenstadt, vierspuriger Expressway, Landstraßen, Küste, Hafenbereich, drei gerichtete Kreisverkehre und Skyline Hills mit Serpentinen und Villen. Höchste Fahrbahn etwa 158 m. Neun Services sind über das Straßennetz erreichbar. Die Karte ist eine eigene Low-Poly-Welt, keine GTA-Kopie. Expressway-Knoten sind derzeit ebenerdig.

Terrain wird unter den Straßen abgesenkt und angeglichen. Fahrbahn-Rendering und Reifenabtastung verwenden dieselben Dreiecke. Kurven teilen sich Randpunkte. Separate Seitenstreifen vermeiden Flackern. Häuser besitzen Hangfundamente; NPC-Räder folgen der Bodenhöhe. Polizei startet ohne Überschneidung mit zivilem Verkehr.

Multiplayer-Protokoll 9 trennt den neuen Kartenstand von V12. Positions- und Höhenvalidierung sowie Polizeisuchdaten unterstützen die ganze Region. Alle Teilnehmer müssen V13 verwenden. Steuerung, Garage, Audio-Erweiterung, SDK, Karriere und Rennstrecke bleiben auf V12 aufgebaut.

Build: npm ci; node build.mjs. READ-ME-V13.txt erklärt Bedienung und Grenzen. qa/release-v13.json nennt ausschließlich die für V13 ausgeführten Prüfungen. Alte QA-Dateien sind historische Nachweise. Physische Hardware, echtes Mehr-PC-Netzwerk und Hörtests wurden nicht geprüft. Der bekannte SDK-Replay-Hashfehler ist in qa/sdk-v12-baseline.json dokumentiert; das SDK wurde für V13 nicht verändert.

GitHub Pages veröffentlicht die getestete SIDEWAYS.html aus dem Repository-Hauptordner. Der Workflow vergleicht ihren SHA-256 mit qa/standalone-browser-v13-results.json. Das Release-ZIP enthält dieselbe HTML sowie Quellen, SDK, Dokumentation und Prüfungen. Keine Sites-Veröffentlichung.

Historie: docs/kontext-v11-historisch.md und docs/kontext-v12-historisch.md. Frühere Grenzen wie „noch nichts ändern“ betreffen nur den damaligen Übergabeschritt. Die späteren Änderungs- und Veröffentlichungsaufträge sind ausdrücklich erteilt.
