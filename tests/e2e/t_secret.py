"""The hidden combination on the back of the chest: all four purple gems lit -> the next chest is a legendary,
only the two upper ones -> an epic. Also: Fast open timing, no zoom / no copy, the two-button row on a wide screen."""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from harness import *
from playwright.sync_api import sync_playwright

c = Checks(); errs = []
G = 'window.__GC'

def drive(pg):
    ev = pg.evaluate
    def sim(sec, fps=30):
        ev('(a) => { const C = window.__GC.chest; for (let i = 0; i < a[0]; i++) { C.time += 1/a[1]; C.applyPose(1/a[1]); } C.renderFrame(); }', [int(round(sec * fps)), fps])
    def turn(yaw):                 # put the chest at an angle and keep it there (it drifts back after 2.5 s without touch)
        ev('(y) => { const C = window.__GC.chest; C.userYaw = y; C.yawVel = 0; C.lastInput = C.time; C.applyPose(0); C.renderFrame(); }', yaw)
    def gems():                    # where every gem is on screen right now, and whether it faces the viewer
        return ev("""() => { const C = window.__GC.chest, r = document.querySelector('#gl').getBoundingClientRect(), out = [];
          C.root.updateMatrixWorld(true); C.camera.updateMatrixWorld(true);
          C.gemGlows.forEach((s, i) => { const v = s.getWorldPosition(new s.position.constructor()); v.project(C.camera);
            const x = r.left + (v.x * .5 + .5) * r.width, y = r.top + (.5 - v.y * .5) * r.height;
            out.push({ i, kind: C.M.gems[i].kind, part: C.M.gems[i].part, back: C.M.gems[i].pos[2] < 0, x, y, hit: C.gemAt(x, y) }); });
          return out; }""")
    def lit(): return ev("Object.keys(window.__GC.chest.armed).map(Number).sort((a, b) => a - b)")
    return sim, turn, gems, lit

with sync_playwright() as p:
    b = launch(p)
    U = make_user({'coins': 0})
    pg = open_app(page_for(b, U, 390, 844, 2, errs))
    sim, turn, gems, lit = drive(pg)
    pg.wait_for_timeout(200); sim(0.2)
    back = pg.evaluate(G + '.chest.backGems')
    c.eq([len(back['upper']), len(back['lower'])], [2, 2], 'the back of the chest has two upper and two lower purple gems')

    # ---- from the front nothing happens: the gems there are not part of it, the back ones cannot be reached
    turn(0)
    front = [g for g in gems() if g['hit'] == g['i']]
    c.ok(len(front) >= 4 and not any(g['back'] for g in front), 'from the front only front gems can be touched', [g['i'] for g in front])
    for g in front: pg.mouse.click(g['x'], g['y'])
    c.eq(lit(), [], 'tapping gems on the front lights nothing')

    # ---- turn the chest round: the four back gems can be tapped and stay lit
    turn(3.14159)
    gs = gems()
    reach = sorted(g['i'] for g in gs if g['back'] and g['kind'] == 'purple' and g['hit'] == g['i'])
    c.eq(reach, sorted(back['upper'] + back['lower']), 'turned round, all four back gems can be touched')
    by = {g['i']: g for g in gs}
    pg.mouse.click(by[back['upper'][0]]['x'], by[back['upper'][0]]['y']); turn(3.14159)
    c.eq(lit(), [back['upper'][0]], 'a tapped gem is lit')
    c.eq(pg.evaluate(G + '.chest.secret()'), None, 'one gem alone is no combination')
    pg.mouse.click(by[back['upper'][0]]['x'], by[back['upper'][0]]['y']); turn(3.14159)
    c.eq(lit(), [], 'a second tap puts it out again')
    # a drag is not a tap
    g0 = by[back['lower'][0]]
    pg.mouse.move(g0['x'], g0['y']); pg.mouse.down(); pg.mouse.move(g0['x'] + 40, g0['y'], steps=4); pg.mouse.up()
    c.eq(lit(), [], 'dragging across a gem does not light it')
    turn(3.14159)
    by = {g['i']: g for g in gems()}

    # ---- the two upper ones: the next chest is an epic
    for i in back['upper']: pg.mouse.click(by[i]['x'], by[i]['y']); turn(3.14159)
    c.eq(pg.evaluate(G + '.chest.secret()'), 'epic', 'both upper gems lit: epic')
    sim(0.3); shot(pg, 'secret_epic')
    turn(0); sim(0.2)
    # rig the dice: every roll is 0.9, which is a common card
    pg.evaluate("(v) => { crypto.getRandomValues = (a) => { for (let k = 0; k < a.length; k++) a[k] = Math.floor(v * 4294967296); return a; }; }", 0.9)       # the dice say: common
    pg.click('#btnOpen'); pg.wait_for_timeout(100); sim(6.0); pg.wait_for_timeout(3000); sim(0.3)
    c.ok(pg.evaluate("document.querySelector('#reveal .rcard').classList.contains('r-epic')"), 'the chest gives an epic although the dice said common')
    c.eq(pg.evaluate(G + '.store.s.stats.epic'), 1, 'it is a real pull: counted and in the inventory')
    c.eq(lit(), [], 'opening uses the combination up')
    pg.click('#chestUi .fn-grey'); pg.wait_for_timeout(100); sim(0.8); pg.wait_for_timeout(400)
    # the chest after that is an ordinary one again
    pg.click('#btnOpen'); pg.wait_for_timeout(100); sim(6.0); pg.wait_for_timeout(3000); sim(0.3)
    c.ok(pg.evaluate("document.querySelector('#reveal .rcard').classList.contains('r-common')"), 'the chest after that follows the dice again')
    pg.click('#chestUi .fn-grey'); pg.wait_for_timeout(100); sim(0.8); pg.wait_for_timeout(400)

    # ---- all four: a legendary
    turn(3.14159); by = {g['i']: g for g in gems()}
    for i in back['upper'] + back['lower']: pg.mouse.click(by[i]['x'], by[i]['y']); turn(3.14159)
    c.eq(pg.evaluate(G + '.chest.secret()'), 'legendary', 'all four lit: legendary')
    sim(0.3); shot(pg, 'secret_legendary')
    turn(0); sim(0.2)
    pg.click('#btnOpen'); pg.wait_for_timeout(100); sim(8.0); pg.wait_for_timeout(3200); sim(0.3)
    c.ok(pg.evaluate("document.querySelector('#reveal .rcard').classList.contains('r-legendary')"), 'the chest gives a legendary')
    c.eq(pg.evaluate(G + '.store.s.stats.legend'), 1, 'counted as a legendary pull')
    pg.click('#chestUi .fn-grey'); pg.wait_for_timeout(100); sim(0.8); pg.wait_for_timeout(400)

    # ---- three gems are nothing, and a preview from the settings leaves lit gems alone
    turn(3.14159); by = {g['i']: g for g in gems()}
    for i in back['upper'] + back['lower'][:1]: pg.mouse.click(by[i]['x'], by[i]['y']); turn(3.14159)
    c.eq(pg.evaluate(G + '.chest.secret()'), None, 'two upper and one lower: no combination')
    turn(0); sim(0.2)
    pg.evaluate(G + '.view.open("rare", true)'); pg.wait_for_timeout(100); sim(6.0); pg.wait_for_timeout(3000); sim(0.3)
    c.eq(len(lit()), 3, 'a preview does not use the gems up')
    pg.click('#chestUi .fn-grey'); pg.wait_for_timeout(100); sim(0.8); pg.wait_for_timeout(400)
    pg.click('#btnOpen'); pg.wait_for_timeout(100); sim(6.0); pg.wait_for_timeout(3000); sim(0.3)
    c.ok(pg.evaluate("document.querySelector('#reveal .rcard').classList.contains('r-common')"), 'three gems: an ordinary chest')
    c.eq(lit(), [], 'and they are out afterwards')
    pg.click('#chestUi .fn-grey'); pg.wait_for_timeout(100); sim(0.8); pg.wait_for_timeout(400)

    # ---- Fast open: one common chest from tap to the buttons in well under a second of animation
    pg.evaluate(G + ".store.set('fast', true)")
    pg.click('#btnOpen'); pg.wait_for_timeout(60)
    c.eq(pg.evaluate(G + '.chest.anim.seq.speed'), 6, 'Fast open plays the chest six times as fast')
    sim(0.3)            # 0.3 s x 6 = 1.8 s of the 1.75 s animation
    t0 = time.time()
    pg.wait_for_function("!document.querySelector('#chestUi').classList.contains('hide') && document.querySelectorAll('#chestUi .fn-btn').length === 3", timeout=5000)
    c.ok(time.time() - t0 < 1.5, 'the card is done and the buttons are there within moments', round(time.time() - t0, 2))
    c.eq(pg.evaluate("getComputedStyle(document.querySelector('#reveal .card-wrap')).animationDuration"), '0.16s', 'the card rises in 0.16 s')
    pg.click('#chestUi .fn-grey'); pg.wait_for_timeout(100); sim(0.3); pg.wait_for_timeout(300)
    pg.evaluate(G + ".store.set('fast', false)")

    # ---- no zoom, no copy
    c.eq(pg.evaluate("getComputedStyle(document.body).touchAction"), 'pan-x pan-y', 'touch: scrolling only, no pinch or double-tap zoom')
    c.eq(pg.evaluate("getComputedStyle(document.body).userSelect"), 'none', 'text cannot be selected')
    blocked = pg.evaluate("""() => { const out = {}; for (const [name, ev] of [['copy', new ClipboardEvent('copy', { bubbles: true, cancelable: true })], ['contextmenu', new MouseEvent('contextmenu', { bubbles: true, cancelable: true })],
      ['selectstart', new Event('selectstart', { bubbles: true, cancelable: true })], ['wheel', new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -50 })],
      ['gesturestart', new Event('gesturestart', { bubbles: true, cancelable: true })], ['dblclick', new MouseEvent('dblclick', { bubbles: true, cancelable: true })]]) out[name] = !document.querySelector('.logo-word').dispatchEvent(ev); return out; }""")
    c.eq(blocked, {'copy': True, 'contextmenu': True, 'selectstart': True, 'wheel': True, 'gesturestart': True, 'dblclick': True}, 'copy, long-press menu, selection, pinch and ctrl-wheel zoom are refused')
    plain = pg.evaluate("!document.querySelector('.logo-word').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 30 }))")
    c.eq(plain, False, 'ordinary scrolling is left alone')
    pg.click('#nav button[data-go=trade]'); pg.wait_for_selector('#trSearch')
    field = pg.evaluate("""() => { const i = document.querySelector('#trSearch'); return ['copy', 'selectstart', 'contextmenu'].map(n => i.dispatchEvent(new Event(n, { bubbles: true, cancelable: true }))); }""")
    c.eq(field, [True, True, True], 'inside a text field selecting and copying still work')
    pg.fill('#trSearch', 'abc'); c.eq(pg.input_value('#trSearch'), 'abc', 'typing works')
    pg.close()

    # ---- wide screen (tablet, landscape): SELL and KEEP sit under OPEN AGAIN, same width, centred
    U2 = make_user({'coins': 0})
    pg = open_app(page_for(b, U2, 1158, 798, 2, errs))
    sim, turn, gems, lit = drive(pg)
    pg.wait_for_timeout(200); sim(0.2)
    pg.click('#btnOpen'); pg.wait_for_timeout(100); sim(6.0); pg.wait_for_timeout(3200); sim(0.3)
    r = pg.evaluate("""() => { const q = s => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; };
      return { again: q('#chestUi > .fn-yellow'), row: q('#chestUi .fn-row'), sell: q('#chestUi .fn-row .fn-green'), keep: q('#chestUi .fn-row .fn-grey') }; }""")
    mid = lambda a: (a[0] + a[1]) / 2
    c.ok(abs(mid(r['again']) - 579) <= 2 and abs(mid(r['row']) - 579) <= 2, 'wide screen: both rows are centred', r)
    c.ok(abs(r['sell'][0] - r['again'][0]) <= 2 and abs(r['keep'][1] - r['again'][1]) <= 2, 'wide screen: the two buttons together are as wide as OPEN AGAIN', r)
    c.ok(abs((r['sell'][1] - r['sell'][0]) - (r['keep'][1] - r['keep'][0])) <= 2 and r['sell'][1] < r['keep'][0], 'wide screen: SELL and KEEP share the row evenly', r)
    shot(pg, 'wide_buttons')
    b.close()
c.done(errs)
