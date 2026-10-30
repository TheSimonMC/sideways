# V31: Phase 5B – Innenraum-Tuning

V31 setzt P05.02 um. Die bestehende Garage enthält 13 neue Innenraumkategorien und insgesamt 54 Teilekategorien. Phase 5 insgesamt und das Gesamtziel bleiben teilweise. Alle 156 Anforderungen stehen unverändert in der Fortschrittsliste.

## Teile und Wirkung

Alle vier Fahrzeuge behalten ihre eigenen Kabinenmaße, Grundmaterialien und Serieninstrumente. Serien-, Sport- und geschüsselte Lenkräder verwenden echte unterschiedliche Radien und Griffpositionen. Der Fahrer folgt dem eingebauten Kranz; die Lenkübersetzung bleibt beim Lenkgetriebe. Sport- und Schalensitze haben andere Polster, Seitenwangen und Schalen. Sie sparen zusammen 8 beziehungsweise 18 kg und senken Sitz-/Augenpunkt um 10 beziehungsweise 25 mm. Masse und Schwerpunkt berücksichtigen Sitze und Käfige.

Leder, Velours, Kabinenfarben, Kontrast-/Rautennähte und Carbon-/Aluminium-/Holzdekore ändern die sichtbaren Materialien und Geometrien. Schaltknäufe und längere Handbremshebel behalten die Schalt-/Pedalanimation; die Hände greifen an die tatsächliche Griffhöhe. Die verlängerte Seil-Handbremse erhöht die Hebelwirkung um 12 Prozent. Die Inline-Hydraulik liefert im intakten Zustand 35 Prozent mehr Handbremsmoment und verliert bei Ausfall der hinteren Bremskreise oder Fade Wirkung. Betätigen einer undichten Hydraulik-Handbremse verliert Flüssigkeit; die serienmäßige Seilbremse bleibt von Hydraulikfehlern unabhängig.

Halb- und Vollkäfige folgen der jeweiligen Kabinenform. Die vorderen Rohre liegen an den A-Säulen und verdecken die Instrumente nicht. Sie erhöhen die Masse und reduzieren die Dachverformung im vorhandenen lokalen Schadensmodell. Bereits im verstärkten Chassis enthaltene Streben werden nicht doppelt gezeichnet oder als volle zweite Käfigmasse gezählt. Vierpunktgurte benötigen Sportsitze/Schalensitze und geeignete Käfig-/Chassisbefestigungen; Sechspunktgurte benötigen Schalensitze und Vollkäfig. Sitze und Gurte begrenzen die animierte Körperbewegung und die kleine lastabhängige Cockpitbewegung. Das ist keine Verletzungs- oder Insassensicherheits-Simulation.

Ein analoges oder digitales Instrumentenlayout ergänzt die modellgerechten Serienanzeigen. Ein einzelner Ladedruck-Pod beziehungsweise drei Pods zeigen den tatsächlichen Ansaugdruck relativ zur Umgebung, Öldruck und Kühlmitteltemperatur. Der Ansaugwert stammt aus dem SDK-Gaszustand; er wird nicht mit dem Nitrovorrat oder dem eingestellten Boost-Ziel verwechselt. Halter verbinden die Pods mit dem Dashboard. Warme, türkise oder violette Leuchtstreifen nutzen die vorhandene Kabinenleuchte für eine begrenzte zusätzliche Ausleuchtung. Sie reagieren auf Lichtschalter und Bordspannung; Stromausfall schaltet Anzeigen und Leuchten ab.

## Garage, Speichern und Multiplayer

Innenraumkategorien wechseln zur passenden Vorschau innerhalb der Kabine: Sitz-/Gurt-/Käfigwahl zeigt den Sitzbereich, die anderen Kategorien Dashboard und Bedienorgane. Der Fahrer wird nur während dieser Inspektion ausgeblendet; ruhende Gurte bleiben an den Sitzen sichtbar. Die normale Fahransicht und Sichtbarkeitseinstellungen werden danach wiederhergestellt. Die Vorschau wird in die vorhandene Garagenfläche eingepasst und braucht keinen zusätzlichen Szenen-Renderdurchgang.

Vorschau und Abbruch sind kostenlos. Im Browser-Test kostete der vollständige gewählte Satz 24.500 Punkte; Installation, erneute kostenlose Installation und Reload erhalten Besitz und vorhandene Schäden. Türdekore und Lichtstreifen folgen den bestehenden beschädigbaren Türbaugruppen. Sitz-, Käfig-, Lenkrad- und Anzeigenbaugruppen bleiben am Kabinenboden beziehungsweise ihren Haltern. Ihre individuellen Ausbau-/Abrisszustände sind noch nicht implementiert und bleiben ausdrücklich Teil von P05.05/Phase 6.

Netzwerkprotokoll 20 überträgt die neuen begrenzten Auswahlwerte und den tatsächlichen Ansaugdruck im bestehenden Datenstrom. RATE_LIMIT-Coalescing und Nachrichtenraten bleiben unverändert. Alle Teilnehmer müssen V31 laden. Lokale Trümmer bleiben lokal.

## Geänderte Dateien

- Neu: dist/interior-tuning.js für Katalog, Preise, Kompatibilität und physikalische Unterschiede; dist/interior-tuning-view.js für Sitze, Gurte, Käfige, Dekore, Leuchten und Messinstrumente.
- dist/interior.js, driver.js, cockpit-state.js und car.js verbinden Baugruppen, Fahrergriffe, Sitzposition, Anzeigen und Vorschau.
- dist/catalog.js, career.js und garage.js verbinden die Teile mit Auswahl, Kauf, Besitz und Migration.
- dist/physics.js verbindet Handbremse und SDK-Druck; body-damage.js berücksichtigt Dachstützung.
- dist/main.js und style.css passen die Kabineninspektion in die Garage ein. multiplayer.js erhält Protokoll 20 und begrenzte Drucktelemetrie; index.html kennzeichnet V31.
- qa/*v31* enthält die Regressionen, Browserabläufe und aktuellen Berichte. SDK und externe Assets bleiben unverändert.

## Nachweise

32 Testsuiten bestehen auf den finalen Quellen beziehungsweise den ausgelieferten HTML-Bytes: 22 native/Build-Suiten und zehn Browserabläufe. Die neuen nativen Tests prüfen 168 Teile-/Fahrzeugvarianten, Masse/Schwerpunkt, Dachverformung, Griffkontakte, tatsächlichen Ansaugdruck, hydraulischen Ausfall, Flüssigkeitsverlust, Körperbewegung, Kauf und Speicherung. Die bestehenden Physik-, Reifen-, Schaden-, Aero-, Eingabe-, Audio-, Karten-, Renn-, KI-, Cockpit- und Exterieurtests bestehen ebenfalls.

Gerenderte Tests zeigen die vier getunten Kabinen bei Tag/Nacht und eine weitere Komfortkombination. Änderungen der tatsächlichen Kühlmitteltemperatur ändern die gezeichneten Instrumentenpixel. Spiegel und Lenkrad-/Handausblendung funktionieren weiter. Der komplette Spieltest prüft Garagenkauf, Vorschau, Abbruch, Reload, Stadtfahrt und Nachtbeleuchtung. Responsive Tests decken zusätzlich die Innenraumvorschau bei 390×844 und 900×480 ab. Die Kabinenprojektion ist auf die sichtbare Vorschaufläche begrenzt; beim Scrollen zeichnet sie keine verzerrte Geometrie hinter den Menüs. Screenshots wurden visuell kontrolliert.

Zwei unabhängige lokale Browser-Prozesse teilen eine echte PeerJS/WebRTC-Sitzung, tauschen getunte Builds aus, fahren und treten erneut bei. Absichtliche Empfangsstaus von 7,5 Sekunden auf Host und Gast bleiben ohne RATE_LIMIT-Rauswurf. Keine JavaScript-Fehler oder externe Laufzeitdownloads im Offline-Test.

Die kleine getunte Cockpit-Szene wurde über je 40 aufgewärmte Frames mit gl.finish gemessen: ohne Spiegel im Mittel 2,02 ms, mit zeitversetzten Spiegeln 2,14 ms. Das ist keine Gesamtspiel-FPS-Garantie und keine Messung auf typischen mobilen GPUs. Physische Wheels, FFB, getrennte PCs/TURN-Netze und subjektives Hören bleiben ungetestet.

## Nächster Schritt

Phase 5C ergänzt den Kompressor mit tatsächlicher Luftförderung und Antriebslast aus dem SDK sowie Kühlung, Schaden, Sound, Kompatibilität und Speicherung. Danach folgt Phase 6 mit individuellen Ausbau-/Montagezuständen, detailliertem beweglichem Motorraum und räumlicher Garageninteraktion. Die dafür fehlenden Zustände und Geometrien werden noch gebaut; frühere teilweise Anforderungen und spätere Phasen bleiben in der Checkliste offen.
