/**
 * Firebase Realtime Sync Configuration
 * ניהול סנכרון נתונים בזמן אמת מול Firebase Firestore
 */

// הגדרות הפרויקט בפיירבייס - כאן ניתן להזין את מפתחות הפרויקט שלך מ-Firebase Console:
// (Firebase Console -> Project Settings -> General -> Your apps -> Web app)
const firebaseConfig = {
  apiKey: "AIzaSyDemoProjectKeyForSchoolLaptops12345",
  authDomain: "school-laptops-cart.firebaseapp.com",
  projectId: "school-laptops-cart",
  storageBucket: "school-laptops-cart.appspot.com",
  messagingSenderId: "109876543210",
  appId: "1:109876543210:web:abcdef1234567890"
};

let firebaseApp = null;
let firebaseDb = null;
let isFirebaseConnected = false;

// 3 מנהלי המערכת המורשים בלבד
const AUTHORIZED_ADMIN_EMAILS = [
  "sharonabudi@gmail.com",
  "iritulp@gmail.com",
  "zviajer@gmail.com"
];

function initFirebase(onStateUpdateCallback) {
  try {
    if (typeof firebase !== 'undefined' && firebaseConfig.apiKey && !firebase.apps.length) {
      firebaseApp = firebase.initializeApp(firebaseConfig);
      firebaseDb = firebase.firestore();
      
      // האזנה לשינויים בזמן אמת (Real-time listener)
      firebaseDb.collection('carts').doc('school_cart')
        .onSnapshot((doc) => {
          if (doc.exists) {
            const data = doc.data();
            isFirebaseConnected = true;
            updateFirebaseBadge(true);
            if (typeof onStateUpdateCallback === 'function') {
              onStateUpdateCallback(data);
            }
          } else {
            // יצירת רשומת ברירת מחדל ראשונית בפיירבייס
            isFirebaseConnected = true;
            updateFirebaseBadge(true);
          }
        }, (error) => {
          console.warn("Firebase real-time listener notice:", error.message);
          updateFirebaseBadge(false);
        });
    }
  } catch (err) {
    console.warn("Firebase init notice:", err.message);
    updateFirebaseBadge(false);
  }
}

// שמירת נתונים לפיירבייס
async function syncCartToFirebase(stateData) {
  if (!firebaseDb) return false;
  try {
    const payload = {
      laptops: stateData.laptops,
      adminEmails: AUTHORIZED_ADMIN_EMAILS,
      lastUpdated: new Date().toISOString()
    };
    await firebaseDb.collection('carts').doc('school_cart').set(payload, { merge: true });
    updateFirebaseBadge(true);
    return true;
  } catch (e) {
    console.warn("Firebase sync error:", e.message);
    return false;
  }
}

// עדכון תגית סטטוס החיבור באפליקציה
function updateFirebaseBadge(connected) {
  const badge = document.getElementById('firebase-status-badge');
  if (!badge) return;
  if (connected) {
    badge.className = 'firebase-badge online';
    badge.innerHTML = '🟢 מחובר לענן Firebase';
    badge.title = 'כל המידע מסונכרן בזמן אמת מול Firebase Firestore';
  } else {
    badge.className = 'firebase-badge local';
    badge.innerHTML = '🟡 סנכרון מקומי + Firebase מוכן';
    badge.title = 'האפליקציה פועלת בסנכרון מהיר. להפעלת פיירבייס יש להזין את מפתחות הפרויקט שלך בקובץ firebase-config.js';
  }
}
