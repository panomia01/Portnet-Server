// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDQ_UgV14iMVshNdOx43gwXOuAB4ls5Avs",
  authDomain: "portnetincidents.firebaseapp.com",
  projectId: "portnetincidents",
  storageBucket: "portnetincidents.appspot.com", // ✅ corrected
  messagingSenderId: "950715328655",
  appId: "1:950715328655:web:7cbccc642ead7e735268fa",
  measurementId: "G-T9V8MYY4FL",
};

// Initialize app safely (avoid duplicate init during hot reload)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Analytics only in browser
let analytics;
if (typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

// Firestore works everywhere
export const db = getFirestore(app);
export { app };