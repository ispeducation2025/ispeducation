// src/firebase/firebaseConfig.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// ✅ Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA-kHwX_TnXDugzGKasAUdp4Zpx9nXXmVI",
  authDomain: "isp-education-864ff.firebaseapp.com",
  projectId: "isp-education-864ff",
  storageBucket: "isp-education-864ff.appspot.com",
  messagingSenderId: "273092740585",
  appId: "1:273092740585:web:a30805f632b7df7a507778",
};

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);

// ✅ Firebase core services
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// ✅ Providers
const googleProvider = new GoogleAuthProvider();

// ✅ OTP Helpers (for real phone verification)
const setUpRecaptcha = (containerId = "recaptcha-container") => {
  // Create or reuse invisible reCAPTCHA verifier
  if (!window.recaptchaVerifier) {
    window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: "invisible",
      callback: (response) => {
        console.log("reCAPTCHA verified:", response);
      },
      "expired-callback": () => {
        console.warn("reCAPTCHA expired. Please refresh.");
      },
    });
  }
  return window.recaptchaVerifier;
};

// ✅ Function to send OTP (real Firebase OTP)
const sendOTP = async (phoneNumber) => {
  try {
    const appVerifier = setUpRecaptcha();
    const confirmationResult = await signInWithPhoneNumber(
      auth,
      phoneNumber,
      appVerifier
    );
    window.confirmationResult = confirmationResult; // store globally for verification step
    return { success: true };
  } catch (error) {
    console.error("Error sending OTP:", error);
    return { success: false, error: error.message };
  }
};

// ✅ Function to verify OTP entered by user
const verifyOTP = async (otpCode) => {
  try {
    if (!window.confirmationResult) throw new Error("No OTP request found.");
    const result = await window.confirmationResult.confirm(otpCode);
    return { success: true, user: result.user };
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return { success: false, error: error.message };
  }
};

export {
  app,
  db,
  auth,
  storage,
  googleProvider,
  setUpRecaptcha,
  sendOTP,
  verifyOTP,
};
