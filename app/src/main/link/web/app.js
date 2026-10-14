// Lokey Link phone app: plain JS, no build. Token lives in localStorage; the PC stores only its hash.
const $ = id => document.getElementById(id)
const K = 'lokey-link-token'
let token = ''
try { token = localStorage.getItem(K) || '' } catch (e) {}
const api = (path, opt = {}) => fetch(path, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } })
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {})

let stopped = false
function show() { $('pair').classList.toggle('hide', !!token); $('app').classList.toggle('hide', !token); if (token) run() }
$('go').onclick = async () => {
  $('perr').textContent = ''
  try {
    const r = await fetch('/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('code').value.trim(), name: $('name').value }) })
    const j = await r.json()
    if (!r.ok) { $('perr').textContent = r.status === 429 ? 'Too many tries, wait a bit.' : 'Wrong or expired code. Make a new one on the PC.'; return }
    token = j.token; try { localStorage.setItem(K, token) } catch (e) {}
    show()
  } catch (e) { $('perr').textContent = 'Cannot reach the PC.' }
}
$('unpair').onclick = () => { token = ''; try { localStorage.removeItem(K) } catch (e) {}; stopped = true; show() }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.setAttribute('aria-selected', x === b))
  for (const t of ['appr', 'say', 'stat', 'clip']) $('t-' + t).classList.toggle('hide', t !== b.dataset.t)
  if (b.dataset.t === 'stat') status()
})

const cards = new Map()
function render() {
  $('cards').innerHTML = cards.size ? '' : '<p class="m">Nothing waiting. When Lokey on the PC asks permission, it shows here.</p>'
  for (const r of cards.values()) {
    const d = document.createElement('div'); d.className = 'card'
    d.innerHTML = '<b>' + esc(r.title) + '</b><p class="m">' + esc(r.tool) + '</p><pre>' + esc(r.detail) + '</pre><div class="row" style="margin-top:12px"><button class="d" data-a="0">Deny</button><button data-a="1">Allow</button></div>'
    d.querySelectorAll('button').forEach(b => b.onclick = async () => { await post('/approve', { id: r.id, allow: b.dataset.a === '1' }); cards.delete(r.id); render() })
    $('cards').append(d)
  }
}
function notify(title, body) { try { if (Notification.permission === 'granted') new Notification(title, { body }) } catch (e) {} }

let running = false
async function run() {
  if (running) return
  running = true; stopped = false
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission() } catch (e) {}
  while (!stopped && token) {
    try {
      const r = await api('/events')
      if (r.status === 401) { token = ''; try { localStorage.removeItem(K) } catch (e) {}; running = false; show(); return } // revoked on the PC
      $('dot').className = 'dot on'; $('conn').textContent = 'connected'
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { value, done } = await rd.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); onEvent(blk) }
      }
    } catch (e) {}
    $('dot').className = 'dot'; $('conn').textContent = 'reconnecting'
    await new Promise(r => setTimeout(r, 3000))
  }
  running = false
}
function onEvent(blk) {
  const ev = /^event: (.+)$/m.exec(blk), dat = /^data: (.+)$/m.exec(blk)
  if (!ev || !dat) return
  const d = JSON.parse(dat[1])
  if (ev[1] === 'confirm') { cards.set(d.id, d); render(); notify(d.title, d.detail); try { navigator.vibrate && navigator.vibrate(200) } catch (e) {} }
  else if (ev[1] === 'confirm-done') { cards.delete(d.id); render() }
  else if (ev[1] === 'nudge' || ev[1] === 'job') notify(d.title || 'Lokey', d.text || '')
}
async function status() { try { const r = await api('/status'); $('stat').textContent = JSON.stringify(await r.json(), null, 2) } catch (e) { $('stat').textContent = 'PC unreachable' } }
$('refresh').onclick = status
$('send').onclick = async () => { const t = $('say').value.trim(); if (!t) return; const r = await post('/say', { text: t }); $('sayr').textContent = r.ok ? 'Sent to your PC.' : 'Failed (' + r.status + ')'; if (r.ok) $('say').value = '' }
$('csend').onclick = async () => { const t = $('clip').value; if (!t) return; const r = await post('/clipboard', { text: t }); $('cr').textContent = r.ok ? 'On the PC clipboard.' : 'Failed (' + r.status + ')'; if (r.ok) $('clip').value = '' }
let qt; $('q').oninput = () => { clearTimeout(qt); qt = setTimeout(async () => { const q = $('q').value.trim(); if (!q) { $('mem').innerHTML = ''; return } const r = await api('/memory/search?q=' + encodeURIComponent(q)); const l = await r.json(); $('mem').innerHTML = (l || []).map(f => '<div class="card">' + esc(f.text || JSON.stringify(f)) + '</div>').join('') || '<p class="m">Nothing found.</p>' }, 300) }
const SR = window.SpeechRecognition || window.webkitSpeechRecognition
if (!SR) $('mic').classList.add('hide')
else $('mic').onclick = () => { const s = new SR(); s.lang = navigator.language; s.onresult = e => { $('say').value = e.results[0][0].transcript }; s.onerror = () => { $('sayr').textContent = 'Mic not available here.' }; s.start() }
show()
