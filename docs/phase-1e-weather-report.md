# SIDEWAYS V24 – Phase 1E

V24 schließt die Nässe-Anbindung aus Phase 1. Regen verändert die tatsächlichen Radkräfte und bleibt als Straßennässe erhalten, wenn das Wetter aufklart. Die vorhandenen vier Fahrzeuge, Karten, Speicherstände, Cartoon-Grafik und MotorLab-Integration bleiben bestehen.

## Umsetzung

- `dist/weather.js`: gespeicherter Wetterverlauf, langsame Benetzung/Trocknung, Oberflächen- und Pfützenabfrage. Tempo, Profilzustand, Druck und Mischung beeinflussen den Verlust von Reifenkontakt.
- `dist/physics.js`, `dist/mechanical.js`: Nasshaftung im bestehenden Reibkreis aller vier Räder, Wasserwiderstand und einseitiges Giermoment, zusätzliche Reifenkühlung. Wasserarbeit wird vom thermischen Reifenkonto getrennt.
- `dist/weather-renderer.js`, `dist/environment.js`, `dist/car.js`: begrenzter Regenpuffer, dunklere/glattere Fahrbahn mit Pfützenmaske, Nebel/Beleuchtung, Sprühwasser aus dem bestehenden Partikelpool.
- `dist/audio.js`, `dist/audio/world.js`: nasses Abrollen, weniger trockenes Quietschen und synthetisches Regengeräusch im unabhängigen Welttransport. Regen funktioniert bei ausgeschaltetem Motor.
- `dist/main.js`, `dist/index.html`, `dist/lobby-panel.js`, `dist/multiplayer.js`: Settings, Speicherung, Host-Wetterregeln und Zustandsübertragung. Gäste erhalten beim Wiedereinstieg die bestehende Nässe. Protokoll 16 trennt inkompatible Versionen; beide Spieler müssen V24 laden. Die RATE_LIMIT-Paketbündelung bleibt erhalten.
- `dist/traffic.js`, `dist/race.js`: geringere Haftung, angepasstes Tempo und frühere Bremsannahmen. Polizei nutzt denselben nassen KI-Integrator; die vollständige KI-Überarbeitung aus Phase 11 steht weiterhin aus.

## Nachweise

Alle 37 funktionalen Suiten bestehen: 14 etablierte Regressionen, zwölf weitere native/Build-/Abdeckungsprüfungen und elf Browserabläufe. Zehn Browserabläufe verwenden die endgültige HTML-Datei. Dazu gehören Wetterauswahl, Pause, Speichern, neue Fahrt, nasse Nachtdarstellung und das vollständige Zweispieler-Spiel mit Host-Wetter und Wiedereinstieg. Ein WebRTC-Modultest prüft zusätzlich 7,5 Sekunden Rückstau auf Host- und Gastseite. Die neue native Wetterprüfung umfasst sieben Gruppen für Benetzung/Trocknung, Zeitschritte, Reifenparameter, alle vier Autos, einseitige Pfützen, thermische Arbeit, PCM, Partikel und KI/Netzwerk. Bestehende Serien-/Drift-, FWD/RWD/AWD-, Schadens-, Reparatur-, Neustart- und Escape-Prüfungen bleiben erfolgreich. Die Wetter-Browserprüfung meldet auch keine Shader-/Konsolenfehler. Nachweise und Dateihashes: qa/release-v24.json.

Bei identischen Bremsversuchen aus 90 km/h auf ebener Straße verlängert vollständige Nässe die simulierte Strecke: Hachi 29,42 auf 38,91 m, Atlas 30,84 auf 40,67 m, Kitsune 28,75 auf 38,11 m, Vector 29,96 auf 39,60 m. Das sind Vergleichswerte dieser fiktiven Spielautos. Sie sind keine Messdaten realer Fahrzeuge. Die gleichen Lenkversuche ergeben bei allen vier Autos weniger Richtungsänderung auf nasser Fahrbahn.

Lokale CPU-Stichprobe mit je 1.200 Schritten nach 120 Warm-up-Schritten: V24 RWD 1,79/1,79/1,80 ms im Mittel (trocken/bergig/nasse Ebene), FWD 1,76/1,75/1,72 ms, AWD 1,75/1,72/1,73 ms. V23 bei denselben trockenen RWD-Eingaben: 1,85/1,75 ms (Ebene/Hang). Ein nativer Motor, ein Chassis und synthetischer Bodensampler; GPU, Welt, KI und Audio sind ausgeschlossen. Keine FPS-Garantie. Details: qa/chassis-performance-v24-results.json.

Die Darstellung benötigt einen Regen-Drawcall mit maximal 120/240/360 Linien nach Qualität. Sprühwasser teilt den vorhandenen Pool von 160 Partikeln. Keine zusätzlichen Spiegelkameras oder Vollbild-Reflexionsdurchläufe. Speicher-, Pause-, Neustart- und Multiplayer-Verhalten werden am endgültigen HTML-Build geprüft; die Wetterformeln zusätzlich mit reproduzierbaren Modulprüfungen.

## Grenzen und nächste Arbeit

P01.07/P01.08/P16.07 sind erledigt. Phase 1 bleibt für breitere Grenzbereichs- und Eingabegeräte-Kalibrierung teilweise. Die übrigen 153 Anforderungen behalten ihren expliziten Status. Sämtliche 156 Originalpunkte stehen wortgleich in der Fortschrittsliste.

Aquaplaning und Pfützen sind effiziente Näherungen. Es gibt keine räumliche Strömungssimulation, stehenden Wasserpegel oder spiegelnde Wiedergabe ganzer Szenen. Bestehende direkte Lichter erzeugen Glanz auf dem glatteren Material. Showroom und als überdacht markierte Oberflächen bleiben trocken; echte neue Tunnel-/Garagendächer benötigen später eine passende Regensperre. Cockpitglas, Wischer und offene Fenster setzen die noch fehlenden Innenräume voraus. Phase 7 bleibt deshalb teilweise.

Die Browserprüfung nutzt Chromium mit Software-Rendering. Separate PCs, Mobilfunk/TURN, physische Controller und subjektives Hören wurden nicht abgenommen. Der Review nach review-agent ist eine Eigenprüfung des implementierenden Agenten, keine unabhängige Zweitprüfung.

Als Nächstes folgt Phase 3: Türen, Hauben, Glas, Leuchten, Befestigungen und weitere abfallende Teile samt mechanischen Folgen. Danach kommen Innenräume, Cockpit und Fahrer in Phase 4. Fehlendes Kompressortuning und Montage/Ausbau aus Phase 2 bleiben mit den entsprechenden späteren Phasen verknüpft. Der Gesamtauftrag bleibt aktiv.

## Fachliche Grundlage

Die qualitative Abhängigkeit von Tempo, Wasser und Profil folgt den Erläuterungen von [Continental zu Aquaplaning](https://www.continental-tires.com/ca/en/tire-knowledge/aquaplaning/) und [Michelin zu nassen Straßen](https://www.michelin.ca/en/auto/learn/driving-tips/driving-on-wet-roads). Die numerischen Koeffizienten stammen aus der Spielkalibrierung, nicht aus diesen Quellen.
