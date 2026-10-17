import json
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
import server

SID = '76561198925829155'
class SteamAPITest(unittest.TestCase):
    def test_missing_key(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(server, 'fetch') as fetch:
            with self.assertRaises(server.APIError) as e: server.library(SID)
            self.assertEqual(e.exception.status, 503)
            fetch.assert_not_called()

    @patch.dict(os.environ, {'STEAM_API_KEY': 'test-only-secret'})
    def test_games(self):
        payload = {'response': {'game_count': 1, 'games': [{'appid': 620, 'name': 'Portal 2'}]}}
        with patch.object(server, 'fetch', return_value=json.dumps(payload).encode()) as fetch:
            result = server.library(SID)
            self.assertEqual(result['games'], [{'id': '620', 'name': 'Portal 2'}])
            url = fetch.call_args.args[0]
            self.assertTrue(url.startswith('https://api.steampowered.com/IPlayerService/GetOwnedGames/'))
            self.assertIn('include_appinfo=1', url)
            self.assertIn('include_played_free_games=1', url)
            self.assertNotIn('test-only-secret', json.dumps(result))

    @patch.dict(os.environ, {'STEAM_API_KEY': 'test-only-secret'})
    def test_private_and_empty_are_distinct(self):
        with patch.object(server, 'fetch', return_value=b'{"response":{}}'):
            with self.assertRaises(server.APIError) as e: server.library(SID)
            self.assertEqual(e.exception.status, 403)
        with patch.object(server, 'fetch', return_value=b'{"response":{"game_count":0}}'):
            self.assertEqual(server.library(SID)['games'], [])

    @patch.dict(os.environ, {'STEAM_API_KEY': 'test-only-secret'})
    def test_errors_never_expose_key(self):
        errors = [HTTPError('https://example.test/?key=test-only-secret', c, 'test', {}, None) for c in (401,403,429,500)]
        errors += [URLError('test-only-secret'), ValueError('test-only-secret')]
        for error in errors:
            with self.subTest(error=type(error).__name__), patch.object(server, 'fetch', side_effect=error):
                with self.assertRaises(server.APIError) as e: server.library(SID)
                self.assertNotIn('test-only-secret', str(e.exception))

    @patch.dict(os.environ, {'STEAM_API_KEY': 'test-only-secret'})
    def test_partial_response_rejected(self):
        for payload in [b'{"response":{"game_count":2,"games":[]}}',b'{"response":{"game_count":1,"games":[{"appid":"bad"}]}}']:
            with patch.object(server, 'fetch', return_value=payload):
                with self.assertRaises(server.APIError): server.library(SID)

    def test_unknown_account(self):
        with self.assertRaises(server.APIError) as e: server.library('123')
        self.assertEqual(e.exception.status, 400)

if __name__ == '__main__': unittest.main()
