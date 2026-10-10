"use strict";

/* ============================================================
   Bauaufmaß (seit Version 10.0, erweitert in 11.0)
   Kunde + Arbeitsbeschreibung, Etagen -> Räume, Verteilungen.
   Pro Raum: Beleuchtung (Schaltungen), Rollos, KNX-Komponenten,
   Zähler-Gruppen und frei hinzufügbares Material.
   Verteilungen (v11): Typenbezeichnung + Komponenten (FI, LS, ...).
   Datum = Erstellungsdatum des Bauaufmaßes (kein eigenes Datumsfeld).
   Export: PDF nach Etage/Raum, Verteilungen, Gesamtzusammenstellung;
   nur Positionen > 0.
   Wird VOR app.js geladen; nutzt dessen Funktionen erst zur Laufzeit.
   ============================================================ */

const STORAGE_KEY_BAUAUFMASSE = "am2_bauaufmasse";

const BAU_ETAGEN_VORGABEN = ["KG", "EG", "OG", "DG", "Spitzboden", "Außenbereich"];

const BAU_RAUM_VORSCHLAEGE = [
  "Flur", "Bad", "Küche", "Esszimmer", "Wohnzimmer", "Schlafzimmer", "Abstellraum",
  "HWR", "Dachboden", "Eltern", "Kind 1", "Kind 2", "Kind 3", "Keller", "HAR", "Büro",
  "Garage", "Terrasse", "Hof"
];
const BAU_RAUM_VORSCHLAEGE_WEITERE = [
  "Gäste-WC", "Windfang", "Diele", "Treppenhaus", "Galerie", "Ankleide", "Gästezimmer",
  "Speisekammer", "Technikraum", "Hobbyraum", "Werkstatt", "Carport", "Balkon",
  "Wintergarten", "Garten", "Eingang außen"
];

const BAU_VERTEILUNG_VORSCHLAEGE = ["HV", "UV EG", "UV OG", "UV KG", "UV Garage", "Zählerschrank", "Kleinverteilung"];

const BAU_POSITIONEN_GRUPPEN = [
  { id: "installation", titel: "Installation", immerOffen: true, positionen: [
    { key: "steckdose", b: "Steckdose", abd: true },
    { key: "cat1", b: "Cat 1-fach", abd: true },
    { key: "cat2", b: "Cat 2-fach", abd: true },
    { key: "sat", b: "Sat-Anschluss", abd: true },
    { key: "blind", b: "Blindabdeckung", abd: true },
    { key: "leerrohr", b: "Leerrohrverbindung" },
    { key: "fbh", b: "FBH Thermostat" }
  ] },
  // Nur sichtbar, wenn im Bauaufmaß „Rahmen zählen“ aktiv ist (oder schon Werte erfasst sind)
  { id: "rahmen", titel: "Rahmen", nurMitRahmen: true, positionen: [
    { key: "rahmen1", b: "Rahmen 1-fach", abd: true },
    { key: "rahmen2", b: "Rahmen 2-fach", abd: true },
    { key: "rahmen3", b: "Rahmen 3-fach", abd: true },
    { key: "rahmen4", b: "Rahmen 4-fach", abd: true },
    { key: "rahmen5", b: "Rahmen 5-fach", abd: true }
  ] },
  { id: "geraete", titel: "Geräteanschlüsse", positionen: [
    { key: "herd", b: "Herdanschluss" },
    { key: "geschirrspueler", b: "Anschluss Geschirrspüler" },
    { key: "waschmaschine", b: "Anschluss Waschmaschine" },
    { key: "trockner", b: "Anschluss Trockner" },
    { key: "kuehlschrank", b: "Anschluss Kühlschrank" },
    { key: "dunstabzug", b: "Anschluss Dunstabzug" },
    { key: "durchlauferhitzer", b: "Anschluss Durchlauferhitzer" },
    { key: "badheizkoerper", b: "Anschluss Badheizkörper / Handtuchheizkörper" },
    { key: "wc", b: "Anschluss Toilette / WC" }
  ] },
  { id: "komm", titel: "Kommunikation", positionen: [
    { key: "tae", b: "TAE / Telefon", abd: true },
    { key: "klingel", b: "Klingel / Sprechanlage", abd: true }
  ] }
];

/* Schaltungsarten.
   stellenLabel: Beschriftung des Zählers (Standard „Schaltstellen“)
   ohneStellen: kein Zähler (Handautomatik)
   melder: Handautomatik mit Präsenz-/Bewegungsmelder */
const BAU_SCHALTUNGSTYPEN = [
  { key: "aus", b: "Ausschaltung", min: 1 },
  { key: "serie", b: "Serienschaltung", min: 1 },
  { key: "kontroll", b: "Kontrollschaltung", min: 1 },
  { key: "kontrollwechsel", b: "Kontrollwechselschaltung", min: 2 },
  { key: "dimmer", b: "Dimmer", min: 1 },
  { key: "wechsel", b: "Wechselschaltung", min: 2 },
  { key: "wechseldimmer", b: "Wechselschaltung mit Dimmer", min: 2 },
  { key: "kreuz", b: "Kreuzschaltung", min: 3 },
  { key: "taster", b: "Tasterschaltung", min: 1, stellenLabel: "Anzahl Taster", stellenEinheit: "Taster" },
  { key: "handauto", b: "Handautomatik-Schalter", min: 1, ohneStellen: true, melder: true },
  { key: "knx", b: "KNX-Schaltung", min: 1, ohneStellen: true, knx: true, ohneAbdeckung: true, versteckt: true }, // alt (bis v18.2), wird migriert
  // v18.3: KNX-Räume – Stromkreise mit Anzahl (Aktor wird in der Verteilung erfasst)
  { key: "knx_sk_licht", b: "Stromkreis Beleuchtung", min: 1, knx: true, stromkreis: true, ohneAbdeckung: true,
    stellenLabel: "Anzahl Stromkreise", stellenEinheit: "Stromkreise", auslaesse: ["decke", "wand", "strahler"], stripes: true },
  { key: "knx_sk_steckdose", b: "Stromkreis Steckdosen", min: 1, knx: true, stromkreis: true, ohneAbdeckung: true,
    stellenLabel: "Anzahl Stromkreise", stellenEinheit: "Stromkreise", auslaesse: [], stripes: false }
];
const BAU_KNX_STROMKREISE = BAU_SCHALTUNGSTYPEN.filter((t) => t.stromkreis);

// Auslässe, die eine Schaltung haben kann (Stromkreise: eingeschränkte Liste)
function auslaesseFuer(t, s) {
  return t.auslaesse ? BAU_AUSLAESSE.filter((a) => t.auslaesse.includes(a.key) || (s && s[a.key] > 0)) : BAU_AUSLAESSE;
}

// Art der KNX-Lichtschaltung (v15)
const BAU_KNX_LICHTARTEN = ["Schalten", "Dimmen", "Tunable White", "RGB(W)"];

const BAU_MELDERARTEN = [
  { key: "praesenz", b: "Präsenzmelder" },
  { key: "bewegung", b: "Bewegungsmelder" }
];

// Rollos (v10.1): je Rollo-Anschluss Bedienung wählbar
const BAU_ROLLO_BEDIENUNG = [
  { key: "keine", b: "Keine", label: "ohne Schalter/Taster" },
  { key: "schalter", b: "Schalter", label: "Schalter", mat: "Rolloschalter" },
  { key: "taster", b: "Taster", label: "Taster", mat: "Rollotaster" }
];

const BAU_AUSLAESSE = [
  { key: "wand", b: "Wandauslass" },
  { key: "decke", b: "Deckenauslass" },
  { key: "steckdose", b: "Schaltbare Steckdose" },
  { key: "strahler", b: "Strahler" }
];

/* ---------- Generische Komponenten (KNX im Raum, Verteilung) ----------
   Feldtypen: counter {k,l,min,d}, select {k,l,o,d}, segment {k,l,o,d}, text {k,l,ph}
   l darf eine Funktion (item) => Text sein.
   bez(item): Bezeichnung im PDF/Gesamt (ohne Typ-Freitext; der wird angehängt)
   unter(item): eingerückte Unterzeilen [{b, menge, e, bGesamt}]
   e: Einheit der Hauptzeile (Standard Stck), mengeFeld: Feld für Menge (Standard anzahl) */
const F_ANZAHL = { k: "anzahl", t: "counter", l: "Anzahl", min: 1, d: 1 };
const F_TYP = (ph) => ({ k: "typ", t: "text", l: "Typ / Hersteller", ph: ph || "optional" });
// Typ aus der gespeicherten Produktliste (v12): speichert typ (Name), nr (Art.-Nr.), produktId
const F_PRODUKT = (kat) => ({ k: "typ", t: "produkt", l: "Typ", kat });

/* ---------- Produktliste (v12) ----------
   Global (nicht je Bauaufmaß) gespeicherte Produkte, einmal angelegt per
   Freitext oder EAN-/Art.-Nr.-Suche im Katalog, danach in den Dropdowns
   wählbar. localStorage am2_produkte: [{id, kat, name, nr, ean}] */
const STORAGE_KEY_PRODUKTE = "am2_produkte";
const PRODUKT_KATEGORIEN = [ // gruppe: Überschrift in der Produktliste
  { key: "abdeckung", gruppe: "Abdeckungen", b: "Abdeckungen / Schalterprogramme", ph: "z. B. Gira E2 reinweiß glänzend" },
  { key: "knx_tastsensor", gruppe: "KNX", b: "KNX-Tastsensoren", ph: "z. B. MDT Taster Plus 55 4-fach" },
  { key: "knx_glastaster", gruppe: "KNX", b: "MDT Glastaster II Smart", ph: "z. B. BE-GTS2TS.01 schwarz" },
  { key: "knx_pille", gruppe: "KNX", b: "KNX-Tasterschnittstellen (Pille)", ph: "z. B. MDT BE-04000.02" },
  { key: "knx_praesenz", gruppe: "KNX", b: "KNX-Präsenzmelder", ph: "z. B. MDT SCN-P360D3.02" },
  { key: "knx_bewegung", gruppe: "KNX", b: "KNX-Bewegungsmelder", ph: "" },
  { key: "knx_rtr", gruppe: "KNX", b: "KNX-Raumtemperaturregler", ph: "" },
  { key: "praesenz", gruppe: "Melder", b: "Präsenzmelder (konventionell)", ph: "z. B. Theben theRonda P360" },
  { key: "bewegung", gruppe: "Melder", b: "Bewegungsmelder (konventionell)", ph: "z. B. Steinel IS 3360" },
  { key: "rauchmelder", gruppe: "Melder", b: "Rauchmelder", ph: "z. B. Ei Electronics Ei650" },
  { key: "strahler", gruppe: "Beleuchtung", b: "Strahler / Downlights", ph: "z. B. SLV Universal Downlight 7 W 3000 K" },
  { key: "ledstripe", gruppe: "Beleuchtung", b: "LED-Stripes", ph: "z. B. Paulmann MaxLED 1000 3000 K", einheit: "m" },
  { key: "lednetzteil", gruppe: "Beleuchtung", b: "LED-Netzteile / Treiber", ph: "z. B. Mean Well LPV-100-24" }
];
const AMP = (liste) => liste.map((a) => a + " A");
const QUERSCHNITTE = ["1,5 mm²", "2,5 mm²", "4 mm²", "6 mm²", "10 mm²", "16 mm²", "25 mm²", "35 mm²"];
const ohneA = (s) => String(s || "").replace(/\s*A$/, "");

const KNX_TYPEN = [
  { key: "tastsensor", b: "KNX-Tastsensor", felder: [
    { k: "fach", t: "segment", l: "Fachigkeit", o: ["1-fach", "2-fach", "4-fach", "6-fach", "8-fach"], d: "4-fach" },
    F_ANZAHL, F_PRODUKT("knx_tastsensor") ],
    bez: (i) => "KNX-Tastsensor" + (i.fach ? " " + i.fach : "") },
  { key: "glastaster", b: "MDT Glastaster II Smart", felder: [
    { k: "variante", t: "segment", l: "Ausführung", o: ["mit Temperatursensor", "ohne Temperatursensor"], d: "mit Temperatursensor" },
    F_ANZAHL, F_PRODUKT("knx_glastaster") ],
    bez: (i) => "MDT Glastaster II Smart, " + i.variante },
  { key: "pille", b: "Tasterschnittstelle (Pille)", felder: [
    { k: "anzahl", t: "counter", l: "Anzahl Pillen", min: 1, d: 1 },
    { k: "ausfuehrung", t: "segment", l: "Mit", o: ["Taster", "Serientaster"], d: "Taster" },
    { k: "tasterAnzahl", t: "counter", l: (i) => "Anzahl " + i.ausfuehrung, min: 0, d: 1 },
    F_PRODUKT("knx_pille") ],
    bez: () => "KNX-Tasterschnittstelle (Pille)",
    unter: (i) => (i.tasterAnzahl > 0 ? [{ b: i.ausfuehrung, menge: i.tasterAnzahl, bGesamt: i.ausfuehrung + " (an Pille)" }] : []) },
  { key: "praesenz", b: "KNX-Präsenzmelder", felder: [F_ANZAHL, F_PRODUKT("knx_praesenz")], bez: () => "KNX-Präsenzmelder" },
  { key: "bewegung", b: "KNX-Bewegungsmelder", felder: [F_ANZAHL, F_PRODUKT("knx_bewegung")], bez: () => "KNX-Bewegungsmelder" },
  { key: "rtr", b: "KNX-Raumtemperaturregler", felder: [F_ANZAHL, F_PRODUKT("knx_rtr")], bez: () => "KNX-Raumtemperaturregler" }
];

// Konventionelle Melder im Raum (v12: statt Zähler, mit Produktauswahl)
const MELDER_TYPEN = [
  { key: "rauchmelder", b: "Rauchmelder", felder: [F_ANZAHL, F_PRODUKT("rauchmelder")], bez: () => "Rauchmelder" },
  { key: "bewegung", b: "Bewegungsmelder", felder: [F_ANZAHL, F_PRODUKT("bewegung")], bez: () => "Bewegungsmelder" },
  { key: "praesenz", b: "Präsenzmelder", felder: [F_ANZAHL, F_PRODUKT("praesenz")], bez: () => "Präsenzmelder" }
];

// Hinweis: Feldnamen "id", "art" (Komponententyp) sind reserviert; "typ" ist der Freitext.
const VERT_TYPEN = [
  // Schutzorgane
  { key: "fi", gruppe: "Schutzorgane", b: "FI-Schutzschalter (RCD)", felder: [
    { k: "rcd", t: "segment", l: "Typ", o: ["A", "F", "B"], d: "A" },
    { k: "nennstrom", t: "select", l: "Nennstrom", o: AMP([25, 40, 63, 80, 100]), d: "40 A" },
    { k: "fehlerstrom", t: "select", l: "Fehlerstrom", o: ["10 mA", "30 mA", "100 mA", "300 mA"], d: "30 mA" },
    { k: "pole", t: "segment", l: "Polzahl", o: ["2-polig", "4-polig"], d: "4-polig" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `FI-Schutzschalter Typ ${i.rcd} ${i.nennstrom} / ${i.fehlerstrom}, ${i.pole}` },
  { key: "ls", gruppe: "Schutzorgane", b: "LS-Schalter (Automat)", felder: [
    { k: "char", t: "segment", l: "Charakteristik", o: ["B", "C", "D"], d: "B" },
    { k: "nennstrom", t: "select", l: "Nennstrom", o: AMP([2, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63]), d: "16 A" },
    { k: "pole", t: "segment", l: "Polzahl", o: ["1-polig", "1+N", "3-polig", "3+N"], d: "1-polig" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `LS-Schalter ${i.char}${ohneA(i.nennstrom)}, ${i.pole}` },
  { key: "fils", gruppe: "Schutzorgane", b: "FI/LS-Kombi (RCBO)", felder: [
    { k: "rcd", t: "segment", l: "FI-Typ", o: ["A", "F", "B"], d: "A" },
    { k: "char", t: "segment", l: "Charakteristik", o: ["B", "C"], d: "B" },
    { k: "nennstrom", t: "select", l: "Nennstrom", o: AMP([6, 10, 13, 16, 20, 25, 32, 40]), d: "16 A" },
    { k: "fehlerstrom", t: "select", l: "Fehlerstrom", o: ["10 mA", "30 mA", "300 mA"], d: "30 mA" },
    { k: "pole", t: "segment", l: "Polzahl", o: ["1+N", "3+N"], d: "1+N" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `FI/LS Typ ${i.rcd} ${i.char}${ohneA(i.nennstrom)} / ${i.fehlerstrom}, ${i.pole}` },
  { key: "afdd", gruppe: "Schutzorgane", b: "Brandschutzschalter (AFDD)", felder: [
    { k: "char", t: "segment", l: "Charakteristik", o: ["B", "C"], d: "B" },
    { k: "nennstrom", t: "select", l: "Nennstrom", o: AMP([6, 10, 13, 16, 20]), d: "16 A" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `Brandschutzschalter (AFDD) ${i.char}${ohneA(i.nennstrom)}` },
  { key: "uess", gruppe: "Schutzorgane", b: "Überspannungsschutz", felder: [
    { k: "stufe", t: "segment", l: "Typ", o: ["Typ 1+2", "Typ 2", "Typ 3"], d: "Typ 1+2" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `Überspannungsschutz ${i.stufe}` },
  { key: "hauptschalter", gruppe: "Schutzorgane", b: "Hauptschalter / Lasttrennschalter", felder: [
    { k: "nennstrom", t: "select", l: "Nennstrom", o: AMP([40, 63, 80, 100, 125]), d: "63 A" },
    { k: "pole", t: "segment", l: "Polzahl", o: ["3-polig", "4-polig"], d: "3-polig" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `Hauptschalter ${i.nennstrom}, ${i.pole}` },
  { key: "sls", gruppe: "Schutzorgane", b: "SH-Schalter (SLS)", felder: [
    { k: "nennstrom", t: "select", l: "Nennstrom", o: AMP([25, 35, 40, 50, 63]), d: "35 A" },
    { k: "pole", t: "segment", l: "Polzahl", o: ["3-polig", "4-polig"], d: "3-polig" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `SH-Schalter (SLS) E${ohneA(i.nennstrom)}, ${i.pole}` },
  // Zählerplatz
  { key: "zaehlerplatz", gruppe: "Zählerplatz", b: "Zählerplatz", felder: [
    { k: "ausf", t: "segment", l: "Ausführung", o: ["eHZ", "3-Punkt"], d: "eHZ" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `Zählerplatz ${i.ausf}` },
  { key: "apz", gruppe: "Zählerplatz", b: "APZ-Feld (Zusatzanwendungen)", felder: [F_ANZAHL, F_TYP()], bez: () => "APZ-Feld" },
  // Geräte
  { key: "klingeltrafo", gruppe: "Reiheneinbaugeräte", b: "Klingeltrafo", felder: [F_ANZAHL, F_TYP("z. B. 8/12 V, 1 A")], bez: () => "Klingeltrafo" },
  { key: "netzteil", gruppe: "Reiheneinbaugeräte", b: "Hutschienen-Netzteil", felder: [F_ANZAHL, F_TYP("z. B. 24 V DC, 60 W")], bez: () => "Hutschienen-Netzteil" },
  { key: "stromstoss", gruppe: "Reiheneinbaugeräte", b: "Stromstoßschalter", felder: [F_ANZAHL, F_TYP()], bez: () => "Stromstoßschalter" },
  { key: "schuetz", gruppe: "Reiheneinbaugeräte", b: "Installationsschütz", felder: [
    { k: "nennstrom", t: "select", l: "Nennstrom", o: AMP([20, 25, 40, 63]), d: "25 A" },
    { k: "kontakte", t: "select", l: "Kontakte", o: ["1 S", "2 S", "3 S", "4 S", "1 S + 1 Ö", "2 S + 2 Ö"], d: "2 S" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `Installationsschütz ${i.nennstrom}, ${i.kontakte}` },
  { key: "treppenlicht", gruppe: "Reiheneinbaugeräte", b: "Treppenlichtzeitschalter", felder: [F_ANZAHL, F_TYP()], bez: () => "Treppenlichtzeitschalter" },
  { key: "zeitschaltuhr", gruppe: "Reiheneinbaugeräte", b: "Zeitschaltuhr", felder: [F_ANZAHL, F_TYP()], bez: () => "Zeitschaltuhr" },
  { key: "regsteckdose", gruppe: "Reiheneinbaugeräte", b: "Steckdose REG (Hutschiene)", felder: [F_ANZAHL, F_TYP()], bez: () => "Steckdose REG" },
  // KNX
  { key: "knxsv", gruppe: "KNX", b: "KNX-Spannungsversorgung", felder: [
    { k: "strom", t: "select", l: "Ausgangsstrom", o: ["160 mA", "320 mA", "640 mA", "960 mA", "1280 mA"], d: "640 mA" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `KNX-Spannungsversorgung ${i.strom}` },
  { key: "knxgeraet", gruppe: "KNX", b: "KNX-Gerät (REG)", felder: [
    { k: "geraet", t: "select", l: "Art", o: ["Schaltaktor", "Dimmaktor", "Jalousieaktor", "Heizungsaktor", "Binäreingang", "IP-Router / Interface", "Linienkoppler", "Logikmodul", "Wetterstation (Auswerteeinheit)", "Sonstiges"], d: "Schaltaktor" },
    { k: "kanaele", t: "select", l: "Kanäle", o: ["–", "1-fach", "2-fach", "4-fach", "6-fach", "8-fach", "12-fach", "16-fach", "20-fach", "24-fach"], d: "8-fach" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => `KNX-${i.geraet}` + (i.kanaele && i.kanaele !== "–" ? " " + i.kanaele : "") },
  // Verdrahtung
  { key: "reihenklemme", gruppe: "Verdrahtung", b: "Reihenklemmen", felder: [
    { k: "klemme", t: "select", l: "Art", o: ["Durchgangsklemme", "N-Trennklemme", "PE-Klemme", "Etagenklemme", "Sicherungsklemme", "Endplatte", "Endhalter"], d: "Durchgangsklemme" },
    { k: "qs", t: "select", l: "Querschnitt", o: QUERSCHNITTE, d: "2,5 mm²" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => (i.klemme === "Endplatte" || i.klemme === "Endhalter") ? i.klemme : `${i.klemme} ${i.qs}` },
  { key: "schiene", gruppe: "Verdrahtung", b: "Verdrahtungsschiene / Phasenschiene", felder: [
    { k: "pole", t: "segment", l: "Polzahl", o: ["1-polig", "1+N", "3-polig", "3+N"], d: "3-polig" },
    { k: "qs", t: "segment", l: "Querschnitt", o: ["10 mm²", "16 mm²"], d: "10 mm²" },
    F_ANZAHL, F_TYP("z. B. 12 TE / 1 m, Stift / Gabel") ],
    bez: (i) => `Verdrahtungsschiene ${i.pole}, ${i.qs}` },
  { key: "verdrahtung", gruppe: "Verdrahtung", b: "Verdrahtung (Aderleitung)", e: "m", felder: [
    { k: "qs", t: "select", l: "Querschnitt", o: QUERSCHNITTE, d: "2,5 mm²" },
    { k: "farbe", t: "select", l: "Farbe", o: ["schwarz", "braun", "grau", "blau", "grün-gelb", "rot", "gemischt"], d: "schwarz" },
    { k: "anzahl", t: "counter", l: "Länge (m)", min: 1, d: 10 }, F_TYP("z. B. H07V-K") ],
    bez: (i) => `Verdrahtung ${i.qs}, ${i.farbe}` },
  { key: "npe", gruppe: "Verdrahtung", b: "N-/PE-Schiene", felder: [
    { k: "schiene", t: "segment", l: "Art", o: ["N-Schiene", "PE-Schiene"], d: "N-Schiene" },
    F_ANZAHL, F_TYP() ],
    bez: (i) => i.schiene },
  { key: "abdeckung", gruppe: "Verdrahtung", b: "Abdeckstreifen / Blindabdeckung", felder: [F_ANZAHL, F_TYP()], bez: () => "Abdeckstreifen / Blindabdeckung" }
];

/* v14: Auch für alle Verteilungs-Positionen eine Produkt-Auswahlliste
   (Kategorie „vert_<key>“). Der bisherige Typ-Freitext wird zum
   Produkt-Dropdown (Freitext bleibt dort möglich). */
for (const t of VERT_TYPEN) {
  const idx = t.felder.findIndex((f) => f.k === "typ");
  const ph = idx >= 0 ? t.felder[idx].ph : "";
  const feld = { k: "typ", t: "produkt", l: "Typ / Hersteller", kat: "vert_" + t.key };
  if (idx >= 0) t.felder[idx] = feld; else t.felder.push(feld);
  PRODUKT_KATEGORIEN.push({ key: "vert_" + t.key, b: t.b, gruppe: "Verteilung – " + t.gruppe, ph: ph && ph !== "optional" ? ph : "", einheit: t.e || "Stck" });
}

let bauaufmasse = [];
let currentBauaufmass = null;
let currentRaum = null;           // { etage, raum } während die Raum-Ansicht offen ist
let currentMaterialHalter = null; // Raum oder Verteilung, deren Materialliste gerade angezeigt wird
let bauScrollPosition = 0;        // Scrollposition der Bauaufmaß-Ansicht beim Öffnen eines Raums

/* ---------- Storage ---------- */

function ladeBauaufmasse() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BAUAUFMASSE);
    bauaufmasse = raw ? JSON.parse(raw) : [];
    bauaufmasse.forEach(migriereBauaufmass);
  } catch (e) {
    console.error("Fehler beim Laden der Bauaufmaße", e);
    bauaufmasse = [];
  }
}

function speichereBauaufmasse() {
  try {
    localStorage.setItem(STORAGE_KEY_BAUAUFMASSE, JSON.stringify(bauaufmasse));
  } catch (e) {
    console.error("Fehler beim Speichern", e);
    alert("Speichern fehlgeschlagen (evtl. Speicher voll). Bitte PDF sichern.");
  }
}

function istLeeresBauaufmass(b) {
  const k = b.kunde;
  return !k.name.trim() && !k.ansprechpartner.trim() && !k.strasse.trim() && !k.plzOrt.trim() &&
    !k.telefon.trim() && !b.baustelle.trim() && !b.arbeitsbeschreibung.trim() && b.etagen.length === 0 &&
    (b.verteilungen || []).length === 0;
}

function upsertCurrentBauaufmass() {
  const idx = bauaufmasse.findIndex((x) => x.id === currentBauaufmass.id);
  currentBauaufmass.geaendert = new Date().toISOString();
  if (idx >= 0) bauaufmasse[idx] = currentBauaufmass;
  else bauaufmasse.unshift(currentBauaufmass);
  speichereBauaufmasse();
}

// Von autosave() in app.js aufgerufen. Bereits gespeicherte Bauaufmaße werden
// auch dann aktualisiert, wenn sie (z. B. nach Löschen aller Etagen) leer sind.
function autosaveBauaufmass() {
  if (!currentBauaufmass) return;
  const bestehend = bauaufmasse.some((x) => x.id === currentBauaufmass.id);
  if (bestehend || !istLeeresBauaufmass(currentBauaufmass)) upsertCurrentBauaufmass();
}

function neuesBauaufmass() {
  const jetzt = new Date().toISOString();
  return {
    id: neueId(),
    typ: "bau",
    erstellt: jetzt,
    geaendert: jetzt,
    kunde: { name: "", ansprechpartner: "", strasse: "", plzOrt: "", telefon: "" },
    baustelle: "",
    arbeitsbeschreibung: "",
    etagen: [],       // { id, name, raeume: [Raum] }
    abdeckung: { standard: "", rahmen: false }, // Standard-Abdeckung + „Rahmen zählen“ (v12)
    verteilungen: []  // { id, name, standort, typ, bemerkung, komponenten: [], material: [] }
  };
}

function neuerRaum(name) {
  return { id: neueId(), name, abdeckung: "", positionen: {}, schaltungen: [], rollos: [], knx: [], melder: [], abw: [], material: [] };
}

function neueVerteilung(name) {
  return { id: neueId(), name, standort: "", typ: "", bemerkung: "", komponenten: [], material: [] };
}

function neuesRollo(anzahl = 1, bedienung = "keine") {
  return { id: neueId(), anzahl, bedienung, bedienAnzahl: 1, bemerkung: "" };
}

function komponentenTyp(typen, key) {
  return typen.find((t) => t.key === key) || typen[0];
}

function neueKomponente(typ, werte) {
  const item = { id: neueId(), art: typ.key, typ: "" };
  for (const f of typ.felder) if (f.d !== undefined) item[f.k] = f.d;
  return Object.assign(item, werte || {});
}

/* v18: Installationsart. Bauaufmaß: "konventionell" | "knx";
   Raum: "" (wie Bauaufmaß) | "konventionell" | "knx". In KNX-Räumen gibt es
   nur KNX-Schaltungen, Rollos nur mit Anzahl (je Rollo ein Aktorkanal). */
function istKnxRaum(b, raum) {
  return ((raum && raum.installation) || (b && b.installation) || "konventionell") === "knx";
}

function migriereBauaufmass(b) {
  if (!Array.isArray(b.verteilungen)) b.verteilungen = [];
  if (!b.abdeckung || typeof b.abdeckung !== "object") b.abdeckung = { standard: "", rahmen: false };
  if (b.installation !== "knx") b.installation = "konventionell"; // v18
  b.etagen.forEach((e) => e.raeume.forEach(migriereRaum));
}

// v10.0: "Rollo" als Zähler -> Rollo-Einträge; v10.x: KNX-Taster/RTR als Zähler -> KNX-Komponenten.
function migriereRaum(raum) {
  if (!raum.positionen) raum.positionen = {};
  if (!Array.isArray(raum.rollos)) raum.rollos = [];
  if (!Array.isArray(raum.knx)) raum.knx = [];
  const p = raum.positionen;
  if (p.rollo > 0) raum.rollos.push(neuesRollo(p.rollo, "keine"));
  delete p.rollo;
  if (p.knxtaster > 0) raum.knx.push(neueKomponente(komponentenTyp(KNX_TYPEN, "tastsensor"), { anzahl: p.knxtaster, fach: "" }));
  delete p.knxtaster;
  if (p.rtr > 0) raum.knx.push(neueKomponente(komponentenTyp(KNX_TYPEN, "rtr"), { anzahl: p.rtr }));
  delete p.rtr;
  // v12: Melder-Zähler -> Melder-Einträge mit Produktauswahl; Abdeckung je Raum/Position
  if (!Array.isArray(raum.melder)) raum.melder = [];
  if (!Array.isArray(raum.abw)) raum.abw = [];
  if (typeof raum.abdeckung !== "string") raum.abdeckung = "";
  for (const [alt, neu] of [["rauchmelder", "rauchmelder"], ["bewegungsmelder", "bewegung"], ["praesenzmelder", "praesenz"]]) {
    if (p[alt] > 0) raum.melder.push(neueKomponente(komponentenTyp(MELDER_TYPEN, neu), { anzahl: p[alt] }));
    delete p[alt];
  }
  // v18.3: alte KNX-Schaltungen (Schalten/Dimmen/…) -> Stromkreis Beleuchtung
  for (const s of raum.schaltungen || []) {
    if (s.typ !== "knx") continue;
    s.typ = "knx_sk_licht";
    s.schaltstellen = 1;
    delete s.knxArt;
  }
}

function rolloBedienung(key) {
  return BAU_ROLLO_BEDIENUNG.find((x) => x.key === key) || BAU_ROLLO_BEDIENUNG[0];
}

function erstelltDatumISO(b) {
  const d = new Date(b.erstellt);
  if (isNaN(d)) return heuteISO();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function schaltungTyp(key) {
  return BAU_SCHALTUNGSTYPEN.find((t) => t.key === key) || BAU_SCHALTUNGSTYPEN[0];
}

function melderArt(key) {
  return BAU_MELDERARTEN.find((m) => m.key === key) || BAU_MELDERARTEN[0];
}

function schaltungBezeichnung(s) {
  const t = schaltungTyp(s.typ);
  if (t.melder) return `${t.b} mit ${melderArt(s.melderArt).b}`;
  if (t.stromkreis) return t.b;
  if (t.knx) return `${t.b} (${s.knxArt || "Schalten"})`;
  if (t.stellenEinheit) return `${t.b} (${s.schaltstellen} ${t.stellenEinheit})`;
  return t.b + (s.schaltstellen > 1 ? ` (${s.schaltstellen} Schaltstellen)` : "");
}

function komponenteMitTyp(bez, item) {
  const typ = (item.typ || "").trim();
  return typ ? `${bez} – ${typ}` : bez;
}

function raumZusammenfassung(raum) {
  const teile = [];
  const nS = raum.schaltungen.filter((s) => !schaltungTyp(s.typ).stromkreis).length;
  if (nS) teile.push(`${nS} Schaltung${nS === 1 ? "" : "en"}`);
  const nSK = raum.schaltungen.filter((s) => schaltungTyp(s.typ).stromkreis).reduce((x, s) => x + (s.schaltstellen || 0), 0);
  if (nSK) teile.push(`${nSK} Stromkreis${nSK === 1 ? "" : "e"}`);
  // Aufmaßsoftware: Auslässe/Strahler/Stripes mit in die Übersicht
  const sum = (k) => raum.schaltungen.reduce((x, sch) => x + (sch[k] || 0), 0);
  const nA = sum("decke") + sum("wand");
  if (nA) teile.push(`${nA} Auslass${nA === 1 ? "" : "e"}`);
  const nSt = sum("strahler");
  if (nSt) teile.push(`${nSt} Strahler`);
  const nLed = raum.schaltungen.reduce((x, sch) => x + (sch.stripes || []).length, 0);
  if (nLed) teile.push(`${nLed} LED-Stripe${nLed === 1 ? "" : "s"}`);
  const nR = (raum.rollos || []).reduce((s, r) => s + r.anzahl, 0);
  if (nR) teile.push(`${nR} Rollo${nR === 1 ? "" : "s"}`);
  const nK = (raum.knx || []).reduce((s, k) => s + (k.anzahl || 0), 0);
  if (nK) teile.push(`${nK} KNX`);
  const nMe = (raum.melder || []).reduce((s, k) => s + (k.anzahl || 0), 0);
  if (nMe) teile.push(`${nMe} Melder`);
  const steck = Object.entries(raum.positionen).filter(([k]) => /^steckdose/.test(k)).reduce((s, [, v]) => s + (v > 0 ? v : 0), 0);
  if (steck) teile.push(`${steck} Steckd.`);
  const nP = Object.entries(raum.positionen).filter(([k]) => !/^steckdose/.test(k)).reduce((s, [, v]) => s + (v > 0 ? v : 0), 0);
  if (nP) teile.push(`${nP} weitere Anschl.`);
  const nM = raum.material.filter((m) => m.menge > 0).length;
  if (nM) teile.push(`${nM} Material`);
  return teile.length ? teile.join(" · ") : "noch leer";
}

function verteilungZusammenfassung(v) {
  const teile = [];
  if ((v.typ || "").trim()) teile.push(v.typ.trim());
  if ((v.standort || "").trim()) teile.push(v.standort.trim());
  const nK = v.komponenten.length;
  teile.push(`${nK} Position${nK === 1 ? "" : "en"}`);
  const nM = v.material.filter((m) => m.menge > 0).length;
  if (nM) teile.push(`${nM} Material`);
  return teile.join(" · ");
}

/* ---------- UI-Bausteine ---------- */

// Dropdown, das beim Auswählen sofort hinzufügt. gruppen: [{label?, optionen:[{value,text,disabled?}]}]
// frei: Platzhalter für Freitext-Option (oder null). onAdd(value) – bei Freitext der eingegebene Text.
function baueAuswahl({ platzhalter, gruppen, frei, onAdd }) {
  const wrap = document.createElement("div");
  wrap.className = "auswahl";
  const select = document.createElement("select");
  select.className = "auswahl-select";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = platzhalter;
  select.appendChild(opt0);
  for (const g of gruppen) {
    let ziel = select;
    if (g.label) {
      ziel = document.createElement("optgroup");
      ziel.label = g.label;
      select.appendChild(ziel);
    }
    for (const o of g.optionen) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.text;
      opt.disabled = !!o.disabled;
      ziel.appendChild(opt);
    }
  }
  if (frei) {
    const opt = document.createElement("option");
    opt.value = "__frei__";
    opt.textContent = "✎ " + frei.option;
    select.appendChild(opt);
  }
  wrap.appendChild(select);

  let freiZeile = null;
  if (frei) {
    freiZeile = document.createElement("div");
    freiZeile.className = "inline-add";
    freiZeile.hidden = true;
    freiZeile.innerHTML = `<input type="text"><button type="button" class="btn btn-secondary">Hinzufügen</button>`;
    const input = freiZeile.querySelector("input");
    input.placeholder = frei.placeholder;
    const add = () => {
      const t = input.value.trim();
      if (!t) { input.focus(); return; }
      onAdd(t, true);
    };
    freiZeile.querySelector("button").addEventListener("click", add);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    wrap.appendChild(freiZeile);
  }

  select.addEventListener("change", () => {
    const v = select.value;
    if (!v) return;
    if (v === "__frei__") {
      freiZeile.hidden = false;
      freiZeile.querySelector("input").focus();
      return;
    }
    if (freiZeile) freiZeile.hidden = true;
    select.value = "";
    onAdd(v, false);
  });
  return wrap;
}

// Zähler-Zeile: Bezeichnung + (−) [Zahl] (+)
function baueZaehler(label, wert, min, onChange, optionen) {
  const dezimal = optionen && optionen.dezimal;
  const row = document.createElement("div");
  row.className = "zaehler-zeile" + (wert > 0 ? " aktiv" : "");
  row.innerHTML = `
    <span class="zaehler-label"></span>
    <div class="menge-control">
      <button type="button" class="btn-qty" data-action="dec" aria-label="weniger">−</button>
      <input type="number" step="${dezimal ? "any" : "1"}" min="${min}" inputmode="${dezimal ? "decimal" : "numeric"}" class="menge-input">
      <button type="button" class="btn-qty" data-action="inc" aria-label="mehr">+</button>
    </div>`;
  row.querySelector(".zaehler-label").textContent = label;
  const input = row.querySelector("input");
  input.value = wert;
  const setze = (v) => {
    v = isNaN(v) ? min : v;
    v = Math.max(min, dezimal ? Math.round(v * 10) / 10 : Math.round(v));
    wert = v;
    input.value = v;
    row.classList.toggle("aktiv", v > 0);
    onChange(v);
  };
  row.querySelector('[data-action="dec"]').addEventListener("click", () => setze(wert - 1));
  row.querySelector('[data-action="inc"]').addEventListener("click", () => setze(wert + 1));
  input.addEventListener("change", () => setze(parseFloat(input.value)));
  return row;
}

// Segment-Auswahl (z. B. Keine / Schalter / Taster)
function baueSegment(label, optionen, wert, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "segment-feld";
  if (label) {
    const l = document.createElement("div");
    l.className = "rollo-bedienung-label";
    l.textContent = label;
    wrap.appendChild(l);
  }
  const seg = document.createElement("div");
  seg.className = "segment";
  seg.setAttribute("role", "radiogroup");
  for (const o of optionen) {
    const value = typeof o === "string" ? o : o.key;
    const text = typeof o === "string" ? o : o.b;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segment-btn" + (wert === value ? " aktiv" : "");
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", wert === value ? "true" : "false");
    btn.textContent = text;
    btn.addEventListener("click", () => {
      seg.querySelectorAll(".segment-btn").forEach((x) => {
        x.classList.toggle("aktiv", x === btn);
        x.setAttribute("aria-checked", x === btn ? "true" : "false");
      });
      onChange(value);
    });
    seg.appendChild(btn);
  }
  wrap.appendChild(seg);
  return wrap;
}

function baueSelectFeld(label, optionen, wert, onChange) {
  const l = document.createElement("label");
  l.className = "komp-select";
  l.textContent = label;
  const sel = document.createElement("select");
  for (const o of optionen) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  }
  if (!optionen.includes(wert)) {
    const opt = document.createElement("option");
    opt.value = wert;
    opt.textContent = wert || "–";
    sel.insertBefore(opt, sel.firstChild);
  }
  sel.value = wert;
  sel.addEventListener("change", () => onChange(sel.value));
  l.appendChild(sel);
  return l;
}

function baueTextFeld(placeholder, wert, onChange, label) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "schaltung-bemerkung";
  input.placeholder = label ? `${label} (${placeholder})` : placeholder;
  input.value = wert || "";
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

/* Rendert eine Liste generischer Komponenten (KNX im Raum, Komponenten einer Verteilung)
   als Karten. liste wird direkt mutiert; nach Änderungen autosave() + onChange(). */
function renderKomponentenListe(container, halter, feld, typen, onChange) {
  container.innerHTML = "";
  const liste = halter[feld];
  liste.forEach((item, i) => {
    const typ = komponentenTyp(typen, item.art);
    const karte = document.createElement("div");
    karte.className = "schaltung-karte komp-karte";
    karte.innerHTML = `
      <div class="schaltung-kopf">
        <strong></strong>
        <span class="komp-aktionen">
          <button type="button" class="btn-link-accent komp-kopie" aria-label="Duplizieren">⧉ Kopie</button>
          <button type="button" class="btn-danger-text" aria-label="Entfernen">✕</button>
        </span>
      </div>
      <div class="komp-felder"></div>`;
    karte.querySelector("strong").textContent = `${i + 1}. ${typ.b}`;
    karte.querySelector(".btn-danger-text").addEventListener("click", () => {
      if (!confirm(`${typ.b} entfernen?`)) return;
      halter[feld] = halter[feld].filter((x) => x.id !== item.id);
      autosave();
      renderKomponentenListe(container, halter, feld, typen, onChange);
      onChange();
    });
    karte.querySelector(".komp-kopie").addEventListener("click", () => {
      const kopie = Object.assign(JSON.parse(JSON.stringify(item)), { id: neueId() });
      halter[feld].splice(halter[feld].indexOf(item) + 1, 0, kopie);
      autosave();
      renderKomponentenListe(container, halter, feld, typen, onChange);
      onChange();
    });
    const felderEl = karte.querySelector(".komp-felder");
    const neuZeichnen = () => {
      renderKomponentenListe(container, halter, feld, typen, onChange);
      onChange();
    };
    for (const f of typ.felder) {
      const label = typeof f.l === "function" ? f.l(item) : f.l;
      if (f.t === "counter") {
        felderEl.appendChild(baueZaehler(label, item[f.k] ?? f.d ?? 0, f.min ?? 0, (v) => { item[f.k] = v; autosave(); onChange(); }));
      } else if (f.t === "segment") {
        felderEl.appendChild(baueSegment(label, f.o, item[f.k], (v) => { item[f.k] = v; autosave(); neuZeichnen(); }));
      } else if (f.t === "select") {
        felderEl.appendChild(baueSelectFeld(label, f.o, item[f.k], (v) => { item[f.k] = v; autosave(); onChange(); }));
      } else if (f.t === "produkt") {
        felderEl.appendChild(baueProduktAuswahl({
          kat: f.kat, wert: item.typ, leerText: `${label}: – offen –`, label,
          onChange: ({ name, nr, produktId }) => { item.typ = name; item.nr = nr; item.produktId = produktId; autosave(); }
        }));
      } else if (f.t === "text") {
        felderEl.appendChild(baueTextFeld(f.ph || "optional", item[f.k], (v) => { item[f.k] = v; autosave(); }, label));
      }
    }
    container.appendChild(karte);
  });
}

function komponentenAuswahl(typen, platzhalter, onAdd) {
  const gruppen = [];
  for (const t of typen) {
    const gName = t.gruppe || "";
    let g = gruppen.find((x) => x.label === gName);
    if (!g) { g = { label: gName, optionen: [] }; gruppen.push(g); }
    g.optionen.push({ value: t.key, text: t.b });
  }
  return baueAuswahl({ platzhalter, gruppen, frei: null, onAdd: (key) => onAdd(komponentenTyp(typen, key)) });
}

function scrolleZuLetzter(selector) {
  const karten = document.querySelectorAll(selector);
  if (karten.length) karten[karten.length - 1].scrollIntoView({ block: "center", behavior: "smooth" });
}

/* ---------- Produkt-Auswahl (v12, seit v15 aus der zentralen Materialdatenbank) ----------
   produkteDerKategorie(), baueProduktFormular() stehen in datenbank.js. */

/* Dropdown für Typ/Abdeckung aus der Produktliste.
   wert = aktueller Name (Freitext erlaubt), leerText = Text für „nichts gewählt“.
   onChange({ name, nr, produktId }) */
function baueProduktAuswahl({ kat, wert, leerText, label, onChange }) {
  const wrap = document.createElement("div");
  wrap.className = "produkt-auswahl";
  if (label) {
    const l = document.createElement("div");
    l.className = "rollo-bedienung-label";
    l.textContent = label;
    wrap.appendChild(l);
  }
  const select = document.createElement("select");
  wrap.appendChild(select);
  const freiZeile = document.createElement("div");
  freiZeile.className = "inline-add";
  freiZeile.hidden = true;
  freiZeile.innerHTML = `<input type="text" placeholder="Freitext"><button type="button" class="btn btn-secondary">OK</button>`;
  wrap.appendChild(freiZeile);
  const formPlatz = document.createElement("div");
  wrap.appendChild(formPlatz);
  let aktuell = wert || "";

  const fuelle = () => {
    select.innerHTML = "";
    const add = (value, text) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      select.appendChild(o);
    };
    add("", leerText);
    const liste = produkteDerKategorie(kat);
    let gewaehlt = "";
    let ziel = select;
    const gruppe = (label) => { const g = document.createElement("optgroup"); g.label = label; select.appendChild(g); return g; };
    const ordnerListe = liste.filter((p) => p.ordner);
    if (ordnerListe.length) ziel = gruppe("📁 " + ordnerName(ordnerListe[0].ordner));
    for (const p of liste) {
      if (ordnerListe.length && !p.ordner && ziel.label && ziel.label.startsWith("📁")) ziel = gruppe("Allgemein");
      const o = document.createElement("option");
      o.value = "p:" + p.id;
      o.textContent = istKombi(p) ? `${p.name} (Kombination)` : p.name + (p.nr ? ` · ${p.nr}` : "");
      ziel.appendChild(o);
      if (aktuell && p.name === aktuell && !gewaehlt) gewaehlt = "p:" + p.id;
    }
    if (aktuell && !gewaehlt) { add("x:", aktuell + " (Freitext)"); gewaehlt = "x:"; }
    add("__frei__", "✎ Freitext eingeben…");
    add("__neu__", "＋ Neues Produkt anlegen (Liste / EAN-Scan)…");
    if (KOMBI_KATEGORIEN.includes("sys:" + kat)) add("__kombi__", "＋ Kombination anlegen (z. B. Gehäuse + Leuchtmittel)…");
    select.value = gewaehlt;
  };
  const setze = (name, nr, produktId) => {
    aktuell = name || "";
    onChange({ name: aktuell, nr: nr || "", produktId: produktId || "" });
    fuelle();
  };
  fuelle();

  select.addEventListener("change", () => {
    const v = select.value;
    freiZeile.hidden = true;
    formPlatz.innerHTML = "";
    if (v === "") setze("", "", "");
    else if (v.startsWith("p:")) {
      const p = dbMaterial.find((x) => x.id === v.slice(2));
      if (p) setze(p.name, p.nr, p.id);
    } else if (v === "__frei__") {
      freiZeile.hidden = false;
      const inp = freiZeile.querySelector("input");
      inp.value = aktuell;
      inp.focus();
      fuelle();
      select.value = "__frei__";
    } else if (v === "__neu__") {
      formPlatz.appendChild(baueProduktFormular({
        kat,
        onSave: (p) => { formPlatz.innerHTML = ""; setze(p.name, p.nr, p.id); },
        onCancel: () => { formPlatz.innerHTML = ""; fuelle(); }
      }));
    } else if (v === "__kombi__") {
      formPlatz.appendChild(baueKombiFormular({
        katId: "sys:" + kat,
        ordner: aktiverOrdnerId(),
        onSave: (p) => { formPlatz.innerHTML = ""; setze(p.name, p.nr, p.id); },
        onCancel: () => { formPlatz.innerHTML = ""; fuelle(); }
      }));
    }
  });
  const freiOk = () => {
    const t = freiZeile.querySelector("input").value.trim();
    freiZeile.hidden = true;
    setze(t, "", "");
  };
  freiZeile.querySelector("button").addEventListener("click", freiOk);
  freiZeile.querySelector("input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); freiOk(); } });
  return wrap;
}

/* Aufmaßsoftware: nach dem Senden anbieten, den Baustellen-Ordner aufzuräumen
   (nur wenn kein anderes, noch nicht gesendetes Bauaufmaß/Aufmaß ihn benutzt). */
function frageOrdnerAufraeumen(b) {
  const id = b.ordner;
  if (!id || !dbOrdner.some((o) => o.id === id)) return;
  const andere = bauaufmasse.some((x) => x.id !== b.id && x.ordner === id && !x.gesendet) ||
    (typeof aufmassListe !== "undefined" && aufmassListe.some((x) => x.ordner === id && !x.gesendet));
  if (andere) return;
  const n = materialImOrdner(id).length;
  if (!confirm(`Bauaufmaß gesendet.\n\nBaustellen-Ordner „${ordnerName(id)}“${n ? ` mit ${n} Einträgen` : ""} jetzt löschen?\n\nDas Aufmaß behält alle Einträge (auch die Teile von Kombinationen).`)) return;
  // Kombinations-Teile sicherheitshalber im Aufmaß festhalten
  b.etagen.forEach((e) => e.raeume.forEach((r) => (r.schaltungen || []).forEach((sch) => { if (sch.strahler > 0) strahlerTeile(sch, b); })));
  loescheOrdner(id);
  b.ordner = "";
  speichereBauaufmasse();
  if (currentBauaufmass === b) renderOrdnerAuswahl(b, "b_ordner");
}

// Leertext der Typ-Auswahl im Raum: zeigt den Standard des Bauaufmaßes
function stdText(kat, label) {
  const std = bauStandard(currentBauaufmass, kat);
  return std ? `Standard: ${std.name}` : `${label}: – offen –`;
}

/* Aufmaßsoftware: Standard-Typen einmal je Bauaufmaß festlegen */
const BAU_STANDARD_KATS = [
  { kat: "strahler", label: "Standard-Strahler (auch Kombination)" },
  { kat: "ledstripe", label: "Standard-LED-Stripe" },
  { kat: "lednetzteil", label: "Standard-LED-Netzteil" },
  { kat: "praesenz", label: "Standard-Präsenzmelder" },
  { kat: "bewegung", label: "Standard-Bewegungsmelder" }
];

function renderStandardTypen(b) {
  const platz = document.getElementById("b_standards");
  if (!platz) return;
  platz.innerHTML = "";
  if (!b.standards || typeof b.standards !== "object") b.standards = {};
  for (const { kat, label } of BAU_STANDARD_KATS) {
    const x = b.standards[kat] || {};
    platz.appendChild(baueProduktAuswahl({
      kat, wert: x.name || "", label, leerText: "– kein Standard –",
      onChange: ({ name, nr, produktId }) => {
        if (!name) delete b.standards[kat];
        else {
          const neu = { name, nr: nr || "", id: produktId || "" };
          const k = kat === "strahler" && typeof findeKombi === "function" ? findeKombi("sys:strahler", name, produktId) : null;
          if (k) neu.teile = k.teile.map((t) => ({ ...t }));
          b.standards[kat] = neu;
        }
        autosave();
      }
    }));
  }
  const h = document.createElement("p");
  h.className = "hint";
  h.textContent = "Gilt in allen Räumen, in denen kein eigener Typ gewählt ist – du wählst nur noch Abweichungen.";
  platz.appendChild(h);
}

/* ---------- Baustellen-Ordner im Bauaufmaß (v19) / Aufmaß (Aufmaßsoftware) ----------
   obj = Bauaufmaß oder Aufmaß (beide mit kunde/baustelle/ordner).
   nachAenderung: Aufrufer zeichnet abhängige Teile neu. */
function renderOrdnerAuswahl(obj, platzId, nachAenderung) {
  const platz = document.getElementById(platzId || "b_ordner");
  if (!platz) return;
  const istBau = !platzId || platzId === "b_ordner";
  const neuZeichnen = () => {
    renderOrdnerAuswahl(obj, platzId, nachAenderung);
    if (istBau) renderStandardTypen(obj);
    if (nachAenderung) nachAenderung();
  };
  platz.innerHTML = "";
  if (obj.ordner && !dbOrdner.some((o) => o.id === obj.ordner)) obj.ordner = ""; // Ordner wurde gelöscht
  const select = document.createElement("select");
  const add = (value, text) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    select.appendChild(o);
  };
  add("", "– kein Baustellen-Ordner –");
  for (const o of dbOrdner.slice().sort((x, y) => x.name.localeCompare(y.name, "de"))) {
    add(o.id, `📁 ${o.name} (${materialImOrdner(o.id).length} Einträge)`);
  }
  add("__neu__", "＋ Neuen Baustellen-Ordner anlegen…");
  select.value = obj.ordner || "";
  select.addEventListener("change", () => {
    if (select.value === "__neu__") {
      const vorschlag = (obj.baustelle || "").trim() || ((obj.kunde && obj.kunde.name) || "").trim();
      const n = prompt("Name des Baustellen-Ordners:", vorschlag);
      const o = n && legeOrdnerAn(n);
      obj.ordner = o ? o.id : obj.ordner || "";
    } else obj.ordner = select.value;
    autosave();
    neuZeichnen();
  });
  platz.appendChild(select);
  // Vorschlag: gleicher Kunde / gleiche Baustelle wie ein (Bau-)Aufmaß mit Ordner
  if (!obj.ordner) {
    const vorschlag = ordnerVorschlag(obj);
    if (vorschlag) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip ordner-vorschlag";
      b.textContent = `📁 ${ordnerName(vorschlag)} verwenden? (gleiche Baustelle)`;
      b.addEventListener("click", () => { obj.ordner = vorschlag; autosave(); neuZeichnen(); });
      platz.appendChild(b);
    }
  }
  const hinweis = document.createElement("p");
  hinweis.className = "hint";
  hinweis.textContent = obj.ordner
    ? `Material aus „${ordnerName(obj.ordner)}“ steht bei der Materialsuche${istBau ? " und in allen Auswahlen (Strahler, LED-Stripes …)" : ""} ganz oben. Neu hinzugefügtes Material aus dem Katalog landet automatisch in diesem Ordner.`
    : "Für Material, das nur auf dieser Baustelle gebraucht wird. Es taucht dann nur hier auf und lässt sich nach der Baustelle samt Ordner löschen.";
  platz.appendChild(hinweis);
}

function ordnerVorschlag(obj) {
  const norm = (x) => String(x || "").trim().toLowerCase();
  const bs = norm(obj.baustelle), kd = norm(obj.kunde && obj.kunde.name);
  if (!bs && !kd) return "";
  const alle = [...(bauaufmasse || []), ...((typeof aufmassListe !== "undefined" && aufmassListe) || [])];
  for (const x of alle) {
    if (x === obj || x.id === obj.id || !x.ordner || !dbOrdner.some((o) => o.id === x.ordner)) continue;
    if ((bs && norm(x.baustelle) === bs) || (kd && norm(x.kunde && x.kunde.name) === kd)) return x.ordner;
  }
  // Ordnername entspricht Baustelle oder Kunde
  const o = dbOrdner.find((o) => norm(o.name) === bs || norm(o.name) === kd);
  return o ? o.id : "";
}

/* ---------- Abdeckungen (v12) ----------
   Bauaufmaß: Standard-Abdeckung; Raum: abweichende Abdeckung; Position
   (Schaltung, Rollo, Zähler über „abw“-Einträge): eigene Abdeckung. */

function raumAbdeckung(b, raum) {
  return ((raum && raum.abdeckung) || "").trim() || ((b.abdeckung && b.abdeckung.standard) || "").trim();
}

function positionsAbdeckung(b, raum, eigene) {
  return (eigene || "").trim() || raumAbdeckung(b, raum);
}

function mitAbdeckung(bez, abd) {
  return abd ? `${bez} · ${abd}` : bez;
}

function abdeckungsPositionen(b) {
  const liste = [];
  for (const g of BAU_POSITIONEN_GRUPPEN) {
    if (g.nurMitRahmen && !(b.abdeckung && b.abdeckung.rahmen)) continue;
    for (const p of g.positionen) if (p.abd) liste.push({ ...p, gruppe: g.id });
  }
  return liste;
}

function positionNachKey(key) {
  for (const g of BAU_POSITIONEN_GRUPPEN) {
    const p = g.positionen.find((x) => x.key === key);
    if (p) return { ...p, gruppe: g.id };
  }
  return { key, b: key, gruppe: "" };
}

/* ---------- Übersicht (Bereich in zeigeUebersicht) ---------- */

function renderBauaufmassUebersicht() {
  const btn = document.getElementById("btnNewBauaufmass");
  if (!btn) return;
  btn.addEventListener("click", () => oeffneBauaufmass(neuesBauaufmass()));
  const listeEl = document.getElementById("bauaufmassListe");
  const leerEl = document.getElementById("bauaufmasseLeer");
  leerEl.hidden = bauaufmasse.length !== 0;
  const sortiert = [...bauaufmasse].sort((a, b) => (b.geaendert || "").localeCompare(a.geaendert || ""));
  for (const b of sortiert) {
    const li = document.createElement("li");
    li.className = "aufmass-card";
    const nRaeume = b.etagen.reduce((s, e) => s + e.raeume.length, 0);
    const nV = (b.verteilungen || []).length;
    const kundeName = b.kunde.name.trim() || "(ohne Kundenname)";
    const beschreibung = b.arbeitsbeschreibung.trim();
    li.innerHTML = `
      <div class="info">
        <p class="kunde">${escapeHtml(kundeName)}</p>
        <p class="meta">${formatDatumDE(erstelltDatumISO(b))} · ${b.etagen.length} Etage${b.etagen.length === 1 ? "" : "n"}, ${nRaeume} Raum${nRaeume === 1 ? "" : "e"}${nV ? `, ${nV} Verteilung${nV === 1 ? "" : "en"}` : ""}${beschreibung ? " · " + escapeHtml(beschreibung) : ""}</p>
      </div>
      <span class="chevron">›</span>`;
    li.addEventListener("click", () => oeffneBauaufmass(b));
    listeEl.appendChild(li);
  }
}

/* ---------- Bauaufmaß-Ansicht ---------- */

function oeffneBauaufmass(b, scrollY) {
  setzeAnsicht("detail");
  aktuellerBereich = "bau";
  migriereBauaufmass(b);
  currentBauaufmass = b;
  currentRaum = null;
  currentMaterialHalter = null;
  currentAufmass = null;
  currentPackliste = null;
  zurueckAktion = null;
  headerTitle.textContent = "Bauaufmaß";
  btnBack.hidden = false;
  btnNew.hidden = true;

  const tpl = document.getElementById("tpl-bauaufmass");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));

  const felder = [
    ["b_kundeName", () => b.kunde.name, (v) => (b.kunde.name = v)],
    ["b_ansprechpartner", () => b.kunde.ansprechpartner, (v) => (b.kunde.ansprechpartner = v)],
    ["b_strasse", () => b.kunde.strasse, (v) => (b.kunde.strasse = v)],
    ["b_plzOrt", () => b.kunde.plzOrt, (v) => (b.kunde.plzOrt = v)],
    ["b_telefon", () => b.kunde.telefon, (v) => (b.kunde.telefon = v)],
    ["b_baustelle", () => b.baustelle, (v) => (b.baustelle = v)],
    ["b_arbeitsbeschreibung", () => b.arbeitsbeschreibung, (v) => (b.arbeitsbeschreibung = v)]
  ];
  for (const [id, getter, setter] of felder) {
    const el = document.getElementById(id);
    el.value = getter();
    el.addEventListener("input", (e) => { setter(e.target.value); autosave(); });
  }
  if (typeof bindeKundenstamm === "function") {
    bindeKundenstamm({ name: "b_kundeName", ansprechpartner: "b_ansprechpartner", strasse: "b_strasse", plzOrt: "b_plzOrt", telefon: "b_telefon" }, b.kunde);
  }
  // Baustellen-Ordner (v19) + Standard-Typen
  renderOrdnerAuswahl(b, "b_ordner");
  renderStandardTypen(b);
  // Installationsart (v18)
  const abdPlatz = document.getElementById("b_abdeckung");
  abdPlatz.appendChild(baueSegment("Installationsart (gilt für alle Räume, je Raum änderbar)", [{ key: "konventionell", b: "Konventionell" }, { key: "knx", b: "KNX" }],
    b.installation, (v) => { b.installation = v; autosave(); }));
  // Abdeckung / Rahmen (v12)
  abdPlatz.appendChild(baueProduktAuswahl({
    kat: "abdeckung", wert: b.abdeckung.standard, leerText: "– keine Angabe –", label: "Standard-Abdeckung / Schalterprogramm",
    onChange: ({ name }) => { b.abdeckung.standard = name; autosave(); }
  }));
  abdPlatz.appendChild(baueSegment("Rahmen zählen", [{ key: "nein", b: "Nein" }, { key: "ja", b: "Ja (1- bis 5-fach je Raum)" }],
    b.abdeckung.rahmen ? "ja" : "nein", (v) => { b.abdeckung.rahmen = v === "ja"; autosave(); }));

  document.getElementById("b_datumHinweis").textContent =
    `Datum im Export: ${formatDatumDE(erstelltDatumISO(b))} (Erstellungsdatum)`;

  // Etage hinzufügen (Dropdown)
  document.getElementById("b_etageAuswahl").appendChild(baueAuswahl({
    platzhalter: "＋ Etage hinzufügen…",
    gruppen: [{ optionen: BAU_ETAGEN_VORGABEN.map((n) => ({ value: n, text: n, disabled: b.etagen.some((e) => e.name === n) })) }],
    frei: { option: "Eigene Etage…", placeholder: "z. B. Anbau, Zwischengeschoss" },
    onAdd: (name) => fuegeEtageHinzu(name)
  }));

  renderEtagen();
  renderRaumVorlagenVerwaltung(b);
  renderVerteilungenListe();

  const bestehend = bauaufmasse.some((x) => x.id === b.id);
  const btnLoeschen = document.getElementById("btnBauLoeschen");
  btnLoeschen.hidden = !bestehend;
  btnLoeschen.addEventListener("click", () => {
    if (!confirm("Dieses Bauaufmaß wirklich löschen?")) return;
    bauaufmasse = bauaufmasse.filter((x) => x.id !== b.id);
    speichereBauaufmasse();
    verwerfeAktuellesOhneSpeichern();
    zeigeUebersicht();
  });
  document.getElementById("btnBauPdf").addEventListener("click", () => {
    if (typeof kundenstammErfassen === "function") kundenstammErfassen(b.kunde);
    autosaveBauaufmass();
    erstelleBauPdf(b);
  });
  baueGesendetStatus(b, document.getElementById("btnBauPdf"), () => {
    if (currentBauaufmass === b) autosaveBauaufmass();
    speichereBauaufmasse();
    if (b.gesendet) setTimeout(() => frageOrdnerAufraeumen(b), 100);
  });

  window.scrollTo(0, scrollY || 0);
}

function etagenRang(name) {
  const i = BAU_ETAGEN_VORGABEN.indexOf(name);
  return i >= 0 ? i : 99;
}

function fuegeEtageHinzu(name) {
  const b = currentBauaufmass;
  if (b.etagen.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
    alert(`Etage „${name}“ ist bereits vorhanden.`);
    return;
  }
  const etage = { id: neueId(), name, raeume: [] };
  // Vorgabe-Etagen in sinnvoller Reihenfolge einsortieren (KG, EG, OG, ...),
  // eigene Bezeichnungen hinten anhängen.
  const rang = etagenRang(name);
  let pos = b.etagen.length;
  if (rang < 99) {
    const idx = b.etagen.findIndex((e) => etagenRang(e.name) > rang);
    if (idx >= 0) pos = idx;
  }
  b.etagen.splice(pos, 0, etage);
  autosave();
  oeffneBauaufmass(b, window.scrollY);
  const karte = document.querySelector(`[data-etage-id="${etage.id}"]`);
  if (karte) karte.scrollIntoView({ block: "start", behavior: "smooth" });
}

function eindeutigerRaumname(etage, name) {
  if (!etage.raeume.some((r) => r.name === name)) return name;
  let n = 2;
  while (etage.raeume.some((r) => r.name === `${name} ${n}`)) n++;
  return `${name} ${n}`;
}

// "Kind 1" -> "Kind 2" (nächste freie Nummer), "Bad" -> "Bad 2"
/* Aufmaßsoftware: Raum als tiefe Kopie mit neuen Ids (für „Raum kopieren“, „wie vorheriger Raum“, Vorlagen) */
function kopiereRaumDaten(raum, name) {
  const kopie = JSON.parse(JSON.stringify(raum));
  kopie.id = neueId();
  kopie.name = name;
  for (const feld of ["schaltungen", "rollos", "knx", "melder", "abw", "material"]) (kopie[feld] || []).forEach((x) => (x.id = neueId()));
  (kopie.schaltungen || []).forEach((sch) => (sch.stripes || []).forEach((x) => (x.id = neueId())));
  return kopie;
}

/* ---------- Raumvorlagen (Aufmaßsoftware) ----------
   [{ id, name, raum }] – synchronisiert; im Bauaufmaß beim „＋ Raum hinzufügen…“ wählbar. */
const STORAGE_KEY_RAUMVORLAGEN = "am2_raumvorlagen";
let raumVorlagen = [];

function ladeRaumVorlagen() {
  try { raumVorlagen = JSON.parse(localStorage.getItem(STORAGE_KEY_RAUMVORLAGEN) || "[]") || []; } catch (e) { raumVorlagen = []; }
}
ladeRaumVorlagen();

function speichereRaumVorlagen() {
  try { localStorage.setItem(STORAGE_KEY_RAUMVORLAGEN, JSON.stringify(raumVorlagen)); } catch (e) { console.error(e); }
}

function speichereAlsVorlage(raum) {
  const name = (prompt("Name der Raumvorlage (z. B. „Schlafzimmer Standard“):", raum.name || "") || "").trim();
  if (!name) return;
  const daten = kopiereRaumDaten(raum, name);
  delete daten.installation; // Installationsart kommt vom Bauaufmaß
  const vorhanden = raumVorlagen.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (vorhanden) {
    if (!confirm(`Vorlage „${vorhanden.name}“ überschreiben?`)) return;
    vorhanden.raum = daten;
  } else raumVorlagen.push({ id: neueId(), name, raum: daten });
  speichereRaumVorlagen();
  alert(`✓ Vorlage „${name}“ gespeichert – beim Hinzufügen eines Raums unter „Vorlagen“ wählbar.`);
}

function baueRaumSchnellleiste() {
  const platz = document.getElementById("r_schnell");
  if (!platz) return;
  const springe = (el, aktion) => {
    if (!el) return;
    const det = el.closest("details");
    if (det) det.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (aktion) setTimeout(aktion, 350);
  };
  const knopf = (text, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = text;
    b.addEventListener("click", fn);
    platz.appendChild(b);
  };
  knopf("💡 Licht", () => springe(document.querySelector("#r_schaltungAuswahl select"), () => { const s = document.querySelector("#r_schaltungAuswahl select"); if (s) s.focus(); }));
  knopf("↕ Rollo", () => springe(document.getElementById("r_rolloHinzufuegen")));
  knopf("🔌 Installation", () => springe(document.querySelector("#r_gruppen details")));
  knopf("👁 Melder/KNX", () => springe(document.getElementById("r_melderAuswahl")));
  knopf("📦 Material", () => springe(document.getElementById("ms_suche"), () => { const s = document.getElementById("ms_suche"); if (s) s.focus(); }));
}

function renderRaumVorlagenVerwaltung(b) {
  const anker = document.getElementById("b_etageAuswahl");
  if (!anker) return;
  const alt = document.getElementById("b_vorlagen");
  if (alt) alt.remove();
  if (!raumVorlagen.length) return;
  const det = document.createElement("details");
  det.id = "b_vorlagen";
  det.className = "vorlagen-verwaltung";
  det.innerHTML = `<summary>📋 Raumvorlagen (${raumVorlagen.length})</summary><ul class="pl-eintraege"></ul>`;
  const ul = det.querySelector("ul");
  for (const v of raumVorlagen.slice().sort((x, y) => x.name.localeCompare(y.name, "de"))) {
    const li = document.createElement("li");
    li.className = "pl-eintrag";
    li.innerHTML = `<div class="info"><strong></strong><small></small></div><span class="komp-aktionen"><button type="button" class="btn-mini btn-mini-danger" aria-label="Vorlage löschen">✕</button></span>`;
    li.querySelector("strong").textContent = v.name;
    li.querySelector("small").textContent = raumZusammenfassung(v.raum) || "leer";
    li.querySelector("button").addEventListener("click", () => {
      if (!confirm(`Vorlage „${v.name}“ löschen?`)) return;
      raumVorlagen = raumVorlagen.filter((x) => x.id !== v.id);
      speichereRaumVorlagen();
      renderRaumVorlagenVerwaltung(b);
    });
    ul.appendChild(li);
  }
  anker.after(det);
}

function kopieRaumname(etage, name) {
  const m = name.match(/^(.*?)\s*(\d+)$/);
  const basis = m ? m[1] : name;
  let n = m ? parseInt(m[2], 10) + 1 : 2;
  while (etage.raeume.some((r) => r.name === `${basis} ${n}`)) n++;
  return `${basis} ${n}`;
}

function renderEtagen() {
  const b = currentBauaufmass;
  const container = document.getElementById("b_etagen");
  const leer = document.getElementById("b_etagenLeer");
  container.innerHTML = "";
  leer.hidden = b.etagen.length !== 0;

  b.etagen.forEach((etage, etageIdx) => {
    const karte = document.createElement("div");
    karte.className = "etage-karte";
    karte.dataset.etageId = etage.id;
    karte.innerHTML = `
      <div class="etage-kopf">
        <strong class="etage-name"></strong>
        <div class="etage-aktionen">
          <button type="button" class="btn-mini" data-a="hoch" aria-label="Nach oben" ${etageIdx === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn-mini" data-a="runter" aria-label="Nach unten" ${etageIdx === b.etagen.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="btn-mini" data-a="umbenennen" aria-label="Umbenennen">✎</button>
          <button type="button" class="btn-mini btn-mini-danger" data-a="loeschen" aria-label="Etage löschen">✕</button>
        </div>
      </div>
      <ul class="raum-liste"></ul>
      <div class="raum-add"></div>`;
    karte.querySelector(".etage-name").textContent = etage.name;

    karte.querySelector('[data-a="hoch"]').addEventListener("click", () => verschiebeEtage(etageIdx, -1));
    karte.querySelector('[data-a="runter"]').addEventListener("click", () => verschiebeEtage(etageIdx, 1));
    karte.querySelector('[data-a="umbenennen"]').addEventListener("click", () => {
      const neu = prompt("Etage umbenennen:", etage.name);
      if (neu && neu.trim()) {
        etage.name = neu.trim();
        autosave();
        oeffneBauaufmass(b, window.scrollY);
      }
    });
    karte.querySelector('[data-a="loeschen"]').addEventListener("click", () => {
      const hinweis = etage.raeume.length ? ` inkl. ${etage.raeume.length} Raum/Räume` : "";
      if (!confirm(`Etage „${etage.name}“${hinweis} wirklich löschen?`)) return;
      b.etagen = b.etagen.filter((e) => e.id !== etage.id);
      autosave();
      oeffneBauaufmass(b, window.scrollY);
    });

    const raumListe = karte.querySelector(".raum-liste");
    if (etage.raeume.length === 0) {
      const li = document.createElement("li");
      li.className = "hint raum-leer";
      li.textContent = "Noch keine Räume.";
      raumListe.appendChild(li);
    }
    for (const raum of etage.raeume) {
      const li = document.createElement("li");
      li.className = "raum-karte";
      li.innerHTML = `<div class="info"><p class="kunde"></p><p class="meta"></p></div><span class="chevron">›</span>`;
      li.querySelector(".kunde").textContent = raum.name;
      li.querySelector(".meta").textContent = raumZusammenfassung(raum);
      li.addEventListener("click", () => oeffneRaum(etage, raum));
      raumListe.appendChild(li);
    }

    const opt = (name) => {
      const benutzt = etage.raeume.some((r) => r.name === name);
      return { value: name, text: benutzt ? `${name} ✓` : name };
    };
    const gruppen = [];
    const letzter = etage.raeume[etage.raeume.length - 1];
    const schnell = [];
    if (letzter) schnell.push({ value: "__wie:" + letzter.id, text: `＝ wie „${letzter.name}“ (Kopie)` });
    if (schnell.length) gruppen.push({ label: "Schnell", optionen: schnell });
    if (raumVorlagen.length) gruppen.push({ label: "📋 Vorlagen", optionen: raumVorlagen.slice().sort((x, y) => x.name.localeCompare(y.name, "de")).map((v) => ({ value: "__vorlage:" + v.id, text: "📋 " + v.name })) });
    gruppen.push({ label: "Räume", optionen: BAU_RAUM_VORSCHLAEGE.map(opt) }, { label: "Weitere Vorschläge", optionen: BAU_RAUM_VORSCHLAEGE_WEITERE.map(opt) });
    karte.querySelector(".raum-add").appendChild(baueAuswahl({
      platzhalter: "＋ Raum hinzufügen…",
      gruppen,
      frei: { option: "Eigener Raumname…", placeholder: "Eigener Raumname" },
      onAdd: (wahl) => {
        let neu;
        if (wahl.startsWith("__wie:")) {
          const quelle = etage.raeume.find((r) => r.id === wahl.slice(6));
          if (!quelle) return;
          neu = kopiereRaumDaten(quelle, kopieRaumname(etage, quelle.name || "Raum"));
        } else if (wahl.startsWith("__vorlage:")) {
          const v = raumVorlagen.find((x) => x.id === wahl.slice(10));
          if (!v) return;
          neu = kopiereRaumDaten(v.raum, eindeutigerRaumname(etage, v.name));
        } else neu = neuerRaum(eindeutigerRaumname(etage, wahl));
        etage.raeume.push(neu);
        autosave();
        if (wahl.startsWith("__")) oeffneRaum(etage, neu); // Kopie/Vorlage direkt öffnen und anpassen
        else oeffneBauaufmass(b, window.scrollY);
      }
    }));

    container.appendChild(karte);
  });
}

function verschiebeEtage(idx, richtung) {
  const b = currentBauaufmass;
  const ziel = idx + richtung;
  if (ziel < 0 || ziel >= b.etagen.length) return;
  [b.etagen[idx], b.etagen[ziel]] = [b.etagen[ziel], b.etagen[idx]];
  autosave();
  oeffneBauaufmass(b, window.scrollY);
}

/* ---------- Verteilungen (Liste im Bauaufmaß) ---------- */

function renderVerteilungenListe() {
  const b = currentBauaufmass;
  const listeEl = document.getElementById("b_verteilungen");
  document.getElementById("b_verteilungenLeer").hidden = b.verteilungen.length !== 0;
  listeEl.innerHTML = "";
  for (const v of b.verteilungen) {
    const li = document.createElement("li");
    li.className = "raum-karte";
    li.innerHTML = `<div class="info"><p class="kunde"></p><p class="meta"></p></div><span class="chevron">›</span>`;
    li.querySelector(".kunde").textContent = v.name || "Verteilung";
    li.querySelector(".meta").textContent = verteilungZusammenfassung(v);
    li.addEventListener("click", () => oeffneVerteilung(v));
    listeEl.appendChild(li);
  }
  document.getElementById("b_verteilungAuswahl").appendChild(baueAuswahl({
    platzhalter: "＋ Verteilung hinzufügen…",
    gruppen: [{ optionen: BAU_VERTEILUNG_VORSCHLAEGE.map((n) => ({ value: n, text: n })) }],
    frei: { option: "Eigene Bezeichnung…", placeholder: "z. B. UV Werkstatt" },
    onAdd: (name) => {
      let n = name, i = 2;
      while (b.verteilungen.some((v) => v.name === n)) n = `${name} ${i++}`;
      const v = neueVerteilung(n);
      b.verteilungen.push(v);
      autosave();
      bauScrollPosition = window.scrollY;
      oeffneVerteilung(v);
    }
  }));
}

/* ---------- Raum-Ansicht ---------- */

function oeffneRaum(etage, raum) {
  setzeAnsicht("detail");
  bauScrollPosition = window.scrollY;
  currentRaum = { etage, raum };
  currentMaterialHalter = raum;
  selectedArtikel = null;
  selectedStandardArtikel = null;
  selectedFavoritArtikel = null;
  migriereRaum(raum);
  const b = currentBauaufmass;
  zurueckAktion = () => oeffneBauaufmass(b, bauScrollPosition);
  headerTitle.textContent = `${etage.name} · ${raum.name}`;
  btnBack.hidden = false;
  btnNew.hidden = true;

  const tpl = document.getElementById("tpl-raum");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  window.scrollTo(0, 0);

  // Name
  const nameInput = document.getElementById("r_name");
  nameInput.value = raum.name;
  nameInput.addEventListener("input", () => {
    raum.name = nameInput.value;
    headerTitle.textContent = `${etage.name} · ${raum.name || "Raum"}`;
    autosave();
  });
  document.getElementById("r_etage").textContent = etage.name;

  // Abdeckung des Raums (v12)
  const std = (b.abdeckung.standard || "").trim();
  document.getElementById("r_abdeckung").appendChild(baueProduktAuswahl({
    kat: "abdeckung", wert: raum.abdeckung, label: "Abdeckung in diesem Raum",
    leerText: `Standard des Bauaufmaßes (${std || "keine Angabe"})`,
    onChange: ({ name }) => { raum.abdeckung = name; autosave(); renderSchaltungen(); renderRollos(); renderAbw(); }
  }));

  // Installationsart des Raums (v18)
  const knxRaum = istKnxRaum(b, raum);
  const instPlatz = document.createElement("div");
  instPlatz.className = "raum-installation";
  instPlatz.appendChild(baueSegment("Installation in diesem Raum", [
    { key: "", b: `Wie Bau (${b.installation === "knx" ? "KNX" : "konv."})` },
    { key: "konventionell", b: "Konventionell" },
    { key: "knx", b: "KNX" }
  ], raum.installation || "", (v) => {
    raum.installation = v;
    autosave();
    const y = window.scrollY;
    oeffneRaum(etage, raum);
    window.scrollTo(0, y);
  }));
  document.getElementById("r_abdeckung").before(instPlatz);

  // Schnellleiste (Aufmaßsoftware): direkt zu den Bereichen springen
  baueRaumSchnellleiste();
  // Diktat (v17)
  const diktatPlatz = document.getElementById("r_diktat");
  if (diktatPlatz && typeof baueDiktatKarte === "function") diktatPlatz.appendChild(baueDiktatKarte(etage, raum));

  // Beleuchtung
  renderSchaltungen();
  // In KNX-Räumen nur KNX-Schaltungen (direkt mit Art wählbar)
  const schaltOptionen = knxRaum
    ? BAU_KNX_STROMKREISE.map((t) => ({ value: t.key, text: t.b }))
    : BAU_SCHALTUNGSTYPEN.filter((t) => !t.knx).map((t) => ({ value: t.key, text: t.b }));
  document.getElementById("r_schaltungAuswahl").appendChild(baueAuswahl({
    platzhalter: knxRaum ? "＋ Stromkreis hinzufügen…" : "＋ Schaltung hinzufügen…",
    gruppen: [{ optionen: schaltOptionen }],
    frei: null,
    onAdd: (wahl) => {
      const t = schaltungTyp(wahl);
      const s = { id: neueId(), typ: t.key, schaltstellen: t.min, wand: 0, decke: 0, steckdose: 0, strahler: 0, bemerkung: "" };
      if (t.melder) Object.assign(s, { melderArt: "praesenz", melderAnzahl: 1, melderTyp: "", melderNr: "" });
      s.stripes = [];
      raum.schaltungen.push(s);
      autosave();
      renderSchaltungen();
      scrolleZuLetzter(".schaltung-karte.licht-karte");
    }
  }));

  // Rollos (Bereich nur offen, wenn schon Rollos erfasst sind)
  renderRollos();
  const rd = document.getElementById("r_rolloDetails");
  if (rd) rd.open = raum.rollos.length > 0;
  document.getElementById("r_rolloHinzufuegen").addEventListener("click", () => {
    raum.rollos.push(neuesRollo());
    autosave();
    renderRollos();
    scrolleZuLetzter(".rollo-karte");
  });

  // KNX
  const renderKnx = () => {
    renderKomponentenListe(document.getElementById("r_knx"), raum, "knx", KNX_TYPEN, aktualisiereKnxTitel);
    aktualisiereKnxTitel();
  };
  const aktualisiereKnxTitel = () => {
    document.getElementById("r_anzahlKnx").textContent = raum.knx.reduce((s, k) => s + (k.anzahl || 0), 0);
    document.getElementById("r_knxLeer").hidden = raum.knx.length !== 0;
  };
  renderKnx();
  const knxDetails = document.getElementById("r_knxDetails");
  knxDetails.open = raum.knx.length > 0;
  document.getElementById("r_knxAuswahl").appendChild(komponentenAuswahl(KNX_TYPEN, "＋ KNX-Komponente hinzufügen…", (typ) => {
    raum.knx.push(neueKomponente(typ));
    autosave();
    renderKnx();
    scrolleZuLetzter("#r_knx .komp-karte");
  }));

  // Melder (konventionell, v12 mit Produktauswahl)
  const renderMelder = () => {
    renderKomponentenListe(document.getElementById("r_melder"), raum, "melder", MELDER_TYPEN, aktualisiereMelderTitel);
    aktualisiereMelderTitel();
  };
  const aktualisiereMelderTitel = () => {
    document.getElementById("r_anzahlMelder").textContent = raum.melder.reduce((s, k) => s + (k.anzahl || 0), 0);
    document.getElementById("r_melderLeer").hidden = raum.melder.length !== 0;
  };
  renderMelder();
  document.getElementById("r_melderDetails").open = raum.melder.length > 0;
  document.getElementById("r_melderAuswahl").appendChild(komponentenAuswahl(MELDER_TYPEN, "＋ Melder hinzufügen…", (typ) => {
    raum.melder.push(neueKomponente(typ));
    autosave();
    renderMelder();
    scrolleZuLetzter("#r_melder .komp-karte");
  }));

  // Zähler-Gruppen
  const gruppenEl = document.getElementById("r_gruppen");
  for (const g of BAU_POSITIONEN_GRUPPEN) {
    const summe = () => g.positionen.reduce((s, p) => s + (raum.positionen[p.key] || 0), 0);
    if (g.nurMitRahmen && !b.abdeckung.rahmen && summe() === 0) continue;
    const details = document.createElement("details");
    details.className = "section-card";
    details.open = g.immerOffen || summe() > 0 || (g.nurMitRahmen && b.abdeckung.rahmen);
    const summary = document.createElement("summary");
    const setzeTitel = () => {
      const s = summe();
      summary.textContent = g.titel + (s ? ` (${s})` : "");
    };
    setzeTitel();
    details.appendChild(summary);
    for (const p of g.positionen) {
      details.appendChild(baueZaehler(p.b, raum.positionen[p.key] || 0, 0, (v) => {
        if (v > 0) raum.positionen[p.key] = v;
        else delete raum.positionen[p.key];
        setzeTitel();
        autosave();
      }));
    }
    gruppenEl.appendChild(details);
  }

  // Positionen mit abweichender Abdeckung (v12)
  renderAbw();
  document.getElementById("r_abwDetails").open = raum.abw.length > 0;
  document.getElementById("r_abwHinzufuegen").addEventListener("click", () => {
    const erste = abdeckungsPositionen(b)[0];
    raum.abw.push({ id: neueId(), key: erste ? erste.key : "steckdose", abdeckung: "", anzahl: 1 });
    autosave();
    renderAbw();
    scrolleZuLetzter(".abw-karte");
  });

  // Material (Katalog / Standard / Freitext)
  klonMaterialTabs("materialHinzufuegenRaum");
  bindeMaterialAuswahl(raum.material, () => {
    renderRaumMaterial();
    autosave();
  });
  renderRaumMaterial();

  document.getElementById("btnRaumFertig").addEventListener("click", () => zurueckAktion());
  document.getElementById("btnRaumVorlage").addEventListener("click", () => speichereAlsVorlage(raum));
  document.getElementById("btnRaumKopieren").addEventListener("click", () => {
    const kopie = kopiereRaumDaten(raum, kopieRaumname(etage, raum.name || "Raum"));
    etage.raeume.splice(etage.raeume.indexOf(raum) + 1, 0, kopie);
    autosave();
    oeffneRaum(etage, kopie);
  });
  document.getElementById("btnRaumLoeschen").addEventListener("click", () => {
    if (!confirm(`Raum „${raum.name}“ wirklich löschen?`)) return;
    etage.raeume = etage.raeume.filter((r) => r.id !== raum.id);
    autosave();
    zurueckAktion();
  });
}

// Abdeckungs-Dropdown für eine einzelne Position (Schaltung, Rollo, abweichende Position)
function baueAbdeckungsAuswahl(obj, leerText) {
  const raumAbd = raumAbdeckung(currentBauaufmass, currentRaum.raum);
  return baueProduktAuswahl({
    kat: "abdeckung", wert: obj.abdeckung, label: "Abdeckung",
    leerText: leerText || `Wie Raum (${raumAbd || "keine Angabe"})`,
    onChange: ({ name }) => { obj.abdeckung = name; autosave(); }
  });
}

function renderAbw() {
  const { raum } = currentRaum;
  const b = currentBauaufmass;
  const liste = document.getElementById("r_abw");
  if (!liste) return;
  liste.innerHTML = "";
  document.getElementById("r_anzahlAbw").textContent = raum.abw.reduce((s, x) => s + (x.anzahl || 0), 0);
  document.getElementById("r_abwLeer").hidden = raum.abw.length !== 0;
  const positionen = abdeckungsPositionen(b);
  raum.abw.forEach((e, i) => {
    const karte = document.createElement("div");
    karte.className = "schaltung-karte abw-karte";
    karte.innerHTML = `
      <div class="schaltung-kopf">
        <strong>${i + 1}. Abweichende Abdeckung</strong>
        <button type="button" class="btn-danger-text" aria-label="Entfernen">✕</button>
      </div>`;
    karte.querySelector(".btn-danger-text").addEventListener("click", () => {
      raum.abw = raum.abw.filter((x) => x.id !== e.id);
      autosave();
      renderAbw();
    });
    const optionen = positionen.map((p) => p.b);
    const aktuell = positionNachKey(e.key).b;
    karte.appendChild(baueSelectFeld("Position", optionen, aktuell, (v) => {
      const p = positionen.find((x) => x.b === v);
      if (p) { e.key = p.key; autosave(); }
    }));
    karte.appendChild(baueAbdeckungsAuswahl(e, "– Abdeckung wählen –"));
    karte.appendChild(baueZaehler("Anzahl", e.anzahl || 1, 1, (v) => {
      e.anzahl = v;
      document.getElementById("r_anzahlAbw").textContent = raum.abw.reduce((s, x) => s + (x.anzahl || 0), 0);
      autosave();
    }));
    liste.appendChild(karte);
  });
}

function renderSchaltungen() {
  const { raum } = currentRaum;
  const liste = document.getElementById("r_schaltungen");
  const anzahl = document.getElementById("r_anzahlSchaltungen");
  liste.innerHTML = "";
  anzahl.textContent = raum.schaltungen.length;
  const knxR = istKnxRaum(currentBauaufmass, raum);
  const titel = document.getElementById("r_schaltTitel");
  if (titel) titel.textContent = knxR ? "Stromkreise (KNX)" : "Beleuchtung";
  const leer = document.getElementById("r_schaltungenLeer");
  leer.hidden = raum.schaltungen.length !== 0;
  leer.textContent = knxR ? "Noch kein Stromkreis – unten Stromkreis wählen." : "Noch keine Schaltung – unten Schaltungsart wählen.";

  raum.schaltungen.forEach((s, i) => {
    const t = schaltungTyp(s.typ);
    const karte = document.createElement("div");
    karte.className = "schaltung-karte licht-karte";
    karte.innerHTML = `
      <div class="schaltung-kopf">
        <strong>${i + 1}. ${escapeHtml(t.b)}</strong>
        <button type="button" class="btn-danger-text" aria-label="Schaltung entfernen">✕</button>
      </div>
      <div class="schaltung-zaehler"></div>`;
    karte.querySelector(".btn-danger-text").addEventListener("click", () => {
      if (!confirm(`${t.b} entfernen?`)) return;
      raum.schaltungen = raum.schaltungen.filter((x) => x.id !== s.id);
      autosave();
      renderSchaltungen();
    });
    const zaehler = karte.querySelector(".schaltung-zaehler");
    if (t.melder) {
      zaehler.appendChild(baueSegment("Melder", BAU_MELDERARTEN, s.melderArt || "praesenz", (v) => {
        if (s.melderArt !== v) { s.melderTyp = ""; s.melderNr = ""; }
        s.melderArt = v;
        autosave();
        renderSchaltungen(); // Typ-Auswahl passend zur Melderart neu aufbauen
      }));
      const za = baueZaehler(`Anzahl ${melderArt(s.melderArt).b}`, s.melderAnzahl || 1, 1, (v) => { s.melderAnzahl = v; autosave(); });
      za.classList.add("melder-anzahl");
      zaehler.appendChild(za);
      const mp = baueProduktAuswahl({
        kat: s.melderArt === "bewegung" ? "bewegung" : "praesenz", wert: s.melderTyp, label: "Typ Melder", leerText: stdText(s.melderArt === "bewegung" ? "bewegung" : "praesenz", "Typ Melder"),
        onChange: ({ name, nr }) => { s.melderTyp = name; s.melderNr = nr; autosave(); }
      });
      mp.classList.add("melder-typ");
      zaehler.appendChild(mp);
    } else if (t.knx && !t.stromkreis) {
      zaehler.appendChild(baueSegment("Art", BAU_KNX_LICHTARTEN, s.knxArt || "Schalten", (v) => { s.knxArt = v; autosave(); }));
    } else {
      const zs = baueZaehler(t.stellenLabel || "Schaltstellen", s.schaltstellen, t.min, (v) => { s.schaltstellen = v; autosave(); });
      zs.classList.add("zaehler-schaltstellen");
      zaehler.appendChild(zs);
    }
    for (const a of auslaesseFuer(t, s)) {
      zaehler.appendChild(baueZaehler(a.b, s[a.key] || 0, 0, (v) => {
        const vorher = s[a.key] || 0;
        s[a.key] = v;
        autosave();
        // Typ-Auswahl für Strahler ein-/ausblenden
        if (a.key === "strahler" && (vorher > 0) !== (v > 0)) renderSchaltungen();
      }));
      if (a.key === "strahler" && s.strahler > 0) {
        const sp = baueProduktAuswahl({
          kat: "strahler", wert: s.strahlerTyp, label: "Typ Strahler", leerText: stdText("strahler", "Typ Strahler"),
          onChange: ({ name, nr, produktId }) => {
            s.strahlerTyp = name; s.strahlerNr = nr; s.strahlerId = produktId;
            // v19: Teile einer Kombination mitspeichern – bleiben erhalten, auch wenn der Baustellen-Ordner später gelöscht wird
            const k = findeKombi("sys:strahler", name, produktId);
            if (k) s.strahlerTeile = k.teile.map((t) => ({ ...t })); else delete s.strahlerTeile;
            autosave(); renderSchaltungen();
          }
        });
        sp.classList.add("unter-auswahl");
        zaehler.appendChild(sp);
        const teile = strahlerTeile(s, currentBauaufmass);
        if (teile.length) {
          const h = document.createElement("p");
          h.className = "hint kombi-hinweis";
          h.textContent = "Kombination je Strahler: " + teile.map((t) => `${t.menge > 1 ? t.menge + "× " : ""}${t.name}`).join(" + ");
          zaehler.appendChild(h);
        }
      }
    }
    // LED-Stripes (v15): beliebig viele je Schaltung, Meter + Typ
    if (!Array.isArray(s.stripes)) s.stripes = [];
    const stripesEl = document.createElement("div");
    stripesEl.className = "stripes";
    s.stripes.forEach((st, si) => {
      const box = document.createElement("div");
      box.className = "stripe-box";
      box.innerHTML = `<div class="stripe-kopf"><span>LED-Stripe ${si + 1}</span><button type="button" class="btn-danger-text" aria-label="LED-Stripe entfernen">✕</button></div>`;
      box.querySelector("button").addEventListener("click", () => {
        s.stripes = s.stripes.filter((x) => x.id !== st.id);
        autosave();
        renderSchaltungen();
      });
      // v18.4: laufende Meter oder Anzahl Rollen (Menge steht in st.meter)
      const rollen = st.einheit === "Rolle";
      box.appendChild(baueSegment("", [{ key: "m", b: "Laufende Meter" }, { key: "Rolle", b: "Rollen" }], rollen ? "Rolle" : "m", (v) => {
        st.einheit = v === "Rolle" ? "Rolle" : "m";
        if (st.einheit === "Rolle") st.meter = 1; // Meterwert passt nicht als Rollenanzahl
        autosave();
        renderSchaltungen();
      }));
      box.appendChild(rollen
        ? baueZaehler("Anzahl Rollen", st.meter || 0, 0, (v) => { st.meter = v; autosave(); })
        : baueZaehler("Länge (m)", st.meter || 0, 0, (v) => { st.meter = v; autosave(); }, { dezimal: true }));
      box.appendChild(baueProduktAuswahl({
        kat: "ledstripe", wert: st.typ, label: "Typ LED-Stripe", leerText: stdText("ledstripe", "Typ LED-Stripe"),
        onChange: ({ name, nr }) => { st.typ = name; st.nr = nr; autosave(); }
      }));
      // Aufmaßsoftware: Netzteil(e) direkt zum LED-Stripe
      box.appendChild(baueZaehler("Netzteile", st.nt || 0, 0, (v) => {
        const vorher = st.nt || 0;
        st.nt = v;
        autosave();
        if ((vorher > 0) !== (v > 0)) renderSchaltungen();
      }));
      if (st.nt > 0) {
        const np = baueProduktAuswahl({
          kat: "lednetzteil", wert: st.ntTyp, label: "Typ Netzteil", leerText: stdText("lednetzteil", "Typ Netzteil"),
          onChange: ({ name, nr }) => { st.ntTyp = name; st.ntNr = nr; autosave(); }
        });
        np.classList.add("unter-auswahl");
        box.appendChild(np);
      }
      stripesEl.appendChild(box);
    });
    const plusStripe = document.createElement("button");
    plusStripe.type = "button";
    plusStripe.className = "btn-link-accent";
    plusStripe.textContent = "＋ LED-Stripe";
    plusStripe.addEventListener("click", () => {
      s.stripes.push({ id: neueId(), meter: 1, typ: "", nr: "" });
      autosave();
      renderSchaltungen();
    });
    stripesEl.appendChild(plusStripe);
    if (t.stripes !== false) zaehler.appendChild(stripesEl);
    if (!t.ohneAbdeckung) karte.appendChild(baueAbdeckungsAuswahl(s));
    karte.appendChild(baueTextFeld("Bemerkung (optional, z. B. Spiegel, Esstisch)", s.bemerkung, (v) => { s.bemerkung = v; autosave(); }));
    liste.appendChild(karte);
  });
}

function renderRollos() {
  const { raum } = currentRaum;
  const liste = document.getElementById("r_rollos");
  liste.innerHTML = "";
  const summe = raum.rollos.reduce((s, r) => s + r.anzahl, 0);
  document.getElementById("r_anzahlRollos").textContent = summe;
  document.getElementById("r_rollosLeer").hidden = raum.rollos.length !== 0;

  raum.rollos.forEach((r, i) => {
    const karte = document.createElement("div");
    karte.className = "schaltung-karte rollo-karte";
    karte.innerHTML = `
      <div class="schaltung-kopf">
        <strong>${i + 1}. Rollo-Anschluss</strong>
        <button type="button" class="btn-danger-text" aria-label="Rollo entfernen">✕</button>
      </div>
      <div class="rollo-anzahl"></div>
      <div class="rollo-seg"></div>
      <div class="rollo-bedien-anzahl"></div>`;
    karte.querySelector(".btn-danger-text").addEventListener("click", () => {
      if (!confirm("Rollo-Anschluss entfernen?")) return;
      raum.rollos = raum.rollos.filter((x) => x.id !== r.id);
      autosave();
      renderRollos();
    });
    karte.querySelector(".rollo-anzahl").appendChild(baueZaehler("Anzahl Rollos", r.anzahl, 1, (v) => {
      r.anzahl = v;
      document.getElementById("r_anzahlRollos").textContent = raum.rollos.reduce((s, x) => s + x.anzahl, 0);
      autosave();
    }));
    if (istKnxRaum(currentBauaufmass, raum)) {
      // KNX: keine Bedienung vor Ort – je Rollo ein Jalousiekanal im Aktor
      karte.querySelector("strong").textContent = `${i + 1}. Rollo (KNX)`;
      const h = document.createElement("p");
      h.className = "hint";
      h.style.padding = "2px 0 4px";
      h.textContent = "KNX: nur Anzahl – keine Schalter/Taster vor Ort.";
      karte.querySelector(".rollo-seg").appendChild(h);
      karte.appendChild(baueTextFeld("Bemerkung (optional, z. B. Terrassentür, Gruppe Süd)", r.bemerkung, (v) => { r.bemerkung = v; autosave(); }));
      liste.appendChild(karte);
      return;
    }
    const bedienAnzahlEl = karte.querySelector(".rollo-bedien-anzahl");
    const zeigeBedienAnzahl = () => {
      bedienAnzahlEl.innerHTML = "";
      const bd = rolloBedienung(r.bedienung);
      if (bd.key === "keine") return;
      bedienAnzahlEl.appendChild(baueZaehler(`Anzahl ${bd.b}`, r.bedienAnzahl || 1, 1, (v) => { r.bedienAnzahl = v; autosave(); }));
      bedienAnzahlEl.appendChild(baueAbdeckungsAuswahl(r));
    };
    karte.querySelector(".rollo-seg").appendChild(baueSegment("Bedienung vor Ort", BAU_ROLLO_BEDIENUNG, r.bedienung, (v) => {
      r.bedienung = v;
      if (!(r.bedienAnzahl >= 1)) r.bedienAnzahl = 1;
      zeigeBedienAnzahl();
      autosave();
    }));
    zeigeBedienAnzahl();
    karte.appendChild(baueTextFeld("Bemerkung (optional, z. B. Terrassentür, Gruppe Süd)", r.bemerkung, (v) => { r.bemerkung = v; autosave(); }));
    liste.appendChild(karte);
  });
}

// Materialliste des aktuellen Raums bzw. der aktuellen Verteilung (gleiche Element-IDs)
function renderRaumMaterial() {
  const halter = currentMaterialHalter;
  if (!halter) return;
  const tbody = document.getElementById("r_materialTbody");
  const leer = document.getElementById("r_materialLeer");
  document.getElementById("r_anzahlMaterial").textContent = halter.material.length;
  tbody.innerHTML = "";
  leer.hidden = halter.material.length !== 0;
  halter.material.forEach((m) => {
    const tr = document.createElement("tr");
    const tdBez = document.createElement("td");
    const sub = m.artikelnummer ? `<div class="row-sub">Art.-Nr. ${escapeHtml(m.artikelnummer)}</div>` : "";
    tdBez.innerHTML = `${escapeHtml(m.bezeichnung)}${sub}`;
    tr.appendChild(tdBez);
    tr.appendChild(baueMengeZelle(m, autosave));
    const tdE = document.createElement("td");
    tdE.textContent = m.einheit;
    tr.appendChild(tdE);
    const tdDel = document.createElement("td");
    tdDel.className = "col-del";
    tdDel.innerHTML = `<button class="btn-danger-text" type="button">✕</button>`;
    tdDel.querySelector("button").addEventListener("click", () => {
      halter.material = halter.material.filter((x) => x.id !== m.id);
      renderRaumMaterial();
      autosave();
    });
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
}

/* ---------- Verteilung-Ansicht ---------- */

function oeffneVerteilung(v) {
  setzeAnsicht("detail");
  const b = currentBauaufmass;
  currentRaum = null;
  currentMaterialHalter = v;
  selectedArtikel = null;
  selectedStandardArtikel = null;
  selectedFavoritArtikel = null;
  zurueckAktion = () => oeffneBauaufmass(b, bauScrollPosition);
  headerTitle.textContent = `Verteilung · ${v.name || ""}`;
  btnBack.hidden = false;
  btnNew.hidden = true;

  const tpl = document.getElementById("tpl-verteilung");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  window.scrollTo(0, 0);

  const felder = [["v_name", "name"], ["v_standort", "standort"], ["v_typ", "typ"], ["v_bemerkung", "bemerkung"]];
  for (const [id, k] of felder) {
    const el = document.getElementById(id);
    el.value = v[k] || "";
    el.addEventListener("input", () => {
      v[k] = el.value;
      if (k === "name") headerTitle.textContent = `Verteilung · ${v.name}`;
      autosave();
    });
  }

  const container = document.getElementById("v_komponenten");
  const aktualisiere = () => {
    document.getElementById("v_anzahlKomponenten").textContent = v.komponenten.length;
    document.getElementById("v_komponentenLeer").hidden = v.komponenten.length !== 0;
  };
  const render = () => { renderKomponentenListe(container, v, "komponenten", VERT_TYPEN, aktualisiere); aktualisiere(); };
  render();
  document.getElementById("v_auswahl").appendChild(komponentenAuswahl(VERT_TYPEN, "＋ Position hinzufügen…", (typ) => {
    v.komponenten.push(neueKomponente(typ));
    autosave();
    render();
    scrolleZuLetzter("#v_komponenten .komp-karte");
  }));

  klonMaterialTabs("materialHinzufuegenVerteilung");
  bindeMaterialAuswahl(v.material, () => {
    renderRaumMaterial();
    autosave();
  });
  renderRaumMaterial();

  document.getElementById("btnVerteilungFertig").addEventListener("click", () => zurueckAktion());
  document.getElementById("btnVerteilungLoeschen").addEventListener("click", () => {
    if (!confirm(`Verteilung „${v.name}“ wirklich löschen?`)) return;
    b.verteilungen = b.verteilungen.filter((x) => x.id !== v.id);
    autosave();
    zurueckAktion();
  });
}

/* ---------- PDF-Export ---------- */

function zahlDE(n) {
  return Number(n).toLocaleString("de-DE");
}

// Zeilen einer generischen Komponentenliste (KNX / Verteilung).
// Bei Verteilungen gruppiert nach Typ-Gruppe (Schutzorgane, Zählerplatz, ...).
function komponentenZeilen(liste, typen, mitGruppen) {
  const zeilen = [];
  const sortiert = liste
    .map((item, idx) => ({ item, idx, t: typen.indexOf(komponentenTyp(typen, item.art)) }))
    .filter((x) => x.item.anzahl > 0)
    .sort((a, b) => (mitGruppen ? a.t - b.t : 0) || a.idx - b.idx);
  let letzteGruppe = null;
  for (const { item } of sortiert) {
    const typ = komponentenTyp(typen, item.art);
    if (mitGruppen && typ.gruppe !== letzteGruppe) {
      zeilen.push({ gruppe: typ.gruppe });
      letzteGruppe = typ.gruppe;
    }
    const unter = typ.unter ? typ.unter(item) : [];
    zeilen.push({ b: komponenteMitTyp(typ.bez(item), item), nr: item.nr || "", menge: item.anzahl, e: typ.e || "Stck", schaltung: unter.length > 0 });
    for (const u of unter) zeilen.push({ b: u.b, menge: u.menge, e: u.e || "Stck", unter: true });
  }
  return zeilen;
}

/* Aufmaßsoftware: Standard-Typen je Bauaufmaß (b.standards = { strahler, ledstripe,
   praesenz, bewegung } mit { name, nr, id, teile? }). Ist im Raum kein Typ gewählt,
   gilt der Standard. */
function bauStandard(b, kat) {
  const x = b && b.standards && b.standards[kat];
  return x && (x.name || "").trim() ? x : null;
}

// Wirksamer Strahler-Typ einer Schaltung: eigener Typ, sonst Standard des Bauaufmaßes
function effStrahler(s, b) {
  if ((s.strahlerTyp || "").trim()) return { quelle: s, name: s.strahlerTyp, nr: s.strahlerNr || "", id: s.strahlerId, snapKey: "strahlerTeile" };
  const std = bauStandard(b || currentBauaufmass, "strahler");
  return std ? { quelle: std, name: std.name, nr: std.nr || "", id: std.id, snapKey: "teile", standard: true } : null;
}

// v18.5: Teile, wenn der (wirksame) Strahler-Typ eine Kombination ist
function strahlerTeile(s, b) {
  const e = effStrahler(s, b);
  if (!e || typeof findeKombi !== "function") return [];
  const k = findeKombi("sys:strahler", e.name, e.id);
  if (k) { e.quelle[e.snapKey] = k.teile.map((t) => ({ ...t })); return k.teile; } // Kopie mitführen
  return Array.isArray(e.quelle[e.snapKey]) ? e.quelle[e.snapKey] : [];
}

function strahlerZeile(s, b) {
  const e = effStrahler(s, b);
  return "Strahler" + (e ? ` – ${e.name.trim()}` : "");
}

function strahlerNr(s, b) {
  const e = effStrahler(s, b);
  return e ? e.nr : "";
}

function stripeNr(st, b) {
  if ((st.typ || "").trim()) return st.nr || "";
  const std = bauStandard(b || currentBauaufmass, "ledstripe");
  return std ? std.nr || "" : "";
}

// Netzteil eines LED-Stripes (eigener Typ, sonst Standard des Bauaufmaßes)
function netzteilZeile(st, b) {
  const std = bauStandard(b || currentBauaufmass, "lednetzteil");
  const typ = (st.ntTyp || "").trim() || (std ? std.name.trim() : "");
  return "LED-Netzteil" + (typ ? ` – ${typ}` : "");
}

function netzteilNr(st, b) {
  if ((st.ntTyp || "").trim()) return st.ntNr || "";
  const std = bauStandard(b || currentBauaufmass, "lednetzteil");
  return std ? std.nr || "" : "";
}

function melderNr(s, b) {
  if ((s.melderTyp || "").trim()) return s.melderNr || "";
  const std = bauStandard(b || currentBauaufmass, s.melderArt === "bewegung" ? "bewegung" : "praesenz");
  return std ? std.nr || "" : "";
}

function stripeEinheit(st) {
  return st.einheit === "Rolle" ? "Rolle" : "m";
}

function stripeZeile(st, b) {
  const std = bauStandard(b || currentBauaufmass, "ledstripe");
  const typ = (st.typ || "").trim() || (std ? std.name.trim() : "");
  return "LED-Stripe" + (typ ? ` – ${typ}` : "");
}

function melderZeile(s, b) {
  const std = bauStandard(b || currentBauaufmass, s.melderArt === "bewegung" ? "bewegung" : "praesenz");
  const typ = (s.melderTyp || "").trim() || (std ? std.name.trim() : "");
  return melderArt(s.melderArt).b + (typ ? ` – ${typ}` : "");
}

// Liefert die Tabellenzeilen eines Raums (nur Positionen > 0). Leeres Array = Raum taucht nicht auf.
function bauRaumZeilen(b, raum) {
  migriereRaum(raum);
  const zeilen = [];
  const raumAbd = raumAbdeckung(b, raum);
  const eigeneAbd = (obj) => ((obj.abdeckung || "").trim() && obj.abdeckung.trim() !== raumAbd ? ` · Abdeckung ${obj.abdeckung.trim()}` : "");
  const licht = raum.schaltungen.filter((s) => s.typ !== "knx_sk_steckdose");
  const skSteckdosen = raum.schaltungen.filter((s) => s.typ === "knx_sk_steckdose" && s.schaltstellen > 0);
  if (licht.length) {
    zeilen.push({ gruppe: "Beleuchtung" });
    licht.forEach((s) => {
      const t = schaltungTyp(s.typ);
      const bem = (s.bemerkung || "").trim();
      zeilen.push({ b: schaltungBezeichnung(s) + (bem ? ` – ${bem}` : "") + (t.ohneAbdeckung ? "" : eigeneAbd(s)), menge: t.stromkreis ? s.schaltstellen : 1, e: "Stck", schaltung: true });
      if (t.melder && s.melderAnzahl > 0) zeilen.push({ b: melderZeile(s, b), nr: melderNr(s, b), menge: s.melderAnzahl, e: "Stck", unter: true });
      for (const a of BAU_AUSLAESSE) {
        if (!(s[a.key] > 0)) continue;
        if (a.key === "strahler") {
          zeilen.push({ b: strahlerZeile(s, b), nr: strahlerNr(s, b), menge: s[a.key], e: "Stck", unter: true });
          for (const t of strahlerTeile(s, b)) zeilen.push({ b: t.name, nr: t.nr || "", menge: rundeMenge(s[a.key] * (t.menge || 1)), e: "Stck", unter2: true });
        }
        else zeilen.push({ b: a.b, menge: s[a.key], e: "Stck", unter: true });
      }
      for (const st of s.stripes || []) {
        if (st.meter > 0) zeilen.push({ b: stripeZeile(st, b), nr: stripeNr(st, b), menge: st.meter, e: stripeEinheit(st), unter: true });
        if (st.nt > 0) zeilen.push({ b: netzteilZeile(st, b), nr: netzteilNr(st, b), menge: st.nt, e: "Stck", unter2: true });
      }
    });
  }
  if (skSteckdosen.length) {
    zeilen.push({ gruppe: "Steckdosen-Stromkreise" });
    skSteckdosen.forEach((s) => {
      const bem = (s.bemerkung || "").trim();
      zeilen.push({ b: schaltungBezeichnung(s) + (bem ? ` – ${bem}` : ""), menge: s.schaltstellen, e: "Stck", schaltung: true });
    });
  }
  const rollos = (raum.rollos || []).filter((r) => r.anzahl > 0);
  if (rollos.length) {
    zeilen.push({ gruppe: "Rollos" });
    const knxR = istKnxRaum(b, raum);
    rollos.forEach((r) => {
      const bd = knxR ? rolloBedienung("keine") : rolloBedienung(r.bedienung);
      const bem = (r.bemerkung || "").trim();
      const zusatz = knxR ? " (KNX)" : bd.key === "keine" ? " (ohne Schalter/Taster)" : "";
      zeilen.push({ b: "Rollo" + zusatz + (bem ? ` – ${bem}` : ""), menge: r.anzahl, e: "Stck", schaltung: true });
      if (bd.mat && r.bedienAnzahl > 0) zeilen.push({ b: bd.mat + eigeneAbd(r), menge: r.bedienAnzahl, e: "Stck", unter: true });
    });
  }
  const knx = komponentenZeilen(raum.knx || [], KNX_TYPEN, false);
  if (knx.length) zeilen.push({ gruppe: "KNX" }, ...knx);
  const melder = komponentenZeilen(raum.melder || [], MELDER_TYPEN, false);
  if (melder.length) zeilen.push({ gruppe: "Melder" }, ...melder);
  for (const g of BAU_POSITIONEN_GRUPPEN) {
    const gz = [];
    for (const p of g.positionen) {
      if (raum.positionen[p.key] > 0) gz.push({ b: p.b, menge: raum.positionen[p.key], e: "Stck" });
      for (const e of raum.abw) {
        if (e.key === p.key && e.anzahl > 0) gz.push({ b: p.b + ` · Abdeckung ${(e.abdeckung || "").trim() || "?"}`, menge: e.anzahl, e: "Stck" });
      }
    }
    if (gz.length) zeilen.push({ gruppe: g.titel }, ...gz);
  }
  const mat = raum.material.filter((m) => m.menge > 0);
  if (mat.length) {
    zeilen.push({ gruppe: "Material" });
    for (const m of mat) zeilen.push({ b: m.bezeichnung, nr: m.artikelnummer || "", menge: m.menge, e: m.einheit });
  }
  if (zeilen.length && raumAbd) zeilen.unshift({ gruppe: `Abdeckung: ${raumAbd}`, info: true });
  return zeilen;
}

function bauVerteilungZeilen(v) {
  const zeilen = [];
  const bem = (v.bemerkung || "").trim();
  if (bem) zeilen.push({ gruppe: "Bemerkung: " + bem, info: true });
  zeilen.push(...komponentenZeilen(v.komponenten, VERT_TYPEN, true));
  const mat = v.material.filter((m) => m.menge > 0);
  if (mat.length) {
    zeilen.push({ gruppe: "Material" });
    for (const m of mat) zeilen.push({ b: m.bezeichnung, nr: m.artikelnummer || "", menge: m.menge, e: m.einheit });
  }
  return zeilen;
}

function verteilungTitel(v) {
  const teile = [`Verteilung ${v.name || ""}`.trim()];
  if ((v.standort || "").trim()) teile[0] += ` (${v.standort.trim()})`;
  if ((v.typ || "").trim()) teile.push(v.typ.trim());
  return teile.join(" – ").replace(/mm²/g, "qmm");
}

// Summiert Zeilen gleicher Bezeichnung/Einheit (sortiert nach ord, dann erstem Auftreten)
function summenMap() {
  const map = new Map();
  return {
    add(b, menge, e, nr, ord) {
      if (!(menge > 0)) return;
      const key = (nr || "") + "|" + b + "|" + e;
      const v = map.get(key);
      if (v) v.menge = rundeMenge(v.menge + menge);
      else map.set(key, { b, nr: nr || "", menge, e, _ord: ord ?? 0, _i: map.size });
    },
    zeilen() {
      return [...map.values()].sort((x, y) => x._ord - y._ord || x._i - y._i)
        .map(({ b, nr, menge, e }) => ({ b, nr, menge, e }));
    },
    get size() { return map.size; }
  };
}

function bauGesamtZeilen(b) {
  const schaltungen = summenMap();
  const stromkreise = summenMap();
  const kombiTeile = summenMap();
  const netzteile = summenMap(); // LED-Netzteile zu den Stripes // v18.5: Teile der Strahler-Kombinationen
  const melderHA = summenMap();
  const auslaesseSM = summenMap();
  const stripes = summenMap();
  const rollo = summenMap();
  const knx = summenMap();
  const melder = summenMap();
  const gruppen = new Map(BAU_POSITIONEN_GRUPPEN.map((g) => [g.id, summenMap()]));
  const material = summenMap();
  const verteilung = new Map(); // gruppe -> summenMap
  const rangSchaltung = (key) => BAU_SCHALTUNGSTYPEN.findIndex((t) => t.key === key);

  const sammleKomponenten = (liste, typen, ziel) => {
    for (const item of liste) {
      if (!(item.anzahl > 0)) continue;
      const typ = komponentenTyp(typen, item.art);
      const ord = typen.indexOf(typ);
      const z = ziel(typ);
      z.add(komponenteMitTyp(typ.bez(item), item), item.anzahl, typ.e || "Stck", item.nr, ord);
      for (const u of typ.unter ? typ.unter(item) : []) z.add(u.bGesamt || u.b, u.menge, u.e || "Stck", "", ord + 0.5);
    }
  };

  for (const etage of b.etagen) {
    for (const raum of etage.raeume) {
      migriereRaum(raum);
      const raumAbd = raumAbdeckung(b, raum);
      for (const s of raum.schaltungen) {
        const st = schaltungTyp(s.typ);
        const abd = st.ohneAbdeckung ? "" : positionsAbdeckung(b, raum, s.abdeckung);
        if (st.stromkreis) stromkreise.add(schaltungBezeichnung(s), s.schaltstellen || 0, "Stck", "", rangSchaltung(s.typ));
        else schaltungen.add(mitAbdeckung(schaltungBezeichnung(s), abd), 1, "Stck", "", rangSchaltung(s.typ));
        if (st.melder) melderHA.add(melderZeile(s, b), s.melderAnzahl || 0, "Stck", melderNr(s, b));
        BAU_AUSLAESSE.forEach((a, idx) => {
          if (!(s[a.key] > 0)) return;
          if (a.key === "strahler") {
            auslaesseSM.add(strahlerZeile(s, b), s[a.key], "Stck", strahlerNr(s, b), idx);
            for (const t of strahlerTeile(s, b)) kombiTeile.add(t.name, rundeMenge(s[a.key] * (t.menge || 1)), "Stck", t.nr);
          }
          else auslaesseSM.add(a.b, s[a.key], "Stck", "", idx);
        });
        for (const x of s.stripes || []) {
          if (x.meter > 0) stripes.add(stripeZeile(x, b), x.meter, stripeEinheit(x), stripeNr(x, b));
          if (x.nt > 0) netzteile.add(netzteilZeile(x, b), x.nt, "Stck", netzteilNr(x, b));
        }
      }
      const knxR = istKnxRaum(b, raum);
      for (const r of raum.rollos || []) {
        if (!(r.anzahl > 0)) continue;
        if (knxR) {
          rollo.add("Rollo (KNX)", r.anzahl, "Stck", "", 0);
          continue;
        }
        rollo.add("Rollo", r.anzahl, "Stck", "", 0);
        const bd = rolloBedienung(r.bedienung);
        if (bd.mat) rollo.add(mitAbdeckung(bd.mat, positionsAbdeckung(b, raum, r.abdeckung)), r.bedienAnzahl || 0, "Stck", "", bd.key === "schalter" ? 1 : 2);
      }
      sammleKomponenten(raum.knx || [], KNX_TYPEN, () => knx);
      sammleKomponenten(raum.melder || [], MELDER_TYPEN, () => melder);
      for (const g of BAU_POSITIONEN_GRUPPEN) {
        const sm = gruppen.get(g.id);
        g.positionen.forEach((p, idx) => {
          const n = raum.positionen[p.key];
          if (n > 0) sm.add(p.abd ? mitAbdeckung(p.b, raumAbd) : p.b, n, "Stck", "", idx);
          for (const e of raum.abw) {
            if (e.key === p.key && e.anzahl > 0) sm.add(mitAbdeckung(p.b, (e.abdeckung || "").trim() || raumAbd), e.anzahl, "Stck", "", idx);
          }
        });
      }
      for (const m of raum.material) material.add(m.bezeichnung, m.menge, m.einheit, m.artikelnummer);
    }
  }
  for (const v of b.verteilungen || []) {
    sammleKomponenten(v.komponenten, VERT_TYPEN, (typ) => {
      if (!verteilung.has(typ.gruppe)) verteilung.set(typ.gruppe, summenMap());
      return verteilung.get(typ.gruppe);
    });
    for (const m of v.material) material.add(m.bezeichnung, m.menge, m.einheit, m.artikelnummer);
  }

  const zeilen = [];
  if (schaltungen.size) zeilen.push({ gruppe: "Beleuchtung – Schaltungen" }, ...schaltungen.zeilen());
  if (stromkreise.size) zeilen.push({ gruppe: "Stromkreise (KNX)" }, ...stromkreise.zeilen());
  if (melderHA.size) zeilen.push({ gruppe: "Beleuchtung – Melder (Handautomatik)" }, ...melderHA.zeilen());
  if (auslaesseSM.size) zeilen.push({ gruppe: "Beleuchtung – Auslässe" }, ...auslaesseSM.zeilen());
  if (kombiTeile.size) zeilen.push({ gruppe: "Strahler – Bestandteile (Kombinationen)" }, ...kombiTeile.zeilen());
  if (stripes.size) zeilen.push({ gruppe: "Beleuchtung – LED-Stripes" }, ...stripes.zeilen());
  if (netzteile.size) zeilen.push({ gruppe: "Beleuchtung – LED-Netzteile" }, ...netzteile.zeilen());
  if (rollo.size) zeilen.push({ gruppe: "Rollos" }, ...rollo.zeilen());
  if (knx.size) zeilen.push({ gruppe: "KNX (Räume)" }, ...knx.zeilen());
  if (melder.size) zeilen.push({ gruppe: "Melder" }, ...melder.zeilen());
  for (const g of BAU_POSITIONEN_GRUPPEN) {
    const sm = gruppen.get(g.id);
    if (sm.size) zeilen.push({ gruppe: g.titel }, ...sm.zeilen());
  }
  for (const [gruppe, sm] of verteilung) {
    if (sm.size) zeilen.push({ gruppe: "Verteilung – " + gruppe }, ...sm.zeilen());
  }
  if (material.size) zeilen.push({ gruppe: "Material" }, ...material.zeilen());
  return zeilen;
}

function zeilenZuAutoTable(zeilen) {
  return zeilen.map((z) => {
    if (z.gruppe) {
      const styles = z.info
        ? { fontStyle: "italic", fillColor: [255, 255, 255], textColor: [80, 90, 105], fontSize: 8.5 }
        : { fontStyle: "bold", fillColor: [238, 241, 246], textColor: [60, 70, 85], fontSize: 8.5 };
      return [{ content: String(z.gruppe).replace(/mm²/g, "qmm"), colSpan: 4, styles }];
    }
    // Standardschrift des PDFs kennt kein „²“ -> „qmm“
    const text = String(z.b).replace(/mm²/g, "qmm").replace(/²/g, "2");
    const bez = z.unter2 ? "            " + text : z.unter ? "      " + text : text;
    const style = z.schaltung ? { fontStyle: "bold" } : {};
    return [
      { content: bez, styles: style },
      z.nr || "",
      { content: zahlDE(z.menge), styles: { halign: "right" } },
      z.e
    ];
  });
}

function bauDateiname(b) {
  const kunde = (b.kunde.name || "Bauaufmass").trim().replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, "").replace(/\s+/g, "_");
  return `Bauaufmass_${b.nummer ? b.nummer + "_" : ""}${kunde}_${heuteISO()}.pdf`;
}

function erstelleBauPdf(b) {
  // Aufmaßsoftware: Nummer beim ersten PDF vergeben (gemeinsamer Zähler mit den Aufmaßen)
  if (!vergibNummer(b)) return;
  if (currentBauaufmass === b) autosaveBauaufmass(); else speichereBauaufmasse();
  if (currentBauaufmass === b) aktualisiereGesendetStatus(b);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 14;
  const breite = 210 - marginX * 2;
  let y = 20;

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text("Bauaufmaß", marginX, y);
  doc.setFont(undefined, "normal");
  pdfKopfRechts(doc, b, `Datum: ${formatDatumDE(erstelltDatumISO(b))}`, marginX, y);
  y += 11;
  doc.setDrawColor(210);
  doc.line(marginX, y, 210 - marginX, y);
  y += 7;

  const block = (titel, zeilen) => {
    doc.setFont(undefined, "bold");
    doc.setFontSize(11);
    doc.text(titel, marginX, y);
    y += 5.5;
    doc.setFont(undefined, "normal");
    doc.setFontSize(10);
    for (const z of zeilen) {
      const teile = doc.splitTextToSize(z, breite);
      doc.text(teile, marginX, y);
      y += teile.length * 5;
    }
    y += 2;
  };

  const k = b.kunde;
  const kundeZeilen = [];
  if (k.name.trim()) kundeZeilen.push(k.name.trim());
  if (k.ansprechpartner.trim()) kundeZeilen.push("z. Hd. " + k.ansprechpartner.trim());
  if (k.strasse.trim()) kundeZeilen.push(k.strasse.trim());
  if (k.plzOrt.trim()) kundeZeilen.push(k.plzOrt.trim());
  if (k.telefon.trim()) kundeZeilen.push("Tel. " + k.telefon.trim());
  if (!kundeZeilen.length) kundeZeilen.push("–");
  block("Kunde", kundeZeilen);
  if (b.baustelle.trim()) block("Baustelle / Bauvorhaben", [b.baustelle.trim()]);
  if (b.arbeitsbeschreibung.trim()) block("Arbeitsbeschreibung", [b.arbeitsbeschreibung.trim()]);
  y += 2;

  const tabelle = (titel, zeilen) => {
    doc.autoTable({
      startY: y,
      head: [
        [{ content: titel, colSpan: 4, styles: { fillColor: [21, 34, 56], textColor: 255, fontSize: 10.5, fontStyle: "bold" } }],
        [
          { content: "Position" },
          { content: "Art.-Nr." },
          { content: "Menge", styles: { halign: "right" } },
          { content: "Einh." }
        ]
      ],
      body: zeilenZuAutoTable(zeilen),
      margin: { left: marginX, right: marginX, bottom: 16 },
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: [214, 220, 230], textColor: [28, 37, 49], fontSize: 8.5 },
      columnStyles: { 1: { cellWidth: 30 }, 2: { cellWidth: 18 }, 3: { cellWidth: 16 } },
      rowPageBreak: "avoid"
    });
    y = doc.lastAutoTable.finalY + 6;
  };
  const platzFuerTitel = () => { if (y > 297 - 40) { doc.addPage(); y = 18; } };

  let raeumeMitInhalt = 0;
  for (const etage of b.etagen) {
    for (const raum of etage.raeume) {
      const zeilen = bauRaumZeilen(b, raum);
      if (!zeilen.length) continue; // Raum ohne Einträge > 0 erscheint nicht
      platzFuerTitel();
      tabelle(`${etage.name} – ${raum.name || "Raum"}`, zeilen);
      raeumeMitInhalt++;
    }
  }

  let verteilungenMitInhalt = 0;
  for (const v of b.verteilungen || []) {
    const zeilen = bauVerteilungZeilen(v);
    if (!zeilen.length && !(v.typ || "").trim()) continue;
    platzFuerTitel();
    tabelle(verteilungTitel(v), zeilen);
    verteilungenMitInhalt++;
  }

  const gesamt = bauGesamtZeilen(b);
  if (gesamt.length) {
    doc.addPage();
    y = 18;
    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.text("Gesamtzusammenstellung", marginX, y);
    doc.setFont(undefined, "normal");
    y += 4;
    doc.setFontSize(9);
    doc.setTextColor(110);
    const vText = verteilungenMitInhalt ? ` und ${verteilungenMitInhalt} Verteilung(en)` : "";
    doc.text(`Summe aller Positionen aus ${raeumeMitInhalt} Raum/Räumen${vText}`, marginX, y + 4);
    doc.setTextColor(0);
    y += 9;
    tabelle("Gesamt", gesamt);
  } else if (!raeumeMitInhalt && !verteilungenMitInhalt) {
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text("Keine Positionen erfasst.", marginX, y + 4);
    doc.setTextColor(0);
  }

  const seiten = doc.internal.getNumberOfPages();
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    const kunde = b.kunde.name.trim();
    doc.text([`Bauaufmaß ${b.nummer || ""}`.trim(), kunde, pdfMitarbeiter(b)].filter(Boolean).join(" · "), marginX, 297 - 8);
    doc.text(`Seite ${i} / ${seiten}`, 210 - marginX, 297 - 8, { align: "right" });
    doc.setTextColor(0);
  }

  gibPdfAus(doc, bauDateiname(b), () => {
    if (currentBauaufmass === b) autosaveBauaufmass();
    setzeGesendet(b, true);
    speichereBauaufmasse();
    if (currentBauaufmass === b) aktualisiereGesendetStatus(b);
    setTimeout(() => frageOrdnerAufraeumen(b), 300);
  });
}
