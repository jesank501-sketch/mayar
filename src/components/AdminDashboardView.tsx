import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Eye,
  Globe,
  Image as ImageIcon,
  Inbox,
  Link2,
  Lock,
  LogOut,
  Megaphone,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  Video,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  adminAssignFirstLinkForUser,
  createBroadcast,
  editBroadcast,
  removeBroadcast,
  savePublicSettings,
  saveSponsoredLinksConfig,
  sendMessageAtomic,
  updateAdminPresence,
  updateThreadAdminState,
  updateUserProfilePhoto,
} from '../services/chatService';
import {
  AdminPresence,
  BroadcastCategory,
  BroadcastMessage,
  ChatMessage,
  ChatThread,
  FIELD_LIMITS,
  Language,
  MessageType,
  PresenceMode,
  PublicPageSettings,
  SponsoredLinksConfig,
  UserLinkState,
} from '../types';
import { formatMessageTime, formatRelativeTime } from '../utils/formatters';
import {
  formatShortLinkLabel,
  isSafeHttpsLink,
  resolveActiveLinkForUser,
} from '../utils/linkRotation';
import { dispatchAdminPushNotification } from '../utils/pushNotifications';
import { Avatar } from './Avatar';
import { ChatComposer } from './ChatComposer';
import { MediaGalleryPanel } from './MediaGalleryPanel';
import { MediaMessageContent } from './MediaMessageContent';
import { ProfilePhotoModal } from './ProfilePhotoModal';
import { PWAInstallButton } from './PWAInstallButton';

interface AdminDashboardViewProps {
  user: User;
  settings: PublicPageSettings;
  linksConfig: SponsoredLinksConfig;
  adminPresence: AdminPresence | null;
  adminOnline: boolean;
  lang: Language;
  onToggleLang: () => void;
  onSignOut: () => void;
  onEnterClientPreview: () => void;
}

type AdminSection = 'inbox' | 'broadcast' | 'links' | 'settings';
type InboxFilter = 'all' | 'unread' | 'resolved';

const CATEGORY_OPTIONS: { value: BroadcastCategory; bn: string; en: string }[] = [
  { value: 'announcement', bn: 'সাধারণ ঘোষণা', en: 'Announcement' },
  { value: 'update', bn: 'গুরুত্বপূর্ণ আপডেট', en: 'Update' },
  { value: 'offer', bn: 'বিশেষ অফার', en: 'Special Offer' },
  { value: 'urgent', bn: 'জরুরি নোটিশ', en: 'Urgent Notice' },
];

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  user,
  settings,
  linksConfig,
  adminPresence,
  adminOnline,
  lang,
  onToggleLang,
  onSignOut,
  onEnterClientPreview,
}) => {
  const [section, setSection] = useState<AdminSection>('inbox');
  const [presenceMode, setPresenceMode] = useState<PresenceMode>(
    adminPresence?.mode || 'auto',
  );

  // Inbox state (paginated for 10k-100k+ users)
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadLimit, setThreadLimit] = useState(50);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [chatViewMode, setChatViewMode] = useState<'chat' | 'media'>('chat');

  // Active thread messages state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgLimit, setMsgLimit] = useState(60);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [videoCallNotice, setVideoCallNotice] = useState(false);

  // Broadcast state
  const [broadcasts, setBroadcasts] = useState<BroadcastMessage[]>([]);
  const [bTitle, setBTitle] = useState('');
  const [bText, setBText] = useState('');
  const [bCategory, setBCategory] = useState<BroadcastCategory>('announcement');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState<string | null>(null);
  const [editingBroadcastId, setEditingBroadcastId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Settings & Avatar modal state
  const [settingsForm, setSettingsForm] = useState<PublicPageSettings>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string | null>(null);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);

  // Sponsored Link Pool & Per-User Review State
  const [linkStatesMap, setLinkStatesMap] = useState<Record<string, UserLinkState>>({});
  const [linksEnabledDraft, setLinksEnabledDraft] = useState(linksConfig.enabled);
  const [linksIntervalDraft, setLinksIntervalDraft] = useState(linksConfig.messagesBeforeLink);
  const [linksTextDraft, setLinksTextDraft] = useState(linksConfig.links.join('\n'));
  const [savingLinksConfig, setSavingLinksConfig] = useState(false);
  const [linksFeedback, setLinksFeedback] = useState<string | null>(null);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [linkReviewSearch, setLinkReviewSearch] = useState('');
  const [assigningUserId, setAssigningUserId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSettingsForm(settings);
  }, [settings]);

  useEffect(() => {
    setLinksEnabledDraft(linksConfig.enabled);
    setLinksIntervalDraft(linksConfig.messagesBeforeLink);
    setLinksTextDraft(linksConfig.links.join('\n'));
  }, [linksConfig]);

  useEffect(() => {
    if (adminPresence?.mode) {
      setPresenceMode(adminPresence.mode);
    }
  }, [adminPresence?.mode]);

  // Live Admin Presence Heartbeat
  useEffect(() => {
    const syncPresence = (online: boolean) => {
      void updateAdminPresence(user, online, presenceMode);
    };

    syncPresence(presenceMode !== 'offline');

    const heartbeatId = window.setInterval(() => {
      if (presenceMode === 'auto') {
        syncPresence(document.visibilityState === 'visible');
      } else {
        syncPresence(presenceMode === 'online');
      }
    }, 45_000);

    const handleVisibility = () => {
      if (presenceMode === 'auto') {
        syncPresence(document.visibilityState === 'visible');
      }
    };

    const handleUnload = () => {
      if (presenceMode === 'auto') {
        syncPresence(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.clearInterval(heartbeatId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [user, presenceMode]);

  const handleChangePresenceMode = async (nextMode: PresenceMode) => {
    setPresenceMode(nextMode);
    await updateAdminPresence(user, nextMode !== 'offline', nextMode);
  };

  // 1. Real-time paginated threads listener
  useEffect(() => {
    const q = query(
      collection(db, 'threads'),
      orderBy('lastMessageAt', 'desc'),
      limit(threadLimit),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ChatThread, 'id'>),
          }))
          .filter((t) => t.clientId !== user.uid);
        setThreads(list);
        setHasMoreThreads(snap.docs.length >= threadLimit);
        setLoadingThreads(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'threads');
      },
    );
    return () => unsub();
  }, [threadLimit, user.uid]);

  // 2. Real-time broadcasts listener
  useEffect(() => {
    const q = query(
      collection(db, 'broadcasts'),
      where('createdAt', '>=', Timestamp.fromMillis(0)),
      orderBy('createdAt', 'desc'),
      limit(30),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setBroadcasts(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<BroadcastMessage, 'id'>),
          })),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'broadcasts');
      },
    );
    return () => unsub();
  }, []);

  // 2b. Real-time per-user rotating link states for Admin Review
  useEffect(() => {
    const q = query(
      collection(db, 'linkStates'),
      orderBy('updatedAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const nextMap: Record<string, UserLinkState> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as Omit<UserLinkState, 'id'>;
          nextMap[d.id] = { id: d.id, ...data };
        });
        setLinkStatesMap(nextMap);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'linkStates');
      },
    );
    return () => unsub();
  }, []);

  // 3. Real-time messages listener for selected thread
  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);
    const path = `threads/${selectedThreadId}/messages`;
    const q = query(
      collection(db, 'threads', selectedThreadId, 'messages'),
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
              threadId: raw.threadId || selectedThreadId,
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
        setLoadingMessages(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      },
    );
    return () => unsub();
  }, [selectedThreadId, msgLimit]);

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

  const selectedMediaCount = useMemo(
    () =>
      messages.filter((m) => m.messageType === 'image' || m.messageType === 'video').length,
    [messages],
  );

  // Clear unreadByAdmin when admin views an unread thread
  useEffect(() => {
    if (selectedThread && selectedThread.unreadByAdmin > 0) {
      void updateThreadAdminState(selectedThread.id, selectedThread.status);
    }
  }, [selectedThread]);

  // Auto-scroll when selected thread messages update
  useEffect(() => {
    if (chatViewMode === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, selectedThreadId, chatViewMode]);

  const filteredThreads = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return threads.filter((t) => {
      if (inboxFilter === 'unread' && t.unreadByAdmin <= 0) return false;
      if (inboxFilter === 'resolved' && t.status !== 'resolved') return false;
      if (!term) return true;
      return (
        t.clientName.toLowerCase().includes(term) ||
        t.clientEmail.toLowerCase().includes(term) ||
        t.lastMessageText.toLowerCase().includes(term)
      );
    });
  }, [threads, inboxFilter, searchQuery]);

  const totalUnreadCount = useMemo(
    () => threads.reduce((sum, t) => sum + (t.unreadByAdmin > 0 ? 1 : 0), 0),
    [threads],
  );

  const handleSelectThread = (thread: ChatThread) => {
    setSelectedThreadId(thread.id);
    setMsgLimit(60);
    setChatViewMode('chat');
    setVideoCallNotice(false);
  };

  const handleSendAdminPayload = async (payload: {
    messageType: MessageType;
    text: string;
    mediaUrl?: string;
    mediaMimeType?: string;
  }) => {
    if (!selectedThread) return;
    await sendMessageAtomic({
      threadId: selectedThread.id,
      sender: user,
      senderRole: 'admin',
      text: payload.text,
      messageType: payload.messageType,
      mediaUrl: payload.mediaUrl,
      mediaMimeType: payload.mediaMimeType,
      threadExists: true,
    });
    setChatViewMode('chat');

    const pushPreview =
      payload.messageType === 'audio'
        ? lang === 'bn'
          ? 'নতুন ভয়েস মেসেজ পাঠিয়েছেন'
          : 'Sent a voice message'
        : payload.messageType === 'image'
          ? lang === 'bn'
            ? 'নতুন ছবি পাঠিয়েছেন'
            : 'Sent a photo'
          : payload.messageType === 'video'
            ? lang === 'bn'
              ? 'নতুন ভিডিও পাঠিয়েছেন'
              : 'Sent a video'
            : payload.text || (lang === 'bn' ? 'নতুন মেসেজ এসেছে' : 'New message');

    void dispatchAdminPushNotification({
      adminUser: user,
      targetUserId: selectedThread.id,
      title: settings.pageName,
      body: pushPreview,
      tag: `thread-${selectedThread.id}`,
    });
  };

  const handleToggleThreadStatus = async () => {
    if (!selectedThread) return;
    const nextStatus = selectedThread.status === 'resolved' ? 'open' : 'resolved';
    await updateThreadAdminState(selectedThread.id, nextStatus);
  };

  const handlePublishBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bTitle.trim() || !bText.trim() || sendingBroadcast) return;

    setSendingBroadcast(true);
    setBroadcastFeedback(null);
    try {
      if (editingBroadcastId) {
        await editBroadcast({
          broadcastId: editingBroadcastId,
          title: bTitle,
          text: bText,
          category: bCategory,
        });
        setEditingBroadcastId(null);
        setBroadcastFeedback(
          lang === 'bn'
            ? 'ব্রডকাস্ট বার্তাটি সফলভাবে আপডেট করা হয়েছে।'
            : 'Broadcast updated successfully.',
        );
      } else {
        await createBroadcast({
          author: user,
          title: bTitle,
          text: bText,
          category: bCategory,
        });
        void dispatchAdminPushNotification({
          adminUser: user,
          broadcast: true,
          title: bTitle.trim() || settings.pageName,
          body: bText.trim(),
          tag: `broadcast-${Date.now()}`,
        });
        setBroadcastFeedback(
          lang === 'bn'
            ? 'সকল ইউজারের কাছে বার্তাটি রিয়েল-টাইমে পাঠানো হয়েছে।'
            : 'Broadcast sent in real time to all users.',
        );
      }
      setBTitle('');
      setBText('');
      setBCategory('announcement');
    } finally {
      setSendingBroadcast(false);
    }
  };

  const handleStartEditBroadcast = (b: BroadcastMessage) => {
    setEditingBroadcastId(b.id);
    setBTitle(b.title);
    setBText(b.text);
    setBCategory(b.category);
    setBroadcastFeedback(null);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingSettings) return;
    setSavingSettings(true);
    setSettingsSavedMsg(null);
    try {
      await savePublicSettings(user, settingsForm);
      setSettingsSavedMsg(
        lang === 'bn' ? 'সেটিংস সংরক্ষিত হয়েছে।' : 'Page settings saved.',
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveAdminPhoto = async (newPhotoURL: string) => {
    await updateUserProfilePhoto({
      user,
      photoURL: newPhotoURL,
      isAdminUser: true,
      currentSettings: settingsForm,
    });
    setSettingsForm((prev) => ({ ...prev, adminAvatarURL: newPhotoURL }));
  };

  const handleSignOutWithPresence = async () => {
    if (presenceMode === 'auto') {
      await updateAdminPresence(user, false, 'auto');
    }
    onSignOut();
  };

  const handleSaveLinksPool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingLinksConfig) return;
    setLinksError(null);
    setLinksFeedback(null);

    const parsedLinks = linksTextDraft
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const validLinks = parsedLinks.filter(isSafeHttpsLink);
    if (validLinks.length === 0) {
      setLinksError(
        lang === 'bn'
          ? 'অন্তত একটি সঠিক https:// লিংক দিন।'
          : 'Please enter at least one valid https:// link.',
      );
      return;
    }

    setSavingLinksConfig(true);
    try {
      await saveSponsoredLinksConfig(user, {
        enabled: linksEnabledDraft,
        messagesBeforeLink: linksIntervalDraft,
        links: validLinks,
      });
      setLinksFeedback(
        lang === 'bn'
          ? `${validLinks.length}টি লিংক ও ${linksIntervalDraft}-মেসেজ নিয়ম সংরক্ষণ করা হয়েছে।`
          : `Saved ${validLinks.length} rotating links (${linksIntervalDraft}-message cycle).`,
      );
    } catch (err) {
      setLinksError(
        err instanceof Error
          ? err.message
          : lang === 'bn'
            ? 'লিংক সেটিংস সেভ করা যায়নি।'
            : 'Failed to save link settings.',
      );
    } finally {
      setSavingLinksConfig(false);
    }
  };

  const handleAssignUserFirstLink = async (
    targetUserId: string,
    assignedFirstLink: string,
    resetCounter = false,
  ) => {
    setAssigningUserId(targetUserId);
    try {
      await adminAssignFirstLinkForUser({
        userId: targetUserId,
        assignedFirstLink,
        resetCounter,
        currentState: linkStatesMap[targetUserId] ?? null,
      });
    } finally {
      setAssigningUserId(null);
    }
  };

  const filteredReviewThreads = useMemo(() => {
    const term = linkReviewSearch.trim().toLowerCase();
    if (!term) return threads;
    return threads.filter(
      (t) =>
        t.clientName.toLowerCase().includes(term) ||
        t.clientEmail.toLowerCase().includes(term) ||
        t.clientId.toLowerCase().includes(term),
    );
  }, [threads, linkReviewSearch]);

  return (
    <div className="h-[100dvh] w-full bg-slate-100 flex flex-col overflow-hidden">
      {/* Top Bar */}
      <header className="h-14 bg-white border-b border-slate-200 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0 pt-safe">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setPhotoModalOpen(true)}
            title={lang === 'bn' ? 'অ্যাডমিন প্রোফাইল ছবি পরিবর্তন করুন' : 'Change Admin Avatar'}
            className="relative group cursor-pointer shrink-0"
          >
            <Avatar src={settings.adminAvatarURL} name={settings.pageName} size="sm" />
          </button>
          <span className="text-base font-bold text-slate-900 tracking-tight whitespace-nowrap shrink-0 font-display">
            {settings.pageName}
          </span>
        </div>

        {/* Desktop Tab Navigation */}
        <nav className="hidden md:flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setSection('inbox')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              section === 'inbox'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>
              {lang === 'bn' ? 'ক্লায়েন্ট ইনবক্স' : 'Client Inbox'}
              {totalUnreadCount > 0 ? ` (${totalUnreadCount})` : ''}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSection('broadcast')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              section === 'broadcast'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Megaphone className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'সবার জন্য মেসেজ' : 'Broadcast All'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('links')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              section === 'links'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'লিংক ও রিভিউ' : 'Link Review'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('settings')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              section === 'settings'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'সেটিংস' : 'Settings'}</span>
          </button>
        </nav>

        {/* Actions + Live Active Status Control */}
        <div className="flex items-center gap-2 shrink-0">
          <select
            aria-label={lang === 'bn' ? 'অ্যাক্টিভ স্ট্যাটাস' : 'Active Status'}
            value={presenceMode}
            onChange={(e) => void handleChangePresenceMode(e.target.value as PresenceMode)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border cursor-pointer focus:outline-none ${
              adminOnline
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-slate-100 text-slate-700 border-slate-200'
            }`}
          >
            <option value="auto">
              {lang === 'bn' ? 'অনলাইন (অটো)' : 'Active (Auto)'}
            </option>
            <option value="online">
              {lang === 'bn' ? 'সবসময় অনলাইন' : 'Always Online'}
            </option>
            <option value="offline">
              {lang === 'bn' ? 'অফলাইন দেখান' : 'Appear Offline'}
            </option>
          </select>

          <PWAInstallButton lang={lang} variant="compact" />
          <button
            type="button"
            onClick={onEnterClientPreview}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'ক্লায়েন্ট ভিউ' : 'Client View'}</span>
          </button>
          <button
            type="button"
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'EN' : 'বাংলা'}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSignOutWithPresence()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{lang === 'bn' ? 'লগআউট' : 'Sign Out'}</span>
          </button>
        </div>
      </header>

      {/* Mobile Tab Strip */}
      <div className="md:hidden bg-white border-b border-slate-200 px-2.5 py-1.5 flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setSection('inbox')}
          className={`flex-1 min-h-[40px] py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
            section === 'inbox' ? 'bg-blue-600 text-white' : 'text-slate-600'
          }`}
        >
          {lang === 'bn' ? `ইনবক্স (${totalUnreadCount})` : `Inbox (${totalUnreadCount})`}
        </button>
        <button
          type="button"
          onClick={() => setSection('broadcast')}
          className={`flex-1 min-h-[40px] py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
            section === 'broadcast' ? 'bg-blue-600 text-white' : 'text-slate-600'
          }`}
        >
          {lang === 'bn' ? 'ব্রডকাস্ট' : 'Broadcast'}
        </button>
        <button
          type="button"
          onClick={() => setSection('links')}
          className={`flex-1 min-h-[40px] py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
            section === 'links' ? 'bg-blue-600 text-white' : 'text-slate-600'
          }`}
        >
          {lang === 'bn' ? 'লিংক' : 'Links'}
        </button>
        <button
          type="button"
          onClick={() => setSection('settings')}
          className={`flex-1 min-h-[40px] py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
            section === 'settings' ? 'bg-blue-600 text-white' : 'text-slate-600'
          }`}
        >
          {lang === 'bn' ? 'সেটিংস' : 'Settings'}
        </button>
      </div>

      {/* SECTION 1: MESSENGER ADMIN INBOX */}
      {section === 'inbox' && (
        <div className="flex-1 flex min-h-0 max-w-7xl w-full mx-auto bg-white lg:my-4 lg:rounded-2xl lg:border lg:border-slate-200 lg:shadow-sm overflow-hidden">
          {/* Left Thread Directory */}
          <aside
            className={`${
              selectedThreadId ? 'hidden md:flex' : 'flex'
            } flex-col w-full md:w-84 lg:w-96 border-r border-slate-200 bg-white shrink-0`}
          >
            <div className="p-4 border-b border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h1 className="text-base font-bold text-slate-900">
                  {lang === 'bn' ? 'সকল ইউজার চ্যাট' : 'All Client Threads'}
                </h1>
                <span className="text-xs text-slate-500 tabular-nums">
                  {threads.length} {lang === 'bn' ? 'জন' : 'loaded'}
                </span>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    lang === 'bn' ? 'নাম বা ইমেইল দিয়ে খুঁজুন...' : 'Search name or email...'
                  }
                  className="w-full min-h-[42px] pl-9 pr-3 py-2 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(['all', 'unread', 'resolved'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setInboxFilter(tab)}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      inboxFilter === tab
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab === 'all'
                      ? lang === 'bn'
                        ? 'সব'
                        : 'All'
                      : tab === 'unread'
                        ? lang === 'bn'
                          ? `অপঠিত (${totalUnreadCount})`
                          : `Unread (${totalUnreadCount})`
                        : lang === 'bn'
                          ? 'সমাধান'
                          : 'Resolved'}
                  </button>
                ))}
              </div>
            </div>

            {/* Thread List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {loadingThreads ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  {lang === 'bn' ? 'কনভার্সেশন লোড হচ্ছে...' : 'Loading conversations...'}
                </div>
              ) : filteredThreads.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <p className="text-sm font-medium text-slate-700">
                    {lang === 'bn' ? 'কোনো চ্যাট পাওয়া যায়নি' : 'No conversations found'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {lang === 'bn'
                      ? 'কোনো ক্লায়েন্ট লগইন করে মেসেজ পাঠালে এখানে সাথে সাথে দেখা যাবে।'
                      : 'When clients sign in and message you, their threads appear here instantly.'}
                  </p>
                </div>
              ) : (
                <>
                  {filteredThreads.map((t) => {
                    const isSelected = t.id === selectedThreadId;
                    const isUnread = t.unreadByAdmin > 0;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSelectThread(t)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                          isSelected ? 'bg-blue-50/90' : 'hover:bg-slate-50'
                        }`}
                      >
                        <Avatar src={t.clientPhotoURL} name={t.clientName} size="md" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p
                              className={`text-sm truncate ${
                                isUnread
                                  ? 'font-bold text-slate-900'
                                  : 'font-semibold text-slate-800'
                              }`}
                            >
                              {t.clientName}
                            </p>
                            <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                              {formatRelativeTime(t.lastMessageAt, lang)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <p
                              className={`text-xs truncate ${
                                isUnread ? 'font-medium text-slate-900' : 'text-slate-500'
                              }`}
                            >
                              {t.lastMessageText
                                ? `${t.lastMessageSender === 'admin' ? (lang === 'bn' ? 'আপনি: ' : 'You: ') : ''}${t.lastMessageText}`
                                : lang === 'bn'
                                  ? 'নতুন ইউজার যুক্ত হয়েছে'
                                  : 'New user connected'}
                            </p>
                            {isUnread && (
                              <span className="text-[11px] font-bold text-blue-600 tabular-nums shrink-0">
                                {t.unreadByAdmin}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {hasMoreThreads && (
                    <div className="p-3">
                      <button
                        type="button"
                        onClick={() => setThreadLimit((prev) => prev + 50)}
                        className="w-full py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        {lang === 'bn' ? 'আরও ৫০টি চ্যাট লোড করুন' : 'Load 50 more threads'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>

          {/* Right 1-to-1 Chat Panel */}
          <section
            className={`${
              selectedThreadId ? 'flex' : 'hidden md:flex'
            } flex-1 flex-col min-w-0 bg-white`}
          >
            {!selectedThread ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
                  <Inbox className="w-6 h-6" />
                </div>
                <h2 className="text-base font-bold text-slate-900">
                  {lang === 'bn'
                    ? 'কথা বলতে বাম দিক থেকে একজন ইউজার নির্বাচন করুন'
                    : 'Select a client thread to start replying'}
                </h2>
                <p className="text-xs text-slate-500 max-w-sm mt-1 leading-relaxed">
                  {lang === 'bn'
                    ? 'আপনি প্রতিটি ইউজারের সাথে টেক্সট, ছবি, নারী কণ্ঠে ভয়েস এবং ভিডিও শেয়ার করতে পারবেন অথবা সবার জন্য মেসেজ ট্যাব থেকে একসাথে সবাইকে বার্তা পাঠাতে পারবেন।'
                    : 'Reply privately with text, photos, female-converted voice, and video, or broadcast to all users.'}
                </p>
              </div>
            ) : (
              <>
                {/* Selected Client Header */}
                <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedThreadId(null)}
                      aria-label="Back to thread list"
                      className="md:hidden min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-100 cursor-pointer shrink-0"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <Avatar
                      src={selectedThread.clientPhotoURL}
                      name={selectedThread.clientName}
                      size="md"
                    />
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-slate-900 truncate">
                        {selectedThread.clientName}
                      </h2>
                      <p className="text-xs text-slate-500 truncate">
                        {selectedThread.clientEmail} ·{' '}
                        {selectedThread.status === 'resolved'
                          ? lang === 'bn'
                            ? 'সমাধানকৃত'
                            : 'Resolved'
                          : lang === 'bn'
                            ? 'চলমান'
                            : 'Open'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Unified Pics & Videos Section Toggle */}
                    <button
                      type="button"
                      onClick={() =>
                        setChatViewMode((prev) => (prev === 'chat' ? 'media' : 'chat'))
                      }
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        chatViewMode === 'media'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">
                        {lang === 'bn'
                          ? `ছবি ও ভিডিও (${selectedMediaCount})`
                          : `Pics & Videos (${selectedMediaCount})`}
                      </span>
                    </button>

                    {/* Locked Video Call Indicator */}
                    <button
                      type="button"
                      onClick={() => setVideoCallNotice((prev) => !prev)}
                      title={
                        lang === 'bn'
                          ? 'ভিডিও কল (লক / বন্ধ রাখা)'
                          : 'Video Call (Locked / Off)'
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Video className="w-3.5 h-3.5 text-slate-400" />
                      <Lock className="w-3 h-3 text-slate-500" />
                      <span className="hidden lg:inline">
                        {lang === 'bn' ? 'ভিডিও কল (লক)' : 'Video Call (Off)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleThreadStatus()}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedThread.status === 'resolved'
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      {selectedThread.status === 'resolved' ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">
                            {lang === 'bn' ? 'পুনরায় খুলুন' : 'Reopen'}
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">
                            {lang === 'bn' ? 'সমাধান' : 'Resolve'}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Inline Per-User Link Review & First-Link Control Strip */}
                {linksConfig.enabled && (() => {
                  const st = linkStatesMap[selectedThread.clientId] ?? null;
                  const countInCycle = st?.messagesSinceLink ?? 0;
                  const cycles = st?.cycleCount ?? 0;
                  const nextUrl = resolveActiveLinkForUser({
                    userId: selectedThread.clientId,
                    links: linksConfig.links,
                    assignedFirstLink: st?.assignedFirstLink,
                    cycleCount: cycles,
                  });
                  return (
                    <div className="px-4 sm:px-6 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2 text-slate-600 min-w-0">
                        <Link2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="font-medium text-slate-800 tabular-nums">
                          {lang === 'bn'
                            ? `লিংক কাউন্টার: ${countInCycle}/${linksConfig.messagesBeforeLink}`
                            : `Link Step: ${countInCycle}/${linksConfig.messagesBeforeLink}`}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="truncate max-w-[240px] text-slate-600">
                          {lang === 'bn' ? 'পরবর্তী লিংক: ' : 'Next: '}
                          <span className="font-mono text-slate-800">
                            {nextUrl ? formatShortLinkLabel(nextUrl) : '—'}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          aria-label={
                            lang === 'bn'
                              ? 'এই আইডিতে কোন লিংক প্রথমে যাবে'
                              : 'First link for this user ID'
                          }
                          disabled={assigningUserId === selectedThread.clientId}
                          value={st?.assignedFirstLink ?? ''}
                          onChange={(e) =>
                            void handleAssignUserFirstLink(
                              selectedThread.clientId,
                              e.target.value,
                            )
                          }
                          className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:border-blue-500 focus:outline-none max-w-[220px] cursor-pointer"
                        >
                          <option value="">
                            {lang === 'bn'
                              ? 'অটো রোটেট (সব লিংক)'
                              : 'Auto Rotate (All Links)'}
                          </option>
                          {linksConfig.links.map((lnk, idx) => (
                            <option key={lnk} value={lnk}>
                              #{idx + 1} · {formatShortLinkLabel(lnk)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setSection('links')}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap cursor-pointer"
                        >
                          {lang === 'bn' ? 'সব রিভিউ' : 'Review All'}
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {videoCallNotice && (
                  <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 text-xs text-slate-700">
                    <span className="flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>
                        {lang === 'bn'
                          ? 'ভিডিও কল অপশনটি বর্তমানে লক/বন্ধ অবস্থায় রয়েছে। নিচ থেকে ছবি, ভিডিও ক্লিপ বা নারী কণ্ঠে ভয়েস মেসেজ পাঠাতে পারবেন।'
                          : 'Live video calling is locked/off. You can share photos, video clips, or voice messages below.'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setVideoCallNotice(false)}
                      className="text-slate-500 hover:text-slate-800 font-medium cursor-pointer shrink-0"
                    >
                      {lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
                    </button>
                  </div>
                )}

                {chatViewMode === 'media' ? (
                  <MediaGalleryPanel
                    messages={messages}
                    lang={lang}
                    onClose={() => setChatViewMode('chat')}
                  />
                ) : (
                  <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4 bg-slate-50/40">
                    {hasMoreMessages && (
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => setMsgLimit((prev) => prev + 60)}
                          className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                        >
                          {lang === 'bn' ? 'আগের মেসেজ লোড করুন' : 'Load earlier messages'}
                        </button>
                      </div>
                    )}

                    {loadingMessages ? (
                      <div className="py-12 text-center text-xs text-slate-500">
                        {lang === 'bn' ? 'মেসেজ লোড হচ্ছে...' : 'Loading messages...'}
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="py-12 text-center text-xs text-slate-500">
                        {lang === 'bn'
                          ? 'এই ইউজারের সাথে এখনো কোনো মেসেজ আদান-প্রদান হয়নি। নিচে লিখে বা ছবি/ভিডিও/অডিও দিয়ে কথোপকথন শুরু করুন।'
                          : 'No messages exchanged yet. Send text, photo, voice, or video below.'}
                      </div>
                    ) : (
                      messages.map((m) => {
                        const isAdminOrSystem =
                          m.senderRole === 'admin' || m.senderRole === 'system';
                        if (isAdminOrSystem) {
                          return (
                            <div key={m.id} className="flex justify-end">
                              <div className="max-w-[82%] sm:max-w-lg space-y-1 flex flex-col items-end">
                                <div
                                  className={`px-4 py-2.5 rounded-2xl rounded-br-sm ${
                                    m.senderRole === 'system'
                                      ? 'bg-slate-200 text-slate-800'
                                      : 'bg-blue-600 text-white'
                                  }`}
                                >
                                  <MediaMessageContent
                                    message={m}
                                    isOwn={m.senderRole === 'admin'}
                                  />
                                </div>
                                <span className="text-[11px] text-slate-400 px-1 tabular-nums">
                                  {m.senderRole === 'system'
                                    ? `${lang === 'bn' ? 'অটো মেসেজ' : 'Auto Reply'} · `
                                    : ''}
                                  {formatMessageTime(m.createdAt, lang)}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={m.id} className="flex items-end gap-2.5 max-w-[85%] sm:max-w-lg">
                            <Avatar
                              src={selectedThread.clientPhotoURL}
                              name={selectedThread.clientName}
                              size="sm"
                            />
                            <div className="space-y-1">
                              <div className="bg-slate-100 text-slate-900 px-4 py-2.5 rounded-2xl rounded-bl-sm">
                                <MediaMessageContent message={m} isOwn={false} />
                              </div>
                              <span className="block text-[11px] text-slate-400 px-1 tabular-nums">
                                {formatMessageTime(m.createdAt, lang)}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}

                {/* Reply Composer (with Female Voice Mode ON by default!) */}
                <ChatComposer
                  user={user}
                  threadId={selectedThread.id}
                  lang={lang}
                  enableFemaleVoiceOption={true}
                  placeholder={
                    lang === 'bn'
                      ? `${selectedThread.clientName}-কে মেসেজ, নারী কণ্ঠে ভয়েস বা ছবি/ভিডিও পাঠান...`
                      : `Send message, female voice, photo, or video to ${selectedThread.clientName}...`
                  }
                  onSendPayload={handleSendAdminPayload}
                />
              </>
            )}
          </section>
        </div>
      )}

      {/* SECTION 2: BROADCAST STUDIO */}
      {section === 'broadcast' && (
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Compose Broadcast */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
              <div>
                <h1 className="text-lg font-bold text-slate-900">
                  {editingBroadcastId
                    ? lang === 'bn'
                      ? 'ব্রডকাস্ট বার্তা সম্পাদনা'
                      : 'Edit Broadcast Message'
                    : lang === 'bn'
                      ? 'সব ইউজারকে একসাথে মেসেজ পাঠান'
                      : 'Broadcast Message to All Users'}
                </h1>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {lang === 'bn'
                    ? 'এখানে পাঠানো বার্তা আপনার সাইটের সকল ১০,০০০ বা ১,০০,০০০+ ইউজারের মেসেঞ্জার চ্যাটে একসাথে রিয়েল-টাইমে পৌঁছে যাবে।'
                    : 'Messages published here are delivered simultaneously in real time to every user connected to your site.'}
                </p>
              </div>

              <form onSubmit={handlePublishBroadcast} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    {lang === 'bn' ? 'বার্তার ধরন' : 'Category'}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {CATEGORY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setBCategory(opt.value)}
                        className={`px-3 py-2 text-xs font-medium rounded-xl border transition-colors cursor-pointer ${
                          bCategory === opt.value
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {lang === 'bn' ? opt.bn : opt.en}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="broadcast-title"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    {lang === 'bn' ? 'শিরোনাম (Title)' : 'Title'}
                  </label>
                  <input
                    id="broadcast-title"
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.BROADCAST_TITLE_MAX}
                    value={bTitle}
                    onChange={(e) => setBTitle(e.target.value)}
                    placeholder={
                      lang === 'bn'
                        ? 'যেমন: আজকের বিশেষ আপডেট বা জরুরি নোটিশ'
                        : 'e.g., Important Service Update'
                    }
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="broadcast-body"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      {lang === 'bn' ? 'মূল মেসেজ' : 'Message Body'}
                    </label>
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      {bText.length}/{FIELD_LIMITS.MESSAGE_TEXT_MAX}
                    </span>
                  </div>
                  <textarea
                    id="broadcast-body"
                    rows={5}
                    required
                    maxLength={FIELD_LIMITS.MESSAGE_TEXT_MAX}
                    value={bText}
                    onChange={(e) => setBText(e.target.value)}
                    placeholder={
                      lang === 'bn'
                        ? 'সকল ইউজারকে যা জানাতে চান তা এখানে বিস্তারিত লিখুন...'
                        : 'Write the announcement you want every user to receive...'
                    }
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none resize-y"
                  />
                </div>

                {broadcastFeedback && (
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{broadcastFeedback}</span>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={!bTitle.trim() || !bText.trim() || sendingBroadcast}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
                  >
                    <Megaphone className="w-4 h-4" />
                    <span>
                      {sendingBroadcast
                        ? lang === 'bn'
                          ? 'পাঠানো হচ্ছে...'
                          : 'Publishing...'
                        : editingBroadcastId
                          ? lang === 'bn'
                            ? 'আপডেট সংরক্ষণ করুন'
                            : 'Save Changes'
                          : lang === 'bn'
                            ? 'সকল ইউজারকে পাঠান'
                            : 'Send to All Users'}
                    </span>
                  </button>

                  {editingBroadcastId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBroadcastId(null);
                        setBTitle('');
                        setBText('');
                      }}
                      className="px-4 py-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Broadcast History */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-slate-900">
                  {lang === 'bn' ? 'পাঠানো ব্রডকাস্ট তালিকা' : 'Sent Broadcasts'}
                </h2>
                <span className="text-xs text-slate-500 tabular-nums">{broadcasts.length}</span>
              </div>

              {broadcasts.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  {lang === 'bn'
                    ? 'এখনো কোনো ব্রডকাস্ট পাঠানো হয়নি।'
                    : 'No broadcasts published yet.'}
                </div>
              ) : (
                <div className="space-y-3 overflow-y-auto max-h-[540px] pr-1">
                  {broadcasts.map((b) => (
                    <div
                      key={b.id}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-medium text-blue-700">
                          {CATEGORY_OPTIONS.find((c) => c.value === b.category)?.[lang] ??
                            b.category}
                        </span>
                        <span className="tabular-nums">
                          {formatRelativeTime(b.createdAt, lang)}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{b.title}</h3>
                      <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {b.text}
                      </p>

                      <div className="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditBroadcast(b)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-600 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>{lang === 'bn' ? 'সম্পাদনা' : 'Edit'}</span>
                        </button>

                        {confirmDeleteId === b.id ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await removeBroadcast(b.id);
                                setConfirmDeleteId(null);
                              }}
                              className="text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                            >
                              {lang === 'bn' ? 'মুছে ফেলুন নিশ্চিত?' : 'Confirm Delete'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-slate-500 cursor-pointer"
                            >
                              {lang === 'bn' ? 'না' : 'No'}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(b.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{lang === 'bn' ? 'মুছুন' : 'Delete'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: ROTATING LINKS & PER-USER LINK REVIEW */}
      {section === 'links' && (
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Link Pool & 5-Message Rule Configuration */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5 h-fit">
              <div>
                <h1 className="text-lg font-bold text-slate-900">
                  {lang === 'bn'
                    ? 'লিংক রোটেশন ও ৫-মেসেজ সেটিংস'
                    : 'Rotating Links & 5-Message Rule'}
                </h1>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {lang === 'bn'
                    ? 'প্রতি ইউজার ৫টি মেসেজ পাঠানোর পর Send বাটনের জায়গায় স্পষ্টভাবে এই লিংকগুলোর একটি ওপেন করার অপশন দেখাবে এবং প্রতিটি ইউজারের আইডিতে লিংকগুলো রোটেট করে চলবে।'
                    : 'After every N messages from a user, the composer visibly shows a rotating link button in place of Send and rotates across all links per user ID.'}
                </p>
              </div>

              <form onSubmit={handleSaveLinksPool} className="space-y-4">
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      {lang === 'bn'
                        ? '৫-মেসেজ পরপর লিংক অপশন চালু রাখুন'
                        : 'Enable Rotating Link Step'}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {lang === 'bn'
                        ? 'চালু থাকলে ইউজাররা নির্দিষ্ট মেসেজ পরপর লিংক ওপেন বাটন দেখতে পাবে।'
                        : 'Shows the link button in place of Send after the configured message count.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLinksEnabledDraft((prev) => !prev)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer shrink-0 ${
                      linksEnabledDraft
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-200 text-slate-700 border-slate-300'
                    }`}
                  >
                    {linksEnabledDraft
                      ? lang === 'bn'
                        ? 'চালু (ON)'
                        : 'ON'
                      : lang === 'bn'
                        ? 'বন্ধ (OFF)'
                        : 'OFF'}
                  </button>
                </div>

                <div>
                  <label
                    htmlFor="links-interval"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    {lang === 'bn'
                      ? 'কতটি মেসেজ দেওয়ার পর লিংক অপশন আসবে'
                      : 'Messages before link button appears'}
                  </label>
                  <input
                    id="links-interval"
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={linksIntervalDraft}
                    onChange={(e) =>
                      setLinksIntervalDraft(
                        Math.min(50, Math.max(1, Number(e.target.value) || 5)),
                      )
                    }
                    className="w-32 px-3.5 py-2 text-sm font-mono-tabular bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="links-pool-textarea"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      {lang === 'bn'
                        ? 'লিংক তালিকা (প্রতি লাইনে একটি https:// লিংক)'
                        : 'Rotating Link Pool (one https:// URL per line)'}
                    </label>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {
                        linksTextDraft
                          .split('\n')
                          .map((l) => l.trim())
                          .filter(isSafeHttpsLink).length
                      }
                      /20
                    </span>
                  </div>
                  <textarea
                    id="links-pool-textarea"
                    rows={9}
                    value={linksTextDraft}
                    onChange={(e) => setLinksTextDraft(e.target.value)}
                    placeholder="https://uplcm.com/4/..."
                    className="w-full px-3.5 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none leading-relaxed"
                  />
                </div>

                {linksError && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                    {linksError}
                  </div>
                )}

                {linksFeedback && (
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{linksFeedback}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={savingLinksConfig}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
                >
                  <Link2 className="w-4 h-4" />
                  <span>
                    {savingLinksConfig
                      ? lang === 'bn'
                        ? 'সংরক্ষণ হচ্ছে...'
                        : 'Saving...'
                      : lang === 'bn'
                        ? 'লিংক সেটিংস সংরক্ষণ করুন'
                        : 'Save Link Settings'}
                  </span>
                </button>
              </form>
            </div>

            {/* Right: Per-User ID Review & Priority Link Assignment */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {lang === 'bn'
                      ? 'প্রতিটি ইউজার আইডি রিভিউ ও প্রথম লিংক নির্ধারণ'
                      : 'Review User IDs & Assign First Link'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {lang === 'bn'
                      ? 'কোন ইউজার আইডিতে কোন লিংকটি প্রথমে যাবে তা এখান থেকে রিভিউ ও পরিবর্তন করুন। বাকিগুলো অটোমেটিক রোটেশনে চলবে।'
                      : 'Review each user ID and choose which link goes first, or leave on Auto Rotate.'}
                  </p>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={linkReviewSearch}
                    onChange={(e) => setLinkReviewSearch(e.target.value)}
                    placeholder={
                      lang === 'bn'
                        ? 'নাম, ইমেইল বা User ID খুঁজুন...'
                        : 'Search name, email or ID...'
                    }
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {filteredReviewThreads.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                  {lang === 'bn'
                    ? 'এখনো কোনো ইউজার আইডি পাওয়া যায়নি। কোনো ইউজার লগইন করলে এখানে দেখা যাবে।'
                    : 'No client IDs found yet. Once users sign in, they appear here for review.'}
                </div>
              ) : (
                <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
                  {filteredReviewThreads.map((t) => {
                    const st = linkStatesMap[t.clientId] ?? null;
                    const countInCycle = st?.messagesSinceLink ?? 0;
                    const cycles = st?.cycleCount ?? 0;
                    const assignedFirst = st?.assignedFirstLink ?? '';
                    const activeNextUrl = resolveActiveLinkForUser({
                      userId: t.clientId,
                      links: linksConfig.links,
                      assignedFirstLink: assignedFirst,
                      cycleCount: cycles,
                    });
                    const isUpdating = assigningUserId === t.clientId;

                    return (
                      <div
                        key={t.clientId}
                        className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar
                              src={t.clientPhotoURL}
                              name={t.clientName}
                              size="md"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900 truncate">
                                {t.clientName}
                              </p>
                              <p className="text-xs text-slate-500 truncate">
                                {t.clientEmail}
                              </p>
                              <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                                ID: {t.clientId}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 text-xs tabular-nums shrink-0">
                            <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-semibold text-slate-800">
                              {countInCycle}/{linksConfig.messagesBeforeLink}{' '}
                              {lang === 'bn' ? 'মেসেজ' : 'msgs'}
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 font-medium text-blue-700">
                              {lang === 'bn' ? `সাইকেল: ${cycles}` : `Cycles: ${cycles}`}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center pt-1 border-t border-slate-200/70">
                          <div className="sm:col-span-5 text-xs min-w-0">
                            <span className="block text-[11px] text-slate-500">
                              {lang === 'bn'
                                ? 'এই আইডিতে পরবর্তী/বর্তমান লিংক:'
                                : 'Active / Next Link for this ID:'}
                            </span>
                            {activeNextUrl ? (
                              <a
                                href={activeNextUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-xs text-blue-700 hover:underline truncate max-w-full mt-0.5"
                              >
                                <span className="truncate">
                                  {formatShortLinkLabel(activeNextUrl)}
                                </span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </div>

                          <div className="sm:col-span-5">
                            <label className="block text-[11px] text-slate-500 mb-0.5">
                              {lang === 'bn'
                                ? 'প্রথম লিংক সেট করুন:'
                                : 'Assign First Link:'}
                            </label>
                            <select
                              disabled={isUpdating}
                              value={assignedFirst}
                              onChange={(e) =>
                                void handleAssignUserFirstLink(
                                  t.clientId,
                                  e.target.value,
                                  false,
                                )
                              }
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:border-blue-500 focus:outline-none cursor-pointer"
                            >
                              <option value="">
                                {lang === 'bn'
                                  ? 'অটো রোটেট (ID অনুযায়ী)'
                                  : 'Auto Rotate (Per-ID Seed)'}
                              </option>
                              {linksConfig.links.map((lnk, idx) => (
                                <option key={lnk} value={lnk}>
                                  #{idx + 1} · {lnk}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-2 flex sm:justify-end pt-3 sm:pt-4">
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() =>
                                void handleAssignUserFirstLink(
                                  t.clientId,
                                  assignedFirst,
                                  true,
                                )
                              }
                              title={
                                lang === 'bn'
                                  ? 'কাউন্টার ও সাইকেল ০ থেকে রিসেট করুন'
                                  : 'Reset counter & cycle to 0'
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>{lang === 'bn' ? 'রিসেট' : 'Reset'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: PAGE, AVATAR & AUTO-MESSAGE SETTINGS */}
      {section === 'settings' && (
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
              <div className="flex items-center gap-4">
                <Avatar src={settingsForm.adminAvatarURL} name={settingsForm.pageName} size="xl" />
                <div>
                  <h1 className="text-lg font-bold text-slate-900">
                    {lang === 'bn' ? 'পেজ, ছবি ও অটো-মেসেজ সেটিংস' : 'Page, Avatar & Auto-Reply'}
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {lang === 'bn'
                      ? 'প্রোফাইল ছবি, নতুন ইউজারের ওয়েলকাম মেসেজ এবং অফলাইন মেসেজ কাস্টমাইজ করুন।'
                      : 'Customize your profile avatar, instant new-user welcome message, and offline retention reply.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPhotoModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl cursor-pointer shrink-0"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'প্রোফাইল ছবি বদলান' : 'Change Photo'}</span>
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === 'bn' ? 'পেজের নাম (Page Name)' : 'Page Name'}
                </label>
                <input
                  type="text"
                  required
                  maxLength={FIELD_LIMITS.PAGE_NAME_MAX}
                  value={settingsForm.pageName}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, pageName: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === 'bn' ? 'ট্যাগলাইন (Tagline)' : 'Tagline'}
                </label>
                <input
                  type="text"
                  required
                  maxLength={FIELD_LIMITS.TAGLINE_MAX}
                  value={settingsForm.tagline}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, tagline: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === 'bn' ? 'ভিজিটর পপআপ শিরোনাম' : 'Welcome Popup Title'}
                </label>
                <input
                  type="text"
                  required
                  maxLength={FIELD_LIMITS.POPUP_TITLE_MAX}
                  value={settingsForm.welcomePopupTitle}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, welcomePopupTitle: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === 'bn' ? 'ভিজিটর পপআপ বিবরণ' : 'Welcome Popup Subtitle'}
                </label>
                <textarea
                  rows={2}
                  required
                  maxLength={FIELD_LIMITS.POPUP_SUBTITLE_MAX}
                  value={settingsForm.welcomePopupSubtitle}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      welcomePopupSubtitle: e.target.value,
                    }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === 'bn'
                    ? 'নতুন ইউজার আসার সাথে সাথে স্বয়ংক্রিয় ওয়েলকাম মেসেজ'
                    : 'Auto Welcome Message for New Visitors'}
                </label>
                <textarea
                  rows={3}
                  required
                  maxLength={FIELD_LIMITS.GREETING_MAX}
                  value={settingsForm.greetingMessage}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, greetingMessage: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  {lang === 'bn'
                    ? 'যেকোনো নতুন ইউজার সাইটে লগইন করার সাথে সাথেই এই বার্তাটি তাদের চ্যাটে চলে যাবে।'
                    : 'Automatically delivered into the chat thread as soon as a new user joins.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === 'bn'
                    ? 'আপনি অফলাইনে থাকলে কাস্টমার ধরে রাখার অটো-রিপ্লাই মেসেজ'
                    : 'Offline Customer Retention Auto-Reply'}
                </label>
                <textarea
                  rows={3}
                  required
                  maxLength={FIELD_LIMITS.OFFLINE_REPLY_MAX}
                  value={settingsForm.offlineAutoReply}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, offlineAutoReply: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  {lang === 'bn'
                    ? 'আপনি লাইনে না থাকলে (অফলাইন অবস্থায়) কেউ মেসেজ পাঠালে সাথে সাথে এই বার্তাটি গিয়ে কাস্টমারকে ধরে রাখবে।'
                    : 'Sent automatically when a customer messages while you are offline so they stay engaged.'}
                </p>
              </div>

              {settingsSavedMsg && (
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{settingsSavedMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={savingSettings}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
              >
                {savingSettings
                  ? lang === 'bn'
                    ? 'সংরক্ষণ হচ্ছে...'
                    : 'Saving...'
                  : lang === 'bn'
                    ? 'পরিবর্তন সংরক্ষণ করুন'
                    : 'Save Settings'}
              </button>
            </form>
          </div>
        </div>
      )}

      <ProfilePhotoModal
        isOpen={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        currentPhotoURL={settingsForm.adminAvatarURL}
        displayName={settingsForm.pageName}
        lang={lang}
        onSavePhoto={handleSaveAdminPhoto}
      />
    </div>
  );
};
