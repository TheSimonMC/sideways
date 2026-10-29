# MotorLab: den vorhandenen Motor in ein Spiel einbauen

MotorLab ergänzt die vorhandene Engine um eine JavaScript-API. SDK **1.6.3**, `physicsRelease: 14` und `audioRelease: 14`, bietet getrennte Klang-Layer mit Pre-Reglern, lokaler Distortion, Post-Pegeln und einer gemeinsamen Hörperspektive. Die bisherigen Aufrufe bleiben gültig. `renderAudio()` und `connectAudio()` erhalten die neue Akustik ohne neue Pflichtoption. Sitzungsdateien verwenden weiterhin Version 1. Es gibt keine npm-Abhängigkeit und keinen Download während der Ausführung.

Die zehn flachen Quellenregler bleiben erhalten: `exhaust`, `intake`, `combustion`, `valve`, `bearing`, `boost`, `manifold`, `mechanical`, `gearbox` und `chain`. Sie sind jetzt die Post-Pegel der bearbeiteten Layer, jeweils von 0 bis 1. `master` wirkt anschließend linear auf den fertigen Hörmix. Neue Sitzungen beginnen mit `master: 0.6`; gespeicherte oder ausdrücklich gesetzte Lautstärken bleiben erhalten. Eine Änderung der Gesamtlautstärke ändert deshalb nicht die Distortion eines Layers. Die neuen Samples sind absichtlich nicht identisch mit älteren Audioversionen.

```js
engine.setAudio({
  bite: 0.7,
  exhaust: 0.64,                 // Post-Pegel des Auspuffs
  layers: {
    exhaust: {preGain: 1.3, distortion: 0.6},
    combustion: {distortion: 0.15}
  },
  listener: {
    mode: 'outside', distance: 1.5,
    azimuth: 90, reflections: 0.12
  }
});

// Ändert nur diesen Wert. Andere Layer und ihre Einstellungen bleiben erhalten.
engine.setAudio({layers: {exhaust: {preGain: 1.1}}});
engine.setVolume(0.2);
```

`layers` akzeptiert nur die zehn vorhandenen Quellnamen. Jeder Layer besitzt vier optionale Felder:

- `enabled`: Layer in den Ausgang übernehmen, standardmäßig `true`.
- `solo`: ausdrücklich nur die gewählten Solo-Layer abhören, standardmäßig `false`. Mehrere Solo-Layer können gemeinsam laufen. Ausgeschaltete Layer bleiben auch bei Solo aus.
- `preGain`: Verstärkung vor der lokalen Bearbeitung, von 0 bis 4, standardmäßig 1.
- `distortion`: lokaler Distortion-Anteil, von 0 bis 1. Der globale Regler `bite` steuert die gemeinsame Distortion-Stärke, bleibt standardmäßig 0,6 und schaltet die klangliche Distortion bei 0 aus.

Die Standardwerte für `distortion` lauten: Auspuff 0,55, Ansaugung 0,15, Verbrennung 0,20, Ventile 0,08, Lager 0, Aufladung 0,08, Krümmer 0,45, Kolben/Mechanik 0,18, Getriebe 0,10 und Ketten 0,12. Alte Spielstände ohne `layers` erhalten diese Werte. Ein partieller Aufruf übernimmt nur die ausdrücklich genannten Felder, auch innerhalb eines einzelnen Layers. Eingaben werden vollständig geprüft, bevor der Zustand ersetzt wird. Ungültige Felder, unbekannte Layer und Werte außerhalb ihrer Grenzen werden verworfen; der vorherige Zustand bleibt bestehen.

`listener` verändert die Hörübertragung nach den Layern:

- `mode`: `direct`, `outside`, `engine` oder `cabin`. Voreinstellung ist `outside`.
- `distance`: Abstand von 0,5 bis 20 Metern, voreingestellt 1,5 Meter.
- `azimuth`: Winkel von -180 bis 180 Grad, voreingestellt 90 Grad für eine seitliche Außenperspektive. Gespeicherte oder ausdrücklich gesetzte Winkel bleiben erhalten.
- `reflections`: Reflexionsanteil von 0 bis 1, voreingestellt 0,12.

Die räumliche Übertragung ist eine akustische Näherung. Sie ist weder eine individuelle HRTF-Messung noch eine Kalibrierung von Kopfhörern oder Lautsprechern. `direct` lässt die räumliche Perspektive aus; die anderen Hörregler bleiben gespeichert. Es werden keine Bauteilgeräusche ergänzt, wenn die entsprechende Anregung fehlt. Kettengeräusche benötigen `configuration.engine.timingDrive: 'chain'` bei einem Viertakter oder `configuration.drivetrain.finalDriveType: 'chain'` bei einem Fahrzeug.

Alle Regler betreffen die Akustik. Sie verändern weder Kraftstoff, Zündungen noch Gangübersetzungen. Die optionalen akustischen Geometriefelder `timingCrankTeeth`, `meshTeeth` und `chainDriveTeeth` bleiben deklarierte Modellannahmen. Der neue optionale Motorparameter `firingOrder` gehört dagegen zur physikalischen Konfiguration: Er beschreibt eine 1-basierte Zündfolge als Zeichenfolge, beispielsweise `1-8-4-3-6-5-7-2`. Ein leerer oder fehlender Wert erhält die bisherige Reihenfolge. Alte gespeicherte Zylinderzustände werden nicht stillschweigend umsortiert.

### Pegel getrennt ablesen

`getAudioStatus()` liefert nach einem gerenderten Block zusätzlich die letzten `sources`-, `layers`- und `mix`-Messwerte. Die Abfrage setzt kein Messfenster zurück. Alle zurückgegebenen Objekte sind unabhängige Kopien.

- `sources[key]` behält die alte Ebene bei: gefilterte Quelle nach dem flachen Quellenregler, vor neuer Layer-Bearbeitung und Master. Diese internen Werte können über 0 dBFS liegen.
- `layers[key]` misst den bearbeiteten Layer nach seinem Post-Pegel, vor räumlicher Übertragung und Master.
- `meter` bleibt die RMS-/Peak-Messung des tatsächlich geschriebenen, gegebenenfalls zeitlupenrekonstruierten Stereoblocks. `mix.headroomDb` wird ebenfalls aus diesen ausgegebenen Float32-Samples berechnet.
- `sourceWindowSeconds` nennt die Dauer des zuletzt gelesenen Quellfensters auf der akustischen Zeitbasis. Eine Statusabfrage ohne neuen Audioblock liefert denselben Messstand.

Im direkten `MotorAcoustics.meter()`-Ergebnis heißen die Ebenen `sources`, `layers`, `master` und `mix`. Dieser tiefere Aufruf beendet sein Quellenmessfenster; der SDK-Adapter ruft ihn deshalb nur einmal je tatsächlich gerendertem Block auf. Ein Gesamtpegel wird nicht aus Quellpegeln zusammengerechnet.

Für den einfachen Browsertransport kann weiterhin etwa `await engine.connectAudio({bufferSize: 2048})` aus einer Bediengeste aufgerufen werden. Die bestehende Option wählt einen echten ScriptProcessor-Puffer; voreingestellt bleiben 1024 Frames. Die neue Sandbox-Auswahl für `renderSizeHint` gehört zum separaten `SimulationDriver` und wird nicht als neues Quellenfeld in `setAudio()` eingeführt. Direkte Driver-Nutzer können optional `renderSizeHint: 1024` im Konstruktor setzen und später `await driver.setRenderSizeHint(2048)` verwenden. Ohne Angabe behält der Driver seinen bisherigen Browserstandard. `driver.getAudioBufferInfo()` meldet gewünschte und tatsächlich verwendete Blockgröße sowie einen gegebenenfalls nötigen Rückfall.

## In wenigen Zeilen starten

`motor-engine.js` einmal mit einem normalen Script-Tag laden. Es stellt nur den neuen Namen `MotorLab` bereit. Ein vorhandenes `EngineCore` oder `VehicleCore` wird weder überschrieben noch erneut im globalen lexikalischen Namensraum deklariert.

```html
<script src="motor-engine.js"></script>
<script>
const engine = MotorLab.createEngine('i4');
engine.start();
let previous = performance.now();
function frame(now) {
  engine.setInputs({throttle: 0.3, loadNm: 12});
  const state = engine.update((now - previous) / 1000);
  previous = now;
  document.title = Math.round(state.rpm) + ' rpm';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```

Das ist ein vollständiger Motortakt ohne Audiogerät. `deltaSeconds` ist in **Sekunden**, nicht Millisekunden. In einer eigenen Game-Loop ersetzt `engine.update(deltaSeconds)` die eigene Zeitintegration dieses Motors. Die übrige Spielwelt kann ihren bisherigen Takt behalten.

Node/CommonJS: `const MotorLab = require('./motor-engine.cjs');`. ESM: `import MotorLab from './motor-engine.mjs';`. Für ESM sind zusätzlich `EngineCore`, `VehicleCore` und `SimulationDriver` als benannte Exporte enthalten. Die Classic- und CommonJS-Bundles lassen sie unter `MotorLab.legacy` erreichbar. TypeScript-Deklarationen liegen passend zu den Dateiformaten in `motor-engine.d.ts`, `motor-engine.d.mts` und `motor-engine.d.cts`. Die Classic-Deklaration beschreibt direkt das globale `MotorLab.createEngine`. Ohne Audiobenutzung wird kein Browserobjekt angelegt. Ein Serverlauf benötigt weder DOM noch Web Audio.

## Motor oder vollständiges Fahrzeug

```js
const engine = MotorLab.createEngine('bmw-m3-e46-2002-us');
const car = MotorLab.createVehicle('bmw-m3-e46-2002-us');
const largeV8 = MotorLab.createEngine({preset: 'v8', displacementCc: 12000});
const rotor = MotorLab.createEngine('renesis');
```

`createEngine` integriert nur den Motor. Es erfindet keine Fahrzeuggeschwindigkeit; `speedMps` und `speedKph` sind deshalb `null`. Diese Variante passt, wenn ein vorhandenes Spiel bereits Räder, Kollisionen, Getriebe und Fahrzeugbewegung berechnet.

`createVehicle` integriert zusätzlich das vorhandene eindimensionale Fahrzeugmodell mit Übersetzungen, Kupplung, Schaltvorgang, Radträgheit, Widerständen und Bremsen. Bei benannten Fahrzeugen übernimmt es das bestehende Antriebsprofil. Die Geschwindigkeit stammt aus diesem Modell. Diese Variante eignet sich für einen eigenständigen Prototyp oder für Spiele, die diese Fahrphysik vollständig übernehmen. Sie ist kein allgemeiner 3D-Fahrzeugsolver. Berechnet ein anderes Physiksystem bereits die Radkräfte und Bewegung, ist `createEngine` die passende Kopplung.

Der kalte Fahrzeugzustand beginnt in Neutral mit getretener Kupplung und angezogener Parkbremse, genau wie im bisherigen Kern. Beispielsweise:

```js
car.start();
car.setInputs({parking: false, clutch: 1, gear: 1, throttle: 0.3});
// Während des Schaltens weiter update(deltaSeconds) ausführen.
// Anschließend den Kupplungsbefehl freigeben; die reale Pedalbewegung bleibt simuliert.
car.setInputs({clutch: 0});
```

`gear` ist ein Alias für `gearRequest`. Es ist eine **Schaltanforderung**. Der Adapter setzt keinen Gangzustand, keine Drehzahl und keine Geschwindigkeit direkt. Das bestehende Getriebe prüft Kupplung, Synchronisierung und Rückwärtssperre. Fahrzeuge ohne Rückwärtsgang erhalten dadurch keinen künstlichen Rückwärtsgang. `state.drive.gear`, `requestedGear`, `shiftProgress` und `message` zeigen den tatsächlichen Zustand.

## Redline und RPM-Begrenzer getrennt einstellen

```js
const engine = MotorLab.createEngine({
  preset: 'i4',
  overrides: {
    redlineEnabled: false,
    revLimiterEnabled: false
  }
});
engine.start();
```

`redlineEnabled` steuert nur die Warnmarkierung der Sandbox. `revLimiterEnabled` steuert die echte Drehzahlabschaltung des Motorkerns. Bei `false` unterbricht diese Regelung keine Zündungen beziehungsweise Einspritzungen, und die Drehzahl folgt weiterhin der berechneten Momentenbilanz. Die gespeicherte `redlineRpm` bleibt als Referenzwert erhalten. Es wird keine Drehzahl gesetzt oder gekappt.

Mit einem positiven `revLimitRpm` lässt sich die Abschaltdrehzahl von der sichtbaren Redline trennen:

```js
const engine = MotorLab.createEngine({
  preset: 'renesis',
  overrides: {
    redlineEnabled: true, redlineRpm: 9000,
    revLimiterEnabled: true, revLimitRpm: 9200
  }
});
```

`revLimitRpm: 0` bedeutet, dass der Begrenzer wie bisher `redlineRpm` verwendet. Fehlende neue Werte werden als `redlineEnabled: true`, `revLimiterEnabled: true` und `revLimitRpm: 0` ergänzt. Diese Konfigurationswerte gehören zu `overrides`, `family` oder der vollständigen `configuration`, nicht zu den laufenden `setInputs`-Befehlen. `save()`, `fromState()` und `reset()` erhalten die Wahl.

Ein ausgeschalteter Begrenzer macht das Modell nicht für beliebig hohe Drehzahlen gültig. Die einstellbaren Drehzahlreferenzen und positiven Abschaltschwellen reichen bis 30000 U/min; numerisch unzulässige Zustände lösen weiterhin einen Fehler aus. Geometrische Empfehlungen sind keine Festigkeitsfreigabe, und ein mechanischer Motorschaden bei Überdrehzahl wird nicht simuliert.

## Eigene Gangzahl und Übersetzungen

`drivetrain.gears` enthält **eine bis zwölf** positive, streng absteigende Vorwärtsübersetzungen. Die Anzahl der Einträge ist die Gangzahl. `VehicleCore.MAX_GEARS` liefert die unterstützte Obergrenze. Beispielsweise:

```js
const {EngineCore, VehicleCore} = MotorLab.legacy;
const engine = EngineCore.defaults('i4');
const drivetrain = VehicleCore.defaults(engine);
drivetrain.gears = [4.1, 3.0, 2.25, 1.75, 1.4, 1.12, 0.9, 0.72];
drivetrain.finalDrive = 3.7;
const car = MotorLab.createVehicle({configuration: {engine, drivetrain}});
const ratios = VehicleCore.gearInfo({engine, drivetrain}, {referenceRpm: 6500});
console.log(ratios.gears.at(-1).speedAtReferenceKmh);
```

Die Primärübersetzung `primaryDrive`, Gangübersetzung und Achsübersetzung `finalDrive` wirken zusammen auf Kupplung, Motordrehzahl und Radkraft. Der Aufruf oben verwendet dieselbe Kupplungs- und Synchronisierungsrechnung wie das bisherige Getriebe. Acht oder zwölf Einträge erzeugen keine Wandlerautomatik oder zusätzliche Schaltsteuerung.

`gearInfo` ergänzt `referenceRpm`, `limitRpm`, `revLimiterEnabled`, `redlineEnabled` und `maxGears`. Jeder Gang besitzt `speedAtReferenceKmh` und `nextGearRpmAtReference`. Ohne ausdrücklich gewählte Referenz gilt die aktive effektive Abschaltdrehzahl, bei ausgeschaltetem Begrenzer die gespeicherte `redlineRpm`. Die bisherigen Felder `redlineRpm`, `speedAtRedlineKmh` und `nextGearRpmAtRedline` behalten ihre ursprüngliche Bedeutung. Alle Geschwindigkeiten dieser Tabelle sind kinematische Werte bei geschlossenem Kraftschluss. Eine daraus ausgelegte Geschwindigkeit im letzten Gang begrenzt das Fahrzeug nicht; Motorleistung und Fahrwiderstände bestimmen weiterhin, ob sie tatsächlich erreicht wird. `speedLimit` ist der davon getrennte vorhandene Geschwindigkeitsregler.

## Parallel arbeitenden Twin-Turbo verwenden

```js
const twin = MotorLab.createEngine({
  family: {kind: 'four', layout: 'v', cylinderCount: 8,
    boost: 'turbo', turboCount: 2},
  displacementCc: 6000
});
twin.start();
twin.setInputs({throttle: 0.4, boostTarget: 80000});
const state = twin.update(1 / 60);
const shafts = state.boost.units;
// shafts[0] und shafts[1]: eigener Winkel, Drehzahl, Energie und Durchsatz.
```

`family` erzeugt passend skalierte Hardware für zwei parallele Lader. `turboCount` unterstützt `1` und `2`, Standard ist `1`. Bestehende Felder wie `turboMaxFlow`, `turboInertia`, `turboRadius`, `turbineArea`, `wastegateArea` und `bypassArea` gelten **je Lader**. Wer diese Felder über `overrides` ausdrücklich setzt, gibt die Hardwaregröße jeder Einheit selbst vor.

Twin-Zustände besitzen `boost.units` und `signal.turboUnits` mit zwei getrennten Elementen. Skalare Flüsse, Leistungen und Energien sind Summen, während die bisherigen skalaren Angaben zu Winkel und Drehzahl die erste Welle beschreiben. Gemeinsame Druckwerte werden nicht addiert. Bei Einzelladern fehlen die zusätzlichen Arrays weiterhin. Das vorhandene `save()`, `MotorLab.fromState()` und die PCM-Ausgabe verwenden auch für Twin-Turbo dieselbe Aufrufstruktur und erhalten beide Wellenzustände.

Abgas- und Ladeluftvolumen sind in diesem Modell gemeinsam. Es gibt keine sequentielle Zuschaltung, Compound-Stufung oder getrennte Zylinderbank-Krümmer. Die Hardwareauslegung ist ein geometrisches Modell mit vereinfachtem Verdichterkennfeld.

## Eingaben und Einheiten

| Eingabe | Bedeutung |
| --- | --- |
| `throttle` | Fahrpedal 0 bis 1 |
| `loadNm` oder `load` | Zusätzliches widerstehendes Wellenmoment, 0 bis 100000 Nm |
| `externalTorqueNm` | Nur Motorbetrieb: vorzeichenbehaftetes äußeres Wellenmoment, -100000 bis +100000 Nm; positives Moment beschleunigt die positive Wellenrichtung |
| `clutch` | Nur Fahrzeug: 1 bedeutet Pedal getreten und Kupplung getrennt, 0 bedeutet Pedal losgelassen |
| `brake` | Nur Fahrzeug: Bremse 0 bis 1 |
| `parking` | Nur Fahrzeug: Parkbremse als Wahrheitswert |
| `gear` oder `gearRequest` | Nur Fahrzeug: -1 rückwärts, 0 neutral, 1 bis Zahl der Vorwärtsgänge |
| `reverseUnlock` | Nur Fahrzeug: bewusste Freigabe der bestehenden Rückwärtssperre |
| `fuel`, `ignition`, `starter` | Unveränderte Kernbedienwerte als Wahrheitswerte |
| `starterSeconds` | Nur zusammen mit `starter: true`; einmalige Laufzeit über 0 bis 10 s |
| `lambdaTarget`, `advance`, `injectionAdvance` | Unveränderte Gemisch- und Zünd-/Einspritzwerte des Kerns; Winkel in Grad |
| `wastegate`, `bypass` | Unveränderte Maschinenventilbefehle, 0 bis 1 |
| `boostTarget` | Gewünschter Überdruck vor der Drosselklappe in Pa, 0 bis 500000; wirkt über Wastegate beziehungsweise Kompressor-Bypass |
| `intakeCamAdvance`, `exhaustCamAdvance` | Nur Viertakt-Kolbenmotor: Zielverstellung der Einlass- und Auslassnocken in Kurbelgrad, -40 bis +40; positiv bedeutet früher |
| `cylinders` | Freigaben der realen Brennkammern; beim Wankel drei Kammern pro Rotor |

Unbekannte Bedienwerte, ungültige Bereiche und widersprüchliche Aliaspaare lösen Fehler aus. Werte werden nicht still begrenzt. `setInputs` setzt nur die mitgegebenen Felder. Ein einmal ausgelaufener Starter wird bei späteren Gaspedalbefehlen nicht erneut eingeschaltet.

`start({starterSeconds: 1.5})` schaltet Kraftstoff, Zündung und einen zeitlich begrenzten Starter ein und beendet eine Pause. `stop()` schaltet diese drei Quellen ab. Welle, Fahrzeug, Turbo und gespeicherte Energie laufen danach physikalisch aus. `pause(true)` hält dagegen den Takt an. `reset()` erzeugt einen kalten Zustand derselben Konfiguration und verwirft bewusst den bisherigen Verlauf.

### Ventilsteuerung und Ladedruck während des Spiels

```js
const engine = MotorLab.createEngine('turbo');
engine.setInputs({
  boostTarget: 80000,          // 0,80 bar Überdruck als Regelziel
  intakeCamAdvance: 12,       // Einlassöffnung und -schluss 12° früher
  exhaustCamAdvance: -6      // Auslassöffnung und -schluss 6° später
});
engine.start();
const state = engine.update(1 / 60);
console.log(state.camPhaser); // tatsächliche, noch laufende Verstellung
console.log(state.boost.wastegateOpening, state.charge.p);
```

`state.controls` enthält die Zielwerte. `state.camPhaser.intakeAdvance` und `exhaustAdvance` enthalten die erreichten Winkel. Der Steller arbeitet in Simulationszeit mit der konfigurierten Höchstgeschwindigkeit `camPhaserRate`, standardmäßig 180 Kurbelgrad pro Sekunde. Dieser Wert ist eine allgemeine Modellannahme, keine rekonstruierte Herstellerkennlinie. Pause hält ihn an, Zeitlupe verlangsamt ihn zusammen mit dem Motor. Die tatsächlichen Winkel verändern die Ventilöffnung und damit Gaswechsel, Füllung und Arbeit. Es gibt keinen davon getrennten Leistungsbonus.

Nicht jede Stellung innerhalb von -40 bis +40 Grad passt zu jeder Geometrie. Der Kern prüft die vereinfachte Ventil-/Kolbengeometrie einschließlich des Verstellweges und lehnt widersprüchliche Befehle ab, bevor der bestehende Zustand verändert wird. Zweitakt- und Wankelmotoren akzeptieren für diese beiden Regler ausschließlich null. Die zusätzlichen Eingaben sind auch über die bisherigen `Engine.setControls()`- und Fahrzeugaufrufe verfügbar.

Das Ladedruckziel wird beim Erstellen aus `configuration.boostTarget` übernommen. Ein neuer Zielwert ersetzt keinen Druckzustand. Abgasenergie, Wellenträgheit, Verdichterstrom und Ventile bestimmen weiterhin, ob und wann der Motor ihn erreicht. `charge.p` ist der absolute Druck vor der Drosselklappe, `intake.p` der absolute Saugrohrdruck dahinter. Für Überdruck jeweils `state.config.ambientP` abziehen; 100000 Pa entsprechen 1 bar. Der zusätzliche Wellenwiderstand bleibt über `loadNm` verfügbar. Im Fahrzeugbetrieb kommt diese Last zur vorhandenen Getrieberückwirkung hinzu.

### Mit einer vorhandenen Spielphysik koppeln

```js
engine.setInputs({throttle: pedal, externalTorqueNm: signedTorqueFromYourDrivetrain});
const state = engine.update(deltaSeconds);
const shaftSpeed = state.shaftAngularVelocityRadPerSec;
```

Das äußere Moment wird nach jedem originalen Motorschritt als `externalTorqueNm * 1/24000` in Nm·s über die bestehende `Engine.applyShaftImpulse`-Schnittstelle gebucht. Die Änderung der Rotationsenergie erscheint in der vorhandenen Bilanz `totals.couplingWork`. Der Adapter benutzt keinen Prüfantrieb und schreibt keine Zieldrehzahl. `loadNm` und `externalTorqueNm` sind unterschiedliche, additive Eingänge. Dieselbe Last darf deshalb nicht über beide Wege doppelt gemeldet werden.

Für einen bereits diskret berechneten Kupplungsimpuls gibt es `engine.applyShaftImpulse(impulseNmSeconds)`. Der Rückgabewert `{impulse, work}` enthält den gebuchten Impuls und die Arbeit in Joule. Das Spiel muss den Gegenimpuls beziehungsweise die Gegenarbeit in seinem eigenen Antriebsstrang berücksichtigen. Der Adapter erfindet keine Rückwirkung in einem fremden Solver. Das Kopplungsschema, Abtastintervall und die Stabilität einer zusätzlichen 3D-Physik bleiben Verantwortung dieser Integration. Mit `createVehicle` sind beide externen Wellenwege gesperrt, weil dort das vorhandene Fahrzeug bereits koppelt.

`state.rpm` ist U/min; `omega` und `shaftAngularVelocityRadPerSec` sind rad/s. Im Fahrzeugbetrieb ist `speedMps` in m/s, `speedKph` in km/h. `state.time` ist die echte bisherige Motorzeit in Sekunden. Weitere originale Snapshotfelder, einschließlich Signalen, Energiebilanzen, Zylinderzuständen und Getriebeinformationen, bleiben abrufbar. `getState()` liefert eine getrennte Kopie, keine beschreibbare Ansicht des Motors.

### Passive Auslassbeobachtung seit SDK 1.6.2

`state.signal.exhaustMomentumFluxes` enthält für jede Kammer den signierten Impulsstrom ihres Abgasstrahls in **Newton**. `state.signal.exhaustMomentumFlux` ist die Summe. Positive Werte stehen für Ausströmung, negative für Rückströmung. Der Kern berechnet die ideale Expansionsgeschwindigkeit aus beiden Drücken und der Donortemperatur vor dem Transfer. Er gewichtet sie mit der wirklich übertragenen Masse nach allen Begrenzungen und mittelt sämtliche inneren Teilschritte über den äußeren Physikschritt.

Diese Felder sind passive Anregungen für das akustische Modell. Sie ändern weder Gastransfer noch Drehmoment, Kraftstoffverbrauch oder die bestehende Energiebilanz. Sie sind keine kalibrierten Schallpegel. `exhaustFlow` und `exhaustFlows` bleiben Massenströme in kg/s und behalten ihre bisherige Bedeutung.

Wer die normale SDK-Schleife benutzt, muss nichts umstellen. Eigene Signalproduzenten dürfen die neuen Felder weglassen; die Akustik verwendet dann weiterhin den vorhandenen Massenstrompfad. In den TypeScript-Typen sind beide Felder deshalb optional. Alte gespeicherte Kernzustände ohne diese Beobachtung werden angenommen und beginnen mit null, bis der nächste reale Physikschritt die Werte berechnet. Neue gespeicherte Zustände enthalten beide Felder; Anzahl, Endlichkeit und Summe werden beim Laden geprüft. Die Sitzungsstruktur bleibt Version 1.

Der zusätzliche Lastklang besitzt eine eigene lokale nichtlineare Stufe. Der bisherige Auspuffpfad bleibt getrennt erhalten. Mit den neuen Beobachtern nutzt der fertige Mix einen festen Reservefaktor von 0,94. Er wird nicht vom Gaspedal oder vom Pegel geregelt. Sobald gültige Beobachter geliefert wurden, bleibt diese Reserve bis zum Zurücksetzen oder Neukonfigurieren aktiv, auch wenn ein eigener Produzent die Felder später auslässt. Ein Produzent, der sie von Anfang an weglässt, behält die bisherige Pegelreferenz. `MotorAcoustics.meter().mix.reserveGain` zeigt die feste Reserve, `exhaustBaseBudget` und `exhaustPresenceBudget` die getrennten Zuteilungen.

## Ein fester Schritt und genau eine Uhr

Der Adapter führt ausschließlich Schritte von **1/24000 s** aus. Ein Aufruf `update(deltaSeconds)` sammelt die Zeit und verarbeitet normalerweise höchstens 2400 Schritte, also 0,1 s Simulation. So kann ein verspätetes Bild den Aufrufer nicht mit einer unbegrenzten Aufholschleife blockieren. Unerledigte Zeit bleibt vollständig erhalten.

```js
engine.update(0.5);                   // standardmäßig 0,1 s verarbeitet
console.log(engine.getTiming().pendingSeconds); // etwa 0,4 s verbleiben
engine.update(0);                     // vorhandene Zeit weiter abarbeiten
engine.update(0, {maxSteps: 4800});    // ausdrücklich mehr Arbeit erlauben
```

`maxStepsPerUpdate` kann bei der Erstellung gesetzt werden. Pro Aufruf überschreibt `maxSteps` dieses Arbeitsbudget; gültig sind 1 bis 240000 Schritte. Das ist kein Drehzahl- oder Motorlimit. Ein wegen mangelnder Rechenzeit wachsender Rückstand bleibt im Status sichtbar. Er wird nicht durch erfundene Zwischenzustände ersetzt. `discardPendingTime()` ist der ausdrückliche Weg, noch nicht gerechnete Zeit zu verwerfen; es liefert die verworfenen Sekunden und erhöht `discardedSeconds`. Bei Pause wächst die Schuld nicht weiter, eine vorher vorhandene Schuld bleibt erhalten. Nicht präzise als sichere Schrittzahl darstellbare Zeitmengen werden vor der Änderung abgelehnt.

`getTiming()` liefert `clock`, `pendingSeconds`, `totalSteps`, `simulatedSeconds`, `acceptedSeconds`, `discardedSeconds`, `lastUpdate` und das Arbeitsbudget. `simulatedSeconds` und `totalSteps` zählen die Arbeit dieser Sitzung seit Erstellung oder Laden des jeweiligen SDK-Spielstands. Nach `loadCoreState` beginnt dieser Adapterzähler bei null; die alte `state.time` bleibt unverändert erhalten. Kleine Fließkommaabweichungen an Zeitgrenzen sind möglich. Es werden weder noch offene ganze Schritte noch Restbruchteile bewusst abgeschnitten.

`setRate(0.25)`, `setRate(0.1)` und `setRate(0.02)` stellen Zeitlupe ein; `setRate(1)` normale Zeit. Die Rate wirkt auf den einzigen Simulationstakt. Im Audiobetrieb werden auch die akustischen Laufzeiten und Zustände auf dieser simulierten Zeit gerechnet und am Ausgang rekonstruiert.

## Audio mit einer Zeile aktivieren

Browser verlangen für die Audiofreigabe unter Umständen eine Nutzeraktion. `connectAudio()` gehört deshalb direkt in den Klickhandler. Die Lautstärke ist standardmäßig 0,6, `muted` ist standardmäßig `false`.

```js
const engine = MotorLab.createEngine('turbo');
startButton.onclick = async () => {
  engine.start();
  await engine.connectAudio();
};
function frame() {
  engine.setInputs({throttle: pedal});
  draw(engine.getState());            // Audio besitzt jetzt den einzigen Takt
  requestAnimationFrame(frame);
}
engine.setVolume(0.4);
requestAnimationFrame(frame);
```

**Nach Audiofreigabe kein `update()` zusätzlich aufrufen.** Es löst absichtlich einen verständlichen Fehler aus. Der Audiotransport führt die Schritte auf derselben Sitzung aus. Die Game-Loop setzt Eingaben und liest den Zustand. Die mitgelieferte `game-loop.html` zeigt zusätzlich den Wechsel zwischen dem stillen Game-Takt vor Freigabe und dem Audiotakt danach.

`await engine.disconnectAudio()` gibt den Takt wieder frei. Der nächste Game-Frame benötigt einen frisch gesetzten Zeitstempel, damit vergangene Audiozeit nicht nochmals als `deltaSeconds` eingegeben wird. Vor der Audioübernahme müssen noch ausstehende ganze Schritte mit `update(0)` abgearbeitet oder ausdrücklich verworfen werden. Ein vorhandener Restbruchteil bleibt erhalten. Auch beim Rückweg werden noch offene simulierte Audiobruchteile in die Zeitschuld übernommen.

Die einfache Geräteanbindung benutzt einen `ScriptProcessorNode` mit demselben `MotorAcoustics`, der auch aus `SimulationDriver.acousticsClass()` erreichbar ist. Es wird kein zweiter `VehicleRuntime` erzeugt. Dieser Kompatibilitätstransport arbeitet auf dem Hauptthread und ist laut Web-Audio-Dokumentation veraltet. Für größere Spiele kann seine Callback-Last oder Pufferlatenz ungeeignet sein. Standardmäßig sind es 1024 Frames; bei 48000 Hz entspricht allein dieser Block etwa 21,3 ms, zuzüglich weiterer Geräte- und Signalverarbeitungslatenz. Das ist keine Zusage zur gesamten hörbaren Latenz. Die Hauptanwendung verwendet ihren eigenen Worklet-Pfad mit Kompatibilitätsfallback.

`connectAudio({context, destination, bufferSize, timeoutMs})` kann einen bereits vorhandenen Audiokontext benutzen. Ohne `context` erzeugt die Sitzung einen eigenen. `disconnectAudio` und `dispose` schließen ausschließlich selbst erzeugte Kontexte. Unterstützte Puffergrößen sind 256, 512, 1024, 2048, 4096, 8192 und 16384 Frames. Die Freigabe läuft standardmäßig nach 3 s in einen erklärten Fehler, ohne die manuelle Simulation unbrauchbar zu machen. `enableAudio` ist ein Alias. Ein erneuter Aufruf bei einem unterbrochenen vorhandenen Kontext versucht dessen Freigabe erneut; ein extern geschlossener Kontext benötigt zuerst `disconnectAudio`.

`getAudioStatus()` nennt Backend, Kontextzustand, Abtastrate, Pegel und Fehler. `connected: true` bedeutet einen eingerichteten Softwaretransport. Es bestätigt keinen physischen Lautsprecheranschluss und keine am Betriebssystem eingestellte Lautstärke. Eine native Geräte- oder Hörprüfung ist nicht Bestandteil der automatischen Tests.

### Einzelne DSP-Stufen für eigene Spiele

`MotorLab.audioModules()` gibt dieselben Klassen zurück, die der Audiopfad verwendet: `Pre`, `Layer`, `Listener` und `Acoustics`. Dieser Zugriff ist optional. Die Klassen erzeugen weder ein Audiogerät noch einen zweiten Physiktakt.

```js
const {Pre, Layer, Listener, Acoustics} = MotorLab.audioModules();

const pre = new Pre(48000, {name: 'exhaust', config: engineConfig});
const layer = new Layer(48000, {
  name: 'exhaust', index: 0,
  budget: 0.23, outputKernelNorm: 1
});
const processedSample = layer.process(pre.process(sourceSample), 1.2, 0.55, 0.6);
pre.clear();
layer.clear();
```

`sourceSample` ist ein bereits berechnetes Quellensample vor der statischen Kalibrierung; `engineConfig` ist die physikalische Motorkonfiguration. `Pre` besitzt je Instanz einen eigenen Filterzustand und verarbeitet linear. Seine festen Referenzfaktoren gleichen die unterschiedlichen numerischen Einheiten der Quellen ab; die Filtereckfrequenz folgt, wo vorgesehen, der Bauteilgeometrie. `describe()` nennt diese Faktoren und Modellannahmen. `radiationStages` gibt die Anzahl der linearen Abschnitte an: Auspuff und Krümmer verwenden zwei, die anderen Quellen einen. `dcWeight` nennt das verbleibende Gleichsignalgewicht nach der gesamten Pre-Stufe. Die Stufe ist eine technische Kalibrierung, keine gemessene Schalldruckreferenz. Bei `renderAudio()` führt das SDK diese Verarbeitung bereits selbst aus.

Die drei folgenden Argumente von `layer.process` sind Pre Gain, lokaler Distortion-Anteil und globale Distortion-Stärke; ihre Standardwerte sind `1`, `0` und `0.6`. Die Konstruktoroptionen von `Layer` sind ebenfalls optional. `budget` reserviert den maximalen Quellenbeitrag, standardmäßig `0.1`; `outputKernelNorm` berücksichtigt das größtmögliche Überschwingen eines nachfolgenden Ausgangsfilters, standardmäßig `1`. Eigene Budgets und Ausgangsfilter gehören damit zum gewählten Mix und müssen zusammenpassen. `oversample: 2` ist der Standard für die lokale Distortion; ein eigener Host kann `4` wählen. `latencySamples` nennt die Verzögerung der Stufe in Samples der Ausgaberate. Die zusätzliche Abtastung verändert die Physikuhr nicht.

`new Listener(sampleRate, sourceNames, engineConfig)` nimmt die Reihenfolge der Quellen und die Motorkonfiguration entgegen. `setSettings(patch)` ändert seine Hörperspektive; `configure(engineConfig)` übernimmt eine geänderte Motorgeometrie. `process(Float64Array)` verarbeitet genau einen Sample-Satz der bereits bearbeiteten Layer; die beiden Ergebnisse stehen in `outputL` und `outputR`. `describe()` nennt die Quellpositionen, Laufzeiten und Übertragungsfaktoren der eingestellten Perspektive, `clear()` löscht ihre akustische Vorgeschichte.

`new Acoustics(sampleRate, engineConfig)` stellt die vollständige Akustik bereit. Sie ist identisch mit `SimulationDriver.acousticsClass()`. Sie erhält echte Motorsignale über `capture(signal)` und berechnet Samples über `sample(fraction, active, transitionGain)`. Die Verantwortung für die einzige Physikuhr bleibt beim eigenen Host. Die vorhandenen `createEngine`-, `createVehicle`- und `renderAudio`-Aufrufe bleiben der direkte Weg, wenn keine einzelnen Stufen benötigt werden.

### Eigener Audiohost und Offline-Verarbeitung

```js
const left = new Float32Array(1024), right = new Float32Array(1024);
engine.renderAudio(left, right, {sampleRate: 48000});
// Nächster Block: derselbe Aufruf, kein zusätzliches engine.update().
await engine.disconnectAudio();       // gibt auch diesen reinen PCM-Takt frei
```

Die Methode liefert echte Float32-Stereosamples im Speicher und braucht keinen Browser. Sie eignet sich als Baustein für einen selbst gewählten Transport. Ein separates Worklet kann nicht einfach auf das Hauptthread-Sitzungsobjekt zugreifen; wer dort rechnen will, muss **die gesamte Sitzung** in diesem Worker besitzen und Ein-/Ausgaben gezielt übertragen. Einen zusätzlichen `SimulationDriver` für dieselbe Sitzung zu starten würde eine zweite Physik erzeugen und gehört nicht zu diesem Adapter.

Die zulässige Abtastrate liegt zwischen 32000 und 192000 Hz. Zwischen den beiden Kanälen sind getrennte Arrays erforderlich; ein Sampleratenwechsel benötigt eine Freigabe mit `disconnectAudio`. Die gemeldeten RMS-/Peak-Pegel stammen vom tatsächlich geschriebenen Stereoblock. `setVolume(0)` blendet den Ausgang zeitlich begrenzt zu exakter Stille aus, während die Physik weiterläuft. Keine Audiodatei, Loop-Aufnahme oder separate Drehzahlmelodie wird geladen. Die Akustik bleibt das vorhandene approximierte Signalmodell; dieser Adapter macht daraus keine Behauptung einer akustischen Messgenauigkeit.

## Speichern, alte Spielstände und Zurücksetzen

```js
const document = engine.save();
const text = JSON.stringify(document);          // etwa im eigenen Save-System speichern
const restored = MotorLab.fromState(JSON.parse(text));
// Bestehende nackte Kernspielstände sind weiterhin verwendbar:
restored.loadCoreState(oldEngineSerializeResult);
```

`save()` erzeugt weiterhin `format: 'MotorLab.Session', version: 1`. Darin liegt der tatsächliche Kernzustand unter `coreState`, einschließlich der neuen Zielwerte und erreichten Nockenwinkel. Takt, noch offene Zeit, Rate, Pausenstatus, Audioregler und äußeres Moment stehen getrennt daneben. `load(document)` prüft einen neuen Kandidaten, bevor es den laufenden Zustand ersetzt. Es schreibt nicht in das übergebene Dokument. Ein ungültiger Spielstand verändert die Sitzung nicht. `fromState(document)` erzeugt eine passende neue Motor- oder Fahrzeugsitzung.

`loadCoreState(raw)` nimmt das bisherige nackte `Engine.serialize()` oder `Vehicle.serialize()` an. Das neue SDK-Format muss nicht in alte Spiele eingebaut werden. Der im Kern gespeicherte Starterablauf wird übernommen und nicht durch ein neues `starter: true` verlängert. Die neue feste Spieluhr akzeptiert dabei den Standardschritt 1/24000 s; andere bisherige Schrittweiten bleiben über die unveränderten Legacy-Exporte verwendbar.

Fehlen in einem älteren Spielstand die neuen Bedienwerte, setzt das Laden die Nockenwinkel auf null und übernimmt das Ladedruckziel aus der gespeicherten Motorkonfiguration. Dabei werden keine Zielwerte einer zuvor benutzten Sitzung übernommen. Abgeleitete Rechencaches werden neu aufgebaut und gehören nicht zum Speicherformat.

`load`, `loadCoreState`, `reset` und das bewusste Verwerfen der Zeitschuld sind während angeschlossenem Audio, direktem PCM-Betrieb oder einer noch laufenden Audiofreigabe gesperrt. Zuerst `await disconnectAudio()` aufrufen. `save` und `getState` dürfen zwischen Audioblöcken gelesen werden. JavaScript führt den synchronen Zugriff nicht gleichzeitig mit dem Audiocallback aus.

Ein SDK-Spielstand speichert die **physikalischen** Zustände und Zeitreste. Er enthält keine Audiokontexte, Filterpuffer, Zufallsfolgen der akustischen Textur oder Geräteobjekte. Nach dem Laden startet der akustische Nachhall neu. Ein physikalischer Replay kann bei gleicher Schrittzahl und Eingabefolge gleich sein, ohne dass ein neu begonnener Audiotail samplegleich zum unterbrochenen Tail ist. Die Tests unterscheiden diese Zusagen ausdrücklich.

`dispose()` beendet die Sitzung dauerhaft, invalidiert ausstehende Audiofreigaben und gibt eigene Ressourcen frei. Ein erst danach aufgelöstes `resume()` kann sie nicht wieder anschließen. Mehrfaches `dispose()` ist erlaubt.

## Presets und eigene Geometrie

`MotorLab.presets()` liefert die verfügbaren Namen. Enthalten sind die bestehenden Grundmotoren, die benannten Modelle wie Hellcat, Bestia, F1-V12, Renesis, BMW E46/E39, Mustang Boss 302 und Camaro Z/28 sowie Motorfamilien bis 16 Zylinder, V, Boxer, W, Stern, Zwei- und Viertakt, Wankel und die vorhandenen Kraftstoffe einschließlich Kerosin. Schreibfehler im Presetnamen lösen einen Fehler aus, statt heimlich einen anderen Motor zu wählen. Die hier bereitgestellten Modellnamen sind die bestehenden Projektvorgaben, keine neue Herstellerzertifizierung.

`{family: {kind: 'four', layout: 'v', cylinderCount: 8, boost: 'turbo'}}` benutzt `EngineCore.familyDefaults`. `displacementCc` benutzt danach `EngineCore.sizeForDisplacement`, einschließlich seiner bisherigen Anpassungen der Geometrie. `overrides` erlaubt explizite zusätzliche Motorparameter innerhalb der bestehenden Validierung. Wer bereits eine vollständige Konfiguration besitzt, übergibt `{configuration: config}`; beim Fahrzeug ist das `{engine, drivetrain}`. Die tatsächlich validierte Konfiguration steht in `getState()` und im Spielstand.

## Build und überprüfbare Kompatibilität

Im vollständigen Projekt: `python build_sdk.py`. Das erzeugt `sdk/` und `Motor_Engine_SDK.zip` ohne npm oder Netzwerk. `sdk/game-loop.html` enthält das gesamte SDK inline und kann direkt geöffnet werden. `examples/game-loop.html` im Quellprojekt ist dagegen die Vorlage mit dem Buildmarker. Nach Quelländerungen den Builder erneut ausführen.

Die eigenen Prüfungen laufen mit `node tests/game-api-tests.mjs`. Der Bericht `qa/game-api-results.json` enthält die tatsächlich geprüften Quellhashes. Die getrennten Release-Integrationsprüfungen prüfen zusätzlich kritische Wechselwirkungen. Für unabhängige Gegenproben bleiben der frühere Motorkern und der frühere Fahrzeugkern vollständig eingefroren. Die Fahrzeugreferenz wurde aus Ausgabe 10 übernommen und besitzt exakt dieselben Bytes wie die bisher verwendete Fahrzeugimplementierung:

| Kompatibilitätsquelle | SHA-256 |
| --- | --- |
| `tests/core-v8-baseline.js` | `efd882f510d5bff174aafa7dfe929c90598c05a9ed92996a678a1e2258bcd57f` |
| `tests/vehicle-v10-baseline.js` | `9a4db840ce4a9b8542a7033e427222206726c8f23220b5e27d23f99854398f98` |

Die Legacy-Gegenproben führen den alten und den aktuellen Kern getrennt mit denselben Eingaben und Schrittzahlen aus. Alle zuvor vorhandenen gespeicherten Felder müssen exakt übereinstimmen. Nur die namentlich aufgeführten neuen Felder für Steller, Ziele, zusätzliche Telemetrie, die neutralen Drehzahloptionen und die passiven Akustikbeobachter aus Ausgabe 13 werden für diesen Vergleich entfernt. Eine tatsächlich ausgeschaltete oder abweichend konfigurierte Abschaltung wird nicht als alter Zustand verglichen. Ein gespeicherter Referenzhash verankert außerdem die alte Ausführung. Die Tests erlauben keine allgemeine Rundung und überspringen keine unbekannten Zustandsfelder. Sie decken keine beliebige Fremdintegration ab. Die bestehenden Exporte bleiben erreichbar; der neue Namensraum, die Paketformate und die freiwillige Bedienhülle sind additiv. Das Audiosystem liefert absichtlich andere Samples als Ausgabe 8.

Beim Restaurieren vergleicht die Prüfung den SDK-Zustand mit demselben originalen `restore()`-Pfad. Der alte Kern berechnet dabei unter anderem numerische Bilanzreste sofort neu; ein durchgehend laufender Motor aktualisiert diese Diagnosefelder erst bei seiner nächsten vorgesehenen Prüfung. Diese vorhandene Eigenschaft wird nicht aus dem Kern entfernt. Für die TypeScript-Dateien fand eine Prüfung ihrer Paket- und Exportformen statt; in der verfügbaren Umgebung war kein TypeScript-Compiler installiert. Ein bestandener `tsc`-Lauf wird daher nicht behauptet.

Technische Referenzen zum Audiotransport: [Web Audio API, W3C](https://www.w3.org/TR/webaudio/) und [BaseAudioContext.createScriptProcessor, MDN](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createScriptProcessor). Die Implementierung und die geprüften Grenzen dieses Adapters sind in `src/game-api.js`, den Tests und `SOURCES.json` des SDK nachvollziehbar.

### Laufzeitpflege in SDK 1.6.3

Die öffentlichen Aufrufe, Sitzungsstruktur und akustischen Einstellungen bleiben erhalten. Der Kern verwendet unveränderte Zeitschritte und vermeidet mehrfach berechnete abgeleitete Gas- und Geometriewerte. Ein nicht gespeicherter Zwischenspeicher wird nach Wiederherstellung neu aufgebaut. Die Akustik teilt identische Interpolationsgewichte zwischen Grundklang und Präsenzpfad. Eine frisch geleerte Klangstufe überspringt ausschließlich Rechnungen mit durchgehend exakt nullwertigem verstärktem Eingang; sobald ein verstärkter Eingang ungleich null auftritt, verarbeitet sie auch alle späteren Ausklänge vollständig bis zum nächsten expliziten Leeren. Es gibt keine neue Spieloption und keine reduzierte Klangqualität.
