import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  EmailAuthProvider,
  linkWithCredential,
  linkWithPopup,
  signInWithCredential,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// CRITICAL: Initialize Firestore with the exact database ID from config
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Initialize Firebase Authentication instance
export const auth = getAuth(app);
export {
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  EmailAuthProvider,
  linkWithCredential,
  linkWithPopup,
  signInWithCredential,
  type User,
};

// Ensure window.firebase (Compat CDN) is initialized if present
if (typeof window !== 'undefined') {
  const win = window as any;
  if (win.firebase) {
    if (!win.firebase.apps || win.firebase.apps.length === 0) {
      try {
        win.firebase.initializeApp(firebaseConfig);
      } catch {
        // App already initialized
      }
    }
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // Keep original error message accessible for UI alerts while adhering to requirement
  return errInfo;
}

export async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore is running in offline mode or waiting for connection.');
    }
  }
}
