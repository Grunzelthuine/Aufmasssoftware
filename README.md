# Aufmaßsoftware (Testversion)

Neue, vereinfachte Fassung der Aufmaß-App – läuft parallel zur bisherigen App unter
https://grunzelthuine.github.io/Aufmasssoftware/

- Eigene Daten (lokal `am2_…`, Firebase `users/{uid}/am2_…`), getrennt von der bisherigen App.
- Beim ersten Start werden die Daten der bisherigen App einmalig übernommen
  (lokal vom selben Gerät, sonst nach der Anmeldung aus der Cloud – nur gelesen).
- Gleiches Firebase-Projekt und gleiche Anmeldung wie die bisherige App.
- Der Großhandelskatalog (~125 MB) wird aus dem Repo `Aufmass` mitbenutzt
  (`../Aufmass/materials-chunks/`) – das alte Repo muss deshalb bestehen bleiben.

Neu gegenüber der bisherigen App: ein Suchfeld für alles Material (Baustelle → Favoriten →
Datenbank → Katalog → Freitext, 📷, 🎤), automatische Ablage in der Datenbank,
Standard-Typen je Bauaufmaß, Raumvorlagen und „wie vorheriger Raum“, Schnellleiste im Raum,
Filter „Benutzt“ / „Doppelte“ in der Materialdatenbank, Baustellen-Ordner auch im normalen
Aufmaß, Aufräumen des Baustellen-Ordners nach dem Senden.
