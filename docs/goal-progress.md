# SIDEWAYS – verbindliche Fortschrittsliste

Stand: V32, Phase 0, Phase 1 Teile A/B/C/D/E, Phase 2 Teile A/B/C/D und Phase 3 Teile A/B/C/D sowie Phase 4 und Phase 5 Teile A/B/C. Grundlage: unveränderte Kopie in `docs/goal.txt`.

Status bezieht sich auf den gesamten Wortlaut eines Punktes. Teilweise bedeutet, dass wesentliche Teile noch fehlen. Phase 0, Phase 3 und Phase 4 sind innerhalb der dokumentierten Browser-Näherungen abgeschlossen. V19 ergänzt die gemeinsame Reifen-Grundlage aus Phase 2 und ihre Folgen für Phase 1. V24 schließt die Nässe-Anbindung. Phase 1 bleibt für breitere Grenzbereichs- und Eingabegeräte-Kalibrierung teilweise; Phase 2 wegen der noch fehlenden vollständigen Montage-/Ausbauintegration. Die umfassende Wetterdarstellung wird in Phase 7 weitergeführt.

Die Referenzdatei hat SHA-256 `4baa27bd5a4d96ab40582166e0fd6095b803dc262f6140dc282ea844a1b96dca`.

## Phase 0: BESTANDSAUFNAHME UND SICHERE ERWEITERUNG

**erledigt** — Quellcode und V14-Basis untersucht; Systemübersicht in phase-0-bestandsaufnahme.md. Fahrzeugdaten bleiben identisch. Catalog/Condition/MechanicalSystem bleiben die gemeinsame Datenbasis; die neue Fahrwerksdefinition ergänzt sie.

- **P00.01 · erledigt** — Vorhandene Fahrzeugphysik, Renderer, Szenen, Kamera, Eingabesysteme, Garagen, Service, Tuning, Weltgenerierung, Verkehr, Audio, Speicherlogik und Assets untersuchen.
- **P00.02 · erledigt** — Auflisten, welche Systeme schon existieren und wo die Erweiterungen anschließen.
- **P00.03 · erledigt** — Vorhandene Fahrzeugspezifikationen und Modelle nicht versehentlich überschreiben.
- **P00.04 · erledigt** — Eine gemeinsame Datenbasis für Fahrzeugkomponenten, Schäden, Temperaturen, Tuning, Animationen und Persistenz vorsehen.
- **P00.05 · erledigt** — Falls nötig, kleine aufeinander abgestimmte Daten- und Codeänderungen vornehmen, statt alles umzubauen.

## Phase 1: REALISTISCHERE FAHRPHYSIK

**teilweise erledigt** — V15: teileabhängige Lenkung, Reifen und Stabilisatoren statt freier Physikmodi/künstlicher Gierhilfe. V16: Hang-/Kontaktkräfte und einzelne Federwege. V17: FWD/RWD/AWD, Differenziale, thermische Arbeit, Schaden, Einzelreparatur und Persistenz. V18 Teil D: geschwindigkeitsabhängige Kräfte von Spoiler, Splitter und Diffusor, drei GT-Flügelstellungen sowie beschädigungsabhängiger Abtrieb. Ein aus tatsächlicher Reifenschlupfarbeit gespeistes Wheel-Hop-Modell verändert Radlasten und Kontakt; verstärkte Achsführungen reduzieren die Schwingung. Die vier Serienautos bleiben RWD. Vergleichsfahrten bleiben innerhalb dokumentierter kleiner Toleranzen; wegen der neuen Transienten wird keine numerische Identität behauptet. V19 ergänzt vier Druck-/Karkassenzustände, gerichtete Flatspots und überlastabhängige Reifenplatzer mit Folgen für Radius, Kontakt, Seitenführung und Rollwiderstand. V24 ergänzt Regen, Benetzung/Trocknung, materialabhängige Nasshaftung, Pfützen und radweises Aquaplaning nach Tempo, Profil, Druck und Mischung. Alle vier Autos bestehen Trocken-/Nass-Brems- und Lenkvergleiche; bestehende Serien-/Drift-/Antriebsprüfungen bleiben bestehen. Breitere Grenzbereichs- und Eingabegeräte-Kalibrierung bleibt offen. Heightfield-Chassis, endliche Antriebsbedingungen und der reduzierte Hop-Modus ersetzen keine vollständige 6-DOF-/Fahrwerkssimulation. Die neuen Reifeneffekte sind eine effiziente Näherung mit fiktiven Spielkoeffizienten.

- **P01.01 · teilweise erledigt** — Der Serienzustand eines Fahrzeugs soll ein nachvollziehbares, deutlich weniger arcade-lastiges Fahrverhalten haben. Serienfahrzeuge dürfen nicht ständig von selbst driften.
- **P01.02 · teilweise erledigt** — Reifenkräfte mit sanftem Übergang zwischen Haftung und Rutschen; realistisches Untersteuern und Übersteuern.
- **P01.03 · teilweise erledigt** — Gewichtstransfer beim Beschleunigen, Bremsen, Lastwechsel und Kurvenfahren; Federweg, Dämpfung, Body Roll, Wanken und Nicken.
- **P01.04 · teilweise erledigt** — Fahrverhalten soll von Gewicht, Schwerpunkt, Radstand, Antrieb (FWD/RWD/AWD), Reifen, Fahrwerk, Leistung, Differenzial und Lenkgeometrie abhängen.
- **P01.05 · teilweise erledigt** — Realistischere Lenkübersetzung, Lenkwinkel, Rückstellverhalten, Reaktion auf hohe Geschwindigkeiten und unterschiedliche Eingabegeräte.
- **P01.06 · teilweise erledigt** — Motorbremse, realistische Bremswege, Traktionsverhältnisse, Wheelspin, Wheel Hop, Kupplungs-/Getriebeträgheit, Differenzialwirkung, Luftwiderstand und aerodynamischer Abtrieb.
- **P01.07 · erledigt** — Bodenwellen, Schlaglöcher, Bordsteine, Unebenheiten, Nässe und verschiedene Oberflächen wirken sich auf die Räder aus.
- **P01.08 · erledigt** — Reifenverschleiß und Temperatur wirken sich auf Haftung und Fahrverhalten aus.
- **P01.09 · erledigt** — Drift-, Street-, Sport- und Track-Setups entstehen aus tatsächlichen Teilen wie Lenkwinkel-Kits, Differenzialen, Stabis, Fahrwerken, Reifen und Achsvermessung. Nicht aus einem Arcade/Balanced/Realistic-Schalter in den Settings.
- **P01.10 · teilweise erledigt** — ABS, Traktionskontrolle oder Stabilitätskontrolle dürfen als reale fahrzeugspezifische Hilfen existieren, aber keine getrennten Physikmodi ersetzen.
- **P01.11 · teilweise erledigt** — Physik weiterhin beherrschbar und spaßig halten. Die Fahrzeugtypen sollen sich klar voneinander unterscheiden.

## Phase 2: EINZELNE MECHANISCHE SCHÄDEN, TEMPERATUR UND VERSCHLEISS

**teilweise erledigt** — V23 ergänzt Block/Kopf, Pleuel, Kurbelwelle, Steuerkette, Ansaugung, Auspuff, Thermostat, Kraftstoffpumpe und Zündung. Luftzufuhr, Gemisch, Verbrennung, Kurbelwellenlast, Wärme, Lecks, Fehlzündungen und Geräusche folgen getrennten Zuständen. Ölverlust/Überdrehen schädigen Kurbeltrieb und Kette; eine ausgefallene Kette kann Ventile beschädigen. Beim Wankel gelten Gehäuse und Exzenterwelle; Pleuel und Ventilsteuertrieb sind nicht verbaut. V21/V22-Systeme bleiben erhalten. P02.07/P02.08/P02.11/P02.12 sind durch thermische, Antriebs-, Diagnose-, Reparatur- und Speicherprüfungen nachgewiesen; P02.02–P02.04/P02.09/P02.10 bleiben erfüllt. V32 ergänzt separate Kompressor-/Ladeluftkühlerzustände und schließt P02.05 ab. P02.01/P02.06 bleiben für die vollständige Verbindung zu sichtbaren Befestigungen und ausgebauten Teilen in Phase 6 teilweise. Alle verbauten Motorarten sind in der mechanischen Näherung abgedeckt.

- **P02.01 · teilweise erledigt** — Weg vom einzigen allgemeinen Auto-Health-Wert als Schadensquelle. Jede wesentliche Baugruppe erhält einen eigenen Zustand, Verschleiß und bei Bedarf Temperatur, Belastung und Ausfallart.
- **P02.02 · erledigt** — Vier unabhängige Reifen: Temperatur, Luftdruck, Reifenmischung, Abrieb, Gripverlust, Flatspots, Platten, Beschädigung und Blowout.
- **P02.03 · erledigt** — Längere Burnouts oder dauerhaft hohe Schlupfwerte erhitzen die Reifen. Nach nachvollziehbarer Überlast können sie einzeln platzen. Reaktion: plötzlicher Druckverlust, veränderte Seitenführung, Fahrwerks-/Lenkreaktion, Geräusch und Partikeleffekte.
- **P02.04 · erledigt** — Rauchmenge hängt von Radschlupf, Temperatur und Oberfläche ab. Nicht jeder Reifen platzt nach einer festen Zeit unabhängig von den Umständen.
- **P02.05 · erledigt** — Motor separat: Block, Kolben/Pleuel, Kurbeltrieb, Zylinderkopf, Dichtung, Ölkreislauf/Öldruck, Kühler/Kühlmittel, Lüfter, Ansaugung, Auspuff, Turbo/Kompressor, Riemen, Lichtmaschine und relevante Nebenaggregate.
- **P02.06 · teilweise erledigt** — Schaden durch Überdrehen, schlechte Kühlung, Ölverlust, Überlast, Kollisionen und lange Überhitzung. Folgen: Leistungsverlust, ungewöhnliche Geräusche, Fehlzündungen, Rauch, Ruckeln, Klopfen, Lecks und schlimmstenfalls Motorausfall.
- **P02.07 · erledigt** — Beschädigter Kühler verursacht Kühlmittelverlust und steigende Motortemperatur; falsches Weiterfahren kann Folgeschäden erzeugen.
- **P02.08 · erledigt** — Kupplung: Verschleiß, Hitze, Schlupf, verringerte Kraftübertragung bis zum kompletten Ausfall. Getriebe: Schäden durch Überlast und schlechte Schaltvorgänge, mögliche Gangprobleme. Differenzial und Antriebswellen ebenfalls getrennt.
- **P02.09 · erledigt** — Bremsen pro Rad: Verschleiß, Temperatur, Fade, beschädigte Leitungen/Komponenten, ungleichmäßige Bremswirkung, Ausfall; heißer Bremsscheiben-Glow bei passender Temperatur.
- **P02.10 · erledigt** — Fahrwerk, Lenkung, Radlager und Aufhängungen können nach Unfällen falsch ausgerichtet, beschädigt oder zerstört sein.
- **P02.11 · erledigt** — Warnanzeigen und Diagnose zeigen echte Zustände. Reparatur ersetzt oder repariert die betroffene Komponente, nicht immer das gesamte Auto.
- **P02.12 · erledigt** — Teileschäden, Temperaturen und Verschleiß dürfen nach dem Verlassen des Fahrzeugs oder der Garage nicht grundlos verschwinden.

## Phase 3: VERFORMUNG UND ABFALLENDE FAHRZEUGTEILE

**erledigt** — V25 trennt Türen, Haube und Kofferraum aus den vier vorhandenen Hüllen. Scharniere, Schlösser und Befestigungen bestimmen Bewegung und Ablösen. Eine offene Tür kann außerhalb des normalen Fahrzeugumrisses an einem Hindernis hängen bleiben. Garagenknöpfe bedienen die montierten Teile, Position und Schaden werden gespeichert; gezielte Reparatur stellt das gewählte Teil wieder her. Abgefallene Teile zeigen ihre tatsächlichen Meshes, verändern Masse/Achslasten/Schwerpunkt/Trägheit und laufen in einem auf acht Teile und 24 Sekunden/180 Meter begrenzten Trümmermodell mit Boden-/Wandkontakt. Offene/fehlende Türen verändern Wind und Luftwiderstand. Multiplayer zeigt geöffnete/fehlende/verformte Teile. V26 ergänzt 20 einzelne Exterieurkomponenten, Kratzer und Glasrisse, durchsichtige Scheiben, begrenzte Glassplitter, seitengenaue Lampenausfälle samt Lichtkegel und Einzelreparatur. Unterteile hängen an ihren Baugruppen; Masse wird bei gemeinsamem Verlust nicht doppelt abgezogen. V27 ergänzt räumliche Boxkontakte für Türen, Haube und Kofferraum einschließlich der Bewegung zwischen zwei Stellungen. Trümmer rollen, gleiten und prallen an vorhandenen statischen Formen ab; lose Räder koppeln Drehung und Geschwindigkeit über Reibung, folgen der Hangneigung und kippen bei geringer Geschwindigkeit. Bestehende Hindernisse erhalten zu ihren Meshes passende Höhen, Brückenleitplanken zusätzlich Neigung. V28 ergänzt vier Querlenker, vier Federbeine, zwei Spurstangen und drei zusammenhängende Auspuffabschnitte. Die Baugruppen besitzen begrenzte Befestigungs-, Quetsch- und Biegezustände; ihre tatsächlichen Meshes fallen ab. Fehlende Lenker/Federbeine nehmen Radabstützung weg, eine fehlende Spurstange trennt das Rad vom Lenkbefehl. Fehlende Räder und Baugruppen ändern Masse/Achslasten. Gequetschte Rohre belasten den Motor; abgerissene Rohre öffnen den Abgasweg früher und ändern Quelle/Leckgeräusch. Diagnose, Einzelreparatur, Speicherung und Übertragung sind angebunden. V28 ist mit den im Phasenbericht genannten Prüfungen nachgewiesen. Lose Trümmer bleiben lokal und kollidieren nicht untereinander. Kollisionsformen sind effiziente Box-/Radnäherungen, keine volle Soft-Body- oder Mehrkörpersimulation.

- **P03.01 · erledigt** — BeamNG-inspirierte modulare Kollisionen, soweit in der Browser-Engine sinnvoll.
- **P03.02 · erledigt** — Einzelteile: Türen, Motorhaube, Kofferraum, Stoßstangen, Lippe/Splitter, Seitenschweller, Spoiler, Diffusor, Kotflügel, Spiegel, Grill, Scheinwerfer, Rückleuchten, Auspuff, Scheiben, Felgen/Räder und Fahrwerksteile.
- **P03.03 · erledigt** — Treffpunkt, Aufprallrichtung, Energie und Bauteilbefestigungen bestimmen Schaden: Kratzer, Risse, Verformung, lockere Befestigung, Funktionsausfall, Abreißen.
- **P03.04 · erledigt** — Abfallende Teile werden kurzzeitig physikalische Objekte mit Kollision, Reibung, Rollen und Rutschen. Performancebewusst nach Entfernung/Lebensdauer aufräumen.
- **P03.05 · erledigt** — Motorhaube und Türen können geöffnet, beschädigt und gelöst werden; offene Teile sollen sich mechanisch glaubwürdig bewegen.
- **P03.06 · erledigt** — Zerbrochene Scheiben, kaputte Leuchten, defekte Kühler und verbogene Fahrwerksteile beeinflussen die restlichen Systeme.
- **P03.07 · erledigt** — Sichtbare Schäden müssen an der getroffenen Fahrzeugseite entstehen und nach Möglichkeit erhalten bleiben.
- **P03.08 · erledigt** — Keine volle Soft-Body-Simulation erzwingen, wenn eine modulare, lokale Deformation mit passenden Kollisionspunkten besser läuft.

## Phase 4: ECHTE FIRST-PERSON-KAMERA UND INNENRÄUME FÜR JEDES FAHRZEUG

**erledigt** — V29 ergänzt die vier vorhandenen Autos um passende Innenräume, Cockpitkamera, echte Anzeigen, Radio-Navigation, Spiegel und Fahrer. Sitz/FOV/Bewegung, Lenkrad-/Arm-Sichtbarkeit und Hardware-Lenkwinkel werden gespeichert. Tag/Nacht, Bedienung, alte Kameras, Schaden/Reparatur, Eingaben und Multiplayer wurden auf dem finalen Build geprüft. Spiegel und Fahrer verwenden die im [Phasenbericht](phase-4-cockpit-report.md) benannten Browser-Näherungen. Physische Wheel-Hardware und mobile GPUs wurden nicht abgenommen.

- **P04.01 · erledigt** — Eine neue, nutzbare Cockpitkamera für jedes spielbare Fahrzeug; passende Augenposition, einstellbare Sitzposition, Blickbewegung und korrektes Sichtfeld.
- **P04.02 · erledigt** — JEDES bestehende spielbare Fahrzeug bekommt einen zum Modell passenden sichtbaren Innenraum. Gemeinsame Bauteile dürfen wiederverwendet werden, aber nicht einfach derselbe generische Innenraum für alle.
- **P04.03 · erledigt** — Je nach Fahrzeug: Dashboard, analoge oder digitale Instrumente, Lenkrad, Sitze, Rücksitze, Pedale, Ganghebel, Handbremse, Mittelkonsole, Türverkleidungen, Spiegel, Dachhimmel, Innenbeleuchtung, Radio/Infotainment und passende Materialien.
- **P04.04 · erledigt** — Kein dauerhaft schwebender HUD-Tacho in der Cockpitansicht. Das tatsächliche Cockpit-Instrument zeigt Geschwindigkeit, Drehzahl, Gang, Tank, Temperaturen und Warnleuchten korrekt an. Nadel und Anzeigen reagieren ohne sinnlose Verzögerung.
- **P04.05 · erledigt** — Third-Person darf optional eine kleine, abschaltbare Geschwindigkeitsanzeige behalten, wenn sie für die Spielbarkeit benötigt wird.
- **P04.06 · erledigt** — Navigation und Karte in ein tatsächlich sichtbares Display am Radio/Infotainment einbauen, mit Routenanzeige, Position und Musiksteuerung. Für ältere Autos sinnvoller externer Navi-Halter statt unpassendem modernen Touchscreen.
- **P04.07 · erledigt** — Scheiben und Seitenscheiben sind durchsichtig. Man muss von außen Fahrer und Innenraum sehen können, abhängig von Spiegelungen, Licht und Tönung.
- **P04.08 · erledigt** — Innenspiegel und Seitenspiegel sollen brauchbare Ansichten bieten, ggf. mit performancegerechter Renderinglösung.
- **P04.09 · erledigt** — Ein sichtbarer Fahrer sitzt im Wagen, mit Kopf/Körper, Oberarmen, Unterarmen, Händen und Beinen. Hände greifen ans Lenkrad und folgen präzise der Lenkraddrehung, bei starken Winkeln mit sinnvoller Handbewegung.
- **P04.10 · erledigt** — Passende Animationen für Schalten, Handbremse und Pedalbedienung sowie subtile Körperreaktionen auf Beschleunigung, Bremsen, Schlaglöcher und Kurven. Keine Clipping-Arme im Dashboard.
- **P04.11 · erledigt** — Bei kompatiblen Lenkradcontrollern über verfügbare Browser-APIs nutzbare Achsen, Buttons, Kalibrierung, Deadzones und einstellbaren Lenkwinkel anbieten. Keine Funktionen behaupten, die der jeweilige Browser nicht bereitstellt.
- **P04.12 · erledigt** — Virtuelles Cockpit-Lenkrad für Wheel-Nutzer optional ausblenden. Arme/Hände bei Bedarf ebenfalls ausblendbar. Die Lenkung, Anzeigen und der restliche Innenraum funktionieren dabei weiter.

## Phase 5: MEHR EXTERIEUR-, INTERIEUR- UND MECHANISCHES TUNING

**teilweise erledigt** — V30/V31 liefern Exterieur, transparente Tönung und Innenraumteile. V32 ergänzt tatsächliche Kompressoraufladung und Ladeluftkühlung auf insgesamt 56 Kategorien. Native Gasförderung/Wellenarbeit, Riemenfehler, Wärme, Verschleiß, Sound, Kauf, Speichern und sichtbare Technik sind verbunden. P05.04 ist umgesetzt. Individueller Ausbau und vollständige Montage-/Abrisszustände für mechanische und Kabinenteile bleiben Phase 6. Die dazu fehlenden Zustände, Interaktionen und vollständigen Motorraumgeometrien sind noch zu bauen. [Bericht Phase 5C](phase-5c-induction-report.md).

- **P05.01 · erledigt** — Exterieurteile: unterschiedliche Front-/Heckstoßstangen, Spoiler, Splitter, Lippen, Schweller, Diffusoren, Kotflügel, Widebody-Kits, Hauben, Grills, Auspuffendrohre, Felgen, Reifen, Lichtdesign, Lacke, Folierungen und Decals.
- **P05.02 · erledigt** — Interieurteile: Lenkräder, Sportsitze, Schalensitze, Bezüge, Nähte, Farben, Dashboard-Dekore, Schaltknäufe, Handbremsen, Überrollkäfige, Gurte, Instrumente, Zusatzanzeigen und Ambientebeleuchtung.
- **P05.03 · erledigt** — Scheibentönung mit einstellbarer Stärke und richtiger Lichtdurchlässigkeit; von außen bei passenden Bedingungen weiterhin hineinschauen können. Keine undurchsichtige schwarze Fläche als Ersatz für Glas.
- **P05.04 · erledigt** — Leistungsupgrades: Motor/ECU, Turbo/Kompressor, Ansaugung, Auspuff, Kühler, Kupplung, Getriebe, Übersetzungen, Differentiale, Fahrwerk, Stabis, Achsgeometrie, Bremsen, Reifen und Aerodynamik.
- **P05.05 · teilweise erledigt** — Optische und mechanische Teile an echte Befestigungspunkte knüpfen, sodass sie bei Schaden abfallen und in der Garage ausgebaut werden können.
- **P05.06 · teilweise erledigt** — Upgrades haben echte Unterschiede und Nachteile: mehr Leistung bedeutet unter Umständen mehr Wärme/Stress; ein Rennfahrwerk kann auf Schlaglöchern schlechter sein; Drift-Reifen unterscheiden sich von Straßenreifen; Bremsen funktionieren je nach Temperatur anders.
- **P05.07 · teilweise erledigt** — Kompatibilität mit dem jeweiligen Fahrzeug prüfen, damit Teile nicht falsch positioniert sind.

## Phase 6: INTERAKTIVE GARAGE UND SICHTBARER, BEWEGLICHER MOTOR

**teilweise erledigt** — V25 ermöglicht das Öffnen und Schließen von Türen, Haube und Kofferraum in der bestehenden Garage. V29 liefert die Innenräume. V32 ergänzt sichtbare Kompressoren, Scheiben, Riemen, Schlauchwege und Ladeluftkühler sowie tatsächliche Rotor-/Kurbelwellenanimation. P06.03/P06.04 sind damit teilweise. Vollständige motorabhängige Geometrien, Lüfter-/Nebenaggregatanimation und gezielter Ausbau/Einbau fehlen weiterhin. Räumliche Werkstattübergänge bleiben in ihrer späteren Phase.

- **P06.01 · teilweise erledigt** — In der bestehenden Garage mit dem Fahrzeug interagieren: Haube öffnen, Türen öffnen, Räder, Stoßstangen, Spoiler, Motorraumteile und andere Komponenten gezielt aus- oder wieder einbauen.
- **P06.02 · offen** — Ausbau verändert das Fahrzeug sofort sichtbar und, sofern relevant, physikalisch. Ohne Räder, Kühler oder andere wichtige Komponenten kann nicht normal gefahren werden.
- **P06.03 · teilweise erledigt** — Unter der geöffneten Haube muss ein echter, zum jeweiligen Fahrzeug passender Motorraum zu sehen sein, inklusive Motor, Kühler, Schläuchen, Ansaugung, Lüfter, Lichtmaschine, Antriebriemen und Riemenscheiben sowie bei passendem Fahrzeug Turbo/Kompressor.
- **P06.04 · teilweise erledigt** — Rotoren, Riemen und Riemenscheiben werden durch tatsächliche Motor-RPM angetrieben. Kühlerlüfter schaltet temperaturabhängig. Motorlager erlauben subtile Motorbewegung durch Lastwechsel/Vibration; Animationen skalieren mit Drehzahl.
- **P06.05 · offen** — Motorraumteile einzeln auswählen, Zustand ablesen, ausbauen, reparieren oder ersetzen. Beschädigungen und fehlende Teile werden sichtbar.
- **P06.06 · offen** — Garagenoberfläche für Komponenten, Kosten, Kompatibilität, Verschleiß und Montagezustand. Der Wagen muss nach Umbauten weiterhin korrekt geladen und gespeichert werden.
- **P06.07 · offen** — Interaktion praktikabel halten, keine unnötige Schraube-für-Schraube-Simulation erzwingen, wenn sie dem Spiel keinen Nutzen bringt.

## Phase 7: GRAFIK, LICHT UND NACHTATMOSPHÄRE

**teilweise erledigt** — environment.js besitzt Sonne/Mond/Sterne/Wolken, Tageszeiten, Scheinwerfer-Spots und einen Pool naher Laternen. post.js liefert Comic-Shading/Bloom. V24 ergänzt einen gemeinsamen Wetterzustand, Regenlinien, Pfützenmaske, dunklere/glattere Fahrbahn, Nebelweite und Regenbeleuchtung. Direkte Lichter reagieren auf die glattere Oberfläche; spiegelnde Szenenreflexionen und Wetterschutz unter späteren Tunnel-/Garagendächern fehlen. Einzelne Lampenschäden und seitengenaue Ausfälle sind vorhanden; V30 ergänzt Lichtdesigns mit passenden Kegeln und Reichweiten. Fern-/Nebel-/Rückfahrlicht bleiben offen. Bremszustands-Glow ist seit V20 vorhanden. V29 prüft Cockpits bei Tag/Nacht im lokalen Browser; weitere Lichtgestaltung und Hardware-Messungen bleiben offen.

- **P07.01 · teilweise erledigt** — Stilisiertes, kohärentes Cartoon-Bild beibehalten, aber Geometrie, Materialien, Schatten, Texturen und Farbgebung verbessern.
- **P07.02 · teilweise erledigt** — Nächte sollen deutlich dunkler sein als bisher. Ambient Light nach Tageszeit steuern, sodass Straßenlaternen und Scheinwerfer nachts wirklich wichtig werden.
- **P07.03 · teilweise erledigt** — Besserer Mond, sichtbares Mondlicht, Sterne, stimmigere Skyboxen, Wolken, Dämmerung, Sonnenaufgang/-untergang und atmosphärischer Dunst.
- **P07.04 · teilweise erledigt** — Schönere Bloom- und Lens-Flare-Effekte, sichtbare Lichtkegel, Leuchten, Streulicht, Reflexionen, dezente volumetrische Effekte sofern bezahlbar. Nicht alles überstrahlen oder unlesbar machen.
- **P07.05 · teilweise erledigt** — Straßenbeleuchtung, Fenster, Werbeschilder, Tunnel und Garagenbeleuchtung abwechslungsreicher gestalten.
- **P07.06 · teilweise erledigt** — Fahrzeuglichter mit echten Emissive-Materialien und passender Beleuchtung der Umgebung. Abblend-/Fernlicht mit sinnvollen Kegeln und Reichweiten, Rück- und Bremslichter mit unterschiedlichen Intensitäten, Blinker, Nebel-/Rückfahrlicht wo passend.
- **P07.07 · teilweise erledigt** — Keine harte, sofortige Intensitätssprünge für Lichter, bei denen ein natürlicher An-/Abglühverlauf sinnvoll ist. Halogen, LED und andere Lichtarten dürfen unterschiedlich schnell reagieren; Bremslichtreaktion muss trotzdem direkt erkennbar bleiben.
- **P07.08 · teilweise erledigt** — Defekte Lampen funktionieren nicht mehr. Glühende Bremsen, Motorraumbeleuchtung und Cockpitbeleuchtung müssen auf Zustände reagieren.
- **P07.09 · teilweise erledigt** — Regen, nasse Oberflächen, Pfützen, Nebel und Wetterwechsel mit passenden Lichtreflexionen und Gripveränderungen, sofern die bestehenden Wettersysteme sinnvoll erweitert werden können.
- **P07.10 · teilweise erledigt** — Custom Textures und detailliertere 3D-Modelle zulässig, wenn sie zum Cartoon-Stil passen und hochwertig genug sind. Low-poly ist keine Pflicht.

## Phase 8: BESSERE STRASSEN, BERGE UND LANDSCHAFT

**teilweise erledigt** — region.js/county-layout.js erhalten vier Landmassen, fünf Brücken, rund 266 km Straßen und Berge bis 210 m. Road-Mesh und Reifenkontakt stimmen überein. Tunnel/Unterführungen fehlen: derzeit nur eine befahrbare Höhe pro X/Z. Felswände, Hangbauwerke, umfassende Leitplanken und echte Fahrbahnschäden fehlen. Dock 09 bleibt eine getrennte Strecke und ist noch nicht räumlich angefahren.

- **P08.01 · teilweise erledigt** — Bestehende Karte erweitern, nicht ersetzen. Die gut fahrbaren Kurven der Rennstrecke als Qualitätsreferenz für Straßen in der offenen Welt verwenden.
- **P08.02 · teilweise erledigt** — Mehr kurvige City-Roads, schnelle Verbindungsstraßen, Höhenwechsel, Landstraßen, Tunnel, Brücken, lange Kurvenkombinationen und attraktive Strecken zum Fahren.
- **P08.03 · teilweise erledigt** — Richtige Bergregionen mit Serpentinen, Pässen, Kehren, Steigungen, Gefällen, Hangstraßen, Felswänden, Leitplanken und Aussichtspunkten.
- **P08.04 · teilweise erledigt** — Bergstraßen folgen nachvollziehbar dem Gelände und sind baulich in die Hänge integriert, statt wie schwebende flache Bänder auszusehen.
- **P08.05 · teilweise erledigt** — Stadt, Vororte, Industrie, Berge, Land, Autobahn, Rennstrecke und Aussichtspunkte über eine zusammenhängende sinnvolle Straßenführung verbinden.
- **P08.06 · teilweise erledigt** — Road-Meshes, Fahrbahnmarkierungen, Leitplanken, Böschungen, Bäume, Felsen und Straßenschäden konsistent aufbauen.
- **P08.07 · teilweise erledigt** — Mehr abwechslungsreiche, auch zufällig entdeckbare Strecken für Cruisen, sportliches Fahren und Driften. Zufall darf gute Straßenführung nicht ersetzen.

## Phase 9: GRÖSSERE UND WENIGER GITTERFÖRMIGE STADT

**teilweise erledigt** — Sechs V14-Viertel, modulare Fassaden und vier gebaute Landmarken ergänzen den Stadtkern. Quartiere haben jedoch weiterhin stark regelmäßige Raster. Individuelle Blockformen, organischere Übergänge, Parkhäuser, Parkplätze, vielfältige Straßenrequisiten und abgestimmte Bezirks-Audiolandschaften sind noch auszubauen. Die neue Größe allein erfüllt diese Phase nicht.

- **P09.01 · teilweise erledigt** — Die vorhandene City glaubwürdiger, dichter, größer und individueller gestalten. GTA IV ist Referenz für dichte und abwechslungsreiche Stadtbereiche.
- **P09.02 · teilweise erledigt** — Nicht nur regelmäßig rechteckige Blöcke. Schrägstraßen, Kurven, verwinkelte Gassen, unregelmäßige Blocks, Kreuzungen unterschiedlicher Größe, Einbahnstraßen und organische Übergänge.
- **P09.03 · teilweise erledigt** — Eigenständige Downtown mit Hochhäusern, Wohnviertel, Gewerbe, Industrie, Außenbezirke, Parkhäuser, Parkanlagen, ggf. Uferpromenade und Autobahnknoten.
- **P09.04 · teilweise erledigt** — Gebäude unterscheiden sich in Höhe, Grundriss, Dach, Fassaden, Farben, Ladenfronten und Beleuchtung. Nicht dieselben wenigen Modelle offensichtlich wiederholen.
- **P09.05 · teilweise erledigt** — Kontrollierte prozedurale Variation plus bewusst gestaltete Landmarken, damit die Stadt nicht wie ein zufälliges, gleichförmiges Raster aussieht.
- **P09.06 · teilweise erledigt** — Beschilderung, Ampeln, Markierungen, parkende Fahrzeuge, Straßenschilder, Laternen, Zäune, Container, Bänke, Baustellen, Vegetation und sonstige Details.
- **P09.07 · teilweise erledigt** — Bezirke sollen durch Gebäude, Straßen, Dichte, Licht und Audio erkennbar verschieden sein.

## Phase 10: DISTANT SCENERY, LOD UND WELTSTREAMING

**teilweise erledigt** — Instancing, Frustum-Culling, räumliche Kollisionsindizes und Entfernungsausblendung von Fassadendetails existieren. Es fehlen gestufte/überblendete LODs, Schatten-LOD, Distant Scenery, Streaming sowie entfernte vereinfachte KI-Simulation. Weltbau lädt derzeit die ganze Region; zuerst CPU/GPU-Budgets messen, dann gezielt teilen.

- **P10.01 · offen** — Hinter den spielbaren Grenzen entfernte Berge, Hügel, Wälder und andere Landschaftssilhouetten sichtbar machen, damit die Karte nicht abrupt endet.
- **P10.02 · teilweise erledigt** — LOD für Gebäude, Vegetation, Verkehr, Fahrzeugteile und Terrain. Fernobjekte mit deutlich billigerer Darstellung, saubere Überblendungen statt sichtbarem Popping.
- **P10.03 · teilweise erledigt** — Frustum-/Distance-Culling, Instancing, Objekt-Pooling, passende Texturauflösungen, Schatten-LOD, ggf. Impostors/Billboards und räumliche Partitionierung.
- **P10.04 · offen** — Weltabschnitte in Abhängigkeit von der Position laden und entladen, ohne nerviges sichtbares Nachladen.
- **P10.05 · teilweise erledigt** — KI/Physik entfernter Autos vereinfachen und nur nahe oder relevante Objekte vollständig simulieren.
- **P10.06 · offen** — Das Prinzip von GTA-Fernsicht und Distant Horizons als Inspiration nutzen, nicht die Technik blind übernehmen.

## Phase 11: BESSERE VERKEHRS-KI

**teilweise erledigt** — traffic.js nutzt Spurkurven, Kreuzungsreservierungen, Signale, Fahrerparameter, Hindernisabstand und kontinuierliche Bewegung. V14 berücksichtigt schmale Straßen. Spurwechsel, Auffahrten, robuste Stauauflösung, bezirks-/zeitabhängige Verteilung fehlen. V24 reduziert Wettertempo und Bremsannahmen; der gemeinsame KI-Integrator berücksichtigt Nässe. Polizei/Renn-KI sind eigene Systeme und bleiben erhalten.

- **P11.01 · teilweise erledigt** — Fahrzeuge sollen Fahrspuren einhalten, Kurven vorausschauend nehmen und sanfter lenken, beschleunigen und bremsen.
- **P11.02 · teilweise erledigt** — Kreuzungen, Ampeln, Vorfahrt, Spurwechsel, Überholen, Auffahrten, Blockaden und Hindernisse besser behandeln.
- **P11.03 · teilweise erledigt** — Verschiedene Fahrpersönlichkeiten: defensiv, normal, ungeduldig, schneller oder aggressiver, aber nachvollziehbar.
- **P11.04 · teilweise erledigt** — Unterschiedliche Geschwindigkeiten je nach Straße, Wetter, Verkehrsfluss und Kurvenradius.
- **P11.05 · teilweise erledigt** — Bessere Routenplanung auf neuem Straßennetz und auf Bergstraßen. Keine häufigen Staus durch feststeckende Fahrzeuge oder sinnlose Wendemanöver.
- **P11.06 · teilweise erledigt** — Verkehrsdichte nach Bezirk und Tageszeit variieren; abgestellte und fahrende Autos sinnvoll verteilen.
- **P11.07 · teilweise erledigt** — Schäden oder andere unerwartete Hindernisse erkennen, sofern das Performancebudget es erlaubt.

## Phase 12: KAMERA, VIEW BOBBING UND GESCHWINDIGKEITSGEFÜHL

**teilweise erledigt** — main.js enthält gedämpfte Kamera, Blicksteuerung, FOV-/Geschwindigkeitseffekte und Aufprallreaktionen; post.js Bewegungsunschärfe. Zielabhängige Kamerakalibrierung und Komfortregler müssen erweitert werden. V29 ergänzt Cockpitbewegung aus Chassispose, Federwegsgeschwindigkeit und Last sowie einen Komfortregler. Weitere Kameraabstimmung und physischer Gerätekomfort bleiben offen.

- **P12.01 · teilweise erledigt** — Third-Person-Kamera darf nicht mehr steif und linear am Fahrzeug hängen. Adaptive Kameradistanz, leichtes Camera Lag, Kurven-Offset, Anfahr-/Bremsreaktion, Roll-/Nick-Reaktion und kontrollierte Rotation.
- **P12.02 · teilweise erledigt** — Geschwindigkeit kann FOV leicht verändern. Dezente Vibration, periphere Bewegung, Bewegungsunschärfe und natürliche Dämpfung der Kamera.
- **P12.03 · teilweise erledigt** — Beim Lenken, Driften, Lastwechsel oder Fahren über Wellen leichte, zum Fahrzeug passende Bewegungen. Die Kamera muss steuerbar und ruhig genug bleiben.
- **P12.04 · teilweise erledigt** — Cockpitkamera mit subtiler Kopfbewegung, Sichtverlagerung in Kurven, Road Bobbing und Brems-/Beschleunigungsreaktion; keine übertriebene Motion Sickness.
- **P12.05 · teilweise erledigt** — Speziell bei hoher Geschwindigkeit deutlich stärkeres Gefühl von Geschwindigkeit durch Kamera, Straße, Audio und Vibration.
- **P12.06 · teilweise erledigt** — Komfort-Einstellungen dürfen die Intensität solcher Kameraeffekte beeinflussen. Das ist kein Ersatz für die realistische Basis-Fahrphysik.

## Phase 13: WIND, MOTORGERÄUSCHE, MUSIK UND UMGEBUNGSAUDIO

**teilweise erledigt** — MotorLab erzeugt bauart-/lastabhängige Quellen; audio.js nutzt Radarbeit, Schäden, Wind und räumliche Reflexionen. music.js besitzt Fahr-/Verfolgungsmusik mit Lizenznachweisen. V29 ergänzt die In-Car-Bedienung der vorhandenen Musik und eine gedämpfte Kabinenmischung; offene/fehlende Türen und Scheiben verändern Wind und Motorfilter. Sender-/Trackauswahl und weitere räumliche Hörabstimmung bleiben offen. V24 ergänzt synthetischen Regen und nasses Abrollgeräusch. Neue Assets werden in dieser Phase nicht hinzugefügt.

- **P13.01 · teilweise erledigt** — Differenzierte Motorsounds nach Motorbauart, Drehzahl, Last, Auspuff, Ansaugung und Tuningzustand.
- **P13.02 · teilweise erledigt** — Reifenquietschen, Scrubbing, Wheelspin, Untergrund, Fahrwerk, Getriebe, Kupplung, Turbo und Schäden hörbar machen. Auspuffknallen nur bei passendem Motor-/Tuningzustand.
- **P13.03 · teilweise erledigt** — Windgeräusche skalieren nach Fahrzeuggeschwindigkeit. Third-Person deutlich offener; Cockpit gedämpft, aber wahrnehmbar.
- **P13.04 · teilweise erledigt** — Offene, fehlende oder zerbrochene Fenster ändern Lautstärke und Charakter des Windes. Tunnel und Gebäude beeinflussen das Klangbild.
- **P13.05 · teilweise erledigt** — Mehr Musik, sinnvoll unterschiedliche Radiosender, Track- und Stationswechsel und Steuerung über das in-car-Radio.
- **P13.06 · teilweise erledigt** — Musik nur mit eigener oder rechtmäßig nutzbarer Lizenz. Keine urheberrechtlich geschützten Songs einfach übernehmen.
- **P13.07 · teilweise erledigt** — Stadtatmosphäre, Verkehr, Garagen, Regen, Wind, Tunnelhall, Tageszeit und Bezirke abwechslungsreicher vertonen.
- **P13.08 · teilweise erledigt** — Mischung so gestalten, dass bei hohem Tempo Wind, Motor und Fahrbahn zusammen mehr Speed vermitteln.

## Phase 14: GARAGENÜBERGÄNGE UND KURZE CUTSCENES

**offen** — Service-Marker öffnen bisher Dialoge; kein tatsächliches Ein-/Ausfahren durch Garagentore. Notwendig sind Gebäudeeingänge, freie Fahrwege, Innenraumszene und eine abbrech-/überspringbare Übergangszustandsmaschine mit Transaktionsschutz. Bestehende Servicekosten bleiben die Grundlage.

- **P14.01 · offen** — Home-Garage: echtes Tor öffnet sich, der Wagen fährt sichtbar hinaus, Kamera geht flüssig in Spielansicht über. Nicht einfach vor der Garage aufploppen.
- **P14.02 · offen** — Service/Motor Works (oder tatsächlicher Ingame-Werkstattname): Fahrzeug wird hineingefahren; Übergang blendet aus, Reparatur wird berechnet und durchgeführt; Einblendung zeigt das Fahrzeug beim Ausfahren.
- **P14.03 · offen** — Tuning-Shop: Auslöser führt durch ein öffnendes Garagentor in eine richtige Innenraumszene mit Fahrzeug, statt in einer leeren Markierung sofort ein Menü zu öffnen.
- **P14.04 · offen** — Änderungen am Fahrzeug sind beim Ausfahren sichtbar. Tor, Licht, Sounds und Kameras sind auf die Szene abgestimmt.
- **P14.05 · offen** — Übergänge sollen kurz, flüssig, skippbar und gegen doppelte Eingabe abgesichert sein. Keine kaputten Spawnpositionen oder verschwundenen Fahrzeuge.

## Phase 15: LEBENDIGERE OPEN WORLD

**teilweise erledigt** — Funktionierende Services, Jobs, Ampeln, Tag/Nacht und Verkehr sind vorhanden. Parkende Fahrzeuge und Dichteverteilung, Tore, Waschstraße, Rastplätze und bewohnte Mikro-Szenen fehlen. Fußgänger bleiben offen, bis das Performancebudget belastbar gemessen ist; keine Platzhalterfiguren.

- **P15.01 · teilweise erledigt** — Der Gesamteindruck soll offener, abwechslungsreicher und bewohnter sein, ähnlich den freien Fahrwelten aus The Crew Motorfest, GTA und NFS Heat, bei weiterhin eigener Sideways-Identität.
- **P15.02 · teilweise erledigt** — Mehr sinnvoll parkende Fahrzeuge und zu Tageszeit/Ort passende Verkehrsdichte.
- **P15.03 · teilweise erledigt** — Funktionierende Ampeln, zu Tageszeiten schaltende Straßenlaternen, animierte Tore und andere kleine Umgebungsbewegungen.
- **P15.04 · teilweise erledigt** — Interaktive Waschanlagen, Tankstellen, Werkstätten, Parkplätze, Aussichtspunkte, Rastplätze und entdeckbare Orte, soweit es zum vorhandenen Spiel passt.
- **P15.05 · teilweise erledigt** — Mehr regionale Eigenheiten, Wetter, Lichter, Ambient-Sounds, verschiedene Straßen und besondere Orte. Nicht alle Blöcke, Gebäude und Umgebungen gleich gestalten.
- **P15.06 · offen** — Fußgänger nur, falls technisch sinnvoll und sauber performant umsetzbar. Keine leeren Attrappen oder zufällige KI-Popups.

## Phase 16: FAHRZEUGBESITZ, ZUSTAND, INSPEKTION UND ZUSAMMENSPIEL

**teilweise erledigt** — Bauteilzustände, Teilebesitz, Temperaturen und Diagnose bleiben je Fahrzeug gespeichert. V20 ergänzt Leitungsschäden und zwei Bremsflüssigkeitsstände. Leitung ersetzen stoppt das jeweilige Leck, füllt aber keinen Vorrat; Nachfüllen dichtet keine defekte Leitung ab. Tuning erhält beides. Neuer Lauf/Restart repariert weiterhin bewusst gemäß Nutzerauftrag; R behält Schäden. Freier Aus-/Einbau weiterer Teile, Licht-/Fensterfolgen bleiben offen. Wetter, Straße und Reifen sind seit V24 gekoppelt; Wetter bleibt bei Neustart erhalten und wird getrennt vom Fahrzeug gespeichert.

- **P16.01 · teilweise erledigt** — Bauteilzustände, Reifen, Reparaturen, Tuning, aus- oder eingebaute Teile, Einstellungen und Fahrzeugzustand sollen bei vorhandener Speichermöglichkeit zuverlässig persistieren.
- **P16.02 · teilweise erledigt** — Werkstatt ersetzt die tatsächlich defekten Baugruppen, statt immer einen unspezifischen Komplettschaden zu reparieren.
- **P16.03 · teilweise erledigt** — Diagnosebildschirm mit Komponentenzustand, Temperatur, Verschleiß und konkreten Fehlern.
- **P16.04 · teilweise erledigt** — Fahrzeuge können verschlissen sein, ohne optisch zerstört zu sein; optische Schäden können wiederum mechanische Folgen haben.
- **P16.05 · teilweise erledigt** — Tuning beeinflusst Sound, Handling, Motorraum, Cockpit, Verschleiß, Gewicht und bei Bedarf Kamerabewegung.
- **P16.06 · erledigt** — Schäden an Lichtern ändern Ausleuchtung, zerbrochene Fenster Windgeräusche, fehlende Spoiler gegebenenfalls Aerodynamik, kaputte Reifen Handling und fehlende Teile die Garagenansicht.
- **P16.07 · erledigt** — Straßen-, Wetter- und Reifenzustand beeinflussen sich sinnvoll gegenseitig.
- **P16.08 · teilweise erledigt** — Kurze, verständliche Rückmeldungen für mechanische Probleme, ohne die Fahransicht mit HUD-Anzeigen zu überladen.

## Phase 17: QUALITÄT, OPTIMIERUNG UND KONTROLLEN

**teilweise erledigt** — Grafikstufen, Belegung, Kalibrierung, Deadzones, synthetische Eingabetests und migrationsfähige Speicher sind vorhanden. Vollständige CPU/GPU-Profile auf Zielgeräten, adaptive Qualität, Reflexions-/LOD-Regler und Cockpit-Sichttests fehlen. Headless-Software-Rendering ist kein Hardware-FPS-Nachweis.

- **P17.01 · teilweise erledigt** — Konstante, möglichst hohe Bildrate auf typischen Zielgeräten anstreben; keine willkürliche FPS-Garantie ohne Messungen.
- **P17.02 · teilweise erledigt** — GPU- und CPU-Kosten von Fahrzeugen, Schatten, Lichtern, Wettersystem, Verkehr, LOD, Partikeln und Physik messen und gezielt senken.
- **P17.03 · teilweise erledigt** — Adaptive Grafikqualität und sinnvolle Optionen für Schatten, Reflexionen, Partikel, Verkehrsdichte, FOV und Kameraeffekte. Physik nicht durch einen Arcade/Realistic-Settings-Schalter austauschen.
- **P17.04 · teilweise erledigt** — Eingaben von Tastatur, Controller und kompatiblen Wheels testen. Konfigurierbare Belegung, Deadzones und Sensitivität, wenn die vorhandene Architektur dies ermöglicht.
- **P17.05 · teilweise erledigt** — Innenraum-Kamera soll nachts und tagsüber spielbar sein. Spiegel, Glas, Sitze, Fahrerarme, Instrumente und Tönung dürfen die Sicht nicht unerwartet blockieren.
- **P17.06 · teilweise erledigt** — Keine fehlenden Texturen, z-fighting, sichtbaren LOD-Sprünge, nachladenden Schatten, falschen Kollisionskörper oder dauerhaften Partikellecks.
- **P17.07 · teilweise erledigt** — Vorhandene Spielstände und Fahrzeugdaten nach Möglichkeit migrieren; nicht ohne ausdrücklichen Grund löschen.

## Phase 18: TESTS UND ABSCHLUSSKRITERIEN

**teilweise erledigt** — V20 reproduziert den gemeldeten RATE_LIMIT auf echter PeerJS/WebRTC-Verbindung: 7,5 Sekunden Empfängerblockade bündeln normale 20-Hz-Updates; V19 trennt danach den Gast. Mit V20 bestehen Blockade auf Gast und Host, erneuter Beitritt sowie ein vollständiger Zwei-Browser-Spielablauf. Bremsentests prüfen Migration, getrennte Kreise, reale Verzögerung, Handbremse, Aufprall, Einzelersatz, Wärme und vier Fahrzeugmodelle. qa/release-v20.json bindet nur die aktuellen Nachweise. Weitere End-to-End-Szenarien bleiben bis zu den entsprechenden Systemen offen oder teilweise; keine Hardware-Wheel-/Mehr-PC-/TURN-Aussage.

- **P18.01 · teilweise erledigt** — Nach jeder Phase die vorhandenen Funktionen prüfen und sicherstellen, dass das Spiel spielbar bleibt.
- **P18.02 · teilweise erledigt** — Konkrete End-to-End-Szenarien testen:
- **P18.03 · teilweise erledigt** — Serienauto fährt griffig und driftet erst bei passender Belastung; Drift-Kit verändert Fahrverhalten nachvollziehbar.
- **P18.04 · erledigt** — Langer Burnout erhitzt einen Reifen; Verschleiß, Gripverlust und schließlich Blowout können auftreten; Fahrverhalten reagiert darauf.
- **P18.05 · teilweise erledigt** — Frontalaufprall beschädigt Kühler; Motortemperatur steigt; Reparatur des Kühlers behebt Ursache, ein bereits beschädigter Motor braucht ggf. gesonderte Reparatur.
- **P18.06 · teilweise erledigt** — Kupplung verschleißt durch Missbrauch, rutscht und kann ausfallen. Heiße Bremsen verzögern schlechter.
- **P18.07 · erledigt** — Tür oder Spoiler fällt durch Unfall ab und fehlt anschließend sichtbar am Fahrzeug.
- **P18.08 · erledigt** — Cockpit jedes spielbaren Autos zeigt korrekte RPM/Geschwindigkeit; Radio-Map und Lenkrad-/Fahreranimation sind nutzbar.
- **P18.09 · erledigt** — Ausgeblendetes virtuelles Lenkrad beeinträchtigt die Fahrzeugsteuerung nicht.
- **P18.10 · offen** — Die Garage zeigt den Motor, dessen Riemen mit der Drehzahl laufen; entfernte Komponenten bleiben entfernt und haben gegebenenfalls Folgen.
- **P18.11 · teilweise erledigt** — Tag/Nacht verändert Licht. Scheinwerfer beleuchten bei Dunkelheit die Straße, Bremslicht reagiert und kaputte Lampen bleiben aus.
- **P18.12 · teilweise erledigt** — Neue Bergstraßen folgen dem Terrain, Stadtteile sind weniger gleichförmig, Verkehr kann sie befahren.
- **P18.13 · offen** — Distant Terrain und LOD verhindern sichtbare Weltgrenzen ohne auffällige Pop-ins.
- **P18.14 · teilweise erledigt** — Kamera und Wind vermitteln mehr Geschwindigkeit in Cockpit und Third Person.
- **P18.15 · offen** — Garage-, Service- und Tuning-Übergänge öffnen Tore, zeigen das Fahrzeug und enden mit korrektem Spawn.
- **P18.16 · teilweise erledigt** — Spielstände speichern Schäden, Ausbauteile und Upgrades korrekt.
- **P18.17 · teilweise erledigt** — Für nicht umgesetzte Punkte konkrete technische Gründe und fehlende Arbeiten auflisten, ohne Fertigstellung vorzutäuschen.

## Nächster abgeschlossener Arbeitsschritt

Phase 2B fortsetzen: Radlager und eigene Lenkungskomponenten mit Belastung, Fahrfolgen, Diagnose, gezieltem Ersatz und Persistenz. Danach die noch fehlenden Motor-Nebenaggregate. Phase 1 benötigt weiter breitere Kalibrierung und später Wetter/Nässe aus Phase 7. Der Multiplayer-Fix ist eine notwendige Regressionkorrektur vor dieser Fortsetzung.

## V16 – bearbeitete Teilziele

Phase 1B vertieft P01.01–P01.03, P01.06–P01.07 und P01.11. Prüfungen betreffen zusätzlich P17.02/P17.07 und P18.01/P18.17. Deren vollständiger Umfang bleibt teilweise erledigt. Neue Details und technische Grenzen: [Phasenbericht](phase-1b-report.md). Die 156 ursprünglichen Anforderungsformulierungen bleiben erhalten.

## V18 – bearbeitete Teilziele

Phase 1D vertieft P01.03/P01.04/P01.06–P01.08. Die dafür notwendige Spoilerbefestigung ergänzt P03.02–P03.04/P03.07, Teileauswahl P05.04–P05.07 und gespeicherte Aero-Schäden P16.01/P16.02/P16.06. P18.07 ist für den ausdrücklich alternativ geforderten Spoiler nachgewiesen; Türen bleiben offen. Alle übrigen Vollumfänge behalten ihren Status. Details: [Phasenbericht](phase-1d-report.md). Alle 156 Originalformulierungen bleiben unverändert.

## V19 – bearbeitete Teilziele

Phase 2A erfüllt P02.02–P02.04 mit einer browsergerechten Reifen-Näherung und weist P18.04 im nativen Spielpfad nach. Sie vertieft P01.04/P01.08, P02.11/P02.12, P16.01–P16.03/P16.06/P16.08. Phase 1 und Phase 2 bleiben insgesamt teilweise. Grenzen und Nachweise: [Phasenbericht](phase-2a-report.md). Alle 156 Originalformulierungen bleiben unverändert; V18 und ältere Abschnitte beschreiben historische Inkremente.

## V20 – Multiplayer-Korrektur und Bremsen aus Phase 2B

P02.09/P02.11/P02.12, P07.08 und P16.01–P16.03 werden erweitert, behalten ihren Teilstatus. Der bestätigte RATE_LIMIT entsteht durch die Behandlung aufgestauter Zustandsupdates als Flood; V20 fasst überzählige Zustände begrenzt zusammen und behält die Prüfung von Steuerpaketen. Details und Grenzen: [Phasenbericht](phase-2b-brakes-report.md). Alle 156 Originalanforderungen bleiben unverändert.

## V21 – Radlager, Lenkung und ergänzende Bremskomponenten

P02.09/P02.10 sind in der beschriebenen effizienten Näherung erfüllt. P02.01/P02.11/P02.12, P16.01–P16.03 und P18.16 werden weitergeführt und bleiben teilweise. Nächster Teil ist Phase 2C mit den fehlenden Motor-Nebenaggregaten. Details und Grenzen: [Phasenbericht](phase-2b-chassis-report.md). Alle 156 Originalanforderungen bleiben unverändert.

## V22 – Motor-Nebenaggregate und Elektrik

P02.01/P02.05/P02.06/P02.07/P02.11/P02.12 wurden erweitert; P16.01–P16.03 und P18.16 erhalten weitere Integrationsnachweise. Die übergeordneten Punkte bleiben teilweise. Alle 156 Anforderungen bleiben unverändert enthalten. Umsetzung, Tests und Grenzen stehen im [Phasenbericht](phase-2c-auxiliaries-report.md). Als Nächstes folgt Phase 2D mit den verbleibenden getrennten Motorbauteilen; danach weitere modulare Karosserieschäden aus Phase 3.

## V23 – getrennte Motorbauteile

Phase 2D ist umgesetzt. P02.07/P02.08/P02.11/P02.12 sind jetzt erledigt, mit Nachweisen und Grenzen im [Phasenbericht](phase-2d-engine-report.md). Die übrigen Punkte behalten ihren expliziten Status; alle 156 Anforderungen sind wortgleich enthalten. Nächste Arbeit: offene Nässe-Anbindung und Fahrkalibrierung aus Phase 1 nachholen, anschließend Phase 3 erweitern.

## V24: Phase 1E

Nässe-Anbindung umgesetzt; P01.07/P01.08/P16.07 sind erledigt. Nachweise, Messwerte und Grenzen stehen im [Phasenbericht](phase-1e-weather-report.md). Alle 156 Anforderungen bleiben erhalten. Frühere Versionsabschnitte dokumentieren ihren damaligen Stand. Als Nächstes folgt Phase 3 mit weiteren Karosseriemodulen und ihren mechanischen Folgen.

## V25: Phase 3A

Türen, Haube und Kofferraum sind getrennt, bedienbar, beschädigbar und lösbar. P03.05/P03.07 sind erledigt; P06.01 ist teilweise erledigt. Die Phase bleibt offen für Glas, Leuchten, kleinere Anbauteile und weitere Schadensdetails. Nachweise und technische Grenzen stehen im [Phasenbericht](phase-3a-body-panels-report.md). Nächster Teil ist Phase 3B; anschließend Phase 4. Alle 156 Anforderungen bleiben verbindlich.

## V26 – Phase 3B

20 zusätzliche Komponenten sind mit den vorhandenen Hüllen aller vier Autos verbunden: Scheiben, Leuchten, Spiegel, Schweller, Kotflügel, Splitter, Diffusor, Grill und Auspuffauslass. Schaden, fehlende Geometrie, Leuchtwirkung, Wind, Masse, Abtrieb, Diagnose, gezielte Reparatur und Save-Migration greifen ineinander. Kleine Glassplitter nutzen einen eigenen Pool mit 24 Plätzen und acht Sekunden/100 Metern Lebensdauer. Bestehende Karosserietrümmer bleiben auf acht Stück begrenzt. Protokoll 18 überträgt den Zustand am Fahrzeug, nicht die losen Trümmer.

P03.06 und P16.06 sind damit umgesetzt. P04.07 ist nur teilweise erfüllt: durchsichtiges Glas ist vorhanden, passende vollständige Innenräume und Fahrer fehlen weiterhin. P03.01–04 und P03.08 bleiben teilweise wegen vereinfachter Kontaktkörper, noch nicht einzeln ablösbarer Fahrwerksglieder und der bisher nur sichtbaren Endrohrbaugruppe. Vor Phase 4 folgt die verbleibende Kontakt-/Anbauteilarbeit aus Phase 3. Bericht und genaue Testgrenzen: docs/phase-3b-exterior-report.md.

## V27 – räumliche Kontakte

Phase 3C ergänzt offene Hauben/Türen und lose Räder um räumliche Kontakte. P03.04 ist damit umgesetzt; Phase 3 insgesamt bleibt wegen einzelner Fahrwerksglieder und der Auspuffführung teilweise offen. Bericht und Messgrenzen: phase-3c-contacts-report.md. Alle ursprünglichen 156 Anforderungen bleiben erhalten.

## V29 – Phase 4

Alle zwölf Phase-4-Punkte und die End-to-End-Punkte P18.08/P18.09 sind mit den dokumentierten Browser-Näherungen umgesetzt. Alle 156 ursprünglichen Anforderungen bleiben wortgleich enthalten. [Phasenbericht und Testgrenzen](phase-4-cockpit-report.md). Nächste Phase: 5, erweitertes Tuning; danach die interaktive Garage und der sichtbare Motorraum aus Phase 6. Frühere Versionsabschnitte beschreiben ihren damaligen Stand.

## V30 – Phase 5 Teil A

P05.01 und P05.03 sind mit den dokumentierten Browser-Näherungen umgesetzt. P05.05–P05.07 und die Integrations-/Testphasen werden weitergeführt, bleiben im vollständigen Umfang teilweise. Alle 156 Originalformulierungen bleiben erhalten. Nächster Teil: Innenraum-Tuning, danach Kompressor und Montageintegration. [Phasenbericht](phase-5a-exterior-report.md).

## V31 – Phase 5 Teil B

P05.02 ist innerhalb der beschriebenen Näherungen umgesetzt. P05.04–P05.07 bleiben wegen Kompressor und vollständiger Montageintegration teilweise. Alle 156 Originalformulierungen bleiben erhalten. Nächster Teil: Kompressor, danach interaktive Garage und Motorraum. [Nachweise und Grenzen](phase-5b-interior-report.md).

## V32 – Phase 5 Teil C

P05.04 ist umgesetzt. P05.05–P05.07 und Phase 5 insgesamt bleiben teilweise; der vollständige Wortlaut aller 156 Anforderungen bleibt erhalten. Nächster Schritt ist Phase 6: Motorraum, einzelne Montage-/Ausbauzustände und räumliche Garageninteraktion. [Nachweise und Grenzen](phase-5c-induction-report.md).
