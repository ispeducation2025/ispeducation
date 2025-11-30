// src/firebase/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

/**
 * Firebase config - make sure storageBucket matches the bucket you ran gsutil on.
 * You applied CORS on:
 *   gs://isp-education-864ff.firebasestorage.app
 *
 * So storageBucket below must be exactly that hostname.
 */

const firebaseConfig = {
  apiKey: "AIzaSyA-kHwX_TnXDugzGKasAUdp4Zpx9nXXmVI",
  authDomain: "isp-education-864ff.firebaseapp.com",
  projectId: "isp-education-864ff",
  // IMPORTANT: this must match the bucket where you set CORS
  storageBucket: "isp-education-864ff.firebasestorage.app",
  messagingSenderId: "273092740585",
  appId: "1:273092740585:web:a30805f632b7df7a507778",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Firebase services
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Google provider
const googleProvider = new GoogleAuthProvider();

// Debug helper for verifying config at runtime
if (typeof window !== "undefined") {
  window.__FIREBASE_CONFIG__ = {
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    authDomain: firebaseConfig.authDomain,
  };
  console.log("Firebase runtime config:", window.__FIREBASE_CONFIG__);
}

export {
  app,
  db,
  auth,
  storage,
  googleProvider,
};
