"""The chest screen while cards are shown: where the switches are, that nothing covers them, that the card fits,
and that an automatic sale does not give the card away before it has turned."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from harness import *
from playwright.sync_api import sync_playwright

c = Checks(); errs = []
G = 'window.__GC'

def drive(pg):
    ev = pg.evaluate
    def sim(sec, fps=30):          # the chest animation, stepped by hand (a real frame takes most of a second here)
        ev('(a) => { const C = window.__GC.chest; for (let i = 0; i < a[0]; i++) { C.time += 1/a[1]; C.applyPose(1/a[1]); } C.renderFrame(); }', [int(round(sec * fps)), fps])
    def rig(q):                    # every chest takes three random numbers: the rarity, the card inside it, the mutation (0.9 = none)
        ev('(q) => { let i = 0; crypto.getRandomValues = (a) => { for (let k = 0; k < a.length; k++) { a[k] = Math.floor(q[i % q.length] * 4294967296); i++; } return a; }; }', q)
    def look():
        return ev("""() => {
          const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
          const g = document.querySelector('#autoGroup'), card = document.querySelector('#reveal .rcard');
          return { card: r('#reveal .rcard'), switches: r('#autoGroup'), buttons: r('#chestUi'), view: r('#view-chest'),
            away: g.classList.contains('away'), opacity: +getComputedStyle(g).opacity, dockAuto: document.querySelector('#chestDock').classList.contains('auto'),
            flipped: !!card && card.classList.contains('flip'), coins: document.querySelector('#coinAmt').textContent, badge: document.querySelector('#invBadge').textContent,
            real: window.__GC.store.s.coins };
        }""")
    return sim, rig, look

with sync_playwright() as p:
    b = launch(p)
    for (w, h) in [(390, 664), (375, 553), (430, 932)]:
        U = make_user({'coins': 0})
        pg = open_app(page_for(b, U, w, h, 2, errs))
        sim, rig, look = drive(pg)
        size = '%dx%d' % (w, h)
        pg.wait_for_timeout(200); sim(0.2)
        home = look()
        c.ok(not home['away'] and not home['dockAuto'] and home['switches']['bottom'] <= home['buttons']['top'] + 1, size + ' idle: the switches sit above the big buttons')

        # ---- a chest opened by hand: the switches step aside, the card stays clear of the buttons
        rig([0.05, 0.0, 0.9])          # a rare
        pg.click('#btnOpen'); pg.wait_for_timeout(350)
        c.ok(look()['away'] and look()['opacity'] < 0.1, size + ' by hand: the switches are out of the way while the chest opens')
        sim(6.0); pg.wait_for_timeout(3200); sim(0.3)
        m = look()
        c.ok(m['card'] and m['flipped'], size + ' by hand: the card is up')
        c.ok(m['card']['bottom'] <= m['buttons']['top'] + 14, size + ' by hand: the card ends above the buttons', (m['card'], m['buttons']))
        c.ok(m['card']['top'] >= m['view']['top'] and m['card']['left'] >= 0 and m['card']['right'] <= w, size + ' by hand: the card is fully on screen', m['card'])
        if (w, h) == (390, 664): shot(pg, 'chest_manual_' + size)
        pg.click('#chestUi .fn-grey'); pg.wait_for_timeout(100); sim(0.8)
        wait_until(lambda: look()['opacity'] > 0.9, 4)
        c.ok(not look()['away'] and look()['opacity'] > 0.9, size + ' by hand: closing the card brings the switches back')

        # ---- auto opening: the switches move to the bottom
        pg.click('#autoPill'); pg.wait_for_selector('.sheet.on #autoStart'); pg.click('.as-presets .chip:nth-child(2)'); pg.wait_for_timeout(150)      # sell commons
        rig([0.9, 0.0, 0.9])           # a common: sold by the rule
        pg.click('#autoStart'); pg.wait_for_timeout(700); sim(0.3)
        a = look()
        c.ok(a['dockAuto'] and not a['away'] and a['opacity'] > 0.9, size + ' auto: the switches stay visible')
        c.ok(a['view']['bottom'] - a['switches']['bottom'] <= 24, size + ' auto: they sit at the very bottom', (a['switches'], a['view']))
        c.ok(a['switches']['top'] > home['switches']['top'] + 60, size + ' auto: clearly lower than before', (home['switches'], a['switches']))
        # ---- the card comes up face down: nothing may give it away yet
        sim(1.4)
        back = look()
        c.ok(back['card'] is not None and not back['flipped'], size + ' auto: the card is up, still face down')
        c.eq([back['real'], back['coins'], back['badge']], [10, '0', '1'], size + ' auto: the sale is booked, but coins and inventory badge have not moved')
        pg.wait_for_timeout(1500); sim(0.05)
        front = look()
        c.ok(front['flipped'], size + ' auto: the card has turned')
        c.eq(front['coins'], '10', size + ' auto: now the coins show the sale')
        c.ok(front['card']['bottom'] <= front['switches']['top'], size + ' auto: the card ends above the switches', (front['card'], front['switches']))
        c.ok(front['card']['bottom'] - front['card']['top'] >= m['card']['bottom'] - m['card']['top'], size + ' auto: the card is at least as large as by hand')
        if (w, h) != (430, 932): shot(pg, 'chest_auto_' + size)
        # ---- the switch can be reached and stops auto opening
        hit = pg.evaluate("(() => { const r = document.querySelector('#autoPill').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest('#autoPill'); })()")
        c.ok(hit, size + ' auto: nothing lies over the auto switch')
        pg.click('#autoPill'); pg.wait_for_timeout(700)
        c.eq(pg.evaluate(G + '.view.auto'), False, size + ' auto: a tap on it stops auto opening')
        off = look()
        c.ok(not off['dockAuto'], size + ' after auto: the switches leave the bottom again')
        pg.close()

    # ---- a kept card moves the inventory badge only after the card has turned as well
    U = make_user({'coins': 0, 'inv': {'i17': 1}})
    pg = open_app(page_for(b, U, 390, 664, 2, errs))
    sim, rig, look = drive(pg)
    pg.wait_for_timeout(200); sim(0.2)
    pg.click('#autoPill'); pg.wait_for_selector('.sheet.on #autoStart'); pg.click('.as-presets .chip:nth-child(1)'); pg.wait_for_timeout(150)          # keep everything
    rig([0.004, 0.0, 0.9])             # an epic
    pg.click('#autoStart'); pg.wait_for_timeout(600)
    sim(2.6)
    back = look()
    c.ok(back['card'] is not None and not back['flipped'], 'kept epic: the card is up, face down')
    c.eq(back['badge'], '1', 'kept epic: the inventory badge has not counted it yet')
    pg.wait_for_timeout(1500); sim(0.05)
    c.eq(look()['badge'], '2', 'kept epic: after the turn it has')
    # ---- the big ones take their time: an epic stays for seconds before the next chest, with Fast open as well
    pg.wait_for_timeout(2600)
    still = look()
    c.ok(still['card'] is not None and still['flipped'], 'kept epic: four seconds later auto opening is still showing it')
    pg.evaluate(G + '.view.setAuto(false)'); pg.wait_for_timeout(500)
    P = lambda id, fast: pg.evaluate("(a) => { const G = window.__GC; G.store.s.settings.fast = a[1]; const it = G.items.find(x => x.id === a[0].split('_')[0]); const m = a[0].split('_')[1]; return G.view.pause(m ? Object.assign({}, it, { mut: { mult: m === 'rainbow' ? 30 : 2 } }) : it); }", [id, fast])
    c.eq([P('i0', False), P('i3', False), P('i17_gold', False), P('i17_rainbow', False), P('i7', False), P('i17', False)], [9000, 6500, 4500, 6500, 1100, 800], 'pauses of auto opening: legendary 9 s, epic 6.5 s, mutated 4.5 to 6.5 s')
    c.eq([P('i0', True), P('i3', True), P('i17_gold', True), P('i7', True), P('i17', True)], [9000, 6500, 4500, 320, 230], 'Fast open hurries past the everyday cards only')
    pg.evaluate(G + ".store.set('fast', true)")
    if pg.evaluate("!!document.querySelector('.sheet.on #runDone')"): pg.click('#runDone'); pg.wait_for_timeout(500)       # the overview of the run that was just stopped
    sim(0.3)
    if pg.evaluate("!!document.querySelector('#chestUi .fn-row .fn-grey') && !document.querySelector('#chestUi').classList.contains('hide')"): pg.click('#chestUi .fn-row .fn-grey'); pg.wait_for_timeout(100)
    sim(1.2); pg.wait_for_timeout(400); sim(0.3)
    wait_until(lambda: not pg.evaluate(G + '.view.busy'), 6)
    rig([0.004, 0.0, 0.9])             # an epic again, now with Fast open on
    pg.click('#btnOpen'); pg.wait_for_timeout(120)
    c.eq(pg.evaluate(G + '.chest.anim.seq.speed'), 1, 'Fast open: the chest of an epic still opens at the normal pace')
    sim(8.0); pg.wait_for_timeout(300)
    c.ok(not pg.evaluate("document.querySelector('#reveal').classList.contains('fast')"), 'Fast open: its card turns at the normal pace too')
    pg.wait_for_timeout(3000); sim(0.2)
    pg.click('#chestUi .fn-grey'); pg.wait_for_timeout(100); sim(0.8); pg.wait_for_timeout(500)
    rig([0.9, 0.0, 0.03])              # a common that comes out gold (3 of 100 rolls land on gold)
    pg.click('#btnOpen'); pg.wait_for_timeout(120)
    c.eq(pg.evaluate(G + '.chest.anim.seq.speed'), 1, 'Fast open: a mutated card takes its time as well')
    sim(6.0); pg.wait_for_timeout(3200); sim(0.2)
    c.ok('m-' in pg.evaluate("document.querySelector('#reveal .rcard').className"), 'and it is a mutated card', pg.evaluate("document.querySelector('#reveal .rcard').className"))
    pg.click('#chestUi .fn-grey'); pg.wait_for_timeout(100); sim(0.8); pg.wait_for_timeout(500)
    rig([0.9, 0.0, 0.9])               # a plain common
    pg.click('#btnOpen'); pg.wait_for_timeout(120)
    c.eq(pg.evaluate(G + '.chest.anim.seq.speed'), 6, 'Fast open: a plain common is as quick as before')
    b.close()
c.done(errs)
