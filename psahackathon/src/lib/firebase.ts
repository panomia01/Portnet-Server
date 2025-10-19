// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDQ_UgV14iMVshNdOx43gwXOuAB4ls5Avs",
  authDomain: "portnetincidents.firebaseapp.com",
  projectId: "portnetincidents",
  storageBucket: "portnetincidents.firebasestorage.app",
  messagingSenderId: "950715328655",
  appId: "1:950715328655:web:7cbccc642ead7e735268fa",
  measurementId: "G-T9V8MYY4FL",
};

const app = initializeApp(firebaseConfig);

// Only initialize analytics in the browser
let analytics;
if (typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

// Firestore works on both server & client
export const db = getFirestore(app);