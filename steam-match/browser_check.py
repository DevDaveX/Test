from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page=b.new_page(viewport={'width':1440,'height':1000})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8080/')
    page.get_by_role('button',name='Beispiel ansehen').click()
    assert page.locator('.card').count()==6
    page.get_by_role('button',name='Gemeinsames Spiel auslosen').click()
    assert page.locator('#winner strong').inner_text()
    page.get_by_role('button',name='In die Warteschlange').click()
    assert page.locator('.queueitem').count()==1
    page.screenshot(path=str(Path(__file__).parent/'desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(Path(__file__).parent/'mobile.png'),full_page=True)
    # Replace demos with real-format imported libraries; account B + her library is a match.
    page.get_by_text('Profile & manueller Bibliothek-Import').click()
    page.locator('#account').select_option('b')
    page.locator('#importText').fill('413150;Stardew Valley')
    page.get_by_role('button',name='Importieren',exact=True).click()
    page.locator('#account').select_option('c')
    page.locator('#importText').fill('{"response":{"games":[{"appid":413150,"name":"Stardew Valley"}]}}')
    page.get_by_role('button',name='Importieren',exact=True).click()
    assert '1 gemeinsame Spiele' in page.locator('#status').inner_text()
    assert page.locator('.card').count()==1
    assert page.locator('#draw').is_disabled() # no invented co-op confirmation
    page.get_by_role('button',name='Bearbeiten',exact=True).click()
    page.locator('#newCoop').check()
    page.get_by_role('button',name='Hinzufügen / vorhandene App-ID ergänzen').click()
    assert not page.locator('#draw').is_disabled()
    page.locator('.votes select').nth(1).select_option('no')
    assert page.locator('#draw').is_disabled()
    page.reload()
    assert page.locator('.votes select').nth(1).input_value()=='no'
    assert not errors,errors
    print('Browser passed: demo, draw, queue, mobile layout, CSV + JSON imports, union of accounts, co-op confirmation, veto and persistence. No page errors.')
    b.close()
