# SIDEWAYS: Kontext und Übergabe

Stand: 28. Oktober 2026. Spielstand: V11, lokaler Commit a38bc66.

## 1. Aktueller Auftrag und klare Grenze

Der Nutzer möchte zuerst eine ehrliche Einschätzung zu einer umfangreichen UI-Überarbeitung und besser verortetem Auto-Sound. Er hat ausdrücklich gesagt, zunächst nichts am Spiel zu ändern.

In diesem Schritt sind nur diese Arbeiten erlaubt und durchgeführt:

- Die vorhandene Implementierung und die hochgeladenen Referenzen lesen.
- Bilder und die als GIF benannte Datei mit unveränderten Originalbytes archivieren.
- Diese kontext.md anlegen.
- Vorhandene Spiel-ZIPs, HTML-Dateien und SDK-Originale unverändert erneut bereitstellen.
- Die tatsächlichen Grenzen und die gewünschte nächste Arbeit dokumentieren.

Kein neuer UI-Entwurf wurde implementiert. Kein Audio-Code, SDK, Fahrzeug, Spielstand, Modell oder bestehendes Release wurde geändert. Es wurde kein neuer Spiel-Build erzeugt und nichts veröffentlicht.

Sites ist im Netz des Nutzers blockiert. Dateien sollen direkt im Chat herunterladbar bleiben. Keine Site-Veröffentlichung oder Site-Downloadseite als Ersatz verwenden.

## 2. Dateien und Einstieg

Zum Spielen dient current/SIDEWAYS-v11.html im Gesamtpaket. Dieselbe Datei wird separat im Chat erneut verlinkt. Sie enthält Code, Fonts, Modelle und Audio. Für Einzelspieler braucht sie keine externen Laufzeitdateien.

current/SIDEWAYS-v11.zip ist das unveränderte vollständige V11-Projekt. Es enthält die spielbare SIDEWAYS.html im Hauptordner, den bearbeitbaren dist-Ordner, SDK, Build-Skripte, Dokumentation, Lizenzen und die damaligen Verhaltensprüfungen.

Das neue Gesamtpaket SIDEWAYS-Gesamtpaket-2026-10-28.zip enthält zusätzlich:

- Diese kontext.md und eine kurze Einstiegshilfe.
- Die unveränderten V11-Dateien.
- Vorhandene ältere Release-ZIPs V8, V9 und V10 in archiv/. Sie dienen nur der Historie.
- Die jeweilige Standalone-HTML aus diesen älteren ZIPs, ohne ihre Bytes zu ändern.
- Die vier hochgeladenen SDK-ZIPs im Original.
- SIDEWAYS-Referenzen.zip mit 18 aktuellen Referenzen und zwei früheren Bildanhängen.
- Ein Manifest mit Größen, Herkunft und SHA-256-Prüfsummen.

Die älteren Archive heißen weiterhin *-pages.zip. Das ist ihr ursprünglicher Dateiname. Sie werden als Dateien im Chat geliefert und benötigen keinen Sites-Download. Für die aktuelle Nutzung V11 wählen. Alte Builds können noch alte Downloadverweise enthalten; sie werden ausdrücklich nicht aktualisiert.

release/pages wird nicht zusätzlich dupliziert. Git-Metadaten, private App-Metadaten, Caches und Upload-Helfer gehören nicht in die Übergabe.

Multiplayer benötigt weiterhin Internetzugriff auf Signalisierung und die anderen Spieler beziehungsweise einen Relay-Dienst. Eine lokal geöffnete HTML hebt Netzwerksperren nicht auf. Spielstände liegen im jeweiligen Browser; ein Kopieren der HTML überträgt sie nicht automatisch.

## 3. Unveränderte Basis

| Datei | Bytes | SHA-256 |
| :--- | ---: | :--- |
| SIDEWAYS-v11.html | 10439475 | 9de891e33865ba237d4b43f91358afbe70d76e1d0057e3298209b6cb429a52c5 |
| SIDEWAYS-v11.zip | 14020704 | e31333bd8b59390454bc1366e65ca8af8ca9b6a6c670c2ad5ea672527236bd2a |
| Motor_Engine_SDK(4).zip | 629350 | de77b061e1d07182ae1f9b065bf7a5236ef091125d8d310efa046af8a427797b |

SDK-Originale:

| Originaldatei | SDK-Version | Einordnung |
| :--- | :--- | :--- |
| Motor_Engine_SDK(1).zip | 1.4.0 | Historische Eingabe |
| Motor_Engine_SDK(2).zip | 1.5.0 | Historische Eingabe |
| Motor_Engine_SDK(3).zip | 1.6.0 | Historische Eingabe |
| Motor_Engine_SDK(4).zip | 1.6.3 | In V11 verwendete Eingabe |

V11 verwendet MotorLab beziehungsweise Motor Engine SDK 1.6.3, Physics Release 14 und Audio Release 14. Alle 28 installierten SDK-Dateien und der Browser-Bundle wurden im V11-Release bytegenau gegen das vierte SDK-ZIP geprüft. Das SDK ist vom Nutzer bereitgestellt; seine Bedingungen und vorhandenen Hinweise bleiben erhalten.

## 4. Gestaltungsziel

SIDEWAYS soll ein 3D-Fahrspiel mit Low-Poly-/PSX-Anmutung und Comic-Effekten bleiben. Die neuen Bilder zeigen vor allem eine deutlich bessere Präsentation und Bedienung:

- Große, klar lesbare Überschriften.
- Dunkle, zurückhaltende Hintergründe mit Halbtönen und Papier-/Drucktexturen.
- Helle, eindeutig markierte Auswahlflächen mit einer sparsam eingesetzten kräftigen Akzentfarbe.
- Fahrzeugvorschau als großer Bestandteil von Garage und Tuning.
- Teilekarten mit Preis, Besitz, Einbauzustand und verständlichem Vergleich.
- Feste Tastenhinweise am unteren Rand.
- Klare Reiter mit sichtbaren Schulter- und Triggertasten.
- Ruhigere Fahransicht mit gut lesbarem Rundinstrument, Gang, Drehzahl, NOS und Warnzuständen.
- Große 2D-Karte mit sichtbarer Route, Ortssymbolen und einer passenden Info-Karte zum ausgewählten Punkt.
- Kurze, abgestimmte Übergänge, Fokusbewegungen und Rückmeldungen.

Die Referenzen sind Vorbilder für Anordnung, Lesbarkeit, Bewegung und Bedienung. Logos, Herstellerfahrzeuge, Shop-Inhalte, Kalender, Battle-Pass- oder League-Systeme in den Bildern sind dadurch nicht bereits Bestandteil von SIDEWAYS. Nicht automatisch zusätzliche Spielsysteme behaupten oder einführen.

Eigene SIDEWAYS-Texte und Formen verwenden. Die Spielsprache bleibt Englisch; die Kommunikation mit dem Nutzer ist Deutsch.

## 5. Bewertung der Audio-Idee

Die gewünschte räumliche Verankerung ist technisch sinnvoll und mit der bestehenden Motorbasis umsetzbar. Mehr Stereobreite allein reicht dafür nicht.

### Bereits vorhanden

Das SDK trennt intern Auspuff, Ansaugung und Motormechanik. AcousticListener in sdk/src/audio.js verwendet unterschiedliche Quellpositionen, Laufzeiten zu beiden Ohren, Distanzdämpfung, Luftfilterung und eine einfache Kopfabschattung.

Die Kameraperspektive beeinflusst den Mix. Die Motorhaubenkamera betont Ansaugung und Mechanik; Außenansichten betonen den Auspuff. Reifen erhalten seitliche Positionen. Hupe, NPC-Motoren, Sirenen und weitere Weltgeräusche sind räumlich gemischt. Fassaden beeinflussen frühe Reflexionen und Hall.

### Konkrete Grenzen in V11

1. Der native Auspuff sitzt an einer generischen Position hinten mittig. Die sichtbaren Endrohre aus dist/car.js werden nicht als individuelle Audioquellen weitergereicht. Fahrzeuge mit zwei Endrohren besitzen deshalb noch keine zwei passend verorteten direkten Auspuffquellen.
2. Die Ansaug- und Motorpositionen sind allgemeine SDK-Positionen und keine am jeweiligen Modell gemessenen Punkte.
3. Das Motor-Audio nutzt einen nahen virtuellen Hörer mit kameraabhängig festen Abständen. Die wirkliche Kamerahöhe und Entfernung werden nicht durchgängig übernommen.
4. Freies Umschauen führt noch nicht zu einer vollständigen kontinuierlichen Drehung des virtuellen Hörerkopfs.
5. Mehrere mechanische Nebengeräusche sind an einem gemeinsamen Getriebepunkt zusammengefasst. Wind und NOS haben breite Stereoanteile ohne dieselbe konkrete Bindung an ein Fahrzeugteil.
6. Der Hall arbeitet mit bereits gemischtem Stereo. Es gibt noch keinen eigenen Reflexionsweg für jedes Endrohr.
7. NPCs nutzen leichtere Audio- und Fahrmodelle. Ihre Motoren, Hupen und Sirenen sitzen noch am gemeinsamen Fahrzeugpunkt.

### Gewünschter späterer Ausbau

- Pro Fahrzeug feste Audiopunkte für jedes Endrohr, Ansaugung, Motorblock, Getriebe, Differenzial und Räder definieren.
- Dieselben Transformationen wie beim Modell verwenden, einschließlich Neigung und relevanter Schäden.
- Einen Hörer mit tatsächlicher Position und Blickrichtung führen. Für die Top-down-Kamera kann eine bewusst näher am Auto liegende Hörperspektive sinnvoll bleiben, damit der Motor spielerisch lesbar bleibt. Diese Perspektive muss ausdrücklich gestaltet werden.
- Auspuff eher nach hinten abstrahlen lassen; Ansaugung und Mechanik nach vorne beziehungsweise in den Motorraum legen.
- Direkte Quellen gut lokalisieren und Reflexionen räumlich verteilen, ohne den gesamten Motor künstlich auseinanderzuziehen.
- Hallwege und Abschattung schrittweise an Quellposition, Umgebung und Hörposition binden.
- In Kopfhörern und Lautsprechern prüfen. Direkt mittig hinter einem symmetrischen Auto darf der direkte Klang mittig bleiben.

Wichtige technische Grenze: Der öffentliche renderAudio(left, right)-Aufruf liefert einen fertigen Stereomix. Eine saubere Ausgabe getrennter laufender Quellkanäle benötigt eine Erweiterung des Audio-Adapters beziehungsweise eine abgestimmte SDK-Schnittstelle.

Die Motor-Simulation darf nur eine Zeitbasis behalten. Nicht mehrfach renderAudio mit wechselnd stummgeschalteten Quellen aufrufen, um einzelne Spuren nachzubauen: Jeder Aufruf würde die Simulation weiterbewegen. Getrennte Quellkanäle müssen innerhalb desselben Renderdurchlaufs entstehen. Diese Erweiterung wurde hier nicht umgesetzt.

Quellen im V11-Projekt:

- sdk/src/audio.js: AcousticListener.
- sdk/src/audio/sources.js: Erzeugung und Zusammenführung nativer Quellen.
- sdk/src/game-api.js und sdk/motor-engine.d.ts: öffentliche Audio-Schnittstelle.
- dist/audio.js: _updateNativeListener, _sourceMix, _renderSound.
- dist/audio/world.js: playerPoint, wheelPan, setSources, renderInto.
- dist/audio/acoustics.js: StreetAcoustics.
- dist/car.js: sichtbare Endrohre.
- dist/main.js: Hörperspektive und Abfrage der Umgebungsakustik.

## 6. Bewertung und Ziel der UI-Überarbeitung

Ein deutlich stärker auf Controller ausgerichtetes Menü ist mit dem vorhandenen HTML/CSS-/3D-Aufbau machbar. Dafür muss die Navigation mit überarbeitet werden. Größere Schaltflächen und neue Farben allein beheben die aktuellen Bedienlücken nicht.

### Vorhandene Grundlage

- Zentrale Eingabe für Tastatur, Standard-Controller, eigene Belegungen und kalibrierte Lenkradsignale.
- Automatische Anzeige passender Tastatur-, Xbox-, PlayStation- oder Wheel-Hinweise.
- Getrennte Spiel- und Menükontexte.
- Richtungsnavigation anhand der sichtbaren Elemente und ihrer Position.
- Controller-Bedienung für Auswahlfelder, Schieberegler und Schalter.
- Bildschirmtastatur für den Lobby-Code.
- Belegungserfassung, Kalibrierung und gespeicherte Profile.
- Bereits vorhandene Ein-/Ausblendungen und reduzierte Bewegung.

### Erkannte Lücken, noch nicht behoben

- Zurück-Navigation ist über einzelne Bildschirmfälle verteilt. Es gibt keinen einheitlichen Verlauf mit Wiederherstellung der exakten zuletzt ausgewählten Karte.
- Die geometrische Fokuswahl kann bei neuen großen Layouts in unerwartete Bereiche springen.
- Native Eingabefelder behandeln Tastatur und Controller teilweise unterschiedlich. Auch Range-Inputs fallen unter die allgemeine Erkennung editierbarer Felder.
- Fahrername, Profilname und Netzwerktextfelder haben noch keine gleichwertige Texteingabe mit Controller. Nur Lobby-Codes besitzen ein passendes Tastenfeld.
- Die Connection-Options-Aufklappzeile verwendet summary und fehlt in der aktuellen Liste der per Controller fokussierbaren Elemente.
- Modale Fenster begrenzen die Tab-Navigation noch nicht vollständig. Der Hintergrund wird nicht allgemein mit inert gesperrt.
- Die vorhandenen Tests belegen Funktionslogik, nicht die Qualität einer echten Controller-Sitzung oder aller Bildschirmgrößen.

### Gewünschte spätere Struktur

Hauptmenü, Garage, Teileauswahl, Karte und Einstellungen sollen klare Bildschirmbereiche bekommen. Eine feste Aktionsleiste zeigt immer die aktuell gültigen Tasten.

Für die Garage passen eine große Fahrzeugansicht, eine übersichtliche Kategorieauswahl und wenige große Teilekarten. Preis, verbauter Zustand und Auswirkungen sollen sichtbar sein, bevor gekauft wird. Die Kamerafahrt zum gewählten Bauteil und die Bewegung der Auswahl sollen zusammenpassen.

In den Einstellungen sollen Zeilen, Wertänderung und Hilfetext klar getrennt sein. Links/rechts ändert einen Wert, oben/unten wechselt die Zeile. Kategorien sind per Schultertaste erreichbar. Gesperrte oder nicht verfügbare Aktionen brauchen verständliche Zustände.

Für die Karte passen ein gut sichtbarer Controller-Cursor, eindeutige Symbole, eine kräftige Route und eine Detailkarte zur Auswahl. Die untere Tastenleiste erklärt Verschieben, Zoomen, Markieren und Zurück.

Für die Fahransicht passen ein Rundinstrument unten rechts, eine runde Minimap unten links, ein kleiner Bereich für Telefon und Ziele sowie getrennte Hinweise für Verfolgung und Rennen. Warnungen für Hitze, Öl, Schaden und fehlenden Kraftschluss müssen im Stil bleiben und trotzdem sofort lesbar sein.

Die Navigation benötigt explizite Gruppen oder Nachbarn, eine einheitliche Bildschirmhistorie, Fokuswiederherstellung, kontrollierte Wiederholung beim Halten und saubere Behandlung von Dialogen. Tastatur und Maus bleiben voll nutzbar. Controller-Fokus und Maus-Hover dürfen sich nicht ständig gegenseitig verdrängen.

### Animation

Animationen sollen Auswahl, Wechsel und Ereignisse erklären. Fokus muss sofort erkennbar sein; ein Menüwechsel darf den nächsten Tastendruck nicht verschlucken.

Geeignete spätere Arbeiten sind kurze Bewegungen der Auswahl, Ein-/Ausblenden der Detailkarte, Übergänge zwischen Kategorien, passende Fahrzeugkamera-Fahrten, Zustandswechsel bei Kauf/Einbau und kurze HUD-Reaktionen bei NOS, Schalten oder kritischem Schaden. Dauerndes Wackeln von Zahlen und starkes Flackern wären beim Fahren schlecht lesbar.

Kurze Übergänge im Bereich von ungefähr 120 bis 240 ms können ein Ausgangspunkt sein. Das ist ein Vorschlag, keine aus den Standbildern gemessene Eigenschaft. Reduzierte Bewegung, kleine Displays und breite Bildschirme müssen mitgedacht werden.

Quellen: dist/input.js, dist/navigation.js, dist/game-ui.js, dist/main.js, dist/controls-ui.js, dist/lobby-panel.js, dist/index.html und dist/style.css.

## 7. Referenzregister

SIDEWAYS-Referenzen.zip enthält Originaldateien unter aktuelle_referenzen. Zwei frühere Anhänge liegen separat unter fruehere_anlagen. reference-index.json enthält Größe, Auflösung, tatsächliches Format, Bildanzahl und SHA-256 jeder Datei.

| Originaldatei | Inhalt und Verwendung |
| :--- | :--- |
| image(20261028-184140).png | Kalenderansicht, große Fahrzeugvorschau, Auswahlflächen, Schulter-/Triggertabs und Aktionsleiste. |
| image(20261028-184141).png | Tuning: Kupplungskarten, Preis, Einbauzustand, Vergleichswerte und großes Auto. |
| image(20261028-184144).png | Effekt-Auswahl: Kartenraster neben der Fahrzeugvorschau. |
| image(20261028-184153).png | Größere Effekt-Auswahl mit Fokus, Besitzstatus und Comic-Partikeln. |
| image(20261028-184156).png | Garage: kurze Kategorieliste, große Überschrift und Fahrzeugbühne. |
| image(20261028-184200).png | Runde Geschwindigkeits-/Drehzahlanzeige, Gang und NOS-Bögen. |
| image(20261028-184230).png | Hochformat-Stilreferenz für Zeichnung, Konturen, Textur und kräftige Akzente. |
| image(20261028-184233).png | Breite Stilreferenz für Comic-Rauch und grafische Bewegungslinien. |
| image(20261028-184237).png | Fahr-HUD mit runder Minimap, Rundinstrument und zentralem Zielhinweis. |
| image(20261028-184245).png | Einstellungen mit hervorgehobener Zeile, Erklärung und Aktionsleiste. |
| image(20261028-184249).png | Detailansicht Audio-Einstellungen mit Schiebereglern und Auswahlwerten. |
| image(20261028-184257).png | Große Karte mit Route, Cursor und Controller-Aktionen. |
| image(20261028-184300).png | Kartenpunkt mit Event-Infokarte und klarer Auswahl. |
| image(20261028-184408).png | Präsentationsreferenz für Karten, Typografie, Farbakzente und Effektvorschau. |
| image(20261028-184414).png | Detail des Rundinstruments mit ereignisbezogener Statuszeile. |
| image(20261028-184426).png | Größeres Rundinstrument mit Drehzahl, Gang, NOS, Warnsymbolen und Ereignistext. |
| Speedo_CriticalDamage_2.gif | Übertragene Datei enthält tatsächlich ein einzelnes PNG-Bild, keine GIF-Animation. |
| image(20261028-184446).png | Gesamte Fahransicht mit Telefonhinweis, Verfolgungsstatus, Route und Comic-Effekten. |
| grafik(20261028-081817).png | Früherer Anhang: fehlgeschlagener Download. Kontext für direkte Chat-Dateien. |
| image(20261027-215229).png | Früherer Anhang: Lobby-/Verbindungsproblem. Historischer Fehlerkontext. |

Zur GIF-Datei: Der Originalname bleibt erhalten. Ihre Signatur ist PNG, Auflösung 305 x 200, ein Bild. Es gibt in den vorliegenden Bytes keine Animationsframes. Sie wurde von uns nicht in ein Standbild umgewandelt. Für einen späteren exakten Bewegungsvergleich müsste eine tatsächlich animierte Originaldatei vorliegen, am besten in einem ZIP.

## 8. Bereits vorhandener V11-Spielumfang

Diese Liste beschreibt den vorhandenen Stand. Sie ist keine Behauptung, dass die gesamte frühere Wunschliste vollständig oder mit realer Fahrzeuggenauigkeit erfüllt ist.

- Vier fiktive Fahrzeuge, acht Motorfamilien und 16 Teilekategorien mit insgesamt 48 Varianten.
- Motor und Motorsound des Spielers aus derselben nativen SDK-Sitzung.
- Vier einzelne Radkontakte, Reifenlängs-/Querkräfte, Federung, Dämpfung und Stabilisatorwirkung im vereinfachten Fahrmodell.
- Automatik, sequenzielles Schalten, Kupplung und über Browser-Eingaben kalibrierbare H-Schaltung.
- Handbremse, NOS, Rückwärtsgang und Herunterschalten ohne pauschale Geschwindigkeitsperre.
- Motor-, Kühlungs-, Schmierungs-, Kupplungs-, Getriebe-, Differenzial-, Brems-, Reifen- und Aufhängungszustände.
- Hitze, Fluidverlust, Verschleiß, Überdrehen und Bauteilschäden mit Auswirkungen auf den Antrieb.
- Sieben Karosserie-Verformungsbereiche, abreißende Stoßfänger und mögliche Radverluste.
- Stadt mit Linksverkehr, Signalen, Vierteln, Tankstellen, Mechanikern, Polizei, Tageszeit und Geschwindigkeitskameras.
- Karte, Wegpunkte, Route, runde Minimap, Telefonaufträge, Punkte, Käufe und gespeicherte Karriere.
- Club Race auf Dock 09 mit fünf Gegnern, drei Schwierigkeitsstufen sowie einer, drei oder fünf Runden.
- Time Attack und Drift Rush zusätzlich zu Free Roam.
- Polizeisuche nach letzter Beobachtung, verschiedene Fahr-/Suchrollen, Funkvarianten und Nachtverstärkung.
- Acht aufgezeichnete Funk-Schnipsel, räumliche NPC-Geräusche, Sirenen, Fassadenreflexionen und zustandsabhängige Musik.
- Tastatur, Maus, Controller, eigene Belegungen, Lenkradkalibrierung und unterstützte Controller-Vibration.
- Multiplayer-Free-Roam für bis zu vier Spieler mit Lobby-Code und Regeln.

## 9. Grenzen und bisherige Prüfungen

Keine vollständige BeamNG-Softbody-Simulation. Die Fahrbewegung verwendet einen vereinfachten Körper mit Federkontakten. Vollständige Aufhängungskinematik, separate ungefederte Massen, vollständige Überschläge und jedes einzelne flexible Fahrzeugteil sind nicht simuliert.

NPCs verwenden leichtere Fahrzeugmodelle und vier gerenderte Motorprofile. Sie haben nicht alle dieselbe Motor-/Bauteiltiefe wie der Spieler. Die genaue lokale Dellenform wird nicht an andere Multiplayer-Teilnehmer übertragen.

Lenkrad-Unterstützung bedeutet die Bindung der vom Browser gemeldeten Achsen und Tasten. Es gibt keine implementierte Lenkrad-Drehmoment-Kraftrückmeldung und keine Garantie für jedes G920-/Treiber-/Browser-Setup.

Die V11-Berichte umfassen 161 automatisierte Prüfungen für SDK, Audio, Teile, Rennen, Polizei, Integration, Wärme und Schaden. Der damalige separate ZIP-Audit prüfte 330 Einträge, 329 Manifest-Payloads und die Gleichheit mit den Release-Dateien. Diese Ergebnisse wurden beim Verpacken nicht durch neue Funktionstests ersetzt.

Die Prüfungen sind keine Hörprobe mit Lautsprechern, keine Prüfung der GPU-Darstellung, kein echter Controller-/Lenkradtest und kein Live-Multiplayer über verschiedene Internetanschlüsse. Eine spätere UI-/Audio-Überarbeitung benötigt genau diese praktische Prüfung zusätzlich.

## 10. Für die spätere Fortsetzung

Zuerst diese Grenzen beachten: Der aktuelle Auftrag erlaubt noch keine UI- oder Audio-Implementierung. Auf eine neue ausdrückliche Arbeitsanweisung warten.

Wenn der Nutzer die Umsetzung beauftragt:

1. Die unveränderte V11-Basis aus current/SIDEWAYS-v11.zip verwenden.
2. Die neuen Referenzen und diese Kontextdatei lesen.
3. Tatsächliche Quellpunkte und die Audio-Schnittstelle planen, ohne einen zweiten Motor-Zeitlauf zu erzeugen.
4. Controller-Navigation, Bildschirmhistorie und Fokusregeln vor dem großen visuellen Umbau festlegen.
5. Garage/Teileauswahl, Einstellungen, Karte und HUD zusammenhängend gestalten.
6. Bestehende Spielmechanik, Karriere, Eingabebelegung, Audio-Fokus und Multiplayer-Fehlermeldungen erhalten.
7. Mit realem Browser, Tastatur und Controller sowie verschiedenen Auflösungen prüfen. Audio beim Umschauen und an verschiedenen Fahrzeugpositionen anhören.
8. Änderungen und Grenzen ehrlich benennen und neue Dateien wieder direkt im Chat liefern.

Keine Bilder generieren, solange der Nutzer nicht ausdrücklich darum bittet. Die hochgeladenen Vorlagen dürfen betrachtet und archiviert werden. Keine vorhandene Datei stillschweigend als bereits animiert oder als schon umgesetzte Funktion darstellen.

