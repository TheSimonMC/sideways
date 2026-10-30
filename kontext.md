# SIDEWAYS V29 – Phase 4

Verbindlich: docs/goal.txt, alle 156 Anforderungen in docs/goal-progress.md/.json. SHA-256 4baa27bd5a4d96ab40582166e0fd6095b803dc262f6140dc282ea844a1b96dca. Gesamtziel aktiv. Direkte Veröffentlichung auf main, Pages und Release ist autorisiert. Fahrzeuge, Karten, vorhandene Teile und MotorLab SDK bleiben erhalten.

Phase 4 liefert vier modellgerechte Innenräume, Kameraindex 3, Sitz/FOV/Bewegung, tatsächliche Instrumente und Radio-Navigation, drei begrenzte Spiegel sowie den gegliederten Fahrer. Details: docs/phase-4-cockpit-report.md. createInterior sitzt im bestehenden car.js-Modell; Türverkleidungen folgen den Panel-Wurzeln. Die Player-Kabine wird einmal pro Frame mit echten Daten/Kartenrenderer aktualisiert; entfernte Wagen nutzen den vorhandenen Updatepfad. Geometrie/Material/Canvastexturen werden durch die bestehende Modellentsorgung freigegeben, Spiegel-Targets separat.

cockpit-state.js definiert Augenpunkt/Layout/Anzeigen und gespeicherte Einstellungen. driver.js nutzt Lenkwinkel mal Rack-Ratio, Umgreifen und die zur Konsole liegende Hand. Clutch im Physics-State bedeutet gedrücktes Pedal; nicht invertieren. input.js wheelRotation=0 behält das alte Vollanschlagverhalten; positive Gradwerte gelten nur für deviceKind wheel. Browser-Gamepad-Kalibrierung und Profile bleiben zuständig.

Multiplayer bleibt Protokoll 18; Fahrerbedienung, Tank, Temperatur/Öldruck/Spannung sind begrenzt im vorhandenen Posepaket. Keine zusätzliche Nachrichtenrate. RATE_LIMIT-Burst- und echte Zwei-Spieler-Tests bleiben Pflicht bei Netzwerkänderungen. Lose Trümmer bleiben lokal.

Nachweise: qa/release-v29.json, qa/review-v29.json. Build: node build.mjs. Browser und native Lasttests seriell ausführen. Paket: node qa/package-v29.mjs ../../outputs. Die Build-/Browser-/Release-Hashes müssen den tatsächlich getesteten Quellen entsprechen. gemischte EOL bewusst erhalten (.gitattributes * -text).

Nächste Phase 5: alle fehlenden Tuningteile, insbesondere Interieur, Tönung und Kompressor, mit Besitz, Kosten, Save, Befestigungen und realen Wirkungen erweitern. Phase 6 Motorraum/Montage folgt. Frühere teilweise Punkte und sämtliche späteren Anforderungen bleiben offen wie aufgelistet. Keine Gesamtfertigstellung oder Hardware-Wheel-/FFB-/GPU-Abnahme behaupten.
