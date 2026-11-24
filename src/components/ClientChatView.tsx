import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  ArrowLeft,
  Bell,
  BellOff,
  Camera,
  Globe,
  Image as ImageIcon,
  Lock,
  LogOut,
  Megaphone,
  Shield,
  Video,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  completeClientLinkStep,
  markThreadReadByClient,
  recordClientMessageSentForLinkCycle,
  sendMessageAtomic,
  sendOfflineAutoReplyIfPossible,
  updateUserProfilePhoto,
} from '../services/chatService';
import {
  AdminPresence,
  BroadcastCategory,
  BroadcastMessage,
  ChatMessage,
  ChatThread,
  Language,
  MessageType,
  PublicPageSettings,
  SponsoredLinksConfig,
  UserLinkState,
} from '../types';
import { formatMessageTime, formatRelativeTime } from '../utils/formatters';
import { resolveActiveLinkForUser } from '../utils/linkRotation';
import {
  enableAndSubscribePushNotifications,
  isNotificationSupported,
  isStandalonePwa,
  playMessageAlertTone,
  showLocalNotification,
  syncExistingPushSubscription,
  watchServiceWorkerControllerForPush,
} from '../utils/pushNotifications';
import { Avatar } from './Avatar';
import { ChatComposer } from './ChatComposer';
import { MediaGalleryPanel } from './MediaGalleryPanel';
import { MediaMessageContent } from './MediaMessageContent';
import { NotificationPermissionModal } from './NotificationPermissionModal';
import { ProfilePhotoModal } from './ProfilePhotoModal';
import { PWAInstallButton } from './PWAInstallButton';

interface ClientChatViewProps {
  user: User;
  clientPhotoURL: string;
  onClientPhotoUpdated: (url: string) => void;
  settings: PublicPageSettings;
  linksConfig: SponsoredLinksConfig;
  adminOnline: boolean;
  adminPresence: AdminPresence | null;
  lang: Language;
  onToggleLang: () => void;
  onSignOut: () => void;
  isAdminPreview?: boolean;
  onExitAdminPreview?: () => void;
}

type TimelineItem =
  | { kind: 'message'; sortMs: number; data: ChatMessage }
  | { kind: 'broadcast'; sortMs: number; data: BroadcastMessage };

function getCategoryLabel(category: BroadcastCategory, lang: Language): string {
  if (lang === 'bn') {
    switch (category) {
      case 'urgent':
        return 'জরুরি নোটিশ';
      case 'offer':
        return 'বিশেষ অফার';
      case 'update':
        return 'গুরুত্বপূর্ণ আপডেট';
      default:
        return 'সবার জন্য ঘোষণা';
    }
  }
  switch (category) {
    case 'urgent':
      return 'Urgent Notice';
    case 'offer':
      return 'Special Offer';
    case 'update':
      return 'Page Update';
    default:
      return 'Announcement';
  }
}

export const ClientChatView: React.FC<ClientChatViewProps> = ({
  user,
  clientPhotoURL,
  onClientPhotoUpdated,
  settings,
  linksConfig,
  adminOnline,
  adminPresence,
  lang,
  onToggleLang,
  onSignOut,
  isAdminPreview = false,
  onExitAdminPreview,
}) => {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [threadExists, setThreadExists] = useState(false);
  const [userLinkState, setUserLinkState] = useState<UserLinkState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastMessage[]>([]);
  const [msgLimit, setMsgLimit] = useState(60);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingChat, setLoadingChat] = useState(true);

  const [activeTab, setActiveTab] = useState<'all' | 'media' | 'announcements'>('all');
  const [mobileShowSidebar, setMobileShowSidebar] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [videoCallNotice, setVideoCallNotice] = useState(false);
  const [notifPermission, setNotifPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => (isNotificationSupported() ? Notification.permission : 'unsupported'));
  const [enablingNotif, setEnablingNotif] = useState(false);
  const [notifDismissed, setNotifDismissed] = useState(false);
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [pushSynced, setPushSynced] = useState(false);
  const [incomingToast, setIncomingToast] = useState<string | null>(null);

  const scrollBottomRef = useRef<HTMLDivElement | null>(null);
  const prevTotalCountRef = useRef(0);
  const initializedMessagesRef = useRef(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const initializedBroadcastsRef = useRef(false);
  const seenBroadcastIdsRef = useRef<Set<string>>(new Set());
  const activeTabRef = useRef(activeTab);
  const settingsRef = useRef(settings);
  const langRef = useRef(lang);
  const offlineAutoReplySentRef = useRef<string | null>(null);
  const offlineMarkerStorageKey = `bartaconnect_offline_reply_${user.uid}`;

  useEffect(() => {
    try {
      offlineAutoReplySentRef.current = window.localStorage.getItem(offlineMarkerStorageKey);
    } catch {
      offlineAutoReplySentRef.current = null;
    }
  }, [offlineMarkerStorageKey]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  // Clear single-shot offline auto-reply marker once Admin replies or comes back online
  useEffect(() => {
    let lastAdminId = 'initial';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].senderRole === 'admin') {
        lastAdminId = messages[i].id;
        break;
      }
    }
    if (
      offlineAutoReplySentRef.current &&
      offlineAutoReplySentRef.current !== lastAdminId
    ) {
      offlineAutoReplySentRef.current = null;
      try {
        window.localStorage.removeItem(offlineMarkerStorageKey);
      } catch {
        // Ignore
      }
    }
  }, [messages, offlineMarkerStorageKey]);

  useEffect(() => {
    if (adminOnline && offlineAutoReplySentRef.current) {
      offlineAutoReplySentRef.current = null;
      try {
        window.localStorage.removeItem(offlineMarkerStorageKey);
      } catch {
        // Ignore
      }
    }
  }, [adminOnline, offlineMarkerStorageKey]);

  // Sync Web Push subscription automatically if notification permission was previously granted
  useEffect(() => {
    if (isAdminPreview) return;
    if (isNotificationSupported()) {
      const currentPerm = Notification.permission;
      setNotifPermission(currentPerm);
      if (currentPerm === 'default' && isStandalonePwa()) {
        const promptKey = `bartaconnect_pwa_notif_prompted_${user.uid}`;
        try {
          if (!window.sessionStorage.getItem(promptKey)) {
            window.sessionStorage.setItem(promptKey, '1');
            setNotifModalOpen(true);
          }
        } catch {
          setNotifModalOpen(true);
        }
      }
    }
    void syncExistingPushSubscription(user).then((ok) => setPushSynced(ok));
    return watchServiceWorkerControllerForPush(user);
  }, [user, isAdminPreview]);

  const handleEnableNotifications = async (): Promise<
    NotificationPermission | 'unsupported'
  > => {
    if (enablingNotif) return notifPermission;
    setEnablingNotif(true);
    try {
      const result = await enableAndSubscribePushNotifications(user);
      setNotifPermission(result);
      if (result === 'granted') {
        const synced = await syncExistingPushSubscription(user);
        setPushSynced(synced);
        void showLocalNotification({
          title: settings.pageName,
          body:
            lang === 'bn'
              ? 'নোটিফিকেশন চালু হয়েছে! অ্যাডমিন মেসেজ দিলে মোবাইলে সাথে সাথেই জানতে পারবেন।'
              : 'Notifications enabled! You will be alerted whenever Admin replies.',
          tag: 'notif-enabled',
        });
      } else {
        setNotifModalOpen(true);
      }
      return result;
    } finally {
      setEnablingNotif(false);
    }
  };

  // 0. Real-time per-user rotating link cycle state
  useEffect(() => {
    if (isAdminPreview) {
      setUserLinkState(null);
      return;
    }
    const path = `linkStates/${user.uid}`;
    const unsub = onSnapshot(
      doc(db, 'linkStates', user.uid),
      (snap) => {
        if (snap.exists()) {
          setUserLinkState({ id: snap.id, ...(snap.data() as Omit<UserLinkState, 'id'>) });
        } else {
          setUserLinkState(null);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      },
    );
    return () => unsub();
  }, [user.uid, isAdminPreview]);

  // 1. Real-time thread header listener
  useEffect(() => {
    const threadPath = `threads/${user.uid}`;
    const unsub = onSnapshot(
      doc(db, 'threads', user.uid),
      (snap) => {
        if (snap.exists()) {
          setThreadExists(true);
          setThread({ id: snap.id, ...(snap.data() as Omit<ChatThread, 'id'>) });
        } else {
          setThreadExists(false);
          setThread(null);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, threadPath);
      },
    );
    return () => unsub();
  }, [user.uid]);

  // 2. Mark incoming admin messages as read when thread updates
  useEffect(() => {
    if (thread && thread.unreadByClient > 0 && !isAdminPreview) {
      void markThreadReadByClient(user.uid);
    }
  }, [thread, user.uid, isAdminPreview]);

  // 3. Real-time private 1-to-1 messages listener (paginated)
  useEffect(() => {
    const path = `threads/${user.uid}/messages`;
    const q = query(
      collection(db, 'threads', user.uid, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(msgLimit),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const raw = d.data() as Partial<ChatMessage>;
            return {
              id: d.id,
              threadId: raw.threadId || user.uid,
              senderId: raw.senderId || '',
              senderRole: raw.senderRole || 'client',
              senderName: raw.senderName || 'User',
              messageType: raw.messageType || 'text',
              text: raw.text || '',
              mediaUrl: raw.mediaUrl || '',
              mediaMimeType: raw.mediaMimeType || '',
              createdAt: raw.createdAt as Timestamp,
            };
          })
          .reverse();
        setMessages(list);
        setHasMoreMessages(snap.docs.length >= msgLimit);
        setLoadingChat(false);

        if (!initializedMessagesRef.current) {
          list.forEach((m) => seenMessageIdsRef.current.add(m.id));
          initializedMessagesRef.current = true;
        } else if (!isAdminPreview) {
          const newlyArrived = list.filter((m) => !seenMessageIdsRef.current.has(m.id));
          newlyArrived.forEach((m) => {
            seenMessageIdsRef.current.add(m.id);
            const isRecent =
              !m.createdAt || Date.now() - m.createdAt.toMillis() < 120_000;
            if (!isRecent) return;
            if (m.senderRole === 'admin' || m.senderRole === 'system') {
              const currentLang = langRef.current;
              const preview =
                m.messageType === 'audio'
                  ? currentLang === 'bn'
                    ? 'নতুন ভয়েস মেসেজ পাঠিয়েছেন'
                    : 'Sent a voice message'
                  : m.messageType === 'image'
                    ? currentLang === 'bn'
                      ? 'নতুন ছবি পাঠিয়েছেন'
                      : 'Sent a photo'
                    : m.messageType === 'video'
                      ? currentLang === 'bn'
                        ? 'নতুন ভিডিও পাঠিয়েছেন'
                        : 'Sent a video'
                      : m.text || (currentLang === 'bn' ? 'নতুন মেসেজ' : 'New message');

              playMessageAlertTone();
              try {
                navigator.vibrate?.([160, 80, 160]);
              } catch {
                // Ignore unsupported vibrate
              }
              if (activeTabRef.current !== 'all') {
                setIncomingToast(preview);
              }
              const shouldNotify =
                document.visibilityState !== 'visible' ||
                !document.hasFocus() ||
                activeTabRef.current !== 'all';
              if (shouldNotify) {
                void showLocalNotification({
                  title: settingsRef.current.pageName,
                  body: preview,
                  tag: `thread-${user.uid}`,
                });
              }
            }
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      },
    );
    return () => unsub();
  }, [user.uid, msgLimit, isAdminPreview]);

  // 4. Real-time broadcasts listener (O(1) fan-out for 100k+ users)
  useEffect(() => {
    const path = 'broadcasts';
    const q = query(
      collection(db, 'broadcasts'),
      where('createdAt', '>=', Timestamp.fromMillis(0)),
      orderBy('createdAt', 'desc'),
      limit(25),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<BroadcastMessage, 'id'>),
          }))
          .reverse();
        setBroadcasts(list);

        if (!initializedBroadcastsRef.current) {
          list.forEach((b) => seenBroadcastIdsRef.current.add(b.id));
          initializedBroadcastsRef.current = true;
        } else if (!isAdminPreview) {
          const newlyArrived = list.filter((b) => !seenBroadcastIdsRef.current.has(b.id));
          newlyArrived.forEach((b) => {
            seenBroadcastIdsRef.current.add(b.id);
            const isRecent =
              !b.createdAt || Date.now() - b.createdAt.toMillis() < 120_000;
            if (!isRecent) return;
            const shouldNotify =
              document.visibilityState !== 'visible' ||
              !document.hasFocus() ||
              activeTabRef.current === 'media';
            if (shouldNotify) {
              const currentLang = langRef.current;
              void showLocalNotification({
                title: b.title || settingsRef.current.pageName,
                body:
                  b.text ||
                  (currentLang === 'bn' ? 'নতুন ঘোষণা এসেছে' : 'New page announcement'),
                tag: `broadcast-${b.id}`,
              });
            }
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      },
    );
    return () => unsub();
  }, [isAdminPreview]);

  const mediaCount = useMemo(
    () =>
      messages.filter((m) => m.messageType === 'image' || m.messageType === 'video').length,
    [messages],
  );

  // Merge private 1-to-1 messages and page broadcasts chronologically
  const timeline = useMemo<TimelineItem[]>(() => {
    if (activeTab === 'announcements') {
      return broadcasts.map((b) => ({
        kind: 'broadcast',
        sortMs: b.createdAt ? b.createdAt.toMillis() : Date.now(),
        data: b,
      }));
    }

    const items: TimelineItem[] = [
      ...messages.map((m) => ({
        kind: 'message' as const,
        sortMs: m.createdAt ? m.createdAt.toMillis() : Date.now(),
        data: m,
      })),
      ...broadcasts.map((b) => ({
        kind: 'broadcast' as const,
        sortMs: b.createdAt ? b.createdAt.toMillis() : Date.now(),
        data: b,
      })),
    ];

    items.sort((a, b) => a.sortMs - b.sortMs);
    return items;
  }, [messages, broadcasts, activeTab]);

  // Scroll to bottom when new items arrive
  useEffect(() => {
    if (activeTab === 'all' && timeline.length > prevTotalCountRef.current) {
      scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevTotalCountRef.current = timeline.length;
  }, [timeline.length, activeTab]);

  const handleSendPayload = async (payload: {
    messageType: MessageType;
    text: string;
    mediaUrl?: string;
    mediaMimeType?: string;
  }) => {
    let lastAdminIndex = -1;
    let lastAdminId = 'initial';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].senderRole === 'admin') {
        lastAdminIndex = i;
        lastAdminId = messages[i].id;
        break;
      }
    }

    const alreadySentOfflineSinceAdmin = messages
      .slice(lastAdminIndex + 1)
      .some((m) => m.senderRole === 'system' && m.text === settings.offlineAutoReply);

    let savedMarker = offlineAutoReplySentRef.current;
    if (!savedMarker) {
      try {
        savedMarker = window.localStorage.getItem(offlineMarkerStorageKey);
      } catch {
        savedMarker = null;
      }
    }
    const shouldSendOfflineAutoReply =
      !adminOnline &&
      !isAdminPreview &&
      !alreadySentOfflineSinceAdmin &&
      savedMarker !== lastAdminId &&
      Boolean(settings.offlineAutoReply.trim());

    await sendMessageAtomic({
      threadId: user.uid,
      sender: user,
      senderRole: 'client',
      text: payload.text,
      messageType: payload.messageType,
      mediaUrl: payload.mediaUrl,
      mediaMimeType: payload.mediaMimeType,
      threadExists,
      senderPhotoOverride: clientPhotoURL,
    });
    setActiveTab('all');

    if (!isAdminPreview && linksConfig.enabled) {
      void recordClientMessageSentForLinkCycle(user.uid, userLinkState);
    }

    // Strictly send offline auto-reply ONCE per offline stretch until Admin replies
    if (shouldSendOfflineAutoReply) {
      offlineAutoReplySentRef.current = lastAdminId;
      try {
        window.localStorage.setItem(offlineMarkerStorageKey, lastAdminId);
      } catch {
        // Ignore
      }
      void sendOfflineAutoReplyIfPossible({
        user,
        settings,
        clientPhotoURL,
      });
    }
  };

  const activeRotatingLink = useMemo(
    () =>
      resolveActiveLinkForUser({
        userId: user.uid,
        links: linksConfig.links,
        assignedFirstLink: userLinkState?.assignedFirstLink,
        cycleCount: userLinkState?.cycleCount ?? 0,
      }),
    [user.uid, linksConfig.links, userLinkState?.assignedFirstLink, userLinkState?.cycleCount],
  );

  const messagesSentInCycle = userLinkState?.messagesSinceLink ?? 0;
  const isSponsoredGateActive = Boolean(
    !isAdminPreview &&
      linksConfig.enabled &&
      activeRotatingLink &&
      messagesSentInCycle >= linksConfig.messagesBeforeLink,
  );

  const handleSaveClientPhoto = async (newPhotoURL: string) => {
    await updateUserProfilePhoto({
      user,
      photoURL: newPhotoURL,
      isAdminUser: false,
      currentSettings: settings,
    });
    onClientPhotoUpdated(newPhotoURL);
  };

  const clientDisplayName = user.displayName || user.email?.split('@')[0] || 'Client';

  const hasSavedGreetingInMessages = messages.some(
    (m) => m.senderRole === 'system' && m.text === settings.greetingMessage,
  );

  const adminStatusLabel = adminOnline
    ? lang === 'bn'
      ? 'এখন অনলাইনে আছেন'
      : 'Active now'
    : adminPresence?.lastSeenAt
      ? lang === 'bn'
        ? `অফলাইন · শেষ দেখা ${formatRelativeTime(adminPresence.lastSeenAt, lang)} আগে`
        : `Offline · Last seen ${formatRelativeTime(adminPresence.lastSeenAt, lang)} ago`
      : lang === 'bn'
        ? 'অফলাইন · মেসেজ রেখে যান'
        : 'Offline · Leave a message';

  return (
    <div className="h-[100dvh] w-full bg-slate-100 flex flex-col overflow-hidden">
      {/* Desktop Workspace Top Bar (consolidated into chat header on mobile to save vertical space) */}
      <header className="hidden md:flex h-14 bg-white border-b border-slate-200 px-6 items-center justify-between gap-6 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-base font-bold text-slate-900 tracking-tight whitespace-nowrap shrink-0 font-display">
            {settings.pageName}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            {lang === 'bn' ? 'ব্যক্তিগত মেসেঞ্জার চ্যাট' : 'Private Messenger Chat'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAdminPreview && onExitAdminPreview && (
            <button
              type="button"
              onClick={onExitAdminPreview}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'অ্যাডমিন প্যানেলে ফিরুন' : 'Back to Admin'}</span>
            </button>
          )}
          <PWAInstallButton lang={lang} variant="compact" />
          <button
            type="button"
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'EN' : 'বাংলা'}</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'লগআউট' : 'Sign Out'}</span>
          </button>
        </div>
      </header>

      {/* Messenger Split Container */}
      <div className="flex-1 flex min-h-0 max-w-6xl w-full mx-auto bg-white lg:my-4 lg:rounded-2xl lg:border lg:border-slate-200 lg:shadow-sm overflow-hidden">
        {/* Left Sidebar */}
        <aside
          className={`${
            mobileShowSidebar ? 'flex' : 'hidden'
          } md:flex flex-col min-h-0 w-full md:w-80 border-r border-slate-200 bg-white shrink-0`}
        >
          <div className="p-4 border-b border-slate-200">
            <h1 className="text-base font-bold text-slate-900">
              {lang === 'bn' ? 'চ্যাট ইনবক্স' : 'Messages'}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'bn'
                ? 'শুধুমাত্র পেজ অ্যাডমিনের সাথে সংযুক্ত'
                : 'Connected directly to Page Admin'}
            </p>

            {/* 3-Tab Segmented Navigation: Chat | Pics & Videos | Updates */}
            <div className="mt-3 grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('all');
                  setMobileShowSidebar(false);
                }}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'bn' ? 'চ্যাট' : 'Chat'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('media');
                  setMobileShowSidebar(false);
                }}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'media'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'bn' ? `ছবি/ভিডিও (${mediaCount})` : `Media (${mediaCount})`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('announcements');
                  setMobileShowSidebar(false);
                }}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'announcements'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang === 'bn'
                  ? `ঘোষণা (${broadcasts.length})`
                  : `News (${broadcasts.length})`}
              </button>
            </div>
          </div>

          {/* Single Admin Contact Row */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab('all');
                setMobileShowSidebar(false);
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors cursor-pointer ${
                activeTab === 'all' ? 'bg-blue-50/90' : 'hover:bg-slate-50'
              }`}
            >
              <Avatar src={settings.adminAvatarURL} name={settings.pageName} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {settings.pageName}
                  </p>
                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                    {thread?.lastMessageAt ? formatRelativeTime(thread.lastMessageAt, lang) : ''}
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5 flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                      adminOnline ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                  />
                  <span className="truncate">
                    {adminOnline
                      ? lang === 'bn'
                        ? 'অনলাইন'
                        : 'Active now'
                      : lang === 'bn'
                        ? 'অফলাইন'
                        : 'Offline'}
                  </span>
                </p>
              </div>
            </button>

            {broadcasts.length > 0 && (
              <div className="pt-4 px-2">
                <p className="text-xs font-semibold text-slate-500 mb-2">
                  {lang === 'bn' ? 'সর্বশেষ পেজ ঘোষণা' : 'Latest Page Announcements'}
                </p>
                <div className="space-y-1.5">
                  {broadcasts
                    .slice(-3)
                    .reverse()
                    .map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setActiveTab('announcements');
                          setMobileShowSidebar(false);
                        }}
                        className="w-full text-left p-2.5 rounded-xl border border-slate-200/80 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-800 truncate">
                            {b.title}
                          </span>
                          <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                            {formatRelativeTime(b.createdAt, lang)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{b.text}</p>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Client User Footer with Change Profile Picture Option */}
          <div className="p-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar src={clientPhotoURL} name={clientDisplayName} size="sm" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {clientDisplayName}
                </p>
                <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPhotoModalOpen(true)}
              title={lang === 'bn' ? 'প্রোফাইল ছবি পরিবর্তন করুন' : 'Change profile photo'}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg shrink-0 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'ছবি' : 'Photo'}</span>
            </button>
          </div>
        </aside>

        {/* Right Chat Window */}
        <section
          className={`${
            mobileShowSidebar ? 'hidden' : 'flex'
          } md:flex flex-1 flex-col min-w-0 min-h-0 bg-white`}
        >
          {/* Chat Thread Header (Compact single header on mobile, spacious on desktop) */}
          <div className="px-3 md:px-6 py-2 md:py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 md:gap-4 bg-white shrink-0 pt-safe">
            <div className="flex items-center gap-2.5 md:gap-3 min-w-0">
              {isAdminPreview && onExitAdminPreview && (
                <button
                  type="button"
                  onClick={onExitAdminPreview}
                  aria-label={lang === 'bn' ? 'অ্যাডমিন প্যানেলে ফিরুন' : 'Back to Admin'}
                  className="md:hidden min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-blue-700 bg-blue-50 cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <Avatar src={settings.adminAvatarURL} name={settings.pageName} size="md" />
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 truncate">{settings.pageName}</h2>
                <p className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                      adminOnline ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                  />
                  <span className="truncate">
                    {activeTab === 'media'
                      ? lang === 'bn'
                        ? 'ছবি ও ভিডিও সেকশন'
                        : 'Photos & Videos'
                      : activeTab === 'announcements'
                        ? lang === 'bn'
                          ? 'পেজ ঘোষণা'
                          : 'Announcements'
                        : adminStatusLabel}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Desktop Toggle Pics & Videos Section */}
              <button
                type="button"
                onClick={() =>
                  setActiveTab((prev) => (prev === 'media' ? 'all' : 'media'))
                }
                className={`hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'media'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>
                  {lang === 'bn' ? `ছবি ও ভিডিও (${mediaCount})` : `Pics & Videos (${mediaCount})`}
                </span>
              </button>

              {/* Mobile PWA Install Button (hidden automatically once installed) */}
              <div className="md:hidden">
                <PWAInstallButton lang={lang} variant="compact" />
              </div>

              {/* Mobile / Desktop Notification Bell Trigger */}
              {!isAdminPreview && notifPermission !== 'unsupported' && (
                <button
                  type="button"
                  onClick={() => {
                    if (notifPermission === 'denied' || notifPermission === 'granted') {
                      setNotifDismissed(false);
                      setNotifModalOpen(true);
                    } else {
                      void handleEnableNotifications();
                    }
                  }}
                  disabled={enablingNotif}
                  aria-label={
                    lang === 'bn' ? 'নোটিফিকেশন স্ট্যাটাস' : 'Notification settings'
                  }
                  title={
                    notifPermission === 'denied'
                      ? lang === 'bn'
                        ? 'ব্রাউজার সেটিংস থেকে নোটিফিকেশন অনুমতি দিন'
                        : 'Notifications blocked in browser settings'
                      : notifPermission === 'granted'
                        ? lang === 'bn'
                          ? 'নোটিফিকেশন চালু আছে (টেস্ট/সিঙ্ক করুন)'
                          : 'Notifications enabled (Test / Sync)'
                        : lang === 'bn'
                          ? 'নোটিফিকেশন চালু করুন'
                          : 'Enable notifications'
                  }
                  className={`min-w-[44px] min-h-[44px] md:min-h-0 md:min-w-0 inline-flex items-center justify-center gap-1.5 md:px-2.5 md:py-1.5 text-xs font-medium rounded-xl md:rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    notifPermission === 'granted'
                      ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                      : 'text-blue-700 bg-blue-50 hover:bg-blue-100'
                  }`}
                >
                  {notifPermission === 'denied' ? (
                    <BellOff className="w-4 h-4 md:w-3.5 md:h-3.5 text-amber-600" />
                  ) : (
                    <Bell className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  )}
                  <span className="hidden lg:inline">
                    {notifPermission === 'denied'
                      ? lang === 'bn'
                        ? 'ব্লক করা'
                        : 'Blocked'
                      : notifPermission === 'granted'
                        ? lang === 'bn'
                          ? 'অ্যালার্ট চালু'
                          : 'Alerts On'
                        : lang === 'bn'
                          ? 'চালু করুন'
                          : 'Turn On'}
                  </span>
                </button>
              )}

              {/* Mobile Profile Pic Button (44px hitbox) */}
              <button
                type="button"
                onClick={() => setPhotoModalOpen(true)}
                aria-label={lang === 'bn' ? 'প্রোফাইল ছবি পরিবর্তন' : 'Change profile photo'}
                className="md:hidden min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-100 active:scale-95 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
              </button>

              {/* Locked / Off Video Call Option */}
              <button
                type="button"
                onClick={() => setVideoCallNotice((prev) => !prev)}
                title={
                  lang === 'bn'
                    ? 'ভিডিও কল (বর্তমানে লক / বন্ধ)'
                    : 'Video Call (Currently Locked / Off)'
                }
                aria-label={lang === 'bn' ? 'ভিডিও কল (লক করা)' : 'Video Call (Locked)'}
                className="min-w-[44px] min-h-[44px] md:min-h-0 md:min-w-0 inline-flex items-center justify-center gap-1 md:px-3 md:py-1.5 text-xs font-medium text-slate-500 md:bg-slate-100 hover:bg-slate-100 md:hover:bg-slate-200/80 rounded-xl md:rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Video className="w-4 h-4 md:w-3.5 md:h-3.5 text-slate-400" />
                <Lock className="w-3 h-3 text-slate-500" />
                <span className="hidden lg:inline">
                  {lang === 'bn' ? 'ভিডিও কল (লক)' : 'Video Call (Off)'}
                </span>
              </button>

              {/* Mobile Language + Sign Out */}
              <button
                type="button"
                onClick={onToggleLang}
                aria-label="Toggle language"
                className="md:hidden min-w-[44px] min-h-[44px] px-2 rounded-xl flex items-center justify-center text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                {lang === 'bn' ? 'EN' : 'বাং'}
              </button>
              <button
                type="button"
                onClick={onSignOut}
                aria-label={lang === 'bn' ? 'লগআউট' : 'Sign Out'}
                className="md:hidden min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mobile 1-Tap Segmented Tab Bar */}
          <div className="md:hidden px-3 py-1.5 bg-slate-50 border-b border-slate-200 grid grid-cols-3 gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`min-h-[34px] px-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              {lang === 'bn' ? 'সরাসরি চ্যাট' : 'Chat'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('media')}
              className={`min-h-[34px] px-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'media'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              {lang === 'bn' ? `ছবি/ভিডিও (${mediaCount})` : `Media (${mediaCount})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('announcements')}
              className={`min-h-[34px] px-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'announcements'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              {lang === 'bn'
                ? `ঘোষণা (${broadcasts.length})`
                : `News (${broadcasts.length})`}
            </button>
          </div>

          {/* 1-Tap Mobile Notification Opt-In Banner */}
          {!isAdminPreview &&
            !notifDismissed &&
            (notifPermission === 'default' || notifPermission === 'denied') && (
              <div className="px-3 sm:px-6 py-2 bg-blue-50/90 border-b border-blue-200 flex items-center justify-between gap-2 text-xs shrink-0">
                <div className="flex items-center gap-2 min-w-0 text-blue-950">
                  {notifPermission === 'denied' ? (
                    <BellOff className="w-4 h-4 text-amber-600 shrink-0" />
                  ) : (
                    <Bell className="w-4 h-4 text-blue-600 shrink-0" />
                  )}
                  <span className="truncate sm:whitespace-normal font-medium">
                    {notifPermission === 'denied'
                      ? lang === 'bn'
                        ? 'নোটিফিকেশন বন্ধ করা আছে — মেসেজ অ্যালার্ট পেতে ব্রাউজার সেটিংস থেকে অনুমতি দিন।'
                        : 'Notifications are blocked — allow notifications in browser site settings for reply alerts.'
                      : lang === 'bn'
                        ? 'অ্যাডমিন মেসেজ দিলে মোবাইলে নোটিফিকেশন পেতে চালু করুন'
                        : 'Turn on mobile notifications to get instant alerts when Admin replies'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {notifPermission === 'default' ? (
                    <button
                      type="button"
                      onClick={() => void handleEnableNotifications()}
                      disabled={enablingNotif}
                      className="min-h-[34px] px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
                    >
                      {enablingNotif
                        ? lang === 'bn'
                          ? 'চালু হচ্ছে...'
                          : 'Enabling...'
                        : lang === 'bn'
                          ? 'চালু করুন'
                          : 'Turn On'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setNotifModalOpen(true)}
                      className="min-h-[34px] px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {lang === 'bn' ? 'চালু করার নিয়ম' : 'Fix Alerts'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNotifDismissed(true)}
                    aria-label={lang === 'bn' ? 'বন্ধ করুন' : 'Dismiss'}
                    className="min-w-[34px] min-h-[34px] rounded-lg flex items-center justify-center text-slate-500 hover:bg-blue-100 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

          {videoCallNotice && (
            <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 text-xs text-slate-700">
              <span className="flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>
                  {lang === 'bn'
                    ? 'ভিডিও কল ফিচারটি বর্তমানে অ্যাডমিন কর্তৃক লক/বন্ধ রাখা হয়েছে। আপনি টেক্সট, ছবি, ভয়েস এবং ভিডিও মেসেজ পাঠাতে পারবেন।'
                    : 'Live video calling is currently locked/off by the page admin. You can send text, photos, voice, and video messages below.'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setVideoCallNotice(false)}
                className="text-slate-500 hover:text-slate-800 font-medium cursor-pointer shrink-0"
              >
                {lang === 'bn' ? 'ঠিক আছে' : 'Dismiss'}
              </button>
            </div>
          )}

          {incomingToast && (
            <div className="px-4 sm:px-6 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between gap-2 text-xs text-emerald-900 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('all');
                  setIncomingToast(null);
                }}
                className="flex items-center gap-2 font-semibold truncate cursor-pointer text-left"
              >
                <Bell className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">
                  {settings.pageName}: {incomingToast}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setIncomingToast(null)}
                className="text-emerald-700 hover:text-emerald-900 font-medium shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {activeTab === 'media' ? (
            <MediaGalleryPanel
              messages={messages}
              lang={lang}
              onClose={() => setActiveTab('all')}
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 space-y-4 bg-slate-50/40">
              {hasMoreMessages && activeTab === 'all' && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setMsgLimit((prev) => prev + 60)}
                    className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                  >
                    {lang === 'bn' ? 'আগের মেসেজ দেখুন' : 'Load earlier messages'}
                  </button>
                </div>
              )}

              {/* Default Greeting Bubble if not already saved inside thread */}
              {activeTab === 'all' && !hasSavedGreetingInMessages && (
                <div className="flex items-end gap-2.5 max-w-xl">
                  <Avatar src={settings.adminAvatarURL} name={settings.pageName} size="sm" />
                  <div className="space-y-1">
                    <div className="bg-slate-100 text-slate-800 text-sm leading-relaxed px-4 py-3 rounded-2xl rounded-bl-sm">
                      {settings.greetingMessage}
                    </div>
                    <p className="text-[11px] text-slate-400 px-1">
                      {settings.pageName} · {lang === 'bn' ? 'স্বাগতম বার্তা' : 'Greeting'}
                    </p>
                  </div>
                </div>
              )}

              {loadingChat ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  {lang === 'bn' ? 'মেসেজ লোড হচ্ছে...' : 'Loading messages...'}
                </div>
              ) : timeline.length === 0 && activeTab === 'announcements' ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  {lang === 'bn'
                    ? 'এখনো কোনো সাধারণ ঘোষণা প্রকাশ করা হয়নি।'
                    : 'No page announcements yet.'}
                </div>
              ) : (
                timeline.map((item) => {
                  if (item.kind === 'broadcast') {
                    const b = item.data;
                    return (
                      <div key={`b-${b.id}`} className="flex justify-center py-1">
                        <div className="w-full max-w-lg bg-white border border-blue-200 rounded-2xl p-4 shadow-xs">
                          <div className="flex items-center justify-between gap-2 text-xs text-blue-700 font-medium mb-1.5">
                            <span className="inline-flex items-center gap-1.5">
                              <Megaphone className="w-3.5 h-3.5 shrink-0" />
                              <span>{getCategoryLabel(b.category, lang)}</span>
                            </span>
                            <span className="text-slate-400 tabular-nums font-normal">
                              {formatMessageTime(b.createdAt, lang)}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-slate-900">{b.title}</h3>
                          <p className="mt-1 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                            {b.text}
                          </p>
                        </div>
                      </div>
                    );
                  }

                  const m = item.data;
                  const isOwn = m.senderRole === 'client';

                  if (isOwn) {
                    return (
                      <div key={`m-${m.id}`} className="flex justify-end items-end gap-2">
                        <div className="max-w-[82%] sm:max-w-lg space-y-1 flex flex-col items-end">
                          <div className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-br-sm">
                            <MediaMessageContent message={m} isOwn={true} />
                          </div>
                          <span className="text-[11px] text-slate-400 px-1 tabular-nums">
                            {formatMessageTime(m.createdAt, lang)}
                          </span>
                        </div>
                        <Avatar src={clientPhotoURL} name={clientDisplayName} size="sm" />
                      </div>
                    );
                  }

                  return (
                    <div key={`m-${m.id}`} className="flex items-end gap-2.5 max-w-[85%] sm:max-w-lg">
                      <Avatar src={settings.adminAvatarURL} name={settings.pageName} size="sm" />
                      <div className="space-y-1">
                        <div className="bg-slate-100 text-slate-900 px-4 py-2.5 rounded-2xl rounded-bl-sm">
                          <MediaMessageContent message={m} isOwn={false} />
                        </div>
                        <span className="block text-[11px] text-slate-400 px-1 tabular-nums">
                          {settings.pageName}
                          {m.senderRole === 'system'
                            ? ` · ${lang === 'bn' ? 'অটো বার্তা' : 'Auto Reply'}`
                            : ''}
                          {' · '}
                          {formatMessageTime(m.createdAt, lang)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}

              <div ref={scrollBottomRef} />
            </div>
          )}

          {/* Messenger Media + Text Composer */}
          <ChatComposer
            user={user}
            threadId={user.uid}
            lang={lang}
            placeholder={
              lang === 'bn'
                ? 'মেসেজ লিখুন, ভয়েস রেকর্ড করুন অথবা ছবি/ভিডিও পাঠান...'
                : 'Write a message, record voice, or send photo/video...'
            }
            sponsoredGate={
              !isAdminPreview && linksConfig.enabled && activeRotatingLink
                ? {
                    active: isSponsoredGateActive,
                    linkUrl: activeRotatingLink,
                    messagesSentInCycle,
                    messagesBeforeLink: linksConfig.messagesBeforeLink,
                    minStaySeconds: linksConfig.minStaySeconds,
                    onLinkVisited: async () => {
                      await completeClientLinkStep({
                        userId: user.uid,
                        visitedLink: activeRotatingLink,
                        currentState: userLinkState,
                      });
                    },
                  }
                : undefined
            }
            onSendPayload={handleSendPayload}
          />
        </section>
      </div>

      <ProfilePhotoModal
        isOpen={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        currentPhotoURL={clientPhotoURL}
        displayName={clientDisplayName}
        lang={lang}
        onSavePhoto={handleSaveClientPhoto}
      />

      <NotificationPermissionModal
        isOpen={notifModalOpen}
        onClose={() => setNotifModalOpen(false)}
        permission={notifPermission}
        lang={lang}
        enabling={enablingNotif}
        pushSynced={pushSynced}
        onRetryPermission={handleEnableNotifications}
      />
    </div>
  );
};
