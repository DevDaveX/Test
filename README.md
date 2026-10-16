# Kiese Reise-Service – Touch-Kiosk-Anpassung

Die vier vollständigen Dateien aus den Anhängen, mit ergänzter Touch-Bedienung.
Farben, Logo, Karten, Tabellen und Fachlogik wurden beibehalten. Der Header
ordnet sich abhängig vom verfügbaren Platz neu an. Vor dem Ersetzen bestehende
Dateien und fleet.db sichern.

Dateien im vorhandenen Projekt ersetzen:
- app/main.py
- app/templates/index.html
- app/static/app.js
- app/static/styles.css

Falls das Python-Paket anders heißt, die entsprechenden bisherigen Pfade verwenden.
Dieses Paket ergänzt eine bestehende Anwendung; es ist kein vollständiges neues
Backend-Projekt. Insbesondere app/date_rules.py sowie die bisherigen Python-
Abhängigkeiten (FastAPI, Pydantic 2, APScheduler, cryptography, Jinja2, pywebpush,
Uvicorn) müssen vorhanden sein. Die bisherigen PWA-Dateien manifest.webmanifest,
sw.js und offline.html sind nicht in den Anhängen enthalten und bleiben erforderlich,
wenn diese Funktionen genutzt werden. Keine erfundenen Ersatzregeln für Prüffristen.

## Bedienung

- Der Pfeil oben links in der Sidebar klappt das Menü ein. Eingeklappt bleibt
  ein Pfeil am linken Bildschirmrand zum Wiederöffnen sichtbar.
  Die manuelle Wahl wird lokal im Browser gespeichert. Bis 1180 CSS-Pixel startet
  die Navigation ohne gespeicherte Wahl eingeklappt und schließt nach Auswahl.
- Mindestens 52 CSS-Pixel hohe Schaltflächen und Eingaben; Zahlenfelder mit
  numerischem inputmode. Touch, Maus und Tastatur nutzen dieselben Klickhandler.
- Native Browserauswahllisten und Datumsfunktionen bleiben erhalten.
- Die Vollbildtaste benötigt eine Benutzeraktion und Browser-Unterstützung.
- Dialoge können scrollen; Kopf und Aktionen bleiben beim Scrollen erreichbar.
  VisualViewport berücksichtigt eine Bildschirmtastatur, soweit Chromium deren
  Größenänderung meldet. Pinch-Zoom bleibt zugänglich.
- Weniger Transparenzeffekte bei grobem Zeiger zur Entlastung des Raspberry Pi.
- Keine automatische Seitenaktualisierung, die laufende Eingaben verwerfen würde.

## Raspberry Pi

Empfehlung: aktuelles Raspberry Pi OS mit Desktop und Chromium, 15,6-Zoll-Display
im Querformat. Nicht die Bildschirmdiagonale, sondern Auflösung und Betriebssystem-
Skalierung bestimmen den verfügbaren Platz. Mit nativer Auflösung und 100 % Skalierung
beginnen; Lesbarkeit am tatsächlichen Gerät prüfen.

Backend aus dem bestehenden Projektverzeichnis mit dessen virtueller Umgebung
starten, z. B. (bei Paketname app):

    python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1

DATA_DIR bei Bedarf auf ein dauerhaftes, beschreibbares Verzeichnis setzen.
Ein Worker verhindert mehrfach gestartete Reminder-Scheduler. Die vorhandene
Datenbank weiterverwenden. Vor Browserstart muss /api/health erfolgreich sein:

    curl --fail http://127.0.0.1:8000/api/health

Chromium innerhalb der grafischen Desktop-Sitzung starten:

    chromium --kiosk --no-first-run --no-default-browser-check http://127.0.0.1:8000/

Je nach OS heißt das Programm chromium-browser. Für Autostart den Befehl in den
Autostart der verwendeten Desktop-Sitzung aufnehmen und das Backend zuvor über
einen passenden Dienst starten. Die konkrete Autostart-Konfiguration hängt von
Raspberry Pi OS und dem verwendeten Desktop/Compositor ab.

Bildschirmtastatur und Abschaltung der Bildschirmabschaltung in Raspberry Pi OS
konfigurieren. HTML kann weder eine Systemtastatur zuverlässig erzwingen noch
Bildschirmschoner, Desktop-Gesten oder Betriebssystem-Zugriff sperren. Keine
Chromium-Sicherheitsprüfung abschalten. Für einen öffentlich zugänglichen Kiosk
muss der Betriebssystem-Zugriff zusätzlich passend eingeschränkt werden.

## Validierung

Python-Syntax und JavaScript-Syntax geprüft. Chromium-Touchtests mit simulierten
API-Antworten prüfen Navigation, Ein-/Ausklappen, Öffnen/Schließen des Fahrzeugdialogs
und horizontales Seiten-Overflow bei verschiedenen Auflösungen. Das ersetzt keinen
Backend-Integrationstest oder Hardwaretest. Das Backend kann ohne date_rules.py und
die übrigen Originalprojektdateien hier nicht vollständig gestartet werden.
