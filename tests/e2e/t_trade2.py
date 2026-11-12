"""More trading through the real page: decline, cancel, both asking, changed offers, taking back, leaving,
the reminder bar on other tabs, a reload in the middle of a trade, and what a trade holds back in the game."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from harness import *
from playwright.sync_api import sync_playwright

c = Checks(); errs = []
G = 'window.__GC'
st = lambda pg: pg.evaluate('(() => { const t = window.__GC.trade.state; return { screen: t.screen, status: t.cur && t.cur.status, me: t.cur && t.cur.me, them: t.cur && t.cur.them, inbox: t.inbox.map(x => x.with.name), sent: t.sent.map(x => x.with.name), open: t.open && t.open.with.name, draft: t.draft }; })()')
poll = lambda pg: pg.evaluate(G + '.net.pollNow()')
bar = lambda pg: pg.evaluate("document.querySelector('#tradeBar').classList.contains('on') ? document.querySelector('#tradeBar').innerText : ''")

def ask(pg, who):
    pg.click('#nav button[data-go=trade]'); pg.wait_for_selector('#trSearch')
    pg.fill('#trSearch', who['name'])
    pg.wait_for_selector('#trPeople .tr-row:has-text("%s") button' % who['name'], timeout=8000)
    pg.click('#trPeople .tr-row:has-text("%s") button' % who['name'])

with sync_playwright() as p:
    b = launch(p)
    A = make_user({'coins': 1000, 'inv': {'i7': 2, 'i17': 4}}); B = make_user({'coins': 300, 'inv': {'i14': 3}}); C = make_user({'coins': 50})
    a = open_app(page_for(b, A, errors=errs)); bp = open_app(page_for(b, B, errors=errs)); cp = open_app(page_for(b, C, errors=errs))

    # --- decline from the bar
    ask(a, B)
    a.wait_for_selector('#trSent .tr-row')
    poll(bp); bp.wait_for_selector('#tradeBar.on')
    bp.click('#tradeBar button[data-act=no]')
    wait_until(lambda: bar(bp) == '', 6)
    c.eq(bar(bp), '', 'declining removes the bar')
    poll(a); wait_until(lambda: st(a)['sent'] == [], 8)
    c.eq(st(a)['sent'], [], 'the asker no longer sees the request as waiting')
    c.eq(rpc('trade.history', {}, A['token'])[1]['trades'][0]['status'], 'declined', 'it is in the history as declined')

    # --- cancel a request that was sent; two requests show "+1 more"
    ask(a, B); a.wait_for_selector('#trSent .tr-row')
    ask(cp, B); cp.wait_for_selector('#trSent .tr-row')
    poll(bp); wait_until(lambda: len(st(bp)['inbox']) == 2, 8)
    c.ok('+1 more' in bar(bp), 'two waiting requests: the bar shows one and counts the rest')
    c.eq(bp.inner_text('#tradeBadge'), '2', 'the tab badge counts both')
    a.click('#trSent button[data-act=cancel]')
    wait_until(lambda: st(a)['sent'] == [], 6)
    poll(bp); wait_until(lambda: len(st(bp)['inbox']) == 1, 8)
    c.eq(st(bp)['inbox'], [C['name']], 'a cancelled request disappears for the other player')
    # --- B opens the Trade tab: requests are listed there, with accept and decline
    bp.click('#nav button[data-go=trade]'); bp.wait_for_selector('#trInbox .tr-row')
    c.eq(bar(bp), '', 'on the Trade tab the bar steps aside for the list')
    c.ok(C['name'] in bp.inner_text('#trInbox'), 'the list shows who asked')
    bp.click('#trInbox button[data-act=no]')
    wait_until(lambda: st(bp)['inbox'] == [], 6)

    # --- both ask each other: the room opens without a separate accept
    ask(a, B); a.wait_for_selector('#trSent .tr-row')
    poll(bp); bp.wait_for_selector('#trInbox .tr-row')
    bp.fill('#trSearch', A['name']); bp.wait_for_selector('#trPeople .tr-row:has-text("%s") button[data-act=yes]' % A['name'], timeout=8000)
    c.eq(bp.inner_text('#trPeople .tr-row:has-text("%s") button' % A['name']), 'Accept', 'someone who asked you shows Accept in the player list')
    bp.click('#trPeople .tr-row:has-text("%s") button' % A['name'])
    bp.wait_for_selector('.tr-room'); poll(a); a.wait_for_selector('.tr-room', timeout=12000)
    c.eq([st(a)['status'], st(bp)['status']], ['open', 'open'], 'both are in the room')

    # --- a changed offer takes the accepts back and locks the button for a moment
    a.fill('#trCoins', '200'); wait_until(lambda: st(a)['draft'] is None and st(a)['me']['offer']['coins'] == 200, 8)
    wait_until(lambda: st(bp)['them']['offer']['coins'] == 200, 8)
    bp.wait_for_timeout(1900)
    bp.click('#trAccept'); wait_until(lambda: st(bp)['me']['step'] == 1, 8)
    wait_until(lambda: st(a)['them']['step'] == 1, 8)
    a.click('#trAdd'); a.wait_for_selector('.sheet.on #trPickDone'); a.click('.sheet.on button[data-id=i17][data-d="1"]'); a.click('#trPickDone')
    wait_until(lambda: st(a)['draft'] is None and st(a)['me']['offer']['items'] == {'i17': 1}, 8)
    wait_until(lambda: st(bp)['them']['offer']['items'] == {'i17': 1}, 8)
    c.eq([st(bp)['me']['step'], st(bp)['them']['step']], [0, 0], "B's accept is taken back when A changes the offer")
    c.ok('changed the offer' in bp.inner_text('#trHint'), 'B is told that the offer changed')
    c.ok(bp.is_disabled('#trAccept'), 'and cannot accept in the same instant')
    wait_until(lambda: not bp.is_disabled('#trAccept'), 5)
    c.ok(not bp.is_disabled('#trAccept'), 'a moment later it can')

    # --- take an accept back
    a.click('#trAccept'); wait_until(lambda: st(a)['me']['step'] == 1, 8)
    a.wait_for_selector('#trUndo'); a.click('#trUndo')
    wait_until(lambda: st(a)['me']['step'] == 0, 8)
    c.eq(st(a)['me']['step'], 0, 'Take it back undoes the accept')
    c.eq(a.inner_text('#trAccept'), 'ACCEPT', 'and the button is ACCEPT again')

    # --- what the offer holds back: inventory, games, upgrader
    a.click('#nav button[data-go=inv]'); a.wait_for_selector('#invList')
    c.ok('Trade with ' + B['name'] in bar(a), 'on another tab a bar reminds of the open trade')
    row = a.locator('#invList .inv-item', has_text='Frau Kaese')
    c.ok('1 in a trade' in row.inner_text(), 'the inventory marks the offered card')
    c.ok('All 30' in row.inner_text(), 'selling all leaves the offered copy alone')
    a.click('#sellAll'); a.wait_for_selector('.sheet.on'); c.ok('Sell 5 items' in a.inner_text('.sheet.on'), 'Sell all counts only free cards (5 of 6)')
    a.click('.sheet.on .btn.gold'); a.wait_for_timeout(600)
    c.eq(a.evaluate(G + '.store.s.inv'), {'i17': 1}, 'after selling everything the offered card is still there')
    c.eq(a.evaluate(G + '.store.avail()'), 1000 + 230 - 200, 'coins from the sale are free, the offered 200 are not')
    a.click('#nav button[data-go=games]'); a.click('.game-tabs button[data-g=flip]'); a.wait_for_selector('#bet-flip')
    c.ok('in a trade' in a.inner_text('.game[data-g=flip] .bet .lbl').lower(), 'the bet box says that coins are in a trade')
    a.click('.game[data-g=flip] .bet-in button[data-a=max]')
    c.eq(a.input_value('#bet-flip'), '1,030', 'MAX stops at the free coins')
    a.click('.game-tabs button[data-g=up]'); a.click('#upIn'); a.wait_for_selector('.sheet.on')
    c.ok('No cards to upgrade' in a.inner_text('.sheet.on'), 'the upgrader does not offer the held card')
    a.click('.sheet.on .x-btn'); a.wait_for_timeout(450)
    shot(a, 'trade_bar_open')

    # --- a reload in the middle: the room and what it holds come back
    a.reload(); a.wait_for_function(G + ' && ' + G + '.ready === true', timeout=120000); a.evaluate(G + '.chest.stop()')
    wait_until(lambda: st(a)['status'] == 'open', 12)
    c.eq(st(a)['status'], 'open', 'after a reload the open trade is found again')
    c.eq(a.evaluate(G + '.store.held'), {'items': {'i17': 1}, 'coins': 200}, 'and holds the same things back')
    c.ok('is open' in bar(a), 'the bar offers to go back in')
    a.click('#tradeBar button[data-act=goto]'); a.wait_for_selector('.tr-room')
    c.eq(a.input_value('#trCoins'), '200', 'the room shows the offer again')

    # --- the other player leaves
    bp.click('#trLeave'); bp.wait_for_selector('.sheet.on'); bp.click('.sheet.on .btn.red')
    bp.wait_for_selector('#trSearch', timeout=8000)
    a.wait_for_selector('#trSearch', timeout=12000)
    c.ok(B['name'] + ' left the trade' in a.inner_text('#toasts'), 'A is told that B left')
    c.eq(a.evaluate(G + '.store.held'), {'items': {}, 'coins': 0}, 'nothing is held back after the trade ended')
    c.eq(a.evaluate(G + '.store.s.coins'), 1230, 'and nothing changed hands')

    # --- the other player deletes the account while a request is waiting
    ask(a, C); a.wait_for_selector('#trSent .tr-row')
    rpc('account.delete', {'pass': C['pass']}, C['token'])
    poll(a); wait_until(lambda: st(a)['sent'] == [], 8)
    c.eq(st(a)['sent'], [], 'a request to a deleted account goes away')
    b.close()
c.done(errs)
