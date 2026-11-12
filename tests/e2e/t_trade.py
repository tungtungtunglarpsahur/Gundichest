"""Two players trade through the real page: request, bar, room, offers, accept twice each, swap, history."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from harness import *
from playwright.sync_api import sync_playwright

c = Checks(); errs = []
A = make_user({'coins': 2500, 'inv': {'i0': 1, 'i7': 2, 'i17': 3}, 'opened': 6})
B = make_user({'coins': 400, 'inv': {'i3': 1, 'i14': 2}, 'opened': 3})
st = lambda pg: pg.evaluate('(() => { const t = window.__GC.trade.state; return { screen: t.screen, status: t.cur && t.cur.status, me: t.cur && t.cur.me, them: t.cur && t.cur.them, inbox: t.inbox.length, sent: t.sent.length, open: !!t.open, draft: t.draft }; })()')
inv = lambda pg: pg.evaluate('(() => { const s = window.__GC.store.s; return { coins: s.coins, inv: s.inv }; })()')

with sync_playwright() as p:
    b = launch(p)
    a = open_app(page_for(b, A, errors=errs)); bp = open_app(page_for(b, B, errors=errs))
    c.eq(inv(a), {'coins': 2500, 'inv': {'i0': 1, 'i7': 2, 'i17': 3}}, 'A starts with the saved game of the account')
    c.eq(a.evaluate('window.__GC.mode'), 'account', 'A is logged in')

    # --- A looks for B and asks
    a.click('#nav button[data-go=trade]')
    a.wait_for_selector('#trSearch')
    a.fill('#trSearch', B['name'][:5])
    a.wait_for_selector('#trPeople .tr-row button[data-act=ask]', timeout=8000)
    c.ok(B['name'] in a.inner_text('#trPeople'), 'search finds the other player')
    c.ok('online' in a.inner_text('#trPeople .tr-row'), 'and shows them as online')
    a.click('#trPeople .tr-row button[data-act=ask]')
    a.wait_for_selector('#trSent .tr-row', timeout=8000)
    c.ok(B['name'] in a.inner_text('#trSent'), 'the request is listed as waiting for an answer')
    c.eq(a.inner_text('#trPeople .tr-row button'), 'Asked', 'the player row says Asked')
    shot(a, 'trade_a_sent')

    # --- B is on the chest tab and gets the bar
    bp.evaluate('window.__GC.net.pollNow()')
    bp.wait_for_selector('#tradeBar.on .tbar', timeout=12000)
    c.ok(A['name'] in bp.inner_text('#tradeBar'), 'the request bar names who is asking')
    c.eq(bp.inner_text('#tradeBadge'), '1', 'the Trade tab shows a badge')
    shot(bp, 'trade_b_bar')
    bp.click('#tradeBar button[data-act=yes]')
    bp.wait_for_selector('.tr-room', timeout=8000)
    c.eq(bp.evaluate('window.__GC.ui.view'), 'trade', 'accepting takes B into the trade room')
    c.ok(not bp.evaluate("document.querySelector('#tradeBar').classList.contains('on')"), 'the bar is gone on the trade tab')

    # --- A is moved into the room by the heartbeat
    a.wait_for_selector('.tr-room', timeout=15000)
    c.eq(st(a)['status'], 'open', 'A is in the room too')
    c.ok(a.is_disabled('#trAccept'), 'nothing to accept while the table is empty')

    # --- A builds an offer: two cards through the picker, coins typed in
    a.click('#trAdd'); a.wait_for_selector('.sheet.on #trPickDone')
    a.click('.sheet.on button[data-id=i0][data-d="1"]')
    a.click('.sheet.on button[data-id=i17][data-d="1"]'); a.click('.sheet.on button[data-id=i17][data-d="1"]')
    c.ok(a.is_disabled('.sheet.on button[data-id=i0][data-d="1"]'), 'the picker stops at the number of copies owned')
    shot(a, 'trade_a_picker')
    a.click('#trPickDone'); a.wait_for_timeout(500)
    a.fill('#trCoins', '120'); a.wait_for_timeout(200)
    wait_until(lambda: st(a)['draft'] is None and st(a)['me']['offer'] == {'items': {'i0': 1, 'i17': 2}, 'coins': 120}, 8)
    c.eq(st(a)['me']['offer'], {'items': {'i0': 1, 'i17': 2}, 'coins': 120}, 'the server has the offer of A')
    c.eq(a.evaluate('window.__GC.store.held'), {'items': {'i0': 1, 'i17': 2}, 'coins': 120}, 'what A offers is held back in the game')
    c.eq(a.evaluate('window.__GC.store.free("i17")'), 1, 'one of three commons is still free')
    c.eq(a.evaluate('window.__GC.store.avail()'), 2380, 'offered coins cannot be bet')
    c.eq(a.evaluate('window.__GC.store.sell("i0", 1)'), 0, 'an offered card cannot be sold')

    # --- B sees it and answers with a card
    wait_until(lambda: st(bp)['them'] and st(bp)['them']['offer']['coins'] == 120, 10)
    c.eq(st(bp)['them']['offer'], {'items': {'i0': 1, 'i17': 2}, 'coins': 120}, "B sees A's offer")
    bp.click('#trAdd'); bp.wait_for_selector('.sheet.on #trPickDone')
    bp.click('.sheet.on button[data-id=i3][data-d="1"]'); bp.click('#trPickDone')
    wait_until(lambda: st(bp)['draft'] is None and st(bp)['me']['offer']['items'] == {'i3': 1}, 8)
    wait_until(lambda: st(a)['them']['offer']['items'] == {'i3': 1}, 10)
    # A gives 10000 + 20 + 120 = 10140 and gets 1500
    c.eq(a.inner_text('#trFairMe b'), '−85%', 'fairness for A: gives far more than it gets')
    c.eq(a.inner_text('#trFairThem b'), '+576%', 'fairness for B from the view of A')
    c.eq(bp.inner_text('#trFairMe b'), '+576%', 'B sees its own gain')
    c.eq(bp.inner_text('#trFairThem b'), '−85%', 'and the loss of A')
    c.ok('Better for' in a.inner_text('#trSay'), 'the meter says who is better off')
    a.wait_for_timeout(2000)
    shot(a, 'trade_a_room'); shot(bp, 'trade_b_room')

    # --- accept twice each
    a.click('#trAccept')
    wait_until(lambda: st(a)['me']['step'] == 1, 8)
    c.ok(a.is_disabled('#trAccept') and 'Waiting' in a.inner_text('#trHint'), 'A accepted and waits')
    wait_until(lambda: st(bp)['them']['step'] == 1, 8)
    c.ok(A['name'] + ' accepted' in bp.inner_text('#trHint'), 'B is told that A accepted')
    bp.click('#trAccept')
    wait_until(lambda: st(bp)['me']['step'] == 1, 8)
    wait_until(lambda: a.inner_text('#trAccept') == 'CONFIRM' and not a.is_disabled('#trAccept'), 10)
    c.eq(a.inner_text('#trAccept'), 'CONFIRM', 'after both accepted the button becomes CONFIRM')
    shot(a, 'trade_a_confirm')
    a.click('#trAccept')
    wait_until(lambda: st(a)['me']['step'] == 2, 8)
    c.eq(st(a)['status'], 'open', 'one confirm is not enough')
    c.eq(inv(a)['coins'], 2500, 'nothing has moved yet')
    wait_until(lambda: bp.inner_text('#trAccept') == 'CONFIRM' and not bp.is_disabled('#trAccept'), 10)
    bp.click('#trAccept')
    bp.wait_for_selector('.tr-done', timeout=10000)
    a.wait_for_selector('.tr-done', timeout=12000)
    shot(bp, 'trade_b_done')

    # --- everything changed hands, on the page and on the server
    wait_until(lambda: inv(a)['coins'] == 2380 and inv(bp)['coins'] == 520, 10)
    c.eq(inv(a), {'coins': 2380, 'inv': {'i7': 2, 'i17': 1, 'i3': 1}}, 'A: gave legendary, two commons and coins, got the epic')
    c.eq(inv(bp), {'coins': 520, 'inv': {'i14': 2, 'i0': 1, 'i17': 2}}, 'B: got them, gave the epic')
    sa = rpc('me', {'rev': -1}, A['token'])[1]['state']; sb = rpc('me', {'rev': -1}, B['token'])[1]['state']
    c.eq([sa['coins'], sa['inv']], [2380, {'i3': 1, 'i7': 2, 'i17': 1}], 'the server agrees for A')
    c.eq([sb['coins'], sb['inv']], [520, {'i0': 1, 'i14': 2, 'i17': 2}], 'the server agrees for B')
    c.eq(a.evaluate('window.__GC.store.held'), {'items': {}, 'coins': 0}, 'nothing is held back any more')
    wait_until(lambda: a.evaluate('window.__GC.store.sync.dirty') is False, 8)
    c.eq(a.evaluate('window.__GC.store.sync.rev'), rpc('me', {}, A['token'])[1]['rev'], 'the page of A is in line with the server')

    # --- back to the lobby, history shows it
    a.click('#trDone'); a.wait_for_selector('#trSearch')
    a.click('#trHist'); a.wait_for_selector('.sheet.on .th', timeout=8000)
    c.ok(B['name'] in a.inner_text('.sheet.on .th') and 'Done' in a.inner_text('.sheet.on .th'), 'the history lists the finished trade')
    c.ok('−85%' in a.inner_text('.sheet.on .th-fair'), 'with how fair it was')
    shot(a, 'trade_a_history')
    b.close()
c.done(errs)
