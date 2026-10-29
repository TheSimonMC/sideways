# SIDEWAYS V12 – aktueller Stand

Stand: 28. Oktober 2026. Grundlage ist das unveränderte V11-Gesamtpaket des Nutzers. Die Umsetzung wurde anschließend ausdrücklich beauftragt.

Die Garage hat eine Fahrzeugbühne, Kategorien und Teilekarten mit Preisen, Besitz, Einbauzustand und Vergleich zum aktuellen Aufbau. Vorschau und Kauf bleiben getrennt. Einstellungen, große Karte und Rundinstrument sind überarbeitet. Die vollständige GIF-Referenz (305 Frames, 6,1 Sekunden) wurde berücksichtigt: kurzer Schadensübergang, anschließend stabile rote Warnung; reduzierte Bewegung unterdrückt die Verzerrung.

Die Controller-Navigation verwendet Bildschirmhistorie, Fokuswiederherstellung, Gruppen, modale Tab-Grenzen und eine virtuelle Tastatur für Textfelder. Maus und Tastatur bleiben nutzbar. View/Select wechselt in der Karte zwischen Cursor und Orten; B/Kreis führt zurück.

Native Audiopunkte folgen den sichtbaren Endrohren einschließlich Verformung sowie Motor, Ansaugung, Getriebe, Differenzial und Rädern. Position und Orientierung der Kamera bestimmen den Hörer. Top-down verwendet bewusst eine nahe Hörperspektive. Die SDK-Erweiterung erzeugt alle Quellen in einem gemeinsamen Renderdurchlauf. Sie ist in sdk/SIDEWAYS-EXTENSION.md dokumentiert. MotorLab bleibt Version 1.6.3; diese Erweiterung ist kein offizielles SDK-Update.

Die vorherige Mechanik, Karriere, Polizei, Rennen, Schaden und Multiplayer bleiben Grundlage. Es wurde keine vollständige BeamNG-Softbody-Simulation oder Lenkrad-Drehmomentsteuerung ergänzt. NPCs behalten ihre leichteren Klangmodelle. Reflexionen verwenden angenäherte Fassadenebenen und generische Ohrfilter.

Spielstart: SIDEWAYS.html im ZIP-Hauptordner. Die separat gelieferte SIDEWAYS-v12.html hat identische Bytes. Singleplayer funktioniert offline; Multiplayer braucht weiterhin Netzverbindungen. Keine Sites-Veröffentlichung.

READ-ME-V12.txt erklärt Bedienung, Build und Grenzen. qa/release-v12.json nennt die aktuellen Prüfergebnisse; ältere QA-Dateien sind historische Nachweise. Ein SDK-Replay-Hashfehler tritt auch im unveränderten Original unter derselben Laufzeit auf und steht in qa/sdk-v12-baseline.json. Physische Controller/Lenkräder, echte Mehr-PC-Verbindungen und Hörtests auf Lautsprechern waren hier nicht verfügbar.

Die ursprüngliche kontext.md liegt unverändert in docs/kontext-v11-historisch.md. Ihre alte Grenze „noch nichts ändern“ beschreibt nur den früheren Übergabeschritt.
