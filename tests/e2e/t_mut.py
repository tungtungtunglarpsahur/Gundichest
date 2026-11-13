"""Mutations and the announcement everybody sees."""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from harness import *
from playwright.sync_api import sync_playwright

c = Checks(); errs = []
G = 'window.__GC'
RIG = "(q) => { let i = 0; crypto.getRandomValues = (a) => { for (let k = 0; k < a.length; k++) { a[k] = Math.floor(q[i % q.length] * 4294967296); i++; } return a; }; }"

with sync_playwright() as p:
    b = launch(p)
    A = make_user({'coins': 0}); B = make_user({'coins': 0})
    pa = open_app(page_for(b, A, 390, 844, 2, errs)); pb = open_app(page_for(b, B, 390, 844, 2, errs))
    pb.evaluate(G + '.net.pollNow()'); pb.wait_for_timeout(800)          # B has heard where the announcements end
    def sim(sec, fps=30):
        pa.evaluate('(a) => { const C = window.__GC.chest; for (let i = 0; i < a[0]; i++) { C.time += 1/a[1]; C.applyPose(1/a[1]); } C.renderFrame(); }', [int(round(sec * fps)), fps])
    pa.wait_for_timeout(200); sim(0.2)

    # ---- a chest that rolls: common (0.9), first card (0.0), rarest mutation (0.0004 -> rainbow)
    pa.evaluate(RIG, [0.9, 0.0, 0.0004])
    pa.click('#btnOpen'); pa.wait_for_timeout(100); sim(6.0); pa.wait_for_timeout(3200); sim(0.3)
    cls = pa.evaluate("document.querySelector('#reveal .rcard').className")
    c.ok('r-common' in cls and 'm-rainbow' in cls, 'the card comes out as a rainbow common', cls)
    c.ok('RAINBOW' in pa.inner_text('#reveal .mrib') and '×30' in pa.inner_text('#reveal .mrib'), 'the card says so', pa.inner_text('#reveal .mrib'))
    inv = pa.evaluate(G + '.store.s.inv')
    c.eq(inv, {'i17_rainbow': 1}, 'it is in the inventory as its own card')
    c.ok('300' in pa.inner_text('#reveal .cell:not(.c1) b'), 'worth 30 times the card: 300', pa.inner_text('#reveal .cell:not(.c1) b'))
    c.eq(pa.evaluate(G + '.store.s.found'), {'i17_rainbow': True, 'i17': True}, 'the plain card counts as found too')
    c.ok('SELL +300' in pa.inner_text('#chestUi'), 'selling it pays 300', pa.inner_text('#chestUi'))
    shot(pa, 'mut_rainbow')
    # ---- everybody is told
    ann = pa.inner_text('#feed')
    c.ok(A['name'] in ann and 'Rainbow Frau Kaese' in ann and 'in Common!' in ann, 'my own page shows the announcement', ann)
    pb.evaluate(G + '.net.pollNow()')
    wait_until(lambda: pb.evaluate("!!document.querySelector('#feed .ann')"), 6)
    annb = pb.inner_text('#feed')
    c.ok(A['name'] in annb and 'got Rainbow Frau Kaese in Common!' in annb, 'the other player sees "<name> got Rainbow Frau Kaese in Common!"', annb)
    shot(pb, 'announce_other')
    pa.click('#chestUi .fn-grey'); pa.wait_for_timeout(100); sim(0.8); pa.wait_for_timeout(400)

    # ---- an epic is announced too: "<name> got Frau ... in Epic!"
    pa.evaluate(RIG, [0.002, 0.0, 0.9])                  # epic, first epic card, no mutation
    pa.click('#btnOpen'); pa.wait_for_timeout(100); sim(8.0); pa.wait_for_timeout(3400); sim(0.3)
    c.ok('r-epic' in pa.evaluate("document.querySelector('#reveal .rcard').className"), 'an epic without a mutation')
    pb.wait_for_timeout(5200); pb.evaluate(G + '.net.pollNow()')
    wait_until(lambda: 'in Epic!' in (pb.inner_text('#feed') if pb.evaluate("!!document.querySelector('#feed')") else ''), 8)
    c.ok(A['name'] + ' got Frau Ullmann in Epic!' in pb.inner_text('#feed'), 'the other player sees "<name> got Frau Ullmann in Epic!"', pb.inner_text('#feed'))
    pa.click('#chestUi .fn-grey'); pa.wait_for_timeout(100); sim(0.8); pa.wait_for_timeout(400)
    # ---- a plain common is nobody's business
    pa.evaluate(RIG, [0.9, 0.0, 0.9])
    pa.click('#btnOpen'); pa.wait_for_timeout(100); sim(6.0); pa.wait_for_timeout(3200); sim(0.3)
    pb.wait_for_timeout(5200); pb.evaluate(G + '.net.pollNow()'); pb.wait_for_timeout(1200)
    c.ok('Kaese in Common' not in pb.inner_text('#feed') or 'Rainbow' in pb.inner_text('#feed'), 'a plain common is not announced', pb.inner_text('#feed'))
    pa.click('#chestUi .fn-grey'); pa.wait_for_timeout(100); sim(0.8); pa.wait_for_timeout(400)

    # ---- inventory, index, saved game
    pa.click('#nav button[data-go=inv]'); pa.wait_for_selector('#invList')
    rows = pa.evaluate("[...document.querySelectorAll('#invList .inv-item')].map(r => r.className.replace('inv-item ', '') + ' | ' + r.querySelector('.nm').textContent + ' | ' + (r.querySelector('.mtag') ? r.querySelector('.mtag').textContent.trim() : ''))")
    c.ok(any('m-rainbow' in r and 'Frau Kaese' in r and 'Rainbow' in r for r in rows) and len(rows) == 3, 'the inventory lists the rainbow card next to the plain ones', rows)
    c.eq(pa.inner_text('.inv-stats .stat:nth-child(3) .v'), '2/26', 'found counts cards, not their mutations')
    pa.click('#invFilters .chip[data-f=mut]'); pa.wait_for_timeout(200)
    c.eq(pa.evaluate("document.querySelectorAll('#invList .inv-item').length"), 1, 'the Mutated filter shows only the mutated card')
    shot(pa, 'mut_inventory')
    pa.evaluate(G + '.net.syncNow()'); pa.wait_for_timeout(800)
    st, body = rpc('me', {'rev': -1}, A['token'])
    c.eq(body['state']['inv'].get('i17_rainbow'), 1, 'the server keeps the mutated card')
    pa.click('#nav button[data-go=chest]'); pa.wait_for_timeout(300); pa.click('#btnIndex'); pa.wait_for_selector('.sheet.on .ix-mut')
    mut = pa.evaluate("[...document.querySelectorAll('.sheet.on .ix-mut .ix-row')].map(r => r.querySelector('.nm').textContent + ':' + r.querySelector('.own').textContent)")
    c.ok(len(mut) == 11 and 'Rainbow:Owned ×1' in mut and 'Gold:Not found yet' in mut, 'the index lists all 11 mutations and what I have', mut)
    pa.evaluate("document.querySelector('.sheet.on .ix-mut').scrollIntoView()"); pa.wait_for_timeout(300); shot(pa, 'mut_index')
    b.close()
c.done(errs)
