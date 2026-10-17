# Player Two – Spiele-Zufallsrechner

Eigenständige Web-App für zwei Personen, mit zwei Steam-Accounts auf deiner Seite:

- OneMenShot1: 76561198925829155
- 18945315: 76561198078956373
- Ihr Account: 76561198350287430

## Starten

Python 3.10 oder neuer genügt; keine zusätzlichen Laufzeitpakete nötig.

```bash
cd steam-match
python3 server.py
```

Dann auf dem eigenen Rechner im Browser `http://127.0.0.1:8080` öffnen. Der Server bindet ausschließlich lokal. Diese Cloud-Oberfläche stellt dafür keine Web-Vorschau bereit. Zum lokalen Verwenden das ZIP herunterladen und entpacken; aus dem entpackten Verzeichnis denselben Python-Befehl ausführen.

## Vergleich und Datenlage

Deine Bibliothek ist die Vereinigung beider Accounts. Die Schnittmenge mit ihrem Account bildet die gemeinsam besessenen Titel. Abgleich über Steam-App-ID, nicht Spielnamen. Es wird angezeigt, welcher deiner Accounts ein Spiel besitzt. Gleichzeitige Verfügbarkeit, Spielmodus, Betriebssystem und eventuelle DLC-Anforderungen müssen zusätzlich passen; Besitz auf einem Account garantiert keine gleichzeitige Lizenznutzung über Familienfreigabe.

**Der tatsächliche Bibliotheksvergleich ist noch offen:** Die Spielelisten aller drei angegebenen Accounts leiteten bei der Prüfung auf die Steam-Anmeldeseite um. Dies beweist weder Privatstatus noch Spielbesitz. Die öffentlichen Spielelisten sind über den anonymen Zugriff hier nicht verfügbar. Die App speichert keine Login-Daten und versucht nicht, Zugriffsbeschränkungen zu umgehen. Alternativ je Account Steam-XML, Steam-API-JSON oder `App-ID;Spielname` importieren. Keine Passwörter oder Tokens eingeben. Ein leerer Import wird abgelehnt, um nicht versehentlich eine Bibliothek zu löschen.

Store-Daten für die Kaufideen wurden tatsächlich vom deutschen Steam-Store abgerufen; sie bestätigen keinen Besitz. „Kaufideen bis 15 € laden“ ergänzt Portal 2, Stardew Valley, Lethal Company, Content Warning und Terraria. Preisstand ist pro Karte hinterlegt; nach 24 Stunden werden diese Preise für Käufe bis zur Aktualisierung ausgeschlossen. Manuell eingegebene Preise sind eure eigene Bestätigung und haben keinen automatischen Aktualitätsnachweis. Steam-Preise können sich jederzeit ändern und regional abweichen. Verfügbare Geschenke, DLCs, Sondereditionen oder Friend-Pass-Regeln vor dem Kauf separat prüfen. Es werden keine Käufe ausgeführt.

## Benutzung

1. Bibliotheken laden oder separat importieren. Der Datenstatus zeigt, ob alle drei geladen sind. Import ersetzt die Besitzinformationen des ausgewählten Accounts; Wünsche anderer Accounts bleiben erhalten.
2. Unter „Bearbeiten“ Eignung für euren konkreten Spielmodus bestätigen sowie Stimmung und optional Zeit pro Runde ergänzen. Store-Koop-Tags sind nur Hinweise und keine automatische Zwei-Spieler-Bestätigung. Für Steam-Titel sind die Store-Seiten verlinkt.
3. Kaufoption wählen: beide besitzen das Spiel, eine fehlende Kopie oder auch zwei neue Kopien. Budget pro Person, standardmäßig 15 €. Ein Spiel für 13,99 € darf bei zwei fehlenden Kopien insgesamt 27,98 € kosten. Unbekannte und veraltete Live-Preise schließen nötige Käufe aus.
4. Beide wählen „Ist okay“, „Favorit“ oder „Heute nicht“. Ein Veto entfernt das Spiel. Wer nicht aktiv abstimmt, bleibt neutral; es handelt sich um eine gemeinsame lokale Bedienung ohne getrennte Anmeldung.
5. Optional Horror, Stimmung, Zeitlimit und bereits eingeplante Spiele filtern. Nicht passende Spiele bleiben sichtbar und nennen alle Ausschlussgründe.
6. Auslosen und das Ergebnis bei Bedarf in die Warteschlange übernehmen. Ohne zulässigen Titel ist die Auslosung deaktiviert.

Ohne Bevorzugung hat jedes zulässige Spiel dieselbe Chance. Mit Favoritengewichtung gibt es ein Los für neutral, zwei bei einem Favoriten und vier bei zwei Favoriten. Auswahl mit `crypto.getRandomValues` und Rejection Sampling ohne Modulo-Verzerrung. Ergebnisse werden nicht automatisch gekauft oder gestartet.

Beispielmodus ist immer als solcher markiert. Beispielbesitz und Beispielpreise sind **keine** Aussagen über die angegebenen Accounts. Beispielpreise erlauben keine Kaufqualifikation. Alle Daten bleiben lokal im Browser; Sicherungen können exportiert und wiederhergestellt werden. Bilder werden für echte Steam-App-IDs von Steams CDN geladen, sofern erreichbar. Die App funktioniert mit Platzhaltern weiter.

## Netzwerk und Grenzen

Für Bibliotheken: `steamcommunity.com`. Für Live-Preise: `store.steampowered.com`. Optionale Bilder: `shared.fastly.steamstatic.com`. TLS-Prüfung bleibt aktiv. Die beiden Pflichtdomains wurden dem Cloud-Konfigurationsentwurf hinzugefügt; Veröffentlichung ist separat. Der lokale Server benötigt weder API-Key noch Drittbibliotheken. Keine Anmeldung über diesen Server. Private oder loginpflichtige Bibliotheken benötigen den manuellen Import. Für komfortable automatische Bibliotheksabfragen wäre eine separate, sicher konfigurierte offizielle Steam-Web-API-Integration möglich; sie ist hier nicht implementiert.

## Geprüft

- `node test_core.cjs`: Besitzvereinigung, Kaufmodi, Budgetgrenze, Preisstatus, Vetos, Horror, Zwei-Spieler-Bestätigung, unbekannte Dauer, Warteschlange, Losgewichte und deterministische Auswahlgrenzen.
- `python browser_check.py`: mit Playwright und lokalem Chromium; Beispielauslosung, Warteschlange, Layout bei 390 px, CSV-/JSON-Import, Account-Vereinigung, Eignungsbestätigung, Veto und Browserpersistenz.
- HTTP-Auslieferung von HTML und JavaScript, echte Steam-Store-Anfragen.
- Vollständiger Accountvergleich **nicht** verifiziert: Steam leitet Spielelisten auf Login um.

Playwright ist nur für die Entwicklungstests nötig, nicht zum Benutzen. Testdaten stammen aus isolierten Browserkontexten. Bestehendes Repository `/workspace/Test` wurde nicht verändert.
