"""The page shell on the website build: top bar, four tabs, icons, the new drop chances, small screens."""
import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from harness import *
from playwright.sync_api import sync_playwright

c = Checks(); errs = []
G = 'window.__GC'

def fits(pg, sel):
    return pg.evaluate("""sel => { const bar = document.querySelector(sel).getBoundingClientRect(); return [...document.querySelector(sel).querySelectorAll('*')].every(e => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= bar.left - 0.5 && r.right <= bar.right + 0.5); }); }""", sel)

with sync_playwright() as p:
    b = launch(p)
    U = make_user({'coins': 123456, 'inv': {'i0': 1, 'i17': 2}})
    pg = open_app(page_for(b, U, errors=errs))
    tabs = pg.evaluate("[...document.querySelectorAll('#nav button')].filter(b => b.offsetWidth > 0).map(b => b.innerText.trim().split('\\n')[0].toLowerCase())")
    c.eq(tabs, ['chest', 'inventory', 'games', 'trade'], 'four tabs: chest, inventory, games, trade')
    c.ok(pg.evaluate("!!document.querySelector('.logo-mark use') && document.querySelector('#gmark') !== null"), 'the G mark sits top left')
    c.ok(pg.evaluate("document.querySelector('.logo-mark').getBoundingClientRect().width >= 26"), 'and is drawn')
    # head: icons and manifest are real files
    head = pg.evaluate("[...document.querySelectorAll('link[rel~=icon], link[rel=apple-touch-icon], link[rel=manifest]')].map(l => l.getAttribute('href'))")
    c.eq(sorted(head), ['/apple-touch-icon.png', '/favicon.ico', '/favicon.svg', '/site.webmanifest'], 'favicon, home screen icon and manifest are linked')
    for path in head + ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/og.png']:
        with urllib.request.urlopen(URL.rstrip('/') + path) as r:
            c.ok(r.status == 200 and len(r.read()) > 300, path + ' is served')
    man = json.loads(urllib.request.urlopen(URL + 'site.webmanifest').read())
    c.eq([man['name'], man['display'], len(man['icons'])], ['GundiChest', 'standalone', 3], 'the manifest names the app and its icons')
    c.eq(pg.evaluate("document.querySelector('meta[name=apple-mobile-web-app-title]').content"), 'GundiChest', 'home screen title is set')
    # the index shows the new chances
    pg.click('#btnIndex'); pg.wait_for_selector('.sheet.on .ix-group')
    text = pg.inner_text('.sheet.on .ix-legend')
    c.ok('Legendary 0.1%' in text and 'Epic 0.5%' in text and 'Common 63.4%' in text, 'index: legendary 0.1%, epic 0.5%, common 63.4%', text)
    c.ok('1 in 3,000' in pg.inner_text('.sheet.on .ix-group.r-legendary'), 'one legendary card: 1 in 3,000 chests')
    c.ok('1 in 1,000' in pg.inner_text('.sheet.on .ix-group.r-epic'), 'one epic card: 1 in 1,000 chests')
    pg.click('.sheet.on .x-btn'); pg.wait_for_timeout(450)
    # the request bar makes room without covering the game
    V = make_user({})
    h0 = pg.evaluate("document.querySelector('#views').getBoundingClientRect().height")
    rpc('trade.request', {'to': U['id']}, V['token'])
    pg.evaluate(G + '.net.pollNow()'); pg.wait_for_selector('#tradeBar.on .tbar'); pg.wait_for_timeout(500)
    h1 = pg.evaluate("document.querySelector('#views').getBoundingClientRect().height")
    c.ok(50 <= h0 - h1 <= 60, 'the request bar pushes the view down instead of covering it', (h0, h1))
    c.eq(pg.evaluate("(() => { const cv = document.querySelector('#gl'); return Math.round(cv.getBoundingClientRect().height) === Math.round(document.querySelector('#views').getBoundingClientRect().height); })()"), True, 'the chest canvas follows the new size')
    pg.evaluate(G + '.chest.step(0.016)'); shot(pg, 'shell_390')
    # small phones: nothing in the top bar or the bar below sticks out
    for w, h in [(375, 667), (360, 640), (320, 568)]:
        pg.set_viewport_size({'width': w, 'height': h}); pg.wait_for_timeout(250)
        c.ok(fits(pg, '.topbar'), 'top bar fits at %d px' % w)
        c.ok(fits(pg, '#tradeBar'), 'request bar fits at %d px' % w)
        c.ok(fits(pg, '#nav'), 'tabs fit at %d px' % w)
        pg.evaluate(G + '.chest.resize(); ' + G + '.chest.step(0.016)'); shot(pg, 'shell_%d' % w)
    # the trade room on a small phone: both sides, the accept button and the coin field are on screen
    pg.set_viewport_size({'width': 375, 'height': 667})
    pg.click('#tradeBar button[data-act=yes]'); pg.wait_for_selector('.tr-room')
    rpc('sync', {'rev': 0, 'state': {'coins': 500, 'inv': {'i3': 1, 'i7': 2, 'i14': 1, 'i20': 3}}}, V['token'])
    tid = rpc('poll', {}, V['token'])[1]['open']['id']
    rpc('trade.offer', {'id': tid, 'items': {'i3': 1, 'i7': 2, 'i14': 1, 'i20': 3}, 'coins': 250}, V['token'])
    pg.click('#trAdd'); pg.wait_for_selector('.sheet.on #trPickDone'); pg.click('.sheet.on button[data-id=i0][data-d="1"]'); pg.click('.sheet.on button[data-id=i17][data-d="1"]'); pg.click('#trPickDone')
    pg.wait_for_timeout(2600)
    vis = pg.evaluate("""() => { const v = document.querySelector('#view-trade').getBoundingClientRect(); return ['#trTheirs', '#trAccept', '#trMine', '#trCoins', '#trAdd'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.top >= v.top - 1 && r.bottom <= v.bottom + 1; }); }""")
    c.eq(vis, [True] * 5, 'trade room at 375x667: both offers, ACCEPT and the coin field are visible together')
    shot(pg, 'room_375')
    pg.set_viewport_size({'width': 320, 'height': 568}); pg.wait_for_timeout(300); shot(pg, 'room_320')
    c.ok(fits(pg, '.tr-room'), 'trade room fits at 320 px wide')
    b.close()
c.done(errs)
