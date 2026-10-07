"use strict";

/* ============================================================
   Aufmaßsoftware – einmalige Übernahme aus der bisherigen App
   Die bisherige App (grunzelthuine.github.io/Aufmass/) liegt auf derselben
   Domain und teilt sich deshalb den lokalen Speicher. Ihre Daten stehen unter
   „aufmass_v1_…“, die Aufmaßsoftware nutzt „am2_…“. Beim allerersten Start
   werden alle Daten einmalig kopiert (die bisherige App bleibt unverändert).
   Geräte ohne bisherige App holen sich die Daten nach der Anmeldung aus der
   Cloud (siehe cloudsync.js, übernehmeAusAlterCloud).
   Muss als erstes App-Skript geladen werden.
   ============================================================ */

const UEBERNAHME_KEY = "am2_uebernahme";

(function uebernehmeLokal() {
  try {
    if (localStorage.getItem(UEBERNAHME_KEY)) return;
    let n = 0;
    // Schlüssel zuerst einsammeln – setItem während der Schleife verschiebt sonst die Reihenfolge
    const alte = [];
    for (let i = 0; i < localStorage.length; i++) alte.push(localStorage.key(i));
    for (const k of alte) {
      if (!k || !k.startsWith("aufmass_v1_")) continue;
      if (k === "aufmass_v1_sync_meta") continue; // Sync-Stand gehört zur alten App
      const neu = "am2_" + k.slice("aufmass_v1_".length);
      if (localStorage.getItem(neu) === null) { localStorage.setItem(neu, localStorage.getItem(k)); n++; }
    }
    localStorage.setItem(UEBERNAHME_KEY, JSON.stringify({ zeit: new Date().toISOString(), lokal: n }));
  } catch (e) {
    console.error("Übernahme aus der bisherigen App fehlgeschlagen", e);
  }
})();

function uebernahmeInfo() {
  try { return JSON.parse(localStorage.getItem(UEBERNAHME_KEY) || "{}"); } catch (e) { return {}; }
}
