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

## Steam Web API einrichten

Der automatische Abruf verwendet die offizielle HTTPS-Schnittstelle `IPlayerService/GetOwnedGames/v0001` mit `include_appinfo=1` und `include_played_free_games=1`. Beide eigenen Bibliotheken werden weiterhin mit ihrem Account verglichen. XML-Scraping wird nicht mehr verwendet.

1. Einen Steam-Web-API-Schlüssel über https://steamcommunity.com/dev/apikey registrieren (Steam-Anmeldung nur auf der offiziellen Steam-Seite).
2. Auf dem Server die geheime Umgebungsvariable `STEAM_API_KEY` setzen und den Server neu starten. Nicht in Quellcode, HTML, Browser-Speicher oder GitHub eintragen. In Bash kann der Schlüssel ohne Terminalanzeige und ohne Shell-History-Eintrag abgefragt werden:

```bash
read -rsp 'Steam API key: ' STEAM_API_KEY; echo
export STEAM_API_KEY
python3 server.py
```

   Auf einem Hosting-Dienst dessen Secret-/Umgebungsvariablen-Einstellungen verwenden. In dieser Cloud-Umgebung die gespeicherte Secret-Anforderung in den Umgebungseinstellungen sicher befüllen. Der Schlüssel wird ausschließlich serverseitig an `api.steampowered.com` gesendet.
3. Auf allen drei Steam-Profilen Profil und Spieldetails öffentlich freigeben, dann „Steam-Bibliotheken via API laden“ klicken. Der API-Schlüssel umgeht keine privaten Bibliotheken.

Fehlender Schlüssel, verweigerter Zugriff, Rate-Limit und Netzwerkfehler werden getrennt behandelt. Fehlgeschlagene oder unvollständige Antworten überschreiben keine vorhandene Bibliothek. Eine von Steam ausdrücklich mit `game_count: 0` zurückgegebene leere Bibliothek ist dagegen ein gültiges Ergebnis.

**Validierungsgrenze:** Die API-Anbindung ist mit simulierten Steam-Antworten getestet. Ein Live-Bibliotheksvergleich benötigt einen gültigen API-Schlüssel, der in dieser Entwicklungsumgebung noch nicht vorliegt. Alternativ je Account Steam-XML, Steam-API-JSON oder `App-ID;Spielname` importieren. Keine Passwörter oder Tokens in den Import eingeben.

Store-Daten für die Kaufideen wurden tatsächlich vom deutschen Steam-Store abgerufen; sie bestätigen keinen Besitz. „Kaufideen bis 15 € laden“ ergänzt Portal 2, Stardew Valley, Lethal Company, Content Warning und Terraria. Preisstand ist pro Karte hinterlegt; nach 24 Stunden werden diese Preise für Käufe bis zur Aktualisierung ausgeschlossen. Manuell eingegebene Preise sind eure eigene Bestätigung und haben keinen automatischen Aktualitätsnachweis. Steam-Preise können sich jederzeit ändern und regional abweichen. Verfügbare Geschenke, DLCs, Sondereditionen oder Friend-Pass-Regeln vor dem Kauf separat prüfen. Es werden keine Käufe ausgeführt.

## Benutzung

1. Bibliotheken laden oder separat importieren. Der Datenstatus zeigt, ob alle drei geladen sind. Import ersetzt die Besitzinformationen des ausgewählten Accounts; Wünsche anderer Accounts bleiben erhalten.
2. Unter „Bearbeiten“ Eignung für euren konkreten Spielmodus bestätigen sowie Stimmung und optional Zeit pro Runde ergänzen. Store-Koop-Tags sind nur Hinweise und keine automatische Zwei-Spieler-Bestätigung. Für Steam-Titel sind die Store-Seiten verlinkt.
3. Kaufoption wählen: beide besitzen das Spiel, eine fehlende Kopie oder auch zwei neue Kopien. Budget pro Person, standardmäßig 15 €. Ein Spiel für 13,99 € darf bei zwei fehlenden Kopien insgesamt 27,98 € kosten. Unbekannte und veraltete Live-Preise schließen nötige Käufe aus.
4. Pia und David wählen im jeweiligen Profil „Ist okay“, „Lieblingsspiel“ oder „Heute nicht“. Ein Veto entfernt das Spiel. Wer nicht aktiv abstimmt, bleibt neutral; es handelt sich um eine lokale Profilauswahl ohne getrennte Anmeldung.
5. Optional Horror, Stimmung, Zeitlimit und bereits eingeplante Spiele filtern. Nicht passende Spiele bleiben sichtbar und nennen alle Ausschlussgründe.
6. Auslosen und das Ergebnis bei Bedarf in die Warteschlange übernehmen. Ohne zulässigen Titel ist die Auslosung deaktiviert.

Ohne Bevorzugung hat jedes zulässige Spiel dieselbe Chance. Mit Favoritengewichtung gibt es ein Los für neutral, zwei bei einem Favoriten und vier bei zwei Favoriten. Auswahl mit `crypto.getRandomValues` und Rejection Sampling ohne Modulo-Verzerrung. Ergebnisse werden nicht automatisch gekauft oder gestartet.

Beispielmodus ist immer als solcher markiert. Beispielbesitz und Beispielpreise sind **keine** Aussagen über die angegebenen Accounts. Beispielpreise erlauben keine Kaufqualifikation. Alle Daten bleiben lokal im Browser; Sicherungen können exportiert und wiederhergestellt werden. Bilder werden für echte Steam-App-IDs von Steams CDN geladen, sofern erreichbar. Die App funktioniert mit Platzhaltern weiter.

## Netzwerk und Grenzen

Für Bibliotheken: `api.steampowered.com`. Für Live-Preise: `store.steampowered.com`. Optionale Bilder: `shared.fastly.steamstatic.com`. TLS-Prüfung bleibt aktiv. Python benötigt keine Drittbibliotheken. Server nur lokal betreiben; nicht ohne zusätzliche Zugriffskontrolle öffentlich veröffentlichen. Private Bibliotheken benötigen einen manuellen Import.

## Geprüft

- `node test_core.cjs`: Besitzvereinigung, Kaufmodi, Budgetgrenze, Preisstatus, Vetos, Horror, Zwei-Spieler-Bestätigung, unbekannte Dauer, Warteschlange, Losgewichte und deterministische Auswahlgrenzen.
- `python browser_check.py`: mit Playwright und lokalem Chromium; Beispielauslosung, Warteschlange, Layout bei 390 px, CSV-/JSON-Import, Account-Vereinigung, Eignungsbestätigung, Veto und Browserpersistenz.
- HTTP-Auslieferung von HTML und JavaScript, echte Steam-Store-Anfragen.
- `python -m unittest test_server.py`: API-Anfragen, fehlender Schlüssel, private und leere Bibliotheken, unvollständige Antworten und Fehlermeldungen ohne Schlüsseloffenlegung.
- Vollständiger Live-Accountvergleich **nicht** verifiziert: gültiger Steam-API-Schlüssel fehlt.

Playwright ist nur für die Entwicklungstests nötig, nicht zum Benutzen. Testdaten stammen aus isolierten Browserkontexten. Bestehendes Repository `/workspace/Test` wurde nicht verändert.

## Pia und David, Favoriten und Mehrspielerfilter

Bei jedem Seitenaufruf erscheint die Auswahl zwischen Pia und David. Pro Profil können Lieblingsspiele, neutrale Wünsche und Vetos gesetzt werden; „Person wechseln“ wechselt die Bearbeitung. Bestehende Wünsche werden übernommen (bisher „Du“ → David, „Sie“ → Pia). Das andere Profil wird dabei nicht überschrieben. „Nur meine Lieblingsspiele anzeigen“ grenzt die sichtbaren Karten ein; die Auslosung verwendet weiterhin beide Wünsche und die festgelegten Regeln. Die Auswahl ist keine Anmeldung: Daten werden weiterhin in diesem Browser gespeichert, nicht zwischen verschiedenen Geräten synchronisiert.

Steam-Spiele werden anhand ihrer Store-Kategorien auf Mehrspieler-/Koop-Unterstützung geprüft. Reine Singleplayer, Software und noch ungeprüfte Titel erscheinen nicht in der Auswahl und können nicht ausgelost werden. Die erste Prüfung bei mehreren hundert Spielen braucht einige Minuten; Fortschritt wird angezeigt und gespeichert. Nach einem Neuladen oder über „Koop-/Mehrspieler prüfen“ werden ungeprüfte Einträge erneut versucht. Store-Fehler lassen Titel ausgeblendet. Zusätzlich bleibt die konkrete Zwei-Personen-Eignung unter „Bearbeiten“ zu bestätigen, da ein Mehrspieler-Tag keine Mindestspielerzahl oder Plattformkompatibilität garantiert.

Minecraft, Roblox, Skribbl.io (Scribble.IO) und Gartic Phone sind feste zusätzliche Einträge. Minecraft-Besitz ist nicht vorgegeben und muss bestätigt werden; Edition und Server müssen zusammenpassen. Kostenlose Browser-/Plattformspiele sind als zugänglich gekennzeichnet und benötigen keine Steam-Lizenz. Roblox erfordert eine passende gemeinsame Experience.

Huntsman ist die ausdrückliche Ausnahme: Pia spielt alleine, David schaut per Livestream zu. Nur Pia setzt dessen Wunsch; nur ihre Lizenz und ihr Veto zählen für diesen Eintrag. Es wird keine ungeprüfte Steam-App-ID für den Titel geraten. Eine Uhrzeitsperre ist nicht gesetzt.

Spielbilder sind absolut auf den begrenzten Kartenkopf zugeschnitten. Sie verdrängen oder überdecken keine Titel, Wünsche oder Schaltflächen. Das wurde mit erfolgreich geladenen Bildern auf Desktop und bei 390 px Breite geprüft.

## Spiele entfernen

Jede Spielkarte bietet „Aus Liste entfernen“. Das entfernt den Titel aus der sichtbaren Auswahl, dem Lostopf und der Warteschlange für beide Profile in diesem Browser. Ein bereits angezeigtes Ergebnis dieses Titels wird zurückgesetzt. Die Entscheidung bleibt nach Neuladen, Steam-Synchronisation und Bibliotheksimport erhalten, auch für die fest eingebauten Zusatzspiele. Besitz und Favoriten bleiben zur Wiederherstellung gespeichert; eure Steam-Bibliothek selbst ändert sich nicht. Unter „Entfernte Spiele“ lassen sich Titel einzeln zurückholen. Eine Datensicherung enthält auch die Entfernungen. „Alles zurücksetzen“ löscht sie zusammen mit den übrigen lokalen Daten.
