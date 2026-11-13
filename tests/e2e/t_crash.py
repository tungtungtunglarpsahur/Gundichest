"""Rugpull and Rocket with an account: the server holds the bet, the clock and the end of the round.
The local dev server lets the test say where the next rounds end (POST /__test/crash)."""
import sys, os, time, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from harness import *
from playwright.sync_api import sync_playwright

c = Checks(); errs = []
G = 'window.__GC'

def roll(v):
    req = urllib.request.Request(URL + '__test/crash', data=json.dumps({'roll': v}).encode(), method='POST', headers={'content-type': 'application/json'})
    urllib.request.urlopen(req).read()

def server_coins(u): return rpc('me', {'rev': -1}, u['token'])[1]['state']['coins']

with sync_playwright() as p:
    b = launch(p)
    U = make_user({'coins': 1000})
    pg = open_app(page_for(b, U, 390, 844, 2, errs))
    ev = pg.evaluate
    coins = lambda: ev(G + '.store.s.coins')
    pg.click('#nav button[data-go=games]'); pg.wait_for_selector('#rugBtn')
    names = ev("[...document.querySelectorAll('.game-tabs button')].map(b => b.textContent.trim())")
    c.eq(names[:2], ['Rugpull', 'Rocket'], 'Rocket is the second game')

    def play(game, pre, crash_at, cash_at=None, auto=0):
        """one round with a bet of 25; returns what happened"""
        st = G + '.' + game + '.st'
        roll(crash_at)
        wait_until(lambda: ev(st + '.phase') == 'wait' and ev(st + '.t') < 4.5, 20)
        if auto: pg.click('#%sBetBox .chip[data-m="%s"]' % (pre, auto))
        c0 = coins()
        pg.click('#%sBtn' % pre)
        wait_until(lambda: ev(st + '.round') is not None, 6)
        rd = ev(st + '.round')
        out = {'c0': c0, 'round': rd, 'after_bet': coins(), 'server_after_bet': server_coins(U), 'btn': pg.inner_text('#%sBtn' % pre)}
        wait_until(lambda: ev(st + '.phase') == 'live', 9)
        out['crash_while_live'] = ev('String(%s.crash)' % st)
        if cash_at:
            wait_until(lambda: ev(st + '.mult') >= cash_at, 25)
            pg.click('#%sBtn' % pre)
            wait_until(lambda: ev(st + '.cashed') > 0, 5)
            out['cashed'] = ev(st + '.cashed'); out['cashMult'] = ev(st + '.cashMult'); out['after_cash'] = coins()
        if game == 'rocket' and not auto: shot(pg, 'rocket_live')
        wait_until(lambda: ev(st + '.phase') == 'rugged', 40)
        out['crash'] = ev(st + '.crash'); out['shown'] = pg.inner_text('#%sMult' % pre); out['over'] = pg.inner_text('#%sRugged' % pre)
        out['cashed_end'] = ev(st + '.cashed'); out['cashMult_end'] = ev(st + '.cashMult')
        out['end'] = coins()
        return out

    # ---- Rugpull: cash out, then the chart is rugged where the server said
    r = play('rug', 'rug', 1.6, cash_at=1.15)
    c.eq([r['after_bet'], r['server_after_bet']], [975, 975], 'the bet leaves the balance, here and on the server')
    c.ok('crash' not in r['round'] and 'crashIn' not in r['round'], 'the page is not told where the round ends', r['round'])
    c.eq(r['crash_while_live'], 'Infinity', 'while the bet is in play the page has no end to look at')
    c.ok(1.15 <= r['cashMult'] < 1.6 and r['cashed'] == int(25 * r['cashMult'] + 1e-9), 'cash out pays the multiplier of the server', (r['cashMult'], r['cashed']))
    c.eq(r['after_cash'], 975 + r['cashed'], 'the payout is on the balance')
    c.eq([r['crash'], r['shown']], [1.6, '1.60×'], 'the chart is rugged where the server rolled it')
    c.eq(server_coins(U), 975 + r['cashed'], 'the server holds the same balance')
    shot(pg, 'rug_server_rugged')

    # ---- no cash out: the bet is gone
    r2 = play('rug', 'rug', 1.2)
    c.eq([r2['crash'], r2['end'] - r2['c0'], r2['cashed_end']], [1.2, -25, 0], 'not cashing out loses the bet')
    c.eq(server_coins(U), coins(), 'server and page agree after a lost round')

    # ---- auto cash out is paid by the server at exactly its mark
    r3 = play('rug', 'rug', 3, auto='1.5')
    c.eq([r3['round']['auto'], r3['cashMult_end'], r3['cashed_end'], r3['end'] - r3['c0']], [1.5, 1.5, 37, 12], 'auto cash out at 1.50× pays 37 for 25')
    c.eq(server_coins(U), coins(), 'server and page agree after an auto cash out')
    pg.click('#rugBetBox .chip[data-m="0"]')

    # ---- a save of the page in between does not undo anything
    ev(G + '.store.give("i17", 1)'); ev(G + '.net.syncNow()'); pg.wait_for_timeout(700)
    c.eq(server_coins(U), coins(), 'saving the game keeps the balance the server paid')
    c.eq(ev(G + '.store.sync.dirty'), False, 'and the page is in step with the server')

    # ---- reload in the middle of a round: it is still there, and can be cashed out
    roll(40)
    wait_until(lambda: ev(G + '.rug.st.phase') == 'wait' and ev(G + '.rug.st.t') < 4.5, 20)
    before = coins(); pg.click('#rugBtn'); wait_until(lambda: ev(G + '.rug.st.round') is not None, 6)
    wait_until(lambda: ev(G + '.rug.st.phase') == 'live', 9); pg.wait_for_timeout(600)
    pg.reload(); pg.wait_for_function(G + ' && ' + G + '.ready === true', timeout=120000); ev(G + '.chest.stop()')
    c.eq(coins(), before - 25, 'after a reload the bet is still off the balance')
    pg.click('#nav button[data-go=games]'); pg.wait_for_selector('#rugBtn')
    wait_until(lambda: ev(G + '.rug.st.round') is not None and ev(G + '.rug.st.phase') == 'live', 8)
    c.ok(ev(G + '.rug.st.bet') == 25 and ev(G + '.rug.st.mult') > 1.02, 'the running round is picked up where the server has it', ev(G + '.rug.st.mult'))
    pg.click('#rugBtn'); wait_until(lambda: ev(G + '.rug.st.cashed') > 0, 5)
    c.eq(coins(), before - 25 + ev(G + '.rug.st.cashed'), 'and cashes out')
    c.eq(server_coins(U), coins(), 'server and page agree after the reload')
    roll(1.3)

    # ---- Rocket
    pg.click('.game-tabs button[data-g="rocket"]'); pg.wait_for_selector('#rocketBtn')
    wait_until(lambda: ev(G + '.rocket.st.phase') == 'wait', 30)
    k = play('rocket', 'rocket', 1.5, cash_at=1.12)
    c.ok(1.12 <= k['cashMult'] < 1.5, 'Rocket: cash out at the multiplier of the server', k['cashMult'])
    c.eq([k['crash'], k['shown'], k['over']], [1.5, '1.50×', 'BOOM!'], 'Rocket: it blows up where the server rolled it')
    c.eq(server_coins(U), coins(), 'Rocket: server and page agree')
    shot(pg, 'rocket_boom')
    # the page cannot pay itself: a made-up request for coins is not a thing
    st, body = rpc('crash.cashout', {'id': k['round']['id'], 'mult': 400, 'paid': 99999}, U['token'])
    c.eq([st, body['round']['paid'], body['book']], [200, k['cashed'], []], 'asking again, with numbers of my own, pays nothing more')
    roll(0)
    pg.close(); b.close()
c.done(errs)
