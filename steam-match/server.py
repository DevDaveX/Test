"""Local Steam library reader. No Steam credentials required or stored."""
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).parent
IDS = {'76561198925829155', '76561198078956373', '76561198350287430'}

def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'SteamMatch/1.0'}), timeout=20) as r:
        return r.read(8_000_000)

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
                if sid not in IDS: raise ValueError('Unbekanntes Profil')
                raw = fetch(f'https://steamcommunity.com/profiles/{sid}/games/?tab=all&xml=1')
                if b'<html' in raw[:500].lower():
                    raise ValueError('Steam liefert eine Anmeldeseite statt der Bibliothek. Besitz nicht ermittelbar. Bitte XML/JSON/CSV der Bibliothek manuell importieren; keine Login-Daten hier eingeben.')
                root = ET.fromstring(raw)
                games = [{'id': g.findtext('appID'), 'name': g.findtext('name')} for g in root.findall('./games/game')]
                if not games: raise ValueError('Keine Spiele lesbar. Steam-Profil und Spieldetails müssen öffentlich sein; alternativ Bibliothek importieren.')
                result = {'games': games}
            elif p.path == '/api/details':
                appid = q.get('id', [''])[0]
                if not re.fullmatch(r'\d{1,10}', appid): raise ValueError('Ungültige App-ID')
                item = json.loads(fetch(f'https://store.steampowered.com/api/appdetails?appids={appid}&cc=de&l=german'))[appid]
                if not item.get('success'): raise ValueError('Keine Store-Daten verfügbar')
                d = item['data']; price = d.get('price_overview', {})
                result = {'name': d['name'], 'coop': any(c['id'] in (9,38,39) for c in d.get('categories', [])), 'categories': [c['description'] for c in d.get('categories', [])], 'price': 0 if d.get('is_free') else (price.get('final', 0)/100 if price.get('currency') == 'EUR' and 'final' in price else None), 'genres': [g['description'] for g in d.get('genres', [])]}
            else: raise ValueError('Unbekannte Anfrage')
            self.reply(200, result)
        except Exception as e:
            self.reply(502, {'error': str(e)})

    def reply(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(body)

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8080), Handler).serve_forever()
