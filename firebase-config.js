/* Firebase-Konfiguration für den Cloud-Sync (seit Version 13.0).
   Solange hier null steht, arbeitet die App wie bisher nur lokal.
   Werte aus der Firebase-Konsole: Projekteinstellungen > Allgemein >
   „Meine Apps“ > Web-App > SDK-Einrichtung > „Konfiguration“.
   Diese Werte sind nicht geheim (sie stehen in jeder Firebase-Web-App
   öffentlich im Quelltext); geschützt werden die Daten durch die
   Anmeldung und die Firestore-Sicherheitsregeln. */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyC2Zuv9pLuKmNGQYmhgkVrdI3JPxjj0CJ4",
  authDomain: "aufmass-app-57dab.firebaseapp.com",
  projectId: "aufmass-app-57dab",
  storageBucket: "aufmass-app-57dab.firebasestorage.app",
  messagingSenderId: "909630787979",
  appId: "1:909630787979:web:e8507f44a1b191b3b99f8e"
};

/* Beispiel – so sieht es ausgefüllt aus:
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "aufmass-app-xxxx.firebaseapp.com",
  projectId: "aufmass-app-xxxx",
  storageBucket: "aufmass-app-xxxx.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
*/
