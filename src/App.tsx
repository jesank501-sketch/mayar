import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import {
  checkIsAdmin,
  computeEffectiveAdminOnline,
  ensureUserAndThread,
} from './services/chatService';
import {
  AdminPresence,
  DEFAULT_PAGE_SETTINGS,
  DEFAULT_SPONSORED_LINKS_CONFIG,
  Language,
  PublicPageSettings,
  SponsoredLinksConfig,
} from './types';
import {
  loadPendingPhoneDemoMeta,
  normalizePhoneDigits,
  PhoneDemoMeta,
  phoneToSyntheticEmail,
  savePendingPhoneDemoMeta,
} from './utils/phoneAuth';
import { LandingView } from './components/LandingView';
import { WelcomePopup } from './components/WelcomePopup';
import { ClientChatView } from './components/ClientChatView';
import { AdminDashboardView } from './components/AdminDashboardView';
import { OfflineIndicator } from './components/OfflineIndicator';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [clientPhotoURL, setClientPhotoURL] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [adminPreviewClient, setAdminPreviewClient] = useState(false);

  const [settings, setSettings] = useState<PublicPageSettings>(DEFAULT_PAGE_SETTINGS);
  const [linksConfig, setLinksConfig] = useState<SponsoredLinksConfig>(
    DEFAULT_SPONSORED_LINKS_CONFIG,
  );
  const [adminPresence, setAdminPresence] = useState<AdminPresence | null>(null);
  const [presenceTick, setPresenceTick] = useState(0);
  const [lang, setLang] = useState<Language>('bn');
  const [popupOpen, setPopupOpen] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const pendingDemoMetaRef = useRef<{
    email: string;
    meta: PhoneDemoMeta;
  } | null>(null);

  // Subscribe to public page settings
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'public'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<PublicPageSettings>;
          setSettings({
            pageName: data.pageName || DEFAULT_PAGE_SETTINGS.pageName,
            tagline: data.tagline || DEFAULT_PAGE_SETTINGS.tagline,
            welcomePopupTitle:
              data.welcomePopupTitle || DEFAULT_PAGE_SETTINGS.welcomePopupTitle,
            welcomePopupSubtitle:
              data.welcomePopupSubtitle || DEFAULT_PAGE_SETTINGS.welcomePopupSubtitle,
            greetingMessage:
              data.greetingMessage || DEFAULT_PAGE_SETTINGS.greetingMessage,
            offlineAutoReply:
              data.offlineAutoReply || DEFAULT_PAGE_SETTINGS.offlineAutoReply,
            adminAvatarURL:
              data.adminAvatarURL || DEFAULT_PAGE_SETTINGS.adminAvatarURL,
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'settings/public');
      },
    );
    return () => unsub();
  }, []);

  // Subscribe to live Admin Active Status (/presence/admin)
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'presence', 'admin'),
      (snap) => {
        if (snap.exists()) {
          setAdminPresence(snap.data() as AdminPresence);
        } else {
          setAdminPresence(null);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'presence/admin');
      },
    );
    return () => unsub();
  }, []);

  // Periodic re-evaluation of 2-minute presence freshness window
  useEffect(() => {
    const id = window.setInterval(() => {
      setPresenceTick((t) => t + 1);
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const adminOnline = useMemo(() => {
    void presenceTick;
    return computeEffectiveAdminOnline(adminPresence);
  }, [adminPresence, presenceTick]);

  // Subscribe to rotating sponsored links configuration once authenticated
  useEffect(() => {
    if (!user) {
      setLinksConfig(DEFAULT_SPONSORED_LINKS_CONFIG);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'settings', 'links'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<SponsoredLinksConfig>;
          setLinksConfig({
            enabled: data.enabled ?? DEFAULT_SPONSORED_LINKS_CONFIG.enabled,
            messagesBeforeLink:
              data.messagesBeforeLink ?? DEFAULT_SPONSORED_LINKS_CONFIG.messagesBeforeLink,
            minStaySeconds:
              typeof data.minStaySeconds === 'number'
                ? data.minStaySeconds
                : DEFAULT_SPONSORED_LINKS_CONFIG.minStaySeconds,
            links:
              Array.isArray(data.links) && data.links.length > 0
                ? data.links
                : DEFAULT_SPONSORED_LINKS_CONFIG.links,
          });
        } else {
          setLinksConfig(DEFAULT_SPONSORED_LINKS_CONFIG);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'settings/links');
      },
    );
    return () => unsub();
  }, [user]);

  // Auth state & user/thread bootstrapping
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setIsAdmin(false);
        setClientPhotoURL('');
        setProfileReady(false);
        setAdminPreviewClient(false);
        setAuthReady(true);
        return;
      }

      try {
        const adminFlag = await checkIsAdmin(nextUser);
        setIsAdmin(adminFlag);

        const pendingMatch =
          pendingDemoMetaRef.current &&
          pendingDemoMetaRef.current.email === nextUser.email
            ? pendingDemoMetaRef.current.meta
            : null;
        const resolvedDemoMeta = pendingMatch ?? loadPendingPhoneDemoMeta(nextUser.email);

        const savedPhoto = await ensureUserAndThread(nextUser, adminFlag, resolvedDemoMeta);
        setClientPhotoURL(savedPhoto);
        setProfileReady(true);
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  const handleToggleLang = () => {
    setLang((prev) => (prev === 'bn' ? 'en' : 'bn'));
  };

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== 'auth/popup-closed-by-user') {
        setAuthError(
          lang === 'bn'
            ? 'লগইন সম্পন্ন করা যায়নি। পপআপ ব্লক করা থাকলে অনুগ্রহ করে অনুমতি দিন।'
            : 'Sign-in could not be completed. Please allow popups and try again.',
        );
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handlePhoneRegister = async (params: {
    name: string;
    phone: string;
    address: string;
    password: string;
  }): Promise<boolean> => {
    if (isSigningIn) return false;
    setIsSigningIn(true);
    setAuthError(null);

    const digits = normalizePhoneDigits(params.phone);
    const syntheticEmail = phoneToSyntheticEmail(digits);
    const cleanName = params.name.trim();
    const cleanAddress = params.address.trim();

    const meta: PhoneDemoMeta = {
      displayName: cleanName,
      phone: digits,
      address: cleanAddress,
    };
    pendingDemoMetaRef.current = { email: syntheticEmail, meta };
    savePendingPhoneDemoMeta(digits, meta);

    try {
      const cred = await createUserWithEmailAndPassword(auth, syntheticEmail, params.password);
      try {
        await updateProfile(cred.user, { displayName: cleanName });
      } catch {
        // Non-blocking: ensureUserAndThread already receives meta directly
      }
      return false;
    } catch (error) {
      pendingDemoMetaRef.current = null;
      const code = (error as { code?: string })?.code ?? '';
      if (code === 'auth/email-already-in-use') {
        setAuthError(
          lang === 'bn'
            ? 'এই মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা আছে। অনুগ্রহ করে পাসওয়ার্ড দিয়ে লগইন করুন।'
            : 'An account with this mobile number already exists. Please sign in with your password.',
        );
        return true;
      }
      if (code === 'auth/operation-not-allowed') {
        setAuthError(
          lang === 'bn'
            ? 'Firebase Console থেকে Email/Password সাইন-ইন মেথড চালু (Enable) করা প্রয়োজন।'
            : 'Email/Password sign-in needs to be enabled in Firebase Console -> Authentication -> Sign-in method.',
        );
        return false;
      }
      if (code === 'auth/weak-password') {
        setAuthError(
          lang === 'bn'
            ? 'পাসওয়ার্ড আরও শক্তিশালী দিন (কমপক্ষে ৬ অক্ষর)।'
            : 'Password is too weak. Please enter at least 6 characters.',
        );
        return false;
      }
      setAuthError(
        lang === 'bn'
          ? 'ডেমো অ্যাকাউন্ট তৈরি করা যায়নি। তথ্য যাচাই করে আবার চেষ্টা করুন।'
          : 'Could not create demo account. Please check your details and try again.',
      );
      return false;
    } finally {
      setIsSigningIn(false);
    }
  };

  const handlePhoneSignIn = async (params: {
    phone: string;
    password: string;
  }): Promise<void> => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError(null);

    const digits = normalizePhoneDigits(params.phone);
    const syntheticEmail = phoneToSyntheticEmail(digits);

    try {
      await signInWithEmailAndPassword(auth, syntheticEmail, params.password);
    } catch (error) {
      const code = (error as { code?: string })?.code ?? '';
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setAuthError(
          lang === 'bn'
            ? 'মোবাইল নম্বর বা পাসওয়ার্ড সঠিক নয়। নতুন হলে "নতুন অ্যাকাউন্ট" ট্যাবে গিয়ে তৈরি করুন।'
            : 'Incorrect mobile number or password. If you are new, switch to New Demo Account.',
        );
      } else if (code === 'auth/operation-not-allowed') {
        setAuthError(
          lang === 'bn'
            ? 'Firebase Console থেকে Email/Password সাইন-ইন মেথড চালু (Enable) করা প্রয়োজন।'
            : 'Email/Password sign-in needs to be enabled in Firebase Console -> Authentication -> Sign-in method.',
        );
      } else if (code === 'auth/too-many-requests') {
        setAuthError(
          lang === 'bn'
            ? 'অনেকবার ভুল চেষ্টা হয়েছে। কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন।'
            : 'Too many failed attempts. Please wait a few moments and try again.',
        );
      } else {
        setAuthError(
          lang === 'bn'
            ? 'লগইন সম্পন্ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Sign-in failed. Please try again.',
        );
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    pendingDemoMetaRef.current = null;
    await signOut(auth);
    setPopupOpen(true);
  };

  if (!authReady || (user && !profileReady)) {
    return (
      <>
        <OfflineIndicator lang={lang} />
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin mx-auto" />
            <p className="text-sm font-medium text-slate-600">
              {lang === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'}
            </p>
          </div>
        </div>
      </>
    );
  }

  if (user) {
    if (isAdmin && !adminPreviewClient) {
      return (
        <>
          <OfflineIndicator lang={lang} />
          <AdminDashboardView
            user={user}
            settings={settings}
            linksConfig={linksConfig}
            adminPresence={adminPresence}
            adminOnline={adminOnline}
            lang={lang}
            onToggleLang={handleToggleLang}
            onSignOut={() => void handleSignOut()}
            onEnterClientPreview={() => setAdminPreviewClient(true)}
          />
        </>
      );
    }

    return (
      <>
        <OfflineIndicator lang={lang} />
        <ClientChatView
          user={user}
          clientPhotoURL={isAdmin ? settings.adminAvatarURL : clientPhotoURL}
          onClientPhotoUpdated={setClientPhotoURL}
          settings={settings}
          linksConfig={linksConfig}
          adminOnline={adminOnline}
          adminPresence={adminPresence}
          lang={lang}
          onToggleLang={handleToggleLang}
          onSignOut={() => void handleSignOut()}
          isAdminPreview={isAdmin && adminPreviewClient}
          onExitAdminPreview={() => setAdminPreviewClient(false)}
        />
      </>
    );
  }

  return (
    <>
      <OfflineIndicator lang={lang} />
      <LandingView
        settings={settings}
        adminOnline={adminOnline}
        adminPresence={adminPresence}
        lang={lang}
        onToggleLang={handleToggleLang}
        onOpenChatPopup={() => {
          setAuthError(null);
          setPopupOpen(true);
        }}
      />
      <WelcomePopup
        isOpen={popupOpen}
        onClose={() => setPopupOpen(false)}
        onSignIn={() => void handleSignIn()}
        onPhoneRegister={handlePhoneRegister}
        onPhoneSignIn={handlePhoneSignIn}
        onClearError={() => setAuthError(null)}
        isSigningIn={isSigningIn}
        authError={authError}
        settings={settings}
        adminOnline={adminOnline}
        adminPresence={adminPresence}
        lang={lang}
      />
    </>
  );
}
