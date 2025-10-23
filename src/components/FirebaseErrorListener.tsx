"use client";

import { useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { type FirestorePermissionError } from '@/firebase/errors';

// This component is a hack to surface rich Firestore security rule errors
// in the Next.js development overlay. It should only be included in development builds.
export function FirebaseErrorListener() {
  useEffect(() => {
    const handleError = (error: FirestorePermissionError) => {
      // Throwing the error here will cause it to be picked up by the Next.js
      // error overlay in development mode.
      throw error;
    };

    errorEmitter.on('permission-error', handleError);

    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, []);

  return null; // This component does not render anything.
}
