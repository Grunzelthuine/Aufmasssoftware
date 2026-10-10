# Aufmaßsoftware

Aufmaß-App (PWA) für Material- und Bauaufmaße – https://grunzelthuine.github.io/Aufmasssoftware/

- Daten lokal (`am2_…`) und per Cloud-Sync in Firebase (`users/{uid}/am2_…`), jeder Mitarbeiter mit eigenem Konto.
- Großhandelskatalog im Ordner `materials-chunks/` (aus DATANORM erzeugt).
- Neuer Katalog: in der App unter ⚙ Einstellungen → Großhandelskatalog die DATANORM-Datei (oder ZIP) einlesen,
  „ZIP für GitHub herunterladen“, entpacken und den Ordner `materials-chunks` hier im Repo ersetzen.
  Alternativ nur auf einem Gerät: „Nur auf diesem Gerät verwenden“.
- Nach jeder Änderung an App-Dateien `CACHE_VERSION` in `sw.js` hochzählen, damit installierte Apps das Update bekommen.
