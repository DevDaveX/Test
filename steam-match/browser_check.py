"""UI regression checks; isolated browser state and mocked Steam responses."""
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright
import server

http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
threading.Thread(target=http.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = b.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/header.jpg', lambda route: route.fulfill(content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><rect width="460" height="215" fill="#615181"/><text x="120" y="120" fill="white" font-size="35">Portal 2</text></svg>'))
        page.goto('http://127.0.0.1:' + str(http.server_port))
        assert page.locator('#profileDialog').is_visible()
        page.locator('#chooseDavid').click()
        assert page.locator('.card').count() == 4
        assert page.locator('#streamGames h3').filter(has_text='Huntsman').count() == 1
        assert not page.locator('#games h3').filter(has_text='Huntsman').count()
        assert page.get_by_label('David · Huntsman', exact=True).count() == 0
        page.get_by_label('David · Roblox', exact=True).select_option('yes')
        page.locator('#favoritesOnly').check()
        assert page.locator('.card').count() == 1
        page.locator('#switchPerson').click()
        page.locator('#choosePia').click()
        assert page.locator('.card').count() == 0 # David's favorite isn't Pia's
        page.locator('#favoritesOnly').uncheck()
        page.locator('#streamGames').evaluate('el=>el.parentElement.open=true')
        page.get_by_label('Pia · Huntsman', exact=True).select_option('yes')
        page.get_by_label('Pia · Roblox', exact=True).select_option('no')
        roblox = page.locator('.card').filter(has=page.get_by_role('heading', name='Roblox', exact=True))
        assert 'Heute nicht gewünscht' in roblox.inner_text()
        page.evaluate('''() => {const s=JSON.parse(localStorage.getItem('player-two-v1'));s.games.push({id:'620',name:'Portal 2',owners:['a','c'],confirmed:true,multiplayer:true,votes:['yes','yes'],genre:'Kreativ',price:null});s.games.push({id:'999',name:'Hackhub Test Singleplayer',owners:['a','c'],confirmed:true,multiplayer:false,votes:['neutral','neutral'],genre:'Kreativ'});localStorage.setItem('player-two-v1',JSON.stringify(s));}''')
        page.reload()
        assert page.locator('#profileDialog').is_visible()
        page.locator('#choosePia').click()
        page.locator('#streamGames').evaluate('el=>el.parentElement.open=true')
        assert page.get_by_label('Pia · Huntsman', exact=True).input_value() == 'yes'
        assert page.get_by_label('Pia · Roblox', exact=True).input_value() == 'no'
        assert page.get_by_role('heading', name='Hackhub Test Singleplayer', exact=True).count() == 0
        image = page.locator('.art img').first
        image.wait_for()
        page.wait_for_function('document.querySelector(".art img").complete')
        for width in (1440, 390):
            page.set_viewport_size({'width': width, 'height': 1000})
            for art in page.locator('.art').all():
                rect = art.bounding_box()
                content = art.locator('..').locator('.content').bounding_box()
                assert content['y'] >= rect['y'] + rect['height'] - 1
                for img in art.locator('img').all():
                    ir = img.bounding_box()
                    assert ir['y'] >= rect['y'] and ir['y'] + ir['height'] <= rect['y'] + rect['height'] + 1
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(Path(__file__).parent / ('desktop.png' if width == 1440 else 'mobile.png')), full_page=True)
        page.evaluate("""() => {const s=JSON.parse(localStorage.getItem('player-two-v1'));s.games.push({id:'12345',name:'Only David owns',owners:['a'],confirmed:false,multiplayer:true,votes:['yes','neutral'],genre:'Kreativ',price:15,priceSource:'manual'});localStorage.setItem('player-two-v1',JSON.stringify(s));}""")
        page.route('**/api/details?id=12345',lambda r:r.fulfill(content_type='application/json',body='{"price":15,"multiplayer":true,"categories":["Mehrspieler"]}'))
        page.reload();page.locator('#chooseDavid').click()
        assert page.get_by_role('heading',name='Only David owns',exact=True).count()==0
        page.locator('#drawPurchase').click()
        page.wait_for_function('document.querySelector("#purchaseResult").textContent.includes("Pia fehlt die Kopie")')
        assert '15.00 €' in page.locator('#purchaseResult').inner_text()
        assert page.locator('#games').get_by_role('heading',name='Only David owns',exact=True).count()==0
        page.locator('#purchaseResult select').select_option('no')
        page.locator('#drawPurchase').click()
        page.wait_for_function('document.querySelector("#purchaseResult").textContent.includes("Keine passende Kaufidee")')
        page.locator('#draw').click()
        page.get_by_role('button', name='In die Warteschlange').click()
        assert page.locator('.queueitem').count() == 1
        assert not errors, errors
        print('Browser passed: entry profile picker, separate favorites/veto persistence, five extras, Pia-only Huntsman, singleplayer hidden, loaded image containment, desktop/mobile layout, draw and queue.')
        b.close()
finally:
    http.shutdown()
    http.server_close()
