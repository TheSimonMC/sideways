# SIDEWAYS V26 – Phase 3B

Vier Scheiben, vier Leuchten und zwölf weitere Anbauteile besitzen eigene Zustände. Ein Treffer kann die linke Leuchte ausfallen lassen, die passende Scheibe zerbrechen oder den getroffenen Spiegel verlieren. Andere Teile bleiben erhalten. Das Spiel speichert den Zustand und erlaubt Einzelreparaturen am Mechaniker.

## Geänderte Dateien und Systeme

- exterior-damage.js: Komponentendefinitionen, lokale Schadensverteilung, Befestigungen, Masse, Bruch und Lichtfunktion.
- body-damage.js, body-hinges.js, physics.js: Migration, Kratzer, kombinierte Baugruppenmassen, Trümmer und Glassplitter. Türen/Hauben aus V25 bleiben erhalten.
- car.js, car-cosmetics.js, surface-damage.js: getrennte Original- und Tuninggeometrie, transparentes Glas, Risse/Kratzer auf Oberflächen, Leuchtenmaterialien und lokale Splitterinstanzen.
- mechanical.js, environment.js, audio.js, aerodynamics.js: Diagnose und Einzelreparatur, ausfallende Lichtkegel, Wind/Glas-/Auslassgeräusche, Abtrieb und Luftwiderstand.
- main.js, multiplayer.js, index.html: Preview-Lichtzustand, Glassignal, V26, Protokoll 18 und begrenzte Übertragung innerhalb vorhandener Nachrichten.

## Nachweise

Alle 25 funktionalen Suiten bestehen: 14 bestehende Regressionen, fünf weitere native/Build-/Abdeckungsprüfungen und sechs Browserabläufe. Neun neue Prüfgruppen decken Migration, treffseitigen Schaden, Lichtausfall, Einzelreparatur, Speichern, kombinierte Massen, Splitter/Diffusor, begrenzte kollidierende Glassplitter, echte Geometrie aller vier Autos mit Serien-/Tuningteilen, Oberflächenmarkierungen, Audio-PCM und begrenzte Netzwerkdaten ab. Fünf Browserabläufe prüfen die endgültige HTML-Datei: Schadensdarstellung/Licht/Reload/Diagnose, vier Garagenmodelle, mobile Tuningbedienung, Offline-Fahrt/Neustart/Escape und eine vollständige Lobby mit zwei Spielern. Der zusätzliche WebRTC-Test überträgt kaputte Lampen, fehlende Scheiben und Spiegel trotz jeweils 7,5 Sekunden blockiertem Host/Gast ohne RATE_LIMIT-Rauswurf. Screenshots aller vier Modelle und der mobilen Bedienung wurden visuell geprüft. Die Tests laufen lokal; eine Hörabnahme oder reale Mobilfunkverbindung wird nicht behauptet.

Lokale CPU-Stichprobe, je 1.200 Physikschritte nach 120 Warm-up-Schritten: V26 RWD 1,55/1,60/1,69 ms im Mittel (trocken/bergig/nass), FWD 1,58/1,60/1,57 ms, AWD 1,60/1,56/1,64 ms. V25 bei denselben trockenen RWD-Eingaben: 1,63/1,62 ms. Ein lokaler Lauf mit gesundem Auto, nativem Motor und synthetischem Bodensampler. Welt, GPU, KI, Audio und Trümmerabfragen sind ausgeschlossen; daraus folgt keine FPS-Garantie.

Die Quellprüfung nach review-agent ist eine Selbstprüfung des implementierenden Agenten. Keine unabhängige Zweitprüfung, keine Tests auf getrennten physischen PCs oder mit echten Lenkrädern. Testgrenzen und Hashes stehen unter qa/release-v26.json.

## Fortschritt und Grenzen

P03.06 und P16.06 sind umgesetzt: Scheiben, Leuchten, Kühler, Fahrwerk, Reifen und Aeroteile wirken auf die jeweils zugehörigen Systeme. P04.07 ist mit transparentem Glas teilweise erfüllt; vollständige Innenräume und Fahrer fehlen noch. Alle 156 Originalanforderungen bleiben in der Checkliste.

Phase 3 bleibt teilweise: Hauben haben noch keinen vollständigen räumlichen Kontaktkörper; lose Räder verwenden weiterhin das ältere Bodenmodell. Nicht jedes Fahrwerksglied kann einzeln abfallen. Beim Auspuff ist die sichtbare Auslassbaugruppe getrennt, die vollständige Rohrführung steht aus. Trümmer verwenden vereinfachte Kontaktproxies und kollidieren nicht miteinander. Sie bleiben im Multiplayer lokal; Schäden am Fahrzeug werden übertragen. Neue Glasfragmente sind stilisierte Dreiecke mit begrenzter Lebensdauer, keine materialgetreue Bruchsimulation.

Die bestehenden Grenzen von Phase 1/2 sowie Innenräume, Cockpit, Fahrer, Motorraum und alle späteren Phasen bleiben vermerkt. Als Nächstes folgen die verbleibenden Kontakte und Anbauteile aus Phase 3, danach Phase 4.
