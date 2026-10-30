# SIDEWAYS V27 – Phase 3C: räumliche Kontakte

Verbindlich bleiben docs/goal.txt und alle 156 Anforderungen in docs/goal-progress.md/.json. SHA-256 4baa27bd5a4d96ab40582166e0fd6095b803dc262f6140dc282ea844a1b96dca. Gesamtziel aktiv; main, Pages und Release sind autorisiert. Vorheriger Kontext: docs/kontext-v26-historisch.md.

part-contacts.js enthält reine 3D-Mathematik und SAT-Boxkontakte. part-shapes.js liefert pro Build zwischengespeicherte Formen und dieselben Scharnier-/Karosserietransformationen wie der Renderer. hinge-contacts.js prüft alle vier beweglichen Paneele entlang ihrer vorherigen/neuen Stellung. Hindernishöhen und Bodenkontakt, Gegenimpuls am Fahrzeug, Scharnierträgheit, Energie und Befestigungsschaden greifen ineinander. body-hinges.js exportiert openDoorContacts weiterhin als Kompatibilitätsnamen.

physics.js integriert Scharnierkontakte nach der Scharnierbewegung, bei Fahrt und im geparkten Zustand; Parkinteraktion erzeugt keinen zusätzlichen Verschleiß. Lose Paneele erhalten ihre räumlichen Achsen, Maße und Winkelgeschwindigkeit. panel-debris.js löst Boden-/Wandkontakte und Reibung; advanceLooseWheel koppelt lineare Bewegung und Rotation, Hangkräfte sowie lageabhängiges Ausrollen/Kippen. car.js rendert diese Achsen und die tatsächliche Reifenbreite. Pools: acht Karosserieteile, acht Räder, 24 Glasfragmente; Ablauf und Entfernungsgrenzen bleiben begrenzt.

city.js, county-architecture.js, region.js und world.js ergänzen Höhen bestehender Kollisionsobjekte. Brückenleitplanken haben zusätzlich exakt die gerenderte Neigung und Mitte. Vorhandene Welt/Modelle/SDK bleiben erhalten. Das Netzformat bleibt Protokoll 18, Zustand Version 3; Trümmer werden weder gespeichert noch übertragen, fehlende Teile und Scharnierstellungen weiterhin schon.

Build: node build.mjs. Tests/Release: qa/release-v27.json und docs/phase-3c-contacts-report.md. Historische QA nicht überschreiben. Paket: node qa/package-v27.mjs ../../outputs. Quellen-/HTML-Hashes müssen den Belegen entsprechen. Alle Fertigmeldungen an ausgeführte Tests binden.

Nächster Schritt: einzelne ablösbare Fahrwerksglieder und vollständige Auspuffführung aus Phase 3, dann Phase 4 mit vier passenden Innenräumen, Cockpit, Instrumenten, Navigation und Fahrer. Keine vollständige Phase 3/4/6 behaupten. Die Grenzen von Phase 1/2 und alle späteren Punkte bleiben vermerkt. Vereinfachte Kontaktboxen ersetzen keine exakte Deformations-/Mehrkörpersimulation; Trümmer kollidieren nicht miteinander oder mit dynamischen Verkehrsteilnehmern.
