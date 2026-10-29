# SIDEWAYS V16 – Phase 1B: Steigungen und Bodenkontakt

V16 erweitert Phase 1 um zusammenhängende Kräfte auf geneigten Straßen. Phase 0 bleibt abgeschlossen; Phase 1 bleibt teilweise erledigt. Alle 156 Anforderungen aus `goal.txt` sind weiterhin in der Fortschrittsliste erfasst. Keine Fahrzeuge, Karten, Motoren oder vorhandenen Teile wurden ersetzt.

## Umsetzung

Steigungen und Gefälle beeinflussen jetzt Rollen, Beschleunigung und Bremsen. Aus den vier bestehenden Radproben entsteht eine lokale Fahrbahnebene. Die horizontale Normalkraft und die vertikalen Reifenkräfte wirken gemeinsam auf das Fahrzeug; die Reifenlast wird vom vertikalen Federanteil getrennt. Ein ausgekuppeltes Auto kann am Hang zurückrollen. Bremsen halten es nur, solange Bremsmoment und Haftung ausreichen. Bei fehlendem Bodenkontakt erzeugt die darunterliegende Straße keine horizontale Kraft.

Beim Zurücksetzen werden Karosserieneigung, Radpositionen und vorherige Bodenhöhen passend zur Straße initialisiert. Dadurch entsteht kein falscher Dämpferstoß beim Spawn am Hang. Die Begrenzung von Wanken und Nicken bezieht sich auf die Straße. Seitliche Haftung bei Parkgeschwindigkeit verhindert künstliches Kriechen auf Querneigungen.

Bodenwellen wirken weiterhin einzeln auf die Räder. Eine Welle unter der linken Spur erreicht das vordere und dann das hintere Rad; Federweg, Wanken und vorhandene Fahrwerksakustik folgen diesen Zuständen. Glatte Wellen speisen die kontinuierliche Dämpferakustik, scharfe Bordsteinkanten zusätzlich den Stoßkanal. Es wurden keine unsichtbaren Zufallsbuckel ergänzt.

## Dateien und betroffene Systeme

| Datei | Zweck |
| --- | --- |
| `dist/road-contact.js` | Lokale Fahrbahnebene und zueinander passende Geschwindigkeits-/Kraftprojektionen. |
| `dist/physics.js` | Hangkräfte, vertikale Reifenimpulse, Normallast, Reset, Feder-Endanschläge und Bremsruhe. Bestehende Wärme-, Verschleiß- und Audiozustände erhalten weiterhin echte Kontaktwerte. |
| `dist/main.js`, `dist/index.html` | V16-Kennung und lesbare Diagnosewerte zur Fahrbahnneigung; vorhandene Spielstände bleiben kompatibel. |
| `dist/multiplayer.js` | Protokoll 12 verhindert gemischte Sitzungen mit dem alten Solver. |
| `qa/road-contact-v16-check.mjs`, `qa/regressions-v16.mjs`, `qa/chassis-performance-v16.mjs` | Neue Hang-/Kontaktprüfungen, aktuelle Regressionen mit erhaltenen historischen Berichten und CPU-Stichprobe. |
| `qa/standalone*-v16*`, `qa/package-v16.mjs`, `.github/workflows/pages.yml` | Prüfung, Paketierung und Veröffentlichung der exakt getesteten HTML. |
| `docs/goal-progress.*`, `kontext.md`, `README.md`, `READ-ME-V16.txt` | Fortschritt, nächste Arbeit und reproduzierbare Prüf-/Buildbefehle. |

## Tests und Messwerte

17 aktuelle funktionale Prüfberichte sind in `qa/release-v16.json` mit Prüfsummen aufgeführt. Dazu gehören:

- Kontakt-/Energieprüfung für 27 Kombinationen aus Längsneigung, Querneigung und Lenkwinkel.
- Alle vier Originalfahrzeuge halten mit Bremsen auf 12 % Steigung und rollen nach dem Lösen in Neutral zurück; kein falscher Stoß beim Hangstart.
- Bremsen, Beschleunigung und Radlasten reagieren auf die Neigung. Eine steile Fläche mit zu geringer Haftung hält den Wagen trotz Bremse nicht fest. Frei fliegende Räder erhalten keine horizontalen Terrainkräfte.
- Einseitige Wellen und Bordsteinkanten erreichen die richtigen Radproben und Audiozustände. Straßen- und Rennfahrwerk zeigen unterschiedliche Federwege.
- Eine vorhandene Straße in Skyline Hills wird mit dem echten Welt-Sampler getestet, einschließlich Rücksetzen und Erhalt bereits beschädigter Räder.
- Die etablierten Prüfungen für Serienfahrzeuge, Drift-Teile, Schaden, Thermik, kosmetische Teile, Kauf/Speichern, Neustart, Eingabe, Navigation, Weltgeometrie, Rennen, Polizei und Netzwerktransport bestehen unverändert. Lediglich Ausgabeversion und erwartete Protokollnummer wurden angepasst.
- Die fertige Offline-HTML läuft in Chromium: Vorschau/Kauf/Speichern, neuer Lauf, Fahren, Karte, Pause mit Escape und Neustart. Keine JavaScript-Fehler oder externen Laufzeitabrufe im Test. Die HTML-Prüfsumme wird vor Paketierung und Pages-Veröffentlichung abgeglichen.

Synthetische Bremsung aus 90 km/h mit Hachi, neuen Reifen und ABS:

| Straße | Bremsweg |
| --- | ---: |
| 12 % Gefälle | 33,30 m |
| Ebene | 29,43 m |
| 12 % Steigung | 27,02 m |

Das sind Spielmesswerte auf definierten Testflächen, keine Messdaten realer Fahrzeuge. Der Test wurde mit konsistenter vertikaler Anfangsgeschwindigkeit auf der Schräge gestartet, nicht durch einen künstlichen Sprung auf die Fahrbahn.

CPU-Stichprobe mit jeweils 1.200 gemessenen Schritten: V16 im Mittel 2,56 ms auf der Ebene und 2,68 ms auf einer gewellten Schräge; V15 unter denselben Eingaben 2,79 bzw. 2,79 ms. In beiden Versionen erfolgen vier Bodenabfragen pro Schritt. Dieser einzelne lokale Lauf umfasst nur Spielerchassis und Motor, keinen vollständigen Welt-/GPU-/Audio-Benchmark und keine FPS-Garantie.

## Grenzen und Fortsetzung

Die technische Grundlage bleibt ein Chassis auf einer Höhenfläche mit dynamischer Federung. Es ist kein frei rotierender 6-DOF-Körper und unterstützt damit noch keine vollständige Überschlagssimulation oder übereinanderliegende Straßen. Die Fahrbahnebene wird aus dem Fahrzeugfußabdruck angenähert; einzelne Kanten bleiben getrennte Federkontakte. Nicht jeder Straßenmeter wurde gefahren. Hardware-Wheels, Lautsprecherwiedergabe und Multiplayer über mehrere echte Rechner wurden nicht geprüft.

Phase 1C folgt mit FWD/AWD-Kraftpfaden, Antriebs-/Differenzialdaten und ihrer Integration in Teile, Kompatibilität, Kauf und Speichern. Die bisherigen vier RWD-Autos bleiben dabei erhalten; es gibt noch keine anderen Kraftpfade im aktuellen Solver. Wheel Hop, Wetterkopplung, Reifendruck/Flatspots und Aero-Teile sind ebenfalls offen. Dafür fehlen eigene Zustandsgrößen bzw. abgestimmte Kraftmodelle.

Phase 2 benötigt danach das erweiterte Komponenten-/Reifenschema. Cockpits, Fahrer, einzelne Karosseriebefestigungen, Motorraum und räumliche Garagenübergänge sind weiterhin spätere offene Arbeiten. Vollständige Zuordnung: [Fortschrittsliste](https://github.com/TheSimonMC/sideways/blob/main/docs/goal-progress.md).
