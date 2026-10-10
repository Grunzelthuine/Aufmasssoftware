/* Speckmann Standort-Funktionen (Stand: Stundenzettel-App v30, 10.10.2026)
   1. "Kunde in der Nähe": ortet einmal und schlägt Kunden vor, deren ADRESSE in der Nähe liegt.
      Am Kundenstamm wird dabei NICHTS gespeichert oder geändert.
   2. "Adresse aus Standort": ortet einmal und schreibt die Adresse des Standorts als Vorschlag
      in ein Adressfeld (vorhandenes "Tel. …" bleibt erhalten).
   Kartendienst: OpenStreetMap Nominatim, Reserve Photon (komoot). Keine Anmeldung, kein Schlüssel.
   Einbinden: <script src="speckmann-standort.js"></script>, danach SpeckmannStandort.init({...}).
*/
(function () {
  'use strict';

  const GEOCACHE_KEY = 'speckmann_geocache_v1'; // nur lokaler Zwischenspeicher: Adresse -> Koordinaten
  const GEO_DEFAULT = { lat: 52.50, lng: 7.49 };  // Raum Thuine/Freren – nur als Suchhilfe
  let cfg = null;
  let geoCache = {};
  try { geoCache = JSON.parse(localStorage.getItem(GEOCACHE_KEY)) || {}; } catch (e) { geoCache = {}; }
  const saveGeoCache = () => { try { localStorage.setItem(GEOCACHE_KEY, JSON.stringify(geoCache)); } catch (e) { /* ignore */ } };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg, ms) => (cfg && cfg.toast ? cfg.toast(msg, ms) : console.log(msg));

  // ---------- Standort ----------
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject({ code: 'nogeo' }); return; }
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }
  function geoErrorToast(err) {
    const code = err && err.code;
    if (code === 1) toast('Standort nicht erlaubt. iPhone: Einstellungen → Datenschutz → Ortungsdienste → Safari-Websites → „Beim Verwenden“.', 7000);
    else if (code === 'nogeo') toast('Dieses Gerät unterstützt keine Standortabfrage.');
    else if (code === 2 || code === 3) toast('Standort konnte nicht ermittelt werden – im Freien erneut versuchen.', 5000);
    else toast('Adresse konnte nicht gefunden werden (Internet?).', 4500);
  }

  // ---------- OpenStreetMap ----------
  let lastReq = 0;
  async function throttle() { // Nominatim: höchstens 1 Anfrage pro Sekunde
    const wait = lastReq + 1100 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastReq = Date.now();
  }

  function formatOsmAddress(a) {
    if (!a) return '';
    const street = a.road || a.pedestrian || a.footway || a.path || a.farmyard || a.street || a.hamlet || '';
    const nr = a.house_number || a.housenumber || '';
    const ort = a.village || a.town || a.city || a.hamlet || a.suburb || a.municipality || a.locality || a.district || '';
    const line1 = [street, nr].filter(Boolean).join(' ');
    const line2 = [a.postcode || '', ort].filter(Boolean).join(' ');
    return [line1, line2].filter(Boolean).join(', ');
  }

  async function reverseGeocode(lat, lon) {
    await throttle();
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=de`);
      if (r.ok) {
        const j = await r.json();
        const txt = formatOsmAddress(j.address);
        if (txt) return { text: txt, exact: !!(j.address && j.address.house_number) };
      }
    } catch (e) { /* Reserve */ }
    const r2 = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=de&limit=1`);
    if (!r2.ok) throw new Error('geocode');
    const j2 = await r2.json();
    const pr = j2 && j2.features && j2.features[0] && j2.features[0].properties;
    const txt2 = formatOsmAddress(pr);
    if (!txt2) throw new Error('geocode');
    return { text: txt2, exact: !!(pr && pr.housenumber) };
  }

  const addrForGeocode = (a) => (a || '').replace(/,?\s*(Tel\.?|Telefon|Mobil|Handy)\b.*$/i, '').replace(/\s+/g, ' ').trim();
  const geoKey = (a) => addrForGeocode(a).toLowerCase();

  async function geocodeAddress(addr, near) {
    const q = addrForGeocode(addr);
    const c = near || GEO_DEFAULT;
    const vb = [c.lng - 0.6, c.lat + 0.4, c.lng + 0.6, c.lat - 0.4].map(v => v.toFixed(3)).join(',');
    await throttle();
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&accept-language=de&viewbox=${vb}&q=${encodeURIComponent(q)}`);
      if (r.ok) {
        const j = await r.json();
        return j && j[0] ? { lat: +(+j[0].lat).toFixed(6), lng: +(+j[0].lon).toFixed(6) } : null;
      }
    } catch (e) { /* Reserve */ }
    const r2 = await fetch(`https://photon.komoot.io/api/?limit=1&lang=de&lat=${c.lat}&lon=${c.lng}&q=${encodeURIComponent(q)}`);
    if (!r2.ok) throw new Error('geocode');
    const j2 = await r2.json();
    const f = j2 && j2.features && j2.features[0];
    return f ? { lat: +f.geometry.coordinates[1].toFixed(6), lng: +f.geometry.coordinates[0].toFixed(6) } : null;
  }

  function distanceM(lat1, lng1, lat2, lng2) {
    const R = 6371000, k = Math.PI / 180;
    const dLat = (lat2 - lat1) * k, dLng = (lng2 - lng1) * k;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * k) * Math.cos(lat2 * k) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const formatDist = (m) => m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;

  // ---------- Adress-Zwischenspeicher ----------
  const customers = () => (cfg && cfg.getCustomers ? cfg.getCustomers() : []) || [];
  function uncachedAddresses() {
    const seen = new Set(), out = [];
    customers().forEach(c => {
      const k = geoKey(c && c.address);
      if (!k || k.length < 5 || seen.has(k)) return;
      seen.add(k);
      const hit = geoCache[k];
      if (!hit || (hit.miss && Date.now() - hit.ts > 14 * 864e5)) out.push(c.address);
    });
    return out;
  }
  let busy = false;
  async function fillGeoCache(near, onProgress) {
    if (busy || !navigator.onLine) return;
    busy = true;
    try {
      const list = uncachedAddresses();
      for (let i = 0; i < list.length; i++) {
        try {
          const res = await geocodeAddress(list[i], near);
          geoCache[geoKey(list[i])] = res ? { ...res, ts: Date.now() } : { miss: true, ts: Date.now() };
          saveGeoCache();
        } catch (e) { break; } // offline – später erneut
        if (onProgress) onProgress(i + 1, list.length);
      }
    } finally { busy = false; }
  }

  // ---------- 1. Kunde in der Nähe ----------
  let shownItems = [];
  let hideTimer = null;
  function hideList() {
    const box = cfg && cfg.suggestBox;
    if (box) { box.classList.remove('show'); box.innerHTML = ''; }
    shownItems = [];
  }
  function renderList(pos, note) {
    const box = cfg.suggestBox;
    const radius = Math.min(1500, Math.max(400, pos.acc * 2));
    const near = customers().map(c => {
      const g = geoCache[geoKey(c && c.address)];
      return g && !g.miss ? { c, d: distanceM(pos.lat, pos.lng, g.lat, g.lng) } : null;
    }).filter(x => x && x.d <= radius).sort((a, b) => a.d - b.d).slice(0, 6);
    shownItems = near.map(x => x.c);
    const withAddr = customers().filter(c => geoKey(c && c.address).length >= 5).length;
    let html = `<div class="suggest-head">${near.length ? 'Kunden in der Nähe' : 'Kein Kunde mit Adresse in der Nähe'} (±${pos.acc} m)</div>`;
    html += near.map((x, i) =>
      `<div class="suggest-item" data-near-i="${i}"><div class="s-name">${esc(x.c.name)} <span class="s-dist">${formatDist(x.d)}</span></div>` +
      (x.c.address ? `<div class="s-addr">${esc(x.c.address)}</div>` : '') + '</div>').join('');
    if (note) html += `<div class="suggest-note">${esc(note)}</div>`;
    else if (!near.length) html += `<div class="suggest-note">Abgeglichen werden nur Kunden mit Adresse im Kundenstamm (${withAddr}).</div>`;
    box.innerHTML = html;
    box.classList.add('show');
  }
  async function findNearby() {
    const btn = cfg.nearButton;
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    try {
      const p = await getPosition();
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) };
      const todo = uncachedAddresses().length;
      renderList(pos, todo ? `Adressen werden abgeglichen … (0/${todo})` : '');
      if (todo) {
        await fillGeoCache(pos, (i, n) => renderList(pos, i < n ? `Adressen werden abgeglichen … (${i}/${n})` : ''));
        renderList(pos, uncachedAddresses().length ? 'Einige Adressen konnten nicht abgeglichen werden (Internet?).' : '');
      }
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hideList, 20000);
    } catch (err) {
      geoErrorToast(err && err.code ? err : { code: 2 });
    } finally {
      btn.classList.remove('busy');
    }
  }

  // ---------- 2. Adresse aus Standort ----------
  async function fillAddress(btn, target) {
    if (!target || btn.disabled) return;
    const label = btn.innerHTML;
    const setText = (t) => { btn.lastChild.textContent = t; };
    btn.disabled = true; btn.classList.add('busy');
    setText('Standort wird ermittelt …');
    try {
      const pos = await getPosition();
      setText('Adresse wird gesucht …');
      const acc = Math.round(pos.coords.accuracy || 0);
      const res = await reverseGeocode(pos.coords.latitude.toFixed(6), pos.coords.longitude.toFixed(6));
      const cur = target.value.trim();
      const telMatch = cur.match(/,?\s*((Tel\.?|Telefon|Mobil|Handy)\b.*)$/i);
      const tel = telMatch ? telMatch[1] : '';
      const curAddr = telMatch ? cur.slice(0, cur.length - telMatch[0].length).trim() : cur;
      if (curAddr && curAddr !== res.text && !confirm(`Gefundene Adresse:\n${res.text}\n\nVorhandene Adresse „${curAddr}“ ersetzen?`)) return;
      target.value = res.text + (tel ? ', ' + tel : '');
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      let msg = `Adresse aus Standort (±${acc} m) – bitte prüfen.`;
      if (acc > 100) msg = `Standort ungenau (±${acc} m) – Adresse bitte genau prüfen.`;
      else if (!res.exact) msg = 'Keine Hausnummer gefunden – bitte ergänzen.';
      toast(msg, 4500);
    } catch (err) {
      geoErrorToast(err);
    } finally {
      btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = label;
    }
  }

  // ---------- Öffentliche Schnittstelle ----------
  window.SpeckmannStandort = {
    /* cfg:
       getCustomers: () => Array<{ name, address, ... }>  – aktueller Kundenstamm (Pflicht)
       onPick:       (kunde) => void                      – Kunde aus "in der Nähe" übernehmen (Pflicht)
       nearButton:   HTMLElement                          – Knopf neben dem Kundenfeld
       suggestBox:   HTMLElement                          – Vorschlagsliste unter dem Kundenfeld
       toast:        (text, ms) => void                   – Hinweis anzeigen (optional)
    */
    init(c) {
      cfg = c || {};
      if (cfg.nearButton) cfg.nearButton.addEventListener('click', (ev) => { ev.preventDefault(); findNearby(); });
      if (cfg.suggestBox) cfg.suggestBox.addEventListener('click', (ev) => {
        const it = ev.target.closest('[data-near-i]');
        if (!it) return;
        const k = shownItems[parseInt(it.dataset.nearI, 10)];
        hideList();
        if (k && cfg.onPick) cfg.onPick(k);
      });
      // Knöpfe "Adresse aus Standort": <button class="loc-btn" data-loc-target="ID-des-Adressfelds">…</button>
      // (funktioniert auch für Knöpfe, die erst später, z. B. in Dialogen, ins HTML kommen)
      document.addEventListener('click', (ev) => {
        const b = ev.target.closest && ev.target.closest('.loc-btn[data-loc-target]');
        if (b) { ev.preventDefault(); fillAddress(b, document.getElementById(b.dataset.locTarget)); }
      });
      // Neue Kundenadressen langsam im Hintergrund vorab abgleichen (ohne Standortabfrage)
      setTimeout(() => fillGeoCache(null), 8000);
      window.addEventListener('online', () => setTimeout(() => fillGeoCache(null), 3000));
    },
    hideList,
    refresh: () => fillGeoCache(null) // z. B. nach Abgleich des Kundenstamms aufrufen
  };
})();
