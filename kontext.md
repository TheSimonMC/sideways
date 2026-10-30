# SIDEWAYS V28 – Phase 3D: Unterboden und Auspuff

Verbindlich: docs/goal.txt und alle 156 Anforderungen in docs/goal-progress.md/.json. SHA-256 4baa27bd5a4d96ab40582166e0fd6095b803dc262f6140dc282ea844a1b96dca. Gesamtziel aktiv. Direkte Veröffentlichung auf main, Pages und Release ist autorisiert. Historischer Kontext: docs/kontext-v27-historisch.md.

underbody.js definiert 13 feste Baugruppen, Layouts, Befestigungen/Quetschung/Biegung, Treffer, Abstützung, Einzelreparatur und Abgasweg. underbody-view.js fasst Geometrie je Baugruppe in einem Mesh zusammen und verbindet Federweg/Lenkwinkel mit der Darstellung. car.js lässt die Achsräume unter der bestehenden Hülle frei. Die Teile werden im vorhandenen Acht-Objekte-Pool als echte Meshes simuliert; lose Räder behalten ihren eigenen Acht-Objekte-Pool.

bodyDamage Version 4 enthält underbody; alte Saves ergänzen intakte Baugruppen. Bestehende suspensionHealth, chassisDamage und health.exhaust bleiben für mechanischen Verschleiß zuständig, die neue Struktur für Befestigungen/Quetschung. Fehlende Arme/Federbeine nehmen Radlast weg, fehlende Spurstangen trennen die Lenkung; Unterboden- und Radmasse fehlen nach Abreißen. Reparaturen bleiben spezifisch. Reifenwechsel allein repariert keine fehlenden Lenker. Der Exterieur-Endrohrsatz benötigt den hinteren Auspuffabschnitt.

exhaustRoute stoppt die verbundene Strömung am ersten fehlenden Abschnitt. Nachfolgende Quetschungen erzeugen dann keine zusätzliche Last. Geräuschanker/Rauch wechseln an diese Öffnung, Endrohrflammen entfallen. Native SDK-Dateien unverändert. Multiplayer bleibt Protokoll 18; feste Strukturfelder, Radsturz und Spurstangen werden begrenzt übertragen. Alte Clients ignorieren Zusatzfelder. Trümmer bleiben lokal.

Build: node build.mjs. Nachweise: qa/release-v28.json, docs/phase-3d-underbody-report.md. Historische QA behalten; Hashes müssen den ausgelieferten Quellen entsprechen. Browser und native CPU-Benchmarks seriell ausführen (Speichergrenze). Paket: node qa/package-v28.mjs ../../outputs.

Nächste Phase 4: vier zum Modell passende Innenräume, Cockpitkamera, Instrumente, Radio-Navigation, Spiegel und Fahrer. Alle späteren und teilweise offenen frühen Anforderungen bleiben in der vollständigen Liste. Keine Cockpit-/Motorraum-/Gesamtfertigstellung behaupten. Die Gelenke und Rohrkontakte sind Browser-Näherungen, keine volle Soft-Body-/Mehrkörpersimulation.
