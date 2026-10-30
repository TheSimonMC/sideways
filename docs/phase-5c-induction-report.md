# V32: Phase 5C – Kompressor und Ladeluftkühlung

V32 schließt P02.05 und P05.04 ab; P06.03/P06.04 sind durch die Kompressordarstellung teilweise umgesetzt. Sideways hat jetzt 56 Teilekategorien. Die vier Fahrzeuge, acht Motoren, Karten, bestehenden Teile, Speicherbasis und SDK-Dateien bleiben erhalten. Phase 5 insgesamt ist wegen der noch fehlenden vollständigen Montage-/Ausbauintegration teilweise; das Gesamtziel bleibt aktiv.

## Tatsächliche Funktion

Street- und High-Output-Kompressoren passen auf die sieben bisher frei saugenden Motoren. Der I6 behält seinen Turbo und kann keinen zweiten Kompressor darüber montieren. Ein Motorwechsel ermöglicht die Kits in jedem der vier Fahrzeuge. Die Ziele liegen bei 0,45 beziehungsweise 0,80 bar; ECU-Upgrades erhöhen sie um 0,08/0,14 bar. Das sind Regelziele, keine garantierten Messwerte. Serien-, große und Competition-Ladeluftkühler ändern die native Wärmeabfuhr bei Turbo und Kompressor. Nicht aufgeladene Motoren können keinen wirkungslosen Kühler kaufen.

MotorLab berechnet Verdränger-Luftstrom, Gasdruck, Verdichterarbeit und Reibung. Die Welle bezahlt den Kompressorantrieb mit tatsächlicher Arbeit. Die Integration verwendet keinen pauschalen Leistungsmultiplikator. Ein rutschender Riemen senkt die Übersetzung und öffnet den Bypass; ein gerissener Riemen stoppt Rotoren, Luftförderung und Wellenarbeit. Ein festgegangener Kompressor belastet den gemeinsamen Zubehörriemen, erwärmt und verschleißt ihn. Lichtmaschine und Wasserpumpe verlieren dabei ebenfalls ihren Antrieb. Ein intakter oder reparierter Riemen stellt den Antrieb nur wieder her, wenn der Kompressor selbst intakt ist.

Kompressor und Ladeluftkühler haben eigene Gesundheit, Temperaturen, Kollisionsreaktionen, Warnungen und Einzelreparaturen. Die Gehäusetemperatur nutzt native Reibungsarbeit und einen Gas-/Gehäuse-Wärmeaustausch. Die Kühlerbilanz nutzt die tatsächlich abgeführte SDK-Wärme. Defekte Kühler reduzieren die native Kühlwirkung; heiße Luft unter Ladedruck belastet Kolben beziehungsweise Rotorabdichtungen. Rotorüberdrehzahl und heiße Lager beschädigen den Kompressor. Das zusätzliche Drehmoment erreicht das vorhandene Getriebe-/Wellen-Schadensmodell. Kitmasse und Einbauhöhe verändern Masse, Trägheit und Schwerpunkt.

Die native Boost-Audioquelle bleibt an denselben laufenden Motor gebunden. Riemengeräusch folgt dem Schlupf und seiner Verlustleistung. Die PCM- und manuelle Fortschreibung verwenden genau einen Motorzeitschritt. Reparaturen an Kompressor und Riemen setzen die laufende Motorzeit nicht zurück. Schäden und Besitz überleben Speichern, Fahrzeugwechsel und Neuladen.

## Sichtbare Technik und Garage

Alle vier bestehenden Karosserien erhalten passende Gehäuse, Rippen, Halter, Riemenscheiben, geschlossenen Riemenlauf, Schlauchwege und Kühlkern. Der flache Kitsune verwendet einen seitlich versetzten Kompressor. Die Scheibenradien entsprechen der eingebauten Übersetzung; die Animation liest tatsächliche Rotor-/Motordrehzahl. Ein gerissener Riemen verschwindet, während die Kurbelwelle weiterdrehen kann. Der Kühler zeigt seine Beschädigung. Diese Baugruppen sind noch nicht einzeln demontierbar.

Die beiden Kategorien zeigen eine Nahansicht innerhalb der vorhandenen Garagenfläche. Die Haube lässt sich mit dem bestehenden Knopf öffnen. Die Vorschau bewegt keinen vorgetäuschten laufenden Motor und zeigt den Zustand des ausgewählten Fahrzeugs. Abbruch kostet nichts. Kauf berechnet nur ungekaufte Teile und erhält vorhandene Schäden. Netzwerkprotokoll 21 überträgt begrenzte Auswahldaten und Rotor-/Riemenzustände im vorhandenen Strom. RATE_LIMIT-Coalescing und Nachrichtenraten bleiben erhalten; alle Spieler müssen V32 laden.

## Dateien und Prüfungen

Neu sind dist/forced-induction.js, induction-drive.js und induction-view.js. catalog.js, career.js und garage.js verbinden Auswahl, Preise und Kompatibilität. mechanical.js, engine-auxiliaries.js und physics.js verbinden tatsächlichen Antrieb, Schaden, Energie, Reparatur und Speicherung. audio.js berücksichtigt Riemenschlupf; car.js/main.js verbinden Geometrie und Nahansicht; multiplayer.js begrenzt die neuen Zustände. index.html, Workflow, README, Kontext und Checkliste kennzeichnen den Stand. qa/*v32* enthält die aktuellen Nachweise.

35 Suiten bestehen: 23 native/Build-Suiten und zwölf Browserabläufe. Der neue native Test misst alle sieben Saugmotoren mit intaktem, rutschendem, gerissenem und repariertem Riemen. Er prüft Kühlervarianten/-schaden, tatsächliche Wellenarbeit, Zustandskontinuität, Einzelreparatur, Speichern, Preise, Kompatibilität, Netzwerkgrenzen und den echten PCM-Pfad. Bestehende Fahrphysik-, Schaden-, Reifen-, Chassis-, Eingabe-, Karten-, Rennen-, Polizei-, Audio-, Cockpit-, Karosserie- und Netzwerktests bestehen ebenfalls.

Die gerenderten Motorraumtests decken alle vier Fahrzeuge ab; Screenshots wurden visuell geprüft. Riemenverlust verändert tatsächliche Bildpixel. Die Garagenansicht wurde bei 1280×800, 390×844 und 900×480 geprüft. Der vollständige Spieltest kauft Teile, bricht eine Vorschau ab, installiert erneut, lädt den Spielstand und fährt mit dem Kompressor in der Stadt. Zwei unabhängige Chromium-Prozesse treten einer echten öffentlichen PeerJS/WebRTC-Sitzung bei, tauschen Kompressor-Builds aus und treten erneut bei. Ein weiterer Test erzeugt Empfangsstaus auf beiden Seiten ohne RATE_LIMIT-Rauswurf.

Die kleine Motorraumszene benötigt über 40 aufgewärmte Frames mit GPU-Abschluss im Mittel 0,84 ms ohne Kit und 1,31 ms mit Kit. Das sind Software-Renderer-Messungen einer Testszene, keine Gesamtspiel-FPS-Garantie. HTML-Tests und Releaseprüfung sind über SHA-256 an die gelieferten Bytes gebunden.

## Grenzen und nächster Schritt

Die Integrationsschicht greift auf direkt gelesene Konfigurationswerte des gebündelten MotorLab 1.6.3 zu, weil dessen öffentliche Schnittstelle keinen Riemeneingang hat. Sie setzt diese nur um den vorhandenen nativen Update-/PCM-Schritt und stellt sie anschließend auch bei Fehlern wieder her. Gaszustände, Motordrehzahl, Zeit und Arbeitszähler werden nicht außerhalb des Solvers bearbeitet. Ein SDK-Update muss diese Abhängigkeit neu validieren.

Wärmekapazitäten, Riemenreibung und Verschleiß sind sparsame fiktive Näherungen. Der Kühler verwendet die native Wirkungsgrad-Näherung; vollständige Wärmestau-/Strömungssimulation und Bauteilverformung fehlen. Physische Wheels/FFB, mobile GPUs, getrennte PCs/TURN-Netze und subjektives Hören wurden nicht geprüft. Der sichtbare Grundmotor ist weiterhin einfach; vollständige modellgerechte Nebenaggregate und Montagepunkte gehören zu Phase 6.

Als Nächstes folgt Phase 6: einzelne Komponenten aus-/einbauen, ihre Masse und Funktionsausfälle berücksichtigen und den gesamten Motorraum passend zum Fahrzeug und Motor ausarbeiten. Räumliche Garagenübergänge bleiben in ihrer späteren Phase. Die früheren teilweise erfüllten Anforderungen und Phasen 7–18 bleiben vollständig in der Checkliste erhalten.
