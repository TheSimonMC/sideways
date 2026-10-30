# V30: Phase 5A – Exterieur und Tönung

V30 erweitert das bestehende Tuning um elf Kategorien. P05.01 und P05.03 sind umgesetzt; Phase 5 insgesamt bleibt teilweise. Alle 156 ursprünglichen Anforderungen stehen unverändert in der Fortschrittsliste. Vier Fahrzeuge, Karten, Innenräume, MotorLab SDK, vorhandene Teile und Speicherbasis bleiben erhalten.

## Teile und tatsächliche Wirkung

Lippe/Splitter und Diffusor lassen sich unabhängig vom Stoßfänger auswählen oder abnehmen. Die Factory-Auswahl folgt weiterhin dem bisher gewählten Stoßfänger. Kotflügel gibt es mit Lüftungselementen oder als leichtere Carbonvariante; Bolt-on- und GT-Verbreiterungen passen sich an Karosserie und Radpositionen an. GT setzt mindestens breite Reifen voraus. Die neuen Grills, Einzel-/Doppel-/Vierfach-Endrohre und Lichtdesigns ergänzen die bisherigen Hauben, Spoiler, Schweller und Felgen.

Breitere Kits ändern Spurweite, Fahrzeugmasse, Luftwiderstand und die Kollisionsbreite für eigene und entfernte Fahrzeuge. Lippen und Diffusoren ändern Abtrieb und Widerstand; fehlende Baugruppen verlieren Wirkung. Die Masse leichterer Hauben und Kotflügel wird beim Einbau und beim Abreißen konsistent berücksichtigt. Untergeordnete Teile werden bei gemeinsamem Verlust nicht doppelt abgezogen. Die tatsächlichen Auspuffanschlüsse und Schallquellen folgen den gewählten Endrohren. Endrohre allein behaupten keinen Leistungsgewinn; Strömung und Motorsound bleiben an das vorhandene Abgassystem gekoppelt.

Projektor-, Rallye- und LED-Leuchten besitzen eigene Geometrie und passende Farbe, Reichweite und Kegelbreite. Seitengenaue Schäden und die elektrische Versorgung beeinflussen sie weiterhin. Das ersetzt nicht die noch ausstehende Erweiterung um Fern-/Nebel-/Rückfahrlicht.

Gloss, Satin und Metallic verändern die Lackoberfläche bei erhaltener Fahrzeugfarbe. Drei selbst erstellte Folierungen werden im vorhandenen Material gezeichnet. Ihre Koordinaten bleiben am jeweiligen Teil, auch beim Öffnen oder Abfallen. Club-/Works-Decals oder saubere Türen ersetzen bei Bedarf die großen Werksnummern. Die Folierungen brauchen keine zusätzlichen Renderdurchgänge und keine heruntergeladenen Texturen.

Vier Tönungsstufen übertragen 85, 70, 50 oder 35 Prozent des sichtbaren Hintergrundlichts bei senkrechtem Blick. Die Straße wird beim Blick von innen ebenfalls dunkler. Glas bleibt durchsichtig; fehlende Scheiben bleiben fehlend. Die Näherung verwendet dünne Absorption und einen Blickwinkelanteil, keine Brechung oder farbige durchgerechnete Glasschatten.

## Integration und Dateien

- Neu: dist/exterior-tuning.js mit Katalog, Preisen, Kompatibilität, Dimensionen und physikalischen Änderungen; dist/exterior-tuning-view.js mit Geometrie, Lack und Glas.
- catalog.js, career.js und garage.js verbinden Auswahl, Vorschau, Kauf und Speicherstände. Abbrechen stellt das installierte Modell wieder her; Besitz wird nur einmal berechnet.
- car.js und car-cosmetics.js montieren die Teile an vorhandene Baugruppen. body-layout.js, exterior-damage.js, part-shapes.js, underbody.js und mechanical.js halten Masse, Schaden, Diagnose und Auspuffführung zusammen.
- aerodynamics.js und contact.js berücksichtigen die neuen Aero-Teile und Fahrzeugbreiten. environment.js erhält die Lampenwahl; main.js und network-cars.js reichen Build und Breite weiter.
- multiplayer.js verwendet Protokoll 19, damit ältere Clients die neuen Teile und Maße nicht stillschweigend verlieren. Nachrichtenrate und RATE_LIMIT-Korrektur bleiben erhalten. Alle Spieler müssen V30 laden.

## Nachweise

29 Testsuiten bestehen auf den finalen Quellen beziehungsweise exakt ausgelieferten HTML-Bytes: 21 native/Build-Suiten und acht Browserabläufe. Die neuen Prüfungen decken alle Varianten auf allen vier Fahrzeugen, freie Vorschau, Abbruch, Kauf zum angezeigten Preis, erneute kostenlose Installation, Reload, erhaltene Schäden, Teilverlust, gezielte Reparatur, Aero und Kollisionsbreite ab. Die bestehenden Physik-, Reifen-, Schaden-, Cockpit-, Eingabe-, Audio-, Karten-, Renn- und KI-Regressionen bestehen ebenfalls.

Der Glas-Framebuffer-Test misst die gewählten Durchlasswerte direkt als Pixelwerte. Die Folierungen erzeugen unterschiedliche Renderbilder. Alle vier getunten Autos wurden außen sowie im Cockpit bei Tag/Nacht gerendert. Der vollständige Spieltest fährt den gekauften Wagen in der Stadt und prüft Nachtlicht, dunkle Tönung, Cockpit und Spiegel. Screenshots wurden visuell kontrolliert. Keine JavaScript-/Shaderfehler oder externe Laufzeitdownloads im Offline-Test.

Zwei unabhängige lokale Chromium-Prozesse teilen echte PeerJS/WebRTC-Sitzungen und übertragen die neuen Teile. Wiedereintritt und die getrennten 7,5-Sekunden-Empfangsstaus auf Host und Gast bleiben ohne RATE_LIMIT-Rauswurf. Das ist keine Abnahme auf getrennten PCs oder in Mobilfunk-/TURN-Netzen.

Die isolierte Hachi-Szene benötigt mit Serienteilen 230 Draw Calls und mit dem getesteten kompletten Tuning 282; die Texturzahl bleibt bei 4. Je 40 aufgewärmte Frames mit gl.finish ergeben lokal im Mittel 0.54 beziehungsweise 1.39 ms, mit 95. Perzentil 0.60/5.20 ms. Diese kleine Render-Szene enthält weder Stadt noch Verkehr und belegt keine Gesamtspiel-Bildrate.

## Grenzen und nächste Arbeit

Karosseriekontakte bleiben die vorhandene planare Fahrzeugform mit räumlichen Einzelteil-Proxies; keine vollständige Soft-Body-Simulation. Neue Archsegmente, Gitter und Lampenelemente werden pro Material und beschädigbarer Baugruppe zusammengefasst. Spiegel behalten die begrenzte V29-Lösung. Lokale Software-Renderer-Messungen sind keine FPS-Garantie; das alte Ganzspiel-fps-Diagnosefeld basiert auf dem begrenzten Simulationszeitschritt und ist kein Wallclock-Leistungsnachweis. Physische Wheels, mobile GPUs und subjektives Hören wurden nicht abgenommen.

Es fehlen weiterhin die in P05.02 geforderten wählbaren Innenraumteile, der Kompressor aus P05.04 und die vollständige manuelle Montage-/Ausbauintegration aus P05.05/Phase 6. Der nächste Schritt ist Phase 5B: Lenkräder, Sitze, Bezüge, Dekore, Schalt-/Handbremshebel, Käfige, Gurte, Anzeigen und Ambientebeleuchtung mit den bestehenden Fahrer- und Cockpitsystemen verbinden. Anschließend folgen Kompressor und Montageintegration. Frühere teilweise Anforderungen und spätere Phasen bleiben in der Checkliste offen.
