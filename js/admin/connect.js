// Firebase connection shared by the Chapter Editor and the Member Portal. Both use the same app name,
// so one Google sign-in works on both pages.
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCredential, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer } from 'firebase/firestore';

export const SUPER_ADMIN_EMAIL = 'muhammadshamsularefin01@gmail.com';
export const ROLES = ['super-admin', 'administrator', 'outreach'];

/** Connects to Firebase (or the emulators) and returns `create({ db, auth })`. */
export function connect(config, create) {
  const app = initializeApp(config.firebase, 'chapter-editor');
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (config.emulators?.firestore) {
    const url = new URL(config.emulators.firestore);
    connectFirestoreEmulator(db, url.hostname, Number(url.port));
  }
  if (!config.emulators?.auth) return create({ db, auth });
  connectAuthEmulator(auth, config.emulators.auth, { disableWarnings: true });
  const api = create({ db, auth });
  // End-to-end tests only: the Auth emulator accepts unsigned Google test accounts. Real Firebase rejects them.
  api.testSignIn = async (email) =>
    (
      await signInWithCredential(
        auth,
        GoogleAuthProvider.credential(JSON.stringify({ sub: email.replace(/\W/g, ''), email, email_verified: true })),
      )
    ).user;
  return api;
}

/** The Chapter Editor role of a signed-in user, or ''. */
export async function editorRole(db, user) {
  if (!user?.emailVerified) return '';
  if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL) return 'super-admin';
  try {
    const grant = await getDocFromServer(doc(db, 'chapterEditors', user.email.toLowerCase()));
    return grant.exists() && grant.data().active === true && ROLES.includes(grant.data().role) ? grant.data().role : '';
  } catch {
    return '';
  }
}
