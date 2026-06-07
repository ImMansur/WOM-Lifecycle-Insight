import React, { createContext, useContext, useEffect, useState } from "react";
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { fetchUserRole } from "./api";

interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string, role: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Safety timeout: if Firebase doesn't respond in 6s, unblock the UI anyway
    const timeout = setTimeout(() => setLoading(false), 6000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(timeout);
      setLoading(true);
      if (firebaseUser) {
        // Fetch role from Firestore via Backend API
        let role = "Uploader";
        try {
          const res = await fetchUserRole(firebaseUser.uid);
          role = res.role || "Uploader";
        } catch (e) {
          console.error("Error fetching user profile from Firestore:", e);
        }

        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || "WOM User",
          photoURL: firebaseUser.photoURL,
          role: role,
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => { clearTimeout(timeout); unsubscribe(); };
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string, displayName: string, role: string) => {
    const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, email, password);
    
    // Update the profile with the display name
    await updateProfile(firebaseUser, { 
      displayName: displayName || "WOM User" 
    });
    
    // Store profile in Firestore
    await setDoc(doc(db, "users", firebaseUser.uid), {
      role: role || "Uploader",
      email: firebaseUser.email,
      displayName: displayName || "WOM User"
    });
    
    setUser({
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: displayName || "WOM User",
      photoURL: firebaseUser.photoURL,
      role: role || "Uploader",
    });
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
