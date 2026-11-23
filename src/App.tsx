import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
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
        const savedPhoto = await ensureUserAndThread(nextUser, adminFlag);
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

  const handleSignOut = async () => {
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
