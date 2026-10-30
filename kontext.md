# SIDEWAYS V30 – Phase 5A

Verbindlich: docs/goal.txt, SHA-256 4baa27bd5a4d96ab40582166e0fd6095b803dc262f6140dc282ea844a1b96dca. Alle 156 Anforderungen bleiben in docs/goal-progress.md/.json. Gesamtziel aktiv. Direkte Veröffentlichung auf main, Pages und Release autorisiert; kein Neubau. Vier Autos, Karten, SDK, Steuerung und Speicherstände erhalten.

V30 ergänzt elf Kategorien auf insgesamt 41: getrennte Lippen/Diffusoren, Fenders/Widebody, Grill, Endrohre, Lichtdesign, Lackoberfläche, Folierung, Decals und Tönung. Daten/Preise/Kompatibilität in exterior-tuning.js; Geometrie/Shader in exterior-tuning-view.js. Catalog/Career/Garage bleiben der atomare Vorschau-/Kaufpfad. GT benötigt breite Reifen. bodyWidth ist die separate Kollisionsbreite; Fahrzeug-Grundmodelle werden nicht skaliert. Body-/Exterior-Layout zählen Teilemassen auch bei Abriss korrekt. outletPositions/outletHeight verbinden hintere Rohre, sichtbare Enden und Klangquellen. Folierung nutzt pro Vertex gespeicherte Panel-Koordinaten. Glasschatten/Brechung sind ausdrücklich nicht simuliert.

Phase 4 bleibt erhalten: modellgerechte Innenräume, Kameraindex 3, echte Instrumente, Radio/Map, Fahrer, begrenzte Spiegel. Neues Interieur-Tuning muss Handkontakte, Sitz-/Augenpunkt, Gauge-Lesbarkeit, Door-Card-Mounts und Disposal erhalten. Kupplungswert bedeutet gedrücktes Pedal. wheelRotation=0 bewahrt Factory Range.

Netzwerk jetzt Protokoll 19 wegen neuer Build-Kategorien und Maße. RATE_LIMIT-Coalescing/Backpressure bleibt; keine höhere Nachrichtenrate. Echte Zwei-Spieler- und Bursttests erforderlich. Lose Trümmer bleiben lokal.

Nachweise: docs/phase-5a-exterior-report.md, qa/release-v30.json und qa/review-v30.json. Build: node build.mjs. Browser und native Lasttests seriell; niemals einen noch lebenden Prozess bei Beobachtungs-Timeout neu starten. SHA-Werte müssen die ausgelieferten Quellen/HTML-Bytes abdecken. Gemischte EOL unveränderter Zeilen erhalten.

Nächster Schritt Phase 5B: alle geforderten Interieurteile mit Geometrie, Kosten/Besitz, Befestigungen, Masse und tatsächlicher Funktion. Danach Kompressor und vollständige Kompatibilität/Montageintegration (Phase 5C/6). P05.01/P05.03 sind erledigt, Phase 5 insgesamt teilweise. Frühere teilweise Punkte und spätere Phasen bleiben offen. Keine vollständige Zielerreichung, Hardware-Wheel-/FFB-/mobile GPU-Abnahme oder pauschale FPS-Garantie behaupten.
