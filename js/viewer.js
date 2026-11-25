const $ = s => document.querySelector(s);
const dec = new TextDecoder();

let activeUrl = null;
let activeBytes = null;
let timerId = null;

const fmt = ms => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

function blockDirectAccess(msg) {
    $('#viewerPanel').hidden = true;
    const gate = $('#vGate');
    gate.hidden = false;
    gate.className = 'out show err';
    gate.innerHTML = '';
    const h3 = document.createElement('h3');
    h3.textContent = 'Access denied';
    const p = document.createElement('p');
    p.textContent = msg || 'Open a file from GhostTrace to use Secure Viewer.';
    gate.append(h3, p);
    setTimeout(() => { window.location.replace('ghosttrace.html'); }, 1500);
}

// Read one-time payload from IndexedDB and immediately delete it
function takeFromViewerDB(token) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('sv_viewer_handoff', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('files', 'readwrite');
            const store = tx.objectStore('files');
            const getReq = store.get(token);
            getReq.onsuccess = () => {
                const data = getReq.result;
                if (data) store.delete(token);
                tx.oncomplete = () => { db.close(); resolve(data || null); };
            };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
    });
}

function wipeAndClose(reason) {
    clearInterval(timerId);
    timerId = null;
    if (activeUrl) { URL.revokeObjectURL(activeUrl); activeUrl = null; }
    if (activeBytes) { activeBytes.fill(0); activeBytes = null; }
    $('#vContent').innerHTML = '';
    $('#viewerPanel').hidden = true;

    if (reason) {
        const gate = $('#vGate');
        gate.hidden = false;
        gate.className = 'out show err';
        gate.innerHTML = '';
        const h3 = document.createElement('h3');
        h3.textContent = 'Session ended';
        const p = document.createElement('p');
        p.textContent = reason;
        gate.append(h3, p);
    } else {
        window.close();
        window.location.replace('ghosttrace.html');
    }
}

function renderWatermarkedImage(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const tempUrl = URL.createObjectURL(blob);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            ctx.save();
            ctx.globalAlpha = 0.16;
            ctx.fillStyle = '#ffffff';
            const fontSize = Math.max(18, Math.floor(canvas.width / 22));
            ctx.font = `600 ${fontSize}px sans-serif`;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(-Math.PI / 6);
            ctx.textAlign = 'center';
            ctx.fillText('GHOSTTRACE · PROTECTED VIEW', 0, 0);
            ctx.restore();

            URL.revokeObjectURL(tempUrl);
            resolve(canvas);
        };
        img.onerror = () => { URL.revokeObjectURL(tempUrl); reject(new Error('Invalid image')); };
        img.src = tempUrl;
    });
}

async function renderPayload({ name, type, exp, buffer }) {
    activeBytes = new Uint8Array(buffer);
    const blob = new Blob([activeBytes], { type: type || '' });
    const container = $('#vContent');
    container.innerHTML = '';

    if (type.startsWith('image/')) {
        container.appendChild(await renderWatermarkedImage(blob));
    } else if (type === 'application/pdf') {
        activeUrl = URL.createObjectURL(blob);
        const iframe = document.createElement('iframe');
        iframe.src = `${activeUrl}#toolbar=0&navpanes=0&scrollbar=1`;
        iframe.title = name;
        container.appendChild(iframe);
    } else if (type.startsWith('video/')) {
        activeUrl = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.src = activeUrl;
        video.controls = true;
        video.setAttribute('controlsList', 'nodownload');
        video.disablePictureInPicture = true;
        container.appendChild(video);
    } else if (type.startsWith('audio/')) {
        activeUrl = URL.createObjectURL(blob);
        const audio = document.createElement('audio');
        audio.src = activeUrl;
        audio.controls = true;
        audio.setAttribute('controlsList', 'nodownload');
        container.appendChild(audio);
    } else if (type.startsWith('text/') || type === 'application/json') {
        const pre = document.createElement('pre');
        pre.className = 'viewer-text';
        pre.textContent = dec.decode(activeBytes);
        container.appendChild(pre);
    } else {
        const p = document.createElement('p');
        p.className = 'viewer-unsupported';
        p.textContent = `In-browser preview is not supported for "${name}" (${type || 'binary file'}).`;
        container.appendChild(p);
    }

    $('#vName').textContent = name;
    $('#vGate').hidden = true;
    $('#viewerPanel').hidden = false;

    const updateClock = () => {
        const left = exp - Date.now();
        if (left <= 0) {
            wipeAndClose('Key expired. Decrypted file has been wiped from memory.');
        } else {
            $('#vTimer').textContent = fmt(left);
        }
    };
    updateClock();
    timerId = setInterval(updateClock, 500);
}

// Startup: validate one-time token from URL hash
(async () => {
    const token = window.location.hash.slice(1);
    if (!token) {
        return blockDirectAccess('Direct access is not allowed. Redirecting to GhostTrace…');
    }
    // Remove token from URL bar immediately
    history.replaceState(null, '', window.location.pathname);

    try {
        const payload = await takeFromViewerDB(token);
        if (!payload || !payload.buffer) {
            return blockDirectAccess('Session expired or already used. Redirecting to GhostTrace…');
        }
        await renderPayload(payload);
    } catch (err) {
        blockDirectAccess('Could not open secure session: ' + (err.message || err));
    }
})();

// Close button + security deterrents
$('#vCloseBtn').addEventListener('click', () => wipeAndClose());

const setBlur = on => {
    if ($('#viewerPanel').hidden) return;
    $('#vStage').classList.toggle('is-blurred', on);
    $('#vCurtain').hidden = !on;
};
window.addEventListener('blur', () => setBlur(true));
window.addEventListener('focus', () => setBlur(false));
document.addEventListener('visibilitychange', () => setBlur(document.hidden));

$('#vStage').addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
    if ($('#viewerPanel').hidden) return;
    if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u', 'c'].includes(e.key.toLowerCase())) {
        e.preventDefault();
    }
});
window.addEventListener('beforeunload', () => {
    if (activeUrl) URL.revokeObjectURL(activeUrl);
    if (activeBytes) activeBytes.fill(0);
});
