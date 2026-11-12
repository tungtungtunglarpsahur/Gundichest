// Login screen: shown before the game when the website build has no session yet.
var Auth = (function () {
  var NAME_HINT = '3 to 16 characters: letters, numbers, dot, dash, underscore.';
  var PASS_HINT = 'At least 6 characters. There is no reset, so pick one you will remember.';

  // Resolves once the player is in: with an account, or (only when the server cannot be reached) without one.
  function show(opt) {
    opt = opt || {};
    return new Promise(function (resolve) {
      var host = $('#auth'), mode = 'login', busy = false;
      host.hidden = false;
      host.innerHTML =
        '<div class="auth-box">' +
          '<svg class="auth-mark" viewBox="0 0 100 100" aria-hidden="true"><use href="#gmark"/></svg>' +
          '<h1 class="auth-word">Gundi<b>Chest</b></h1>' +
          '<p class="auth-tag">Open chests, collect cards, trade them with friends.</p>' +
          '<div class="seg wide auth-tabs" role="tablist"><button type="button" class="on" data-m="login" role="tab">Log in</button><button type="button" data-m="register" role="tab">Create account</button></div>' +
          '<form id="authForm" novalidate>' +
            '<label class="field"><span>Username</span><input id="authName" name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="16" enterkeyhint="next"></label>' +
            '<div class="field-hint" id="authNameHint" hidden>' + NAME_HINT + '</div>' +
            '<label class="field"><span>Password</span><span class="field-row"><input id="authPass" name="password" type="password" autocomplete="current-password" maxlength="100" enterkeyhint="go">' +
              '<button type="button" class="field-btn" id="authEye" aria-label="Show password" aria-pressed="false">Show</button></span></label>' +
            '<div class="field-hint" id="authPassHint" hidden>' + PASS_HINT + '</div>' +
            '<div class="auth-err" id="authErr" role="alert"></div>' +
            '<button class="fn-btn fn-yellow auth-go" id="authGo" type="submit"><span>LOG IN</span></button>' +
          '</form>' +
          '<div class="auth-alt" id="authAlt" hidden><p>You can try again, or play without an account for now.</p><div class="row"><button class="btn grow" type="button" id="authRetry">Try again</button><button class="btn grow" type="button" id="authOffline">Play offline</button></div>' +
            '<p class="auth-fine">Offline progress stays on this device. Trading needs an account.</p></div>' +
          '<p class="auth-fine">Play coins only. Nothing here costs or pays real money.</p>' +
        '</div>';
      var name = $('#authName'), pass = $('#authPass'), err = $('#authErr'), goBtn = $('#authGo'), alt = $('#authAlt');
      function setMode(m) {
        mode = m;
        $$('.auth-tabs button', host).forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); b.setAttribute('aria-selected', b.dataset.m === m ? 'true' : 'false'); });
        $('span', goBtn).textContent = m === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
        pass.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
        $('#authNameHint').hidden = $('#authPassHint').hidden = m === 'login';
        say('');
      }
      function say(text) { err.textContent = text || ''; err.classList.toggle('on', !!text); }
      function setBusy(on) {
        busy = on; goBtn.disabled = on; host.classList.toggle('busy', on);
        $('span', goBtn).textContent = on ? 'ONE MOMENT…' : mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
      }
      function finish(how) {
        host.classList.add('out');
        setTimeout(function () { host.hidden = true; host.innerHTML = ''; host.classList.remove('out'); }, 380);
        resolve(how);
      }
      function submit() {
        if (busy) return;
        var n = name.value.trim(), p = pass.value;
        if (!n) { say('Enter your username.'); name.focus(); return; }
        if (!p) { say('Enter your password.'); pass.focus(); return; }
        if (mode === 'register') {
          if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,15}$/u.test(n)) { say('That name does not work. Use ' + NAME_HINT.charAt(0).toLowerCase() + NAME_HINT.slice(1)); name.focus(); return; }
          if (p.length < 6) { say('The password needs at least 6 characters.'); pass.focus(); return; }
        }
        say(''); setBusy(true); alt.hidden = true;
        (mode === 'login' ? Net.login(n, p) : Net.register(n, p)).then(function (user) {
          finish({ mode: 'account', user: user, created: mode === 'register' });
        }, function (e) {
          setBusy(false);
          say(e.message || 'That did not work. Try again.');
          if (Net.isDown(e)) alt.hidden = false;
          else if (e.code === 'taken' || e.code === 'name') name.focus();
          else pass.select();
        });
      }
      $$('.auth-tabs button', host).forEach(function (b) { onTap(b, function () { if (!busy) setMode(b.dataset.m); }); });
      $('#authForm').addEventListener('submit', function (ev) { ev.preventDefault(); submit(); });
      onTap($('#authEye'), function () {
        var showing = pass.type === 'text';
        pass.type = showing ? 'password' : 'text';
        $('#authEye').textContent = showing ? 'Show' : 'Hide'; $('#authEye').setAttribute('aria-pressed', showing ? 'false' : 'true');
      });
      onTap($('#authRetry'), function () { alt.hidden = true; say(''); if (name.value && pass.value) submit(); });
      onTap($('#authOffline'), function () { finish({ mode: 'local' }); });
      if (opt.notice) say(opt.notice);
      if (opt.down) { alt.hidden = false; if (!opt.notice) say('The server cannot be reached right now.'); }
      requestAnimationFrame(function () { host.classList.add('on'); });
    });
  }
  return { show: show };
})();
