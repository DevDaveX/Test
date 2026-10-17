"""Local Steam reader; STEAM_API_KEY is read only from the server environment."""
import json
import os
import socket
import urllib.error
import re
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode

ROOT = Path(__file__).parent
IDS = {'76561198925829155', '76561198078956373', '76561198350287430'}

def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'SteamMatch/1.0'}), timeout=20) as r:
        return r.read(8_000_000)

class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def library(sid):
    if sid not in IDS:
        raise APIError(400, 'Unbekanntes Profil')
    key = os.environ.get('STEAM_API_KEY', '').strip()
    if not key:
        raise APIError(503, 'Steam-API-Schlüssel fehlt auf dem Server. STEAM_API_KEY sicher als Umgebungsvariable setzen und den Server neu starten. Schlüssel nicht im Browser oder in GitHub eintragen.')
    query = urlencode({'key': key, 'steamid': sid, 'include_appinfo': 1,
                       'include_played_free_games': 1, 'format': 'json'})
    try:
        data = json.loads(fetch('https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?' + query))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise APIError(502, 'Steam API verweigert den Zugriff. API-Schlüssel und Freigabe für api.steampowered.com auf dem Server prüfen.') from None
        if e.code == 429:
            raise APIError(429, 'Steam-API-Limit erreicht. Bitte später erneut versuchen.') from None
        raise APIError(502, 'Steam API ist vorübergehend nicht verfügbar.') from None
    except (urllib.error.URLError, TimeoutError, socket.timeout):
        raise APIError(502, 'Steam API nicht erreichbar. Netzwerkfreigabe für api.steampowered.com und Verbindung prüfen.') from None
    except (ValueError, UnicodeError):
        raise APIError(502, 'Ungültige Antwort der Steam API.') from None
    response = data.get('response') if isinstance(data, dict) else None
    if not isinstance(response, dict) or 'game_count' not in response:
        raise APIError(403, 'Steam gibt diese Bibliothek nicht frei. Profil und Spieldetails müssen öffentlich sein. Der API-Schlüssel umgeht keine Privatsphäre-Einstellungen.')
    games = response.get('games', [])
    if not isinstance(games, list) or not isinstance(response['game_count'], int) or response['game_count'] < 0 or response['game_count'] != len(games):
        raise APIError(502, 'Unvollständige Spieleliste der Steam API; bestehende Bibliothek bleibt erhalten.')
    result = []
    for game in games:
        if not isinstance(game, dict) or not isinstance(game.get('appid'), int) or game['appid'] <= 0:
            raise APIError(502, 'Ungültiger Spieleintrag der Steam API.')
        result.append({'id': str(game['appid']), 'name': game.get('name') or 'Steam App ' + str(game['appid'])})
    return {'games': result, 'source': 'steam-web-api'}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_GET(self):
        p = urlparse(self.path)
        if not p.path.startswith('/api/'):
            return super().do_GET()
        try:
            q = parse_qs(p.query)
            if p.path == '/api/library':
                sid = q.get('id', [''])[0]
                result = library(sid)
            elif p.path == '/api/details':
                appid = q.get('id', [''])[0]
                if not re.fullmatch(r'\d{1,10}', appid): raise ValueError('Ungültige App-ID')
                item = json.loads(fetch(f'https://store.steampowered.com/api/appdetails?appids={appid}&cc=de&l=german'))[appid]
                if not item.get('success'): raise ValueError('Keine Store-Daten verfügbar')
                d = item['data']; price = d.get('price_overview', {})
                result = {'name': d['name'], 'coop': any(c['id'] in (9,38,39) for c in d.get('categories', [])), 'categories': [c['description'] for c in d.get('categories', [])], 'price': 0 if d.get('is_free') else (price.get('final', 0)/100 if price.get('currency') == 'EUR' and 'final' in price else None), 'genres': [g['description'] for g in d.get('genres', [])]}
            else: raise ValueError('Unbekannte Anfrage')
            self.reply(200, result)
        except APIError as e:
            self.reply(e.status, {'error': str(e)})
        except Exception:
            # Upstream exceptions may contain URLs with the API key. Never return them.
            self.reply(502, {'error': 'Steam-Anfrage fehlgeschlagen. Verbindung und Eingaben prüfen.'})

    def reply(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(body)

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8080), Handler).serve_forever()
