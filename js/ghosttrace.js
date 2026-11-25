const $ = s => document.querySelector(s);
const REG = 'sv_key_registry';
const enc = new TextEncoder(), dec = new TextDecoder();
let tick = null;

const readReg = () => { try { return JSON.parse(localStorage.getItem(REG)) || {}; } catch { return {}; } };
const writeReg = r => { try { localStorage.setItem(REG, JSON.stringify(r)); } catch {} };
const sweep = () => { const r = readReg(), n = Date.now(); Object.keys(r).forEach(k => { if (r[k].exp <= n) delete r[k]; }); writeReg(r); };
const hex = u => [...u].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = h => Uint8Array.from(h.match(/../g), x => parseInt(x, 16));
const b64 = u => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

function show(sel, html, err) { const o = $(sel); o.className = 'out show' + (err ? ' err' : ''); o.innerHTML = html; }

// One-time IndexedDB handoff to viewer.html
function saveForViewer(token, payload) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sv_viewer_handoff', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(payload, token);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

// Tabs
function tab(name) {
  const lock = name === 'lock';
  $('#paneLock').hidden = !lock; $('#paneUnlock').hidden = lock;
  $('#tabLock').setAttribute('aria-selected', lock); $('#tabUnlock').setAttribute('aria-selected', !lock);
}
$('#tabLock').onclick = () => tab('lock');
$('#tabUnlock').onclick = () => tab('unlock');

// Lock
$('#lockBtn').onclick = async () => {
  const f = $('#lockFile').files[0];
  if (!f) return show('#lockOut', '<h3>No file selected</h3>Choose a file to lock.', true);
  try {
    sweep();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const keyText = b64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const id = hex(crypto.getRandomValues(new Uint8Array(8)));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await f.arrayBuffer()));
    const head = enc.encode(JSON.stringify({ id, iv: hex(iv), name: f.name, type: f.type }));
    const pre = new Uint8Array(9); pre.set([71, 86, 76, 84, 49]); new DataView(pre.buffer).setUint32(5, head.length);
    const url = URL.createObjectURL(new Blob([pre, head, ct]));
    const exp = Date.now() + Number($('#expiry').value) * 60000;
    const r = readReg(); r[id] = { exp }; writeReg(r);
    show('#lockOut', `<h3>File locked</h3>
    <a class="btn" href="${url}" download="${esc(f.name)}.gvault">Download locked file</a>
    <p style="margin-top:18px;color:var(--muted)">Your key. Save it now, it is shown only once:</p>
    <div style="display:flex;gap:8px;align-items:stretch;margin:8px 0 14px">
    <div class="mono" style="margin:0;flex:1">${keyText}</div>
    <button class="btn ghost" id="copyKeyBtn" type="button" style="white-space:nowrap">Copy key</button>
    </div>
    <p style="color:var(--muted)">Key expires in</p><div class="timer" id="clock">${fmt(exp - Date.now())}</div>`);

    $('#copyKeyBtn').onclick = async () => {
      const btn = $('#copyKeyBtn');
      try {
        await navigator.clipboard.writeText(keyText);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = keyText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      btn.textContent = 'Copied!';
      btn.style.color = 'var(--ok)';
      btn.style.borderColor = 'rgba(76,183,130,.45)';
      setTimeout(() => {
        if (!btn) return;
        btn.textContent = 'Copy key';
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 2000);
    };

    clearInterval(tick);
    tick = setInterval(() => {
      const left = exp - Date.now(), c = $('#clock');
      if (!c) return clearInterval(tick);
      if (left <= 0) { clearInterval(tick); sweep(); c.textContent = 'Key destroyed'; c.style.color = 'var(--bad)'; }
      else c.textContent = fmt(left);
    }, 500);
  } catch (e) { show('#lockOut', '<h3>Could not lock the file</h3>' + esc(String(e.message || e)), true); }
};

// Unlock -> Open in Secure Viewer
$('#unlockBtn').onclick = async () => {
  const f = $('#unlockFile').files[0], k = $('#keyIn').value.trim();
  if (!f || !k) return show('#unlockOut', '<h3>Missing details</h3>Choose a .gvault file and enter its key.', true);
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (dec.decode(buf.slice(0, 5)) !== 'GVLT1') return show('#unlockOut', '<h3>Not a GhostTrace file</h3>Choose a file ending in .gvault.', true);
    const hl = new DataView(buf.buffer).getUint32(5);
    const head = JSON.parse(dec.decode(buf.slice(9, 9 + hl)));
    sweep();
    const entry = readReg()[head.id];
    if (!entry) return show('#unlockOut', '<h3>Expired</h3>The key for this file has been destroyed. It can no longer be opened.', true);
    const key = await crypto.subtle.importKey('raw', unb64(k), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(head.iv) }, key, buf.slice(9 + hl));

    const token = hex(crypto.getRandomValues(new Uint8Array(16)));
    await saveForViewer(token, { name: head.name, type: head.type || '', exp: entry.exp, buffer: plain });

    const viewerWin = window.open(`viewer.html#${token}`, '_blank');
    if (!viewerWin) {
      return show('#unlockOut', '<h3>Popup blocked</h3>Allow popups for this site so GhostTrace can open the Secure Viewer.', true);
    }

    show('#unlockOut', `<h3>Opened in Secure Viewer</h3><p style="color:var(--muted)"><b>${esc(head.name)}</b> is open in a read-only viewer tab.</p>`);
  } catch { show('#unlockOut', '<h3>Wrong key</h3>The key does not match this file. Check it and try again.', true); }
};
