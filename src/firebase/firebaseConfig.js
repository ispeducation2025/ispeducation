// src/firebase/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA-kHwX_TnXDugzGKasAUdp4Zpx9nXXmVI",
  authDomain: "isp-education-864ff.firebaseapp.com",
  projectId: "isp-education-864ff",
  storageBucket: "isp-education-864ff.appspot.com",
  messagingSenderId: "273092740585",
  appId: "1:273092740585:web:a30805f632b7df7a507778",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Firebase services
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Google Sign-In Provider
const googleProvider = new GoogleAuthProvider();

export { app, db, auth, storage, googleProvider };
