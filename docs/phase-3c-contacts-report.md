# SIDEWAYS V27 – Phase 3C

Offene Türen, Motorhaube und Kofferraum reagieren auf räumliche Hindernisse. Die Prüfung berücksichtigt Höhen sowie die Bewegung zwischen zwei Stellungen. Treffer können das Scharnier zurückschlagen, das Fahrzeug abbremsen und das getroffene Paneel lösen. Bestehende Bedienung, Einzelreparatur und Speicherung bleiben erhalten.

Lose Räder treffen Wände und Brückenleitplanken. Drehung und Bewegung beeinflussen einander über Reibung; die Räder rollen an Gefällen und kippen bei geringer Geschwindigkeit auf die Seite. Karosserietrümmer verwenden ihre räumliche Orientierung für Boden- und Wandkontakte. Alle Pools bleiben begrenzt und werden nach Lebensdauer/Entfernung bereinigt.

## Geänderte Dateien

- part-contacts.js, part-shapes.js, hinge-contacts.js: Boxkontakte, gemeinsame Formen/Transformationen, Scharnierimpulse und treffseitiger Schaden.
- body-hinges.js, physics.js, panel-debris.js: Integration, Abreißen, begrenzte Trümmer, rollende Räder und Reparaturbereinigung.
- car.js: physikalische Ausrichtung loser Paneele, Radneigung und tatsächliche Reifenbreite.
- city.js, county-architecture.js, region.js, world.js: Höhen vorhandener Hindernisse und geneigte Brückenleitplanken.
- main.js, index.html und Pages-Workflow: V27 und Veröffentlichung der geprüften Datei.

## Nachweise

Alle 27 funktionalen Suiten bestehen: 14 bestehende Regressionen, sechs weitere native/Build-/Abdeckungsprüfungen und sieben Browserabläufe. Elf neue Kontakt-Prüfgruppen decken alle vier Fahrzeugtypen mit vier Scharnieren, Höhenabstände, schnelle Treffer, Scharnierbewegung zwischen Frames, Winkelumlauf, Roll-/Reibungsenergie, Gefälle, ruhende Räder, Poolgrenzen, Einzelreparatur, unveränderte pausierte Fahrzustände und die Übereinstimmung geneigter Brückenleitplanken mit der gerenderten Geometrie ab. Ein Browserfixture verwendet die tatsächliche Physik, MotorLab und Three.js für Abreißen, Wandkontakt, Darstellung und Wiederherstellung aller vier Autos. Seine Abwurfgeschwindigkeiten sind kontrollierte Testeingaben. Fünf weitere Abläufe prüfen exakt die gelieferte HTML-Datei: beschädigte Exterieurteile, Garage/Speichern, mobile Tuningbedienung, Offline-Fahrt/Neustart/Escape und Zwei-Spieler-Lobby mit Wetter und Wiedereintritt. Der separate WebRTC-Burst-Test übersteht jeweils 7,5 Sekunden blockierten Host/Gast ohne RATE_LIMIT-Rauswurf. Die vorhandenen Modelle und das Kontaktfixture wurden visuell geprüft. Lokale Browser mit Software-Rendering; keine separate Mobilfunk-/TURN- oder Hörabnahme.

Lokale CPU-Stichprobe für Trümmer, 600 Schritte nach 60 Warm-up-Schritten: ein Paneel, sechs Glassplitter und ein Rad benötigen im Mittel 0,07 ms; die Maximalbelegung mit acht Paneelen, 24 Splittern und acht Rädern 0,16 ms bei vier Testwänden. In der tatsächlichen Dock-Welt mit 90 Kollisionsobjekten und ihrem Bodensampler: 0,62 ms im Mittel, 1,22 ms im 95. Perzentil. Motor, GPU, KI und Audio sind dabei ausgeschlossen. Separate Fahrphysik-Stichprobe, je 1.200 Schritte: V27 RWD 1,70/1,79/1,76 ms im Mittel (trocken/bergig/nass), FWD 1,71/1,66/1,68 ms, AWD 1,70/1,69/1,68 ms. Vergleich V26 trocken RWD 1,69/1,73 ms. Diese getrennten Einzelmessungen sind keine allgemeine FPS-Garantie.

## Offen und technische Grenzen

P03.04 ist umgesetzt. Phase 3 bleibt wegen einzelner ablösbarer Fahrwerksglieder und der vollständigen Auspuffführung teilweise offen. Diese Arbeiten stehen als Nächstes an, danach Phase 4 mit Innenräumen, Cockpit und Fahrer.

Die Kontaktboxen nähern Verkleidungen und Dellen an. Lose Räder verwenden eine zylindergroße Box für Wände sowie eine analytische Bodenauflage. Trümmer kollidieren mit statischen Weltobjekten, nicht miteinander oder mit dynamischem Verkehr. Sie bleiben lokal; sichtbarer Fahrzeugzustand wird weiterhin über Protokoll 18 übertragen. Keine volle Soft-Body-/Mehrkörpersimulation, keine garantierte Bildrate. Alle 156 Originalanforderungen und die übrigen Grenzen bleiben in der Checkliste erhalten.

Die Prüfung nach review-agent ist eine Selbstprüfung des implementierenden Agenten. Keine unabhängige Zweitprüfung, Tests auf getrennten physischen PCs oder Hörabnahme werden behauptet.
