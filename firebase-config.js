// Firebase web app settings for project "test-app-52149" (used by sync.js).
// These values are not secret: every Firebase web app ships them to the
// browser. The data is protected by firestore.rules, not by hiding these.
// Fetch them with: npx -y firebase-tools@latest apps:sdkconfig WEB 1:245899552801:web:698ea4d0a5a8c9d852db60
// While this is null, sign-in is switched off and to-dos stay on the device.
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBVEDTxKusDuwGyk9O7tWskmLW3B0tfBxs',
  authDomain: 'test-app-52149.firebaseapp.com',
  projectId: 'test-app-52149',
  storageBucket: 'test-app-52149.firebasestorage.app',
  messagingSenderId: '245899552801',
  appId: '1:245899552801:web:698ea4d0a5a8c9d852db60',
};

// Web Push key (public half of the key pair) for phone notifications (Issue #51).
// From Firebase console → Project settings → Cloud Messaging → Web Push certificates.
// Not secret: browsers need it to subscribe. While it's missing, phone notifications stay hidden.
window.FIREBASE_VAPID_KEY = 'BJJfzn5UACWNuPDwnEeGazdjMpHCx1u3PlH98veMWleaHLTIczwXNTV-c7vWdEIvDK0TTKPxJRsSsBM_ynrqBt0';
