# SIDEWAYS V22 – Phase 2C: Motor-Nebenaggregate und Elektrik

V22 ergänzt sechs eigene Bauteilzustände: Antriebsriemen, Riemenspanner, Lichtmaschine, Batterie, Starter und Kühlerlüfter. Die Batterie besitzt zusätzlich einen getrennten Ladestand. Die vorhandenen vier Fahrzeuge, Maps, Tuningteile, Speicherstände, Schadenssysteme und der native Motor-Solver bleiben erhalten.

## Funktion

Die Lichtmaschine liefert abhängig von Drehzahl, Riemenantrieb und Zustand Strom. Ihre Leistungsabgabe belastet die Kurbelwelle. Bordnetz, Licht, Lüfter und Starter verbrauchen Ladung; Strom wird in Amperestunden integriert. Der Batteriezustand beeinflusst Kapazität und Innenwiderstand. Spannung entscheidet über Startfähigkeit, Zündung, Lichtstärke und Lüfterleistung. Ein schwacher Starter dreht den nativen Motor langsamer, ein ausgefallener Starter gar nicht. Die Diagnose unterscheidet eine leere von einer beschädigten Batterie.

Ein gerissener Riemen stoppt Generator und Wasserpumpenantrieb. Verschlissene Spanner und schwergängige Nebenaggregate verursachen Schlupf, Wärme und Riemenverschleiß. Der temperaturgesteuerte elektrische Lüfter fällt bei Beschädigung aus; Fahrtwind kühlt weiterhin. Langes Orgeln heizt den Starter und kann ihn beschädigen. Zentrale Frontkollisionen treffen die dort angeordneten Aggregate. Lüfter- und Riemengeräusch folgen diesen Zuständen und dem mechanischen Audioregler.

In Vehicle Condition stehen Einzelersatz und CHARGE getrennt zur Verfügung. Laden heilt keine Bauteile. Riemenwechsel repariert keinen Spanner; Lüfterwechsel keine Lichtmaschine. Recovery, Umbau und Speichern behalten den Zustand. Eine nicht startfähige Elektrik wird beim Wiederherstellen nicht durch den vorhandenen warmen Motorzustand umgangen. Ein neuer Lauf repariert das Auto wie zuvor.

## Geänderte Systeme

- `dist/engine-auxiliaries.js`: Zustände, elektrisches Netz, Generator-/Starterwirkung, Wärme/Verschleiß und Einzelservice.
- `dist/mechanical.js`: Mechanical-Version 5, Kühlfluss, Schäden, Diagnose, Warnungen und Speicherung.
- `dist/physics.js`: native Starter-/Zündungsanbindung, Generatorlast, Wärmeabgrenzung und Wiederherstellung.
- `dist/main.js`, `dist/vehicle-panel.js`: Verbraucher-Eingabe, Startanzeige, Diagnose und Ladestanddarstellung.
- `dist/car.js`, `dist/environment.js`, `dist/audio.js`: Spannung an Leuchten und Lichtkegeln; Lüfter-/Riemenklang.
- Versions-, Build-, Dokumentations- und QA-Dateien für V22; SDK und Multiplayer-Protokoll unverändert.

## Nachweise

Alle 33 aktuellen funktionalen Suiten bestehen. Dazu gehören die 14 etablierten Regressionen sowie native Antriebs-, Kontakt-, Aero-, Reifen-, Brems-, Fahrwerks-, Elektrik- und Multiplayerprüfungen. Acht Browserabläufe verwenden die endgültige HTML-Datei, darunter das vollständige Zweispieler-Spiel. Ein zusätzlicher WebRTC-Modultest prüft 7,5 Sekunden Rückstau auf Host- und Gastseite. Neue Elektrik-Prüfungen bestätigen Save/Reload, Tuning ohne Heilung, Neustart und Diagnose; die Einzelserviceknöpfe werden zusätzlich mit originalem Panel und nativer Physik in einem separaten Harness geprüft. Dieser prüft weder die Fahrt zur Werkstatt noch den Hauptcontroller-Service-Timer. Keine JavaScript-Fehler oder unerwarteten Netz-/Dateizugriffe in den Offline-Abläufen. Dateihashes und einzelne Nachweise: qa/release-v22.json.

Lokale CPU-Stichprobe mit jeweils 1.200 Schritten nach 120 Warm-up-Schritten: V22 RWD 1,92/2,10 ms im Mittel (Ebene/Hang), FWD 2,22/2,20 ms, AWD 2,06/2,11 ms. V21 bei denselben RWD-Eingaben: 2,15/2,29 ms. Ein nativer Motor, ein Chassis und synthetischer Bodensampler; GPU, Welt, KI und Audio sind ausgeschlossen. Das ist keine FPS-Garantie. Details: qa/chassis-performance-v22-results.json.

Die native Zusatzsuite prüft unter anderem alle vier Starter, Strom-/Ladungsbilanz, schwachen Starter, Stromausfall, Einzelreparaturen, Speichern/Recovery, Lüfterausfall, Riemenverschleiß, Diagnose und tatsächliche Leuchtenmaterialien. Ein kontrollierter Kühlversuch verwendet bei 1.800 rpm 30 kW Wandwärme und 5 kW Reibwärme, je 180 Sekunden. Das ist ein Vergleich mit definierten Eingaben, kein gemessener Leerlauf eines realen Autos.

## Grenzen und offene Anforderungen

Die vier fiktiven Fahrzeuge teilen eine vereinfachte 12-V-/60-Ah-Architektur mit riemengetriebener Pumpe und Lichtmaschine. Starterstrom und Last sind konzentrierte Näherungen; kein vollständiges Batteriechemie-, Kabel-, Sicherungs-, Erregerstrom- oder Stromkreisnetz. Der Generatorzustand fasst elektrische und mechanische Beeinträchtigung zusammen. Workshop-Laden ist zeitlich verkürzt. Die Lüfter-/Riemenwärme nutzt feste Kapazitäten. Kleine Kopplungsabweichungen zwischen elektrischem Modell und nativen Motor-Substeps werden nicht als streng geschlossene Energiebilanz ausgegeben.

Laden/Entladen läuft während aktiver Fahrphysik. Menüs, Pause und Werkstatt stoppen diese Simulation wie bisher. Remote-Autos erhalten weiterhin keine vollständigen einzelnen Elektrikzustände. Es gibt noch keinen sichtbaren Motorraum mit Riemen, Lüfter und Generator; dieser bleibt Phase 6. Die neuen Zustände bilden dafür eine funktionierende Grundlage. Kein separates reales Fahrzeug, physischer Controller, subjektiver Hörtest oder Netzvergleich über Mobilfunk/TURN wurde geprüft.

Bearbeitet wurden P02.01/P02.05–P02.07/P02.11/P02.12 sowie zugehörige Diagnose-, Audio- und Prüfpunkte. Sie bleiben teilweise, weil weitere Motorbauteile und die übergreifende Integration fehlen. Alle 156 Originalanforderungen sind unverändert in der Fortschrittsliste enthalten. Phase 0 ist erledigt; Phase 1/2 bleiben teilweise. Bereits erfüllte P02.09/P02.10 bleiben erhalten.

Als Nächstes folgt Phase 2D: Block/Kopf und Kolben/Pleuel genauer trennen, Ansaug-/Auspuffschäden und Steuertrieb/weitere relevante Aggregate. Danach weitere modulare Karosserieschäden aus Phase 3, anschließend Innenräume/Cockpit/Fahrer nach Dokumentreihenfolge.

## Technische Grundlage

Die Zusammenhänge zwischen Riemenspannung, Schlupf, Ladeleistung und Aggregatbelastung orientieren sich an [Gates' Hinweisen zum Riemenspanner](https://www.gates.com/content/dam/gates/home/knowledge-center/resource-library/tech-tips-bulletins/tt004-15.pdf). Die Unterscheidung von Batteriezustand, Ladespannung und Generatorfehlern folgt den Diagnoseprinzipien von [DENSO](https://www.denso-am.eu/news/alternator-troubleshooting). Sämtliche Fahrzeugparameter, Schwellen und Verschleißraten sind eigene Spielkalibrierungen.

Der historische V16-Trajektorienvergleich berücksichtigt jetzt die neue Generatorlast: maximal 8 cm Positionsabweichung und 1% RPM nach zwei Sekunden; die anderen Grenzen bleiben unverändert. Gemessen wurden maximal 5,3 cm und 31 rpm. Die zusätzliche Generatorlast wird dabei ausdrücklich auf einen positiven Wert geprüft.
