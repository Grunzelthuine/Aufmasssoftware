"use strict";

/* ============================================================
   Aufmaßsoftware – einheitliche Materialsuche
   Ersetzt die fünf Reiter (Favoriten / Aus Liste / Standardmaterial /
   Freitext / Diktat) durch EIN Suchfeld mit 📷 Scannen und 🎤 Diktat.
   Treffer gruppiert: 📁 Baustelle → ⭐ Favoriten → Meine Datenbank →
   Großhandelskatalog → Freitext. Ein Tipp fügt Menge 1 hinzu; die Menge
   wird in der Leiste unten angepasst (oder ↶ rückgängig).
   Material aus Katalog/Freitext/unbekannter EAN legt sich automatisch in
   der Datenbank ab (im Baustellen-Ordner, sonst „Eigene Artikel“).
   Wird nach app.js geladen.
   ============================================================ */

const MS_EINHEITEN = ["Stck", "m", "Rolle", "Pack", "Satz", "Paar", "kg", "VE"];
let msZustand = null; // { material, fertig }

function msEl(id) { return document.getElementById(id); }

/* `material`: Array, in das hinzugefügt wird; `onHinzufuegen`: Neuzeichnen + Speichern beim Aufrufer */
function bindeMaterialAuswahl(material, onHinzufuegen, optionen) {
  if (typeof aktualisiereAbgeleiteteListen === "function") aktualisiereAbgeleiteteListen();
  const fertig = () => {
    if (typeof loeseKombisAuf === "function") loeseKombisAuf(material);
    onHinzufuegen();
  };
  msZustand = { material, fertig };
  msSnackAus();
  const suche = msEl("ms_suche");
  const erg = msEl("ms_ergebnis");
  if (!suche || !erg) return;

  // Diktat (nur Aufmaß / Packliste)
  const dBtn = msEl("ms_diktatBtn");
  const dPanel = msEl("ms_diktat");
  if (optionen && optionen.diktat && typeof bindeMaterialDiktat === "function") {
    dBtn.hidden = false;
    bindeMaterialDiktat(material, fertig);
    dBtn.addEventListener("click", () => {
      dPanel.hidden = !dPanel.hidden;
      dBtn.classList.toggle("aktiv", !dPanel.hidden);
      if (!dPanel.hidden) msEl("md_text").focus();
    });
  }

  let timer = null;
  suche.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => msRender(suche.value), 150); });
  suche.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const erste = erg.querySelector(".ms-zeile");
    if (erste) erste.click();
  });
  msEl("ms_scan").addEventListener("click", () => oeffneBarcodeScanner((roh) => msNachScan(roh)));
  if (typeof materialDBListener !== "undefined") {
    const l = () => {
      if (!document.body.contains(suche)) { materialDBListener.delete(l); return; }
      if (suche.value.trim().length >= 2) msRender(suche.value);
    };
    materialDBListener.add(l);
  }
  msRender("");
}

/* ---------- Treffer sammeln ---------- */

function msAusDb(m, quelle) {
  return {
    quelle, dbId: m.id, name: m.name, nr: m.nr || "", ean: m.ean || "", einheit: m.einheit || "Stck",
    kombi: typeof istKombi === "function" && istKombi(m),
    info: (typeof istKombi === "function" && istKombi(m)) ? "Kombination: " + kombiBeschreibung(m)
      : [m.ordner ? "📁 " + ordnerName(m.ordner) : kategorieName(m.kat), m.nr && "Art.-Nr. " + m.nr, m.einheit || "Stck"].filter(Boolean).join(" · "),
    stern: sternDatenFuerDb(m)
  };
}

function msAusKatalog(a) {
  return {
    quelle: "katalog", name: a.b, nr: a.n || "", ean: a.g || "", einheit: a.e || "Stck",
    info: ["Großhandel", a.n && "Art.-Nr. " + a.n, a.e].filter(Boolean).join(" · "),
    stern: sternDatenFuerKatalog(a)
  };
}

function msNutzungDb(m) { return nutzung("standard:" + m.name); }

function msSortiere(liste) {
  return liste.sort((a, b) => msNutzungDb(b) - msNutzungDb(a) || a.name.localeCompare(b.name, "de"));
}

function msPasst(worte, text) {
  const t = text.toLowerCase();
  return worte.every((w) => t.includes(w));
}

function msSammle(q) {
  const worte = q.toLowerCase().split(/\s+/).filter(Boolean);
  const ordnerId = typeof aktiverOrdnerId === "function" ? aktiverOrdnerId() : "";
  const sichtbar = dbMaterial.filter((m) => (typeof imKontextSichtbar !== "function" || imKontextSichtbar(m)));
  const gruppen = [];
  const gezeigt = new Set();
  const merke = (e) => { const k = (e.name + "|" + e.nr).toLowerCase(); if (gezeigt.has(k)) return false; gezeigt.add(k); return true; };
  const dbText = (m) => m.name + " " + (m.nr || "") + " " + (m.ean || "") + " " + kategorieName(m.kat) + (istKombi(m) ? " " + kombiBeschreibung(m) : "");

  // 📁 Baustelle
  if (ordnerId) {
    let l = sichtbar.filter((m) => m.ordner === ordnerId);
    if (worte.length) l = l.filter((m) => msPasst(worte, dbText(m)));
    const eintraege = msSortiere(l).map((m) => msAusDb(m, "db")).filter(merke);
    if (eintraege.length) gruppen.push({ titel: "📁 " + ordnerName(ordnerId), eintraege });
  }
  // ⭐ Favoriten
  {
    const favs = [];
    for (const f of topFavoriten()) {
      if (worte.length && !msPasst(worte, f.bezeichnung + " " + (f.artikelnummer || ""))) continue;
      const m = sichtbar.find((x) => x.name === f.bezeichnung);
      let e;
      if (m) e = msAusDb(m, "db");
      else if (f.quelle === "liste") e = { quelle: "katalog", name: f.bezeichnung, nr: f.artikelnummer || "", ean: "", einheit: f.einheit || "Stck", info: ["Großhandel", f.artikelnummer && "Art.-Nr. " + f.artikelnummer, f.einheit].filter(Boolean).join(" · "), stern: { key: f.key, ...f } };
      else if (!dbMaterial.some((x) => x.name === f.bezeichnung)) e = { quelle: "frei", name: f.bezeichnung, nr: f.artikelnummer || "", ean: "", einheit: f.einheit || "Stck", info: f.einheit || "Stck", stern: { key: f.key, ...f } };
      else continue; // gehört zu einem anderen Baustellen-Ordner
      if (merke(e)) favs.push(e);
      if (favs.length >= (worte.length ? 10 : 15)) break;
    }
    if (favs.length) gruppen.push({ titel: "⭐ Favoriten", eintraege: favs });
  }
  if (!worte.length) {
    // Häufig benutzt (ohne Stern)
    const haeufig = Object.entries(favoritenCounts)
      .filter(([key]) => !istStern(key))
      .sort((a, b) => b[1].count - a[1].count)
      .map(([, d]) => {
        const m = sichtbar.find((x) => x.name === d.bezeichnung);
        if (m) return msAusDb(m, "db");
        if (d.quelle === "liste") return { quelle: "katalog", name: d.bezeichnung, nr: d.artikelnummer || "", ean: "", einheit: d.einheit || "Stck", info: ["Großhandel", d.artikelnummer && "Art.-Nr. " + d.artikelnummer].filter(Boolean).join(" · "), stern: { key: "liste:" + d.artikelnummer, quelle: "liste", artikelnummer: d.artikelnummer, bezeichnung: d.bezeichnung, einheit: d.einheit } };
        return null;
      })
      .filter(Boolean).filter(merke).slice(0, 8);
    if (haeufig.length) gruppen.push({ titel: "🕘 Häufig benutzt", eintraege: haeufig });
    return { gruppen, worte };
  }
  // Meine Datenbank
  {
    const l = msSortiere(sichtbar.filter((m) => !m.ordner && msPasst(worte, dbText(m))));
    const eintraege = l.map((m) => msAusDb(m, "db")).filter(merke);
    if (eintraege.length) gruppen.push({ titel: "🗂 Meine Datenbank", eintraege: eintraege.slice(0, 25), mehr: Math.max(0, eintraege.length - 25) });
  }
  // Großhandelskatalog
  if (q.trim().length >= 2) {
    if (typeof materialDBReady !== "undefined" && !materialDBReady) {
      gruppen.push({ titel: "🏭 Großhandelskatalog", eintraege: [], hinweis: materialDBFehler || materialDBStatus });
    } else {
      const kat = sucheMaterial(q, 40).filter((a) => !a._eigen).map(msAusKatalog).filter(merke).slice(0, 20);
      if (kat.length) gruppen.push({ titel: "🏭 Großhandelskatalog", eintraege: kat });
    }
  }
  return { gruppen, worte };
}

/* ---------- Anzeige ---------- */

function msRender(q) {
  const erg = msEl("ms_ergebnis");
  if (!erg) return;
  const text = (q || "").trim();
  const { gruppen } = msSammle(text);
  erg.innerHTML = "";
  for (const g of gruppen) {
    const kopf = document.createElement("div");
    kopf.className = "ms-gruppe";
    kopf.textContent = g.titel;
    erg.appendChild(kopf);
    if (g.hinweis) {
      const p = document.createElement("p");
      p.className = "hint ms-hinweis";
      p.textContent = g.hinweis;
      erg.appendChild(p);
    }
    const ul = document.createElement("ul");
    ul.className = "ms-liste";
    for (const e of g.eintraege) ul.appendChild(msZeile(e));
    erg.appendChild(ul);
    if (g.mehr) {
      const p = document.createElement("p");
      p.className = "hint ms-hinweis";
      p.textContent = `… und ${g.mehr} weitere – Suche genauer eingeben.`;
      erg.appendChild(p);
    }
  }
  if (text) {
    if (istEanAehnlich(text) && !gruppen.some((g) => g.eintraege.length)) erg.appendChild(msEanNeuZeile(text));
    erg.appendChild(msFreiZeile(text));
  } else if (!gruppen.length) {
    const p = document.createElement("p");
    p.className = "hint ms-hinweis";
    p.textContent = "Tippen zum Suchen – Treffer kommen aus Baustellen-Ordner, Favoriten, deiner Datenbank und dem Großhandelskatalog. 📷 scannt eine EAN.";
    erg.appendChild(p);
  }
}

function msZeile(e) {
  const li = document.createElement("li");
  li.className = "ms-zeile" + (e.quelle === "katalog" ? " katalog" : "");
  li.innerHTML = `<div class="ms-text"><strong></strong><small></small></div>
    <button type="button" class="stern-btn" aria-label="Favorit"></button>
    <span class="ms-plus" aria-hidden="true">＋</span>`;
  li.querySelector("strong").textContent = e.name;
  li.querySelector("small").textContent = e.info;
  if (e.stern) bindeSternKnopf(li.querySelector(".stern-btn"), e.stern, () => {});
  else li.querySelector(".stern-btn").remove();
  li.addEventListener("click", () => msHinzufuegen(e, 1));
  return li;
}

function msFreiZeile(text) {
  const li = document.createElement("div");
  li.className = "ms-frei";
  li.innerHTML = `<span class="ms-frei-text"></span>
    <select class="ms-frei-einheit">${MS_EINHEITEN.map((x) => `<option>${x}</option>`).join("")}</select>
    <button type="button" class="btn btn-secondary">＋</button>`;
  li.querySelector(".ms-frei-text").textContent = `✎ „${text}“ als eigenes Material`;
  const sel = li.querySelector("select");
  if (/\b(nym|kabel|leitung|rohr|kanal|stripe|streifen|band|draht|litze)\b/i.test(text)) sel.value = "m";
  li.querySelector("button").addEventListener("click", () => {
    msHinzufuegen({ quelle: "frei", name: text, nr: "", ean: "", einheit: sel.value }, 1);
  });
  return li;
}

function msEanNeuZeile(code) {
  const li = document.createElement("div");
  li.className = "ms-frei ms-ean";
  li.innerHTML = `<span class="ms-frei-text"></span><button type="button" class="btn btn-secondary">Anlegen</button>`;
  li.querySelector(".ms-frei-text").textContent = `EAN ${code} unbekannt – neuen Artikel anlegen`;
  li.querySelector("button").addEventListener("click", () => msEanNeu(code));
  return li;
}

function msEanNeu(code) {
  const name = (prompt(`Bezeichnung für EAN ${code}:`) || "").trim();
  if (!name) return;
  const einheit = (prompt("Einheit (Stck, m, Rolle, Pack …):", "Stck") || "Stck").trim() || "Stck";
  msHinzufuegen({ quelle: "frei", name, nr: "", ean: code, einheit }, 1);
}

/* ---------- Scannen ---------- */

function msNachScan(roh) {
  const code = String(roh || "").trim();
  const suche = msEl("ms_suche");
  if (!code || !suche) return;
  suche.value = code;
  // exakter Treffer in der eigenen Datenbank (sichtbar) -> direkt hinzufügen
  const m = dbMaterial.find((x) => imKontextSichtbar(x) && ((x.ean && eanVarianten(code).includes(x.ean)) || x.ean === code || x.nr === code));
  if (m) { msHinzufuegen(msAusDb(m, "db"), 1); msRender(code); return; }
  const kat = (typeof materialDBReady === "undefined" || materialDBReady) ? sucheNachEan(code, 3).filter((a) => !a._eigen) : [];
  if (kat.length === 1) { msHinzufuegen(msAusKatalog(kat[0]), 1); msRender(code); return; }
  msRender(code);
}

/* ---------- Hinzufügen ---------- */

function msHinzufuegen(e, menge) {
  if (!msZustand) return;
  const { material, fertig } = msZustand;
  const ordnerId = typeof aktiverOrdnerId === "function" ? aktiverOrdnerId() : "";
  let name = e.name, nr = e.nr || "", einheit = e.einheit || "Stck";
  // Automatisch in der Datenbank ablegen (Katalog / eigenes Material / neue EAN)
  if (e.quelle === "katalog" || e.quelle === "frei") {
    const m = dbNeu({ kat: KAT_EIGENE, name, nr, ean: e.ean || "", einheit, ordner: ordnerId });
    if (m) { name = m.name; nr = m.nr || ""; einheit = m.einheit || einheit; }
  }
  registriereFavoritTreffer("standard", "", name, einheit);

  const istKombination = !!e.kombi;
  let zeile = istKombination ? null : material.find((x) => !String(x.id).includes("~") && !x.erledigt &&
    x.bezeichnung === name && (x.artikelnummer || "") === nr && x.einheit === einheit);
  let neu = false;
  const vorher = zeile ? zeile.menge : 0;
  if (zeile) zeile.menge = rundeMenge((zeile.menge || 0) + menge);
  else {
    zeile = { id: neueId(), bezeichnung: name, artikelnummer: nr, einheit, menge, quelle: e.quelle === "katalog" ? "liste" : "standard", erledigt: false };
    material.push(zeile);
    neu = true;
  }
  const id = zeile.id;
  fertig();
  const suche = msEl("ms_suche");
  if (suche && suche.value) { suche.select(); msRender(suche.value); } else msRender("");
  msSnack({
    text: istKombination ? `✓ ${name} – Teile einzeln eingetragen` : `✓ ${name}`,
    zeile: istKombination ? null : zeile,
    rueckgaengig: () => {
      if (neu) {
        for (let i = material.length - 1; i >= 0; i--) if (String(material[i].id).split("~")[0] === id) material.splice(i, 1);
      } else if (zeile) zeile.menge = vorher;
      fertig();
    }
  });
}

/* ---------- Leiste „zuletzt hinzugefügt“ ---------- */

let msSnackTimer = null;

function msSnackAus() {
  clearTimeout(msSnackTimer);
  const el = document.getElementById("msSnack");
  if (el) el.hidden = true;
}

function msSnack({ text, zeile, rueckgaengig }) {
  let el = document.getElementById("msSnack");
  if (!el) {
    el = document.createElement("div");
    el.id = "msSnack";
    el.className = "ms-snack";
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="ms-snack-text"></div>
    <div class="ms-snack-aktionen">
      ${zeile ? `<button type="button" class="btn-qty" data-a="minus" aria-label="weniger">−</button>
      <input type="number" class="ms-snack-menge" step="any" min="0" inputmode="decimal">
      <button type="button" class="btn-qty" data-a="plus" aria-label="mehr">＋</button>
      <span class="ms-snack-einheit"></span>` : ""}
      <button type="button" class="ms-snack-undo">↶</button>
      <button type="button" class="ms-snack-zu" aria-label="Schließen">✕</button>
    </div>`;
  el.querySelector(".ms-snack-text").textContent = text;
  const verlaengere = () => { clearTimeout(msSnackTimer); msSnackTimer = setTimeout(msSnackAus, 8000); };
  if (zeile) {
    const inp = el.querySelector(".ms-snack-menge");
    inp.value = zeile.menge;
    el.querySelector(".ms-snack-einheit").textContent = zeile.einheit;
    const setze = (v) => { zeile.menge = Math.max(0, rundeMenge(v)); inp.value = zeile.menge; msZustand && msZustand.fertig(); verlaengere(); };
    el.querySelector('[data-a="minus"]').addEventListener("click", () => setze((zeile.menge || 0) - 1));
    el.querySelector('[data-a="plus"]').addEventListener("click", () => setze((zeile.menge || 0) + 1));
    inp.addEventListener("focus", () => { clearTimeout(msSnackTimer); inp.select(); });
    inp.addEventListener("change", () => { const v = parseFloat(String(inp.value).replace(",", ".")); setze(isNaN(v) ? 0 : v); });
    inp.addEventListener("blur", verlaengere);
  }
  el.querySelector(".ms-snack-undo").addEventListener("click", () => { rueckgaengig(); msSnackAus(); });
  el.querySelector(".ms-snack-zu").addEventListener("click", msSnackAus);
  el.hidden = false;
  verlaengere();
}
