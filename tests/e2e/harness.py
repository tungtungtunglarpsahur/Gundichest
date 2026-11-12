"""Shared helpers for the browser tests (Python + Playwright).

They drive the real page in headless Chrome against a local server:

    DATABASE_URL=postgres://postgres@127.0.0.1:5432/gc_dev node tools/dev-server.mjs 3311
    GC_URL=http://127.0.0.1:3311/ python3 tests/e2e/t_trade.py

Software rendering makes a 3D frame slow, so the tests never wait for chest animations; they drive the
game through window.__GC where timing would matter.
"""
import json, os, random, string, sys, time, urllib.request

URL = os.environ.get('GC_URL', 'http://127.0.0.1:3311/')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
SHOTS = os.environ.get('GC_SHOTS', '/tmp/shots')
ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio']


def launch(p):
    return p.chromium.launch(executable_path=CHROME, args=ARGS)


def rpc(op, data=None, token=None):
    """One API call from the test itself. Returns (status, body)."""
    req = urllib.request.Request(URL + 'api/rpc', data=json.dumps(dict(op=op, **(data or {}))).encode(), method='POST', headers={'content-type': 'application/json'})
    if token:
        req.add_header('authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def new_name(prefix='t'):
    return prefix + ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(7))


def make_user(seed=None, name=None):
    name = name or new_name()
    status, body = rpc('register', {'name': name, 'pass': 'pw-' + name, 'seed': seed or {}})
    assert status == 200, body
    return {'name': name, 'pass': 'pw-' + name, 'token': body['token'], 'id': body['user']['id']}


def page_for(browser, user=None, w=390, h=844, dpr=2, errors=None):
    """A fresh browser profile; with user it starts logged in."""
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    if errors is not None:
        # the browser logs every 4xx answer of the API as an error; those are expected outcomes (wrong password, stale save)
        page.on('console', lambda m: m.type == 'error' and 'the server responded with a status of 4' not in m.text and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append('uncaught: ' + str(e)))
    if user:
        ctx.add_init_script("try{ if(!localStorage.getItem('gundichest.session.v1')) localStorage.setItem('gundichest.session.v1', %s) }catch(e){}" % json.dumps(json.dumps({'token': user['token'], 'user': {'id': user['id'], 'name': user['name']}})))
    return page


def open_app(page, wait='ready', timeout=120000):
    page.goto(URL)
    page.wait_for_function('window.__GC && window.__GC.%s === true' % wait, timeout=timeout)
    # no 3D frames are needed for these tests, and each one costs most of a second here
    page.evaluate('window.__GC.chest && window.__GC.chest.stop && window.__GC.chest.stop()')
    return page


def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    path = os.path.join(SHOTS, name + '.png')
    page.screenshot(path=path)
    return path


class Checks:
    def __init__(self):
        self.failed = []
        self.n = 0

    def ok(self, cond, label, detail=''):
        self.n += 1
        if cond:
            print('  ok   ' + label)
        else:
            self.failed.append(label)
            print('  FAIL ' + label + (' :: ' + str(detail) if detail != '' else ''))

    def eq(self, got, want, label):
        self.ok(got == want, label, 'got %r, want %r' % (got, want))

    def done(self, errors=None):
        if errors:
            print('  console errors:')
            for e in errors[:10]:
                print('    ' + e[:300])
            self.failed.append('console errors')
        print('%d checks, %d failed' % (self.n, len(self.failed)))
        sys.exit(1 if self.failed else 0)


def wait_until(fn, timeout=15.0, step=0.15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v
        time.sleep(step)
    return fn()
