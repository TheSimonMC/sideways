# SIDEWAYS V23 – Phase 2D

V23 ergänzt zehn getrennte Motorbauteile. Block, Zylinderkopf, Pleuel, Kurbelwelle, Steuerkette, Ansaugung, Auspuff, Thermostat, Kraftstoffpumpe und Zündung besitzen eigene Zustände und gezielte Reparaturen. Fahrzeuge, Karten, Speicherstände, Cartoon-Stil und MotorLab bleiben erhalten.

## Verhalten

Ein beschädigter Ansaugtrakt begrenzt die Luftzufuhr und das Ladedruckziel im nativen Motor. Eine schwache Kraftstoffpumpe erzeugt ein magereres Gemisch; ihr Ausfall unterbindet die Verbrennung. Zündungsschäden verursachen zylinderweise Aussetzer. Ein verengter Auspuff belastet die Kurbelwelle. Ansaug- und Abgasleckgeräusch folgen Drehzahl, Zustand und dem mechanischen Lautstärkeregler.

Block und Kopf können Flüssigkeit verlieren. Ein klemmendes Thermostat führt bei anhaltender Last zu Überhitzung und Folgeschäden. Überdrehen, Ölmangel und Überlast treffen Pleuel, Kurbelwelle und Kette getrennt. Eine ausgefallene Kette kann Ventile und Kolben beschädigen, ein gebrochenes Pleuel den Block. Kühler-, Thermostat- oder Kettenersatz lässt diese Schäden und verlorene Flüssigkeiten bestehen. Warnungen und bestehende Rauch-/Dampf-/Klopfpfade verwenden die tatsächlichen Komponentenzustände.

Der Wankelmotor zeigt Gehäuse und Exzenterwelle; Pleuel, Ventile und Kette sind dort inaktiv. Ein Motorumbau behält deren gespeicherten Zustand für einen späteren Rückbau. Die Migration erzeugt bei einem Kettenfehler keinen zusätzlichen Kolbenschaden. Laden, Recovery und Tuning umgehen weder Pumpen- noch Zündungsausfall durch einen warmen Motorzustand. Ein neuer Lauf repariert das Auto wie bisher.

## Dateien und Prüfungen

- `dist/mechanical.js`: Schema 6, Komponenten, Fehlerursachen, Wärme-/Leckfolgen, Diagnose, Einzelreparatur und Migration.
- `dist/physics.js`: native Luft-/Gemisch-/Zündungs- und Lastanbindung, Starter-/Warmstartprüfung und Verlustarbeit.
- `dist/audio.js`: gefilterte Ansaug-/Abgasleckgeräusche und korrektes Zurücksetzen.
- `dist/main.js`, `dist/index.html`, Pages-Workflow: V23-Kennung und Veröffentlichung der geprüften HTML-Datei.
- `qa/*v23*`, Fortschrittsliste, Kontext, README und dieses Protokoll: reproduzierbare Nachweise und offener Umfang.

Alle 35 funktionalen Suiten bestehen: 14 etablierte Regressionen, elf weitere native/Build-/Abdeckungsprüfungen und zehn Browserabläufe. Neun Browserabläufe verwenden die endgültige HTML-Datei, darunter das vollständige Zweispieler-Spiel. Ein zusätzlicher WebRTC-Modultest prüft 7,5 Sekunden Rückstau auf Host- und Gastseite. Die neue Motorprüfung umfasst zehn Gruppen für Migration, Wankel/Motorumbau, Starter-/Verbrennungsausfall, Ansaugung/Gemisch/Abgaslast, Lecks, Überhitzung, Steuertrieb, Kollision und PCM. Die allgemeinen Browserprüfungen bestätigen auch Neustart, Escape, Tuning und Speichern. Die Offline-Abläufe melden keine JavaScript-Fehler oder unerwarteten Netz-/Dateizugriffe. Dateihashes und Nachweise: qa/release-v23.json.

Der Thermostatvergleich speist über 600 simulierte Sekunden bei 2.387 rpm und 25 m/s definierte 60 kW Wand- und 15 kW Reibwärme ein. Gesunder Fall: rund 108,6 °C. Ausgefallenes Thermostat: rund 210,2 °C und Kopfzustand rund 55%. Das sind kontrollierte Spieleingaben; keine Messwerte eines realen Fahrzeugs. Die frühere 180-Sekunden-Prüfung war zu kurz für den erwarteten Folgeschaden, weil kochendes Kühlmittel zunächst Wärme abführt. Der Test wurde auf die vollständige Folgekette verlängert.

Lokale CPU-Stichprobe mit je 1.200 Schritten nach 120 Warm-up-Schritten: V23 RWD 1,66/1,85 ms im Mittel (Ebene/Hang), FWD 1,84/1,95 ms, AWD 1,82/1,81 ms. V22 bei denselben RWD-Eingaben: 1,82/1,80 ms. Ein nativer Motor, ein Chassis und synthetischer Bodensampler; GPU, Welt, KI und Audio sind ausgeschlossen. Keine FPS-Garantie. Details: qa/chassis-performance-v23-results.json.

## Grenzen und nächste Arbeit

Die Komponenten verwenden gemeinsame Motor-/Öl-/Kühlmitteltemperaturen und fiktive Verschleißraten. Die Steuerkette erzeugt Aussetzer und Ventilfolgeschaden ohne neue Zahn-für-Zahn-Simulation. Abgasverengung nutzt den nativen Kurbelwellenlastkanal; keine veränderte 3D-Rohrströmung. Ihre abgeführte Arbeit wird nicht zusätzlich als Motor-/Ölreibwärme gezählt. Ansaugung und Auspuff fassen Verformung und Undichtigkeit zusammen. Im Teilekatalog gibt es noch keinen Kompressor; dessen Tuning/Einbau bleibt offen. Sichtbarer Motorraum und Ausbau wichtiger Teile folgen in Phase 6.

Die Browserprüfung deckt Speichern, echten Tuningkauf, Reload, Neustart, Escape und Diagnose in der endgültigen HTML ab. Einzelserviceknöpfe werden zusätzlich mit originalem VehiclePanel und CarPhysics in einem lokalen Modulaufbau betätigt. Werkstattfahrt und Hauptcontroller-Reparaturtimer sind damit nicht vollständig geprüft. Multiplayer wird mit zwei lokalen Browserprozessen und öffentlichem PeerJS/WebRTC geprüft; separate PCs und restriktive NAT/TURN-Netze sind nicht belegt. Keine subjektiven Hörtests oder echten Lenkradcontroller.

Phase 2D ist umgesetzt. P02.07/P02.08/P02.11/P02.12 werden aufgrund der thermischen, Antriebs-, Diagnose-, Einzelservice- und Speicherprüfungen als erledigt geführt. P02.01/P02.05/P02.06 bleiben teilweise für Kompressortuning und die späteren Montage-/Ausbauverbindungen. Alle 156 Originalanforderungen bleiben in der Checkliste. Zuerst folgen die offene Nässe-Anbindung und Fahrkalibrierung aus Phase 1, anschließend Phase 3 mit Türen, Hauben, Scheiben, Leuchten und weiteren abfallenden Teilen. Innenräume, Fahrer, Garage, Welt und die restlichen Phasen bleiben im Gesamtziel.

Die Schadensketten orientieren sich an den beschriebenen Zusammenhängen von Überhitzung, Schmierung und Ventilkontakt in [Motorservices Schadensdiagnose](https://www.ms-motorservice.com/MediaAssets/piston-damage-recognising-and-rectifying_51730.pdf). [Gates](https://www.gatestechzone.com/gb/en/technical-section/problem-diagnosis-overview.html) beschreibt die getrennte Diagnose von Steuertrieb, Nebenaggregaten und Kühlkomponenten. Die verwendeten Zahlen sind eigene Spielkalibrierungen.
