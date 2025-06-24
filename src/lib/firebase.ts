'use client';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";

// It's recommended to use environment variables for your Firebase config
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Conditionally initialize Firebase to avoid errors during build or when env vars are not set.
const app = (firebaseConfig.projectId && firebaseConfig.apiKey)
  ? (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig))
  : null;

const db = app ? getFirestore(app) : null;
const auth = app ? getAuth(app) : null;
const googleProvider = app ? new GoogleAuthProvider() : null;
const storage = app ? getStorage(app) : null;

if (!app && typeof window !== 'undefined') {
    console.warn("Firebase is not configured. Please add your Firebase credentials to a .env.local file. App functionality will be limited.");
}

export { db, auth, googleProvider, storage };
