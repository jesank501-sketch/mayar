import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  AdminPresence,
  BroadcastCategory,
  ChatMessage,
  DEFAULT_PAGE_SETTINGS,
  DEFAULT_SPONSORED_LINKS_CONFIG,
  FIELD_LIMITS,
  MessageType,
  PresenceMode,
  PublicPageSettings,
  ReplyTarget,
  SenderRole,
  SponsoredLinksConfig,
  ThreadStatus,
  UserLinkState,
} from '../types';
import { clampText } from '../utils/formatters';
import { isSafeHttpsLink } from '../utils/linkRotation';
import { isSafeAvatarUrl, isSafeMediaUrl } from '../utils/media';
import {
  extractPhoneFromSyntheticEmail,
  loadPendingPhoneDemoMeta,
  PhoneDemoMeta,
} from '../utils/phoneAuth';

export async function checkIsAdmin(user: User): Promise<boolean> {
  if (user.email === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified) {
    return true;
  }
  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    return adminSnap.exists();
  } catch {
    return false;
  }
}

export function computeEffectiveAdminOnline(presence: AdminPresence | null): boolean {
  if (!presence) return false;
  if (presence.mode === 'online') return true;
  if (presence.mode === 'offline') return false;
  if (!presence.isOnline || !presence.lastSeenAt) return false;
  return Date.now() - presence.lastSeenAt.toMillis() < 120_000;
}

export async function ensurePublicSettingsInitialized(admin: User): Promise<void> {
  const ref = doc(db, 'settings', 'public');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        pageName: DEFAULT_PAGE_SETTINGS.pageName,
        tagline: DEFAULT_PAGE_SETTINGS.tagline,
        welcomePopupTitle: DEFAULT_PAGE_SETTINGS.welcomePopupTitle,
        welcomePopupSubtitle: DEFAULT_PAGE_SETTINGS.welcomePopupSubtitle,
        greetingMessage: DEFAULT_PAGE_SETTINGS.greetingMessage,
        offlineAutoReply: DEFAULT_PAGE_SETTINGS.offlineAutoReply,
        adminAvatarURL: DEFAULT_PAGE_SETTINGS.adminAvatarURL,
        updatedAt: serverTimestamp(),
        updatedBy: admin.uid,
      });
    } else {
      const existing = snap.data() as Partial<PublicPageSettings>;
      if (!existing.offlineAutoReply || !existing.adminAvatarURL) {
        await updateDoc(ref, {
          pageName: clampText(existing.pageName, FIELD_LIMITS.PAGE_NAME_MAX, DEFAULT_PAGE_SETTINGS.pageName),
          tagline: clampText(existing.tagline, FIELD_LIMITS.TAGLINE_MAX, DEFAULT_PAGE_SETTINGS.tagline),
          welcomePopupTitle: clampText(
            existing.welcomePopupTitle,
            FIELD_LIMITS.POPUP_TITLE_MAX,
            DEFAULT_PAGE_SETTINGS.welcomePopupTitle,
          ),
          welcomePopupSubtitle: clampText(
            existing.welcomePopupSubtitle,
            FIELD_LIMITS.POPUP_SUBTITLE_MAX,
            DEFAULT_PAGE_SETTINGS.welcomePopupSubtitle,
          ),
          greetingMessage: clampText(
            existing.greetingMessage,
            FIELD_LIMITS.GREETING_MAX,
            DEFAULT_PAGE_SETTINGS.greetingMessage,
          ),
          offlineAutoReply: clampText(
            existing.offlineAutoReply,
            FIELD_LIMITS.OFFLINE_REPLY_MAX,
            DEFAULT_PAGE_SETTINGS.offlineAutoReply,
          ),
          adminAvatarURL:
            existing.adminAvatarURL && isSafeAvatarUrl(existing.adminAvatarURL)
              ? existing.adminAvatarURL
              : DEFAULT_PAGE_SETTINGS.adminAvatarURL,
          updatedAt: serverTimestamp(),
          updatedBy: admin.uid,
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/public');
  }
}

export async function updateAdminPresence(
  admin: User,
  isOnline: boolean,
  mode: PresenceMode,
): Promise<void> {
  const ref = doc(db, 'presence', 'admin');
  try {
    await setDoc(ref, {
      isOnline,
      mode,
      lastSeenAt: serverTimestamp(),
      updatedBy: admin.uid,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'presence/admin');
  }
}

export async function ensureUserAndThread(
  user: User,
  isAdminUser: boolean,
  demoMeta?: PhoneDemoMeta | null,
): Promise<string> {
  const uid = user.uid;
  const fallbackPhone = extractPhoneFromSyntheticEmail(user.email);
  const storedDemoMeta = demoMeta ?? loadPendingPhoneDemoMeta(user.email);
  const initialDisplayName = clampText(
    storedDemoMeta?.displayName ||
      user.displayName ||
      (fallbackPhone ? fallbackPhone : user.email?.split('@')[0]),
    FIELD_LIMITS.DISPLAY_NAME_MAX,
    'Client User',
  );
  const email = clampText(user.email, FIELD_LIMITS.EMAIL_MAX, 'client@user.local');
  const authPhoto = clampText(user.photoURL, FIELD_LIMITS.PHOTO_URL_MAX, '');
  let activePhotoURL = isSafeAvatarUrl(authPhoto) ? authPhoto : '';
  let finalDisplayName = initialDisplayName;
  let finalPhone = clampText(storedDemoMeta?.phone || fallbackPhone, FIELD_LIMITS.PHONE_MAX);
  let finalAddress = clampText(storedDemoMeta?.address, FIELD_LIMITS.ADDRESS_MAX);

  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid,
        displayName: finalDisplayName,
        email,
        photoURL: activePhotoURL,
        ...(finalPhone ? { phone: finalPhone } : {}),
        ...(finalAddress ? { address: finalAddress } : {}),
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      });
    } else {
      const existingData = userSnap.data() as {
        photoURL?: string;
        displayName?: string;
        phone?: string;
        address?: string;
      };
      if (existingData.photoURL && isSafeAvatarUrl(existingData.photoURL)) {
        activePhotoURL = existingData.photoURL;
      }
      finalDisplayName = clampText(
        storedDemoMeta?.displayName ||
          user.displayName ||
          existingData.displayName ||
          (fallbackPhone ? fallbackPhone : user.email?.split('@')[0]),
        FIELD_LIMITS.DISPLAY_NAME_MAX,
        'Client User',
      );
      finalPhone = finalPhone || clampText(existingData.phone, FIELD_LIMITS.PHONE_MAX);
      finalAddress = finalAddress || clampText(existingData.address, FIELD_LIMITS.ADDRESS_MAX);

      await updateDoc(userRef, {
        displayName: finalDisplayName,
        photoURL: activePhotoURL,
        ...(finalPhone ? { phone: finalPhone } : {}),
        ...(finalAddress ? { address: finalAddress } : {}),
        lastSeenAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  if (isAdminUser) {
    await Promise.all([
      ensurePublicSettingsInitialized(user),
      ensureSponsoredLinksInitialized(user),
    ]);
    return activePhotoURL;
  }

  const threadPath = `threads/${uid}`;
  const threadRef = doc(db, 'threads', uid);
  try {
    const threadSnap = await getDoc(threadRef);
    if (!threadSnap.exists()) {
      let greetingText = '';
      let pageName = DEFAULT_PAGE_SETTINGS.pageName;
      try {
        const settingsSnap = await getDoc(doc(db, 'settings', 'public'));
        if (settingsSnap.exists()) {
          const s = settingsSnap.data() as Partial<PublicPageSettings>;
          greetingText = clampText(s.greetingMessage, FIELD_LIMITS.GREETING_MAX);
          pageName = clampText(s.pageName, FIELD_LIMITS.PAGE_NAME_MAX, pageName);
        }
      } catch {
        greetingText = '';
      }

      const batch = writeBatch(db);
      batch.set(threadRef, {
        clientId: uid,
        clientName: finalDisplayName,
        clientEmail: email,
        clientPhotoURL: activePhotoURL,
        ...(finalPhone ? { clientPhone: finalPhone } : {}),
        ...(finalAddress ? { clientAddress: finalAddress } : {}),
        lastMessageText: greetingText ? clampText(greetingText, FIELD_LIMITS.THREAD_PREVIEW_MAX) : '',
        lastMessageSender: greetingText ? 'system' : 'admin',
        lastMessageAt: serverTimestamp(),
        unreadByAdmin: 0,
        unreadByClient: greetingText ? 1 : 0,
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (greetingText) {
        const welcomeMsgRef = doc(collection(db, 'threads', uid, 'messages'));
        batch.set(welcomeMsgRef, {
          threadId: uid,
          senderId: uid,
          senderRole: 'system',
          senderName: pageName,
          messageType: 'text',
          text: greetingText,
          mediaUrl: '',
          mediaMimeType: '',
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
    } else {
      const existingThread = threadSnap.data() as {
        clientName?: string;
        clientPhone?: string;
        clientAddress?: string;
        clientPhotoURL?: string;
      };
      const needsContactSync =
        (finalDisplayName && existingThread.clientName !== finalDisplayName) ||
        (finalPhone && existingThread.clientPhone !== finalPhone) ||
        (finalAddress && existingThread.clientAddress !== finalAddress);
      if (needsContactSync) {
        await updateDoc(threadRef, {
          clientName: finalDisplayName,
          clientPhotoURL: activePhotoURL || existingThread.clientPhotoURL || '',
          ...(finalPhone ? { clientPhone: finalPhone } : {}),
          ...(finalAddress ? { clientAddress: finalAddress } : {}),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, threadPath);
  }

  return activePhotoURL;
}

export async function updateUserProfilePhoto(params: {
  user: User;
  photoURL: string;
  isAdminUser: boolean;
  currentSettings: PublicPageSettings;
}): Promise<void> {
  const { user, photoURL, isAdminUser, currentSettings } = params;
  if (!isSafeAvatarUrl(photoURL)) {
    throw new Error('Invalid avatar URL');
  }

  const cleanPhoto = photoURL.slice(0, FIELD_LIMITS.PHOTO_URL_MAX);
  const storedDemoMeta = loadPendingPhoneDemoMeta(user.email);
  const fallbackPhone = extractPhoneFromSyntheticEmail(user.email);
  const displayName = clampText(
    storedDemoMeta?.displayName ||
      user.displayName ||
      fallbackPhone ||
      user.email?.split('@')[0],
    FIELD_LIMITS.DISPLAY_NAME_MAX,
    'User',
  );

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      displayName,
      photoURL: cleanPhoto,
      lastSeenAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
  }

  if (isAdminUser) {
    await savePublicSettings(user, {
      ...currentSettings,
      adminAvatarURL: cleanPhoto || DEFAULT_PAGE_SETTINGS.adminAvatarURL,
    });
    return;
  }

  try {
    await updateDoc(doc(db, 'threads', user.uid), {
      clientName: displayName,
      clientPhotoURL: cleanPhoto,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `threads/${user.uid}`);
  }
}

export async function sendMessageAtomic(params: {
  threadId: string;
  sender: User;
  senderRole: SenderRole;
  text: string;
  messageType?: MessageType;
  mediaUrl?: string;
  mediaMimeType?: string;
  threadExists: boolean;
  senderPhotoOverride?: string;
  senderNameOverride?: string;
  replyTo?: ReplyTarget | null;
}): Promise<void> {
  const {
    threadId,
    sender,
    senderRole,
    text,
    messageType = 'text',
    mediaUrl = '',
    mediaMimeType = '',
    threadExists,
    senderPhotoOverride,
    senderNameOverride,
    replyTo,
  } = params;

  const cleanText = clampText(text, FIELD_LIMITS.MESSAGE_TEXT_MAX);
  const cleanMediaUrl = mediaUrl.trim().slice(0, FIELD_LIMITS.MEDIA_URL_MAX);
  const cleanMime = mediaMimeType.trim().slice(0, FIELD_LIMITS.MEDIA_MIME_MAX);

  if (messageType === 'text' && !cleanText) return;
  if (messageType !== 'text' && !isSafeMediaUrl(cleanMediaUrl)) {
    throw new Error('Invalid media URL');
  }

  const storedDemoMeta = senderRole === 'client' ? loadPendingPhoneDemoMeta(sender.email) : null;
  const fallbackPhone =
    senderRole === 'client' ? extractPhoneFromSyntheticEmail(sender.email) : '';
  const senderPhone = clampText(storedDemoMeta?.phone || fallbackPhone, FIELD_LIMITS.PHONE_MAX);
  const senderAddress = clampText(storedDemoMeta?.address, FIELD_LIMITS.ADDRESS_MAX);

  const senderName = clampText(
    senderNameOverride ||
      sender.displayName ||
      storedDemoMeta?.displayName ||
      (fallbackPhone ? fallbackPhone : sender.email?.split('@')[0]),
    FIELD_LIMITS.DISPLAY_NAME_MAX,
    senderRole === 'admin' ? 'Admin' : 'Client',
  );

  const previewSource =
    cleanText ||
    (messageType === 'image'
      ? '📷 Photo shared'
      : messageType === 'video'
        ? '🎬 Video shared'
        : '🎤 Audio message');
  const previewText = clampText(previewSource, FIELD_LIMITS.THREAD_PREVIEW_MAX);

  const threadRef = doc(db, 'threads', threadId);
  let resolvedThreadExists = threadExists;
  if (!resolvedThreadExists) {
    try {
      const checkSnap = await getDoc(threadRef);
      resolvedThreadExists = checkSnap.exists();
    } catch {
      resolvedThreadExists = false;
    }
  }

  const messagesColRef = collection(db, 'threads', threadId, 'messages');
  const newMessageRef = doc(messagesColRef);
  const batch = writeBatch(db);

  const rawPhoto =
    senderPhotoOverride !== undefined
      ? senderPhotoOverride
      : clampText(sender.photoURL, FIELD_LIMITS.PHOTO_URL_MAX, '');
  const resolvedPhoto = isSafeAvatarUrl(rawPhoto) ? rawPhoto : '';

  if (!resolvedThreadExists) {
    const email = clampText(sender.email, FIELD_LIMITS.EMAIL_MAX, 'client@user.local');
    batch.set(threadRef, {
      clientId: threadId,
      clientName: senderName,
      clientEmail: email,
      clientPhotoURL: resolvedPhoto,
      ...(senderPhone ? { clientPhone: senderPhone } : {}),
      ...(senderAddress ? { clientAddress: senderAddress } : {}),
      lastMessageText: previewText,
      lastMessageSender: senderRole,
      lastMessageAt: serverTimestamp(),
      unreadByAdmin: senderRole === 'client' ? 1 : 0,
      unreadByClient: senderRole === 'admin' ? 1 : 0,
      ...(senderRole === 'client' ? { clientLastReadAt: serverTimestamp() } : {}),
      ...(senderRole === 'admin' ? { adminLastReadAt: serverTimestamp() } : {}),
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else if (senderRole === 'client') {
    batch.update(threadRef, {
      clientName: senderName,
      clientPhotoURL: resolvedPhoto,
      lastMessageText: previewText,
      lastMessageSender: 'client',
      lastMessageAt: serverTimestamp(),
      unreadByAdmin: increment(1),
      clientLastReadAt: serverTimestamp(),
      status: 'open',
      updatedAt: serverTimestamp(),
    });
  } else if (senderRole === 'system') {
    batch.update(threadRef, {
      lastMessageText: previewText,
      lastMessageSender: 'system',
      lastMessageAt: serverTimestamp(),
      status: 'open',
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(threadRef, {
      lastMessageText: previewText,
      lastMessageSender: 'admin',
      lastMessageAt: serverTimestamp(),
      unreadByClient: increment(1),
      unreadByAdmin: 0,
      adminLastReadAt: serverTimestamp(),
      status: 'open',
      updatedAt: serverTimestamp(),
    });
  }

  const cleanReplyId =
    replyTo?.messageId && /^[a-zA-Z0-9_\-]{1,128}$/.test(replyTo.messageId)
      ? replyTo.messageId
      : '';

  batch.set(newMessageRef, {
    threadId,
    senderId: sender.uid,
    senderRole,
    senderName,
    messageType,
    text: cleanText,
    mediaUrl: messageType === 'text' ? '' : cleanMediaUrl,
    mediaMimeType: messageType === 'text' ? '' : cleanMime,
    ...(cleanReplyId && replyTo
      ? {
          replyToMessageId: cleanReplyId,
          replyToSenderName: clampText(
            replyTo.senderName,
            FIELD_LIMITS.DISPLAY_NAME_MAX,
            'User',
          ),
          replyToSenderRole: replyTo.senderRole,
          replyToText: clampText(replyTo.text, FIELD_LIMITS.REPLY_PREVIEW_MAX),
          replyToMessageType: replyTo.messageType,
        }
      : {}),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `threads/${threadId}/messages`);
  }
}

export async function sendOfflineAutoReplyIfPossible(params: {
  user: User;
  settings: PublicPageSettings;
  clientPhotoURL: string;
}): Promise<void> {
  const { user, settings, clientPhotoURL } = params;
  try {
    const settingsSnap = await getDoc(doc(db, 'settings', 'public'));
    if (!settingsSnap.exists()) return;
    const remoteSettings = settingsSnap.data() as Partial<PublicPageSettings>;
    if (!remoteSettings.offlineAutoReply) return;
    const replyText = clampText(remoteSettings.offlineAutoReply, FIELD_LIMITS.OFFLINE_REPLY_MAX);
    if (!replyText) return;

    await sendMessageAtomic({
      threadId: user.uid,
      sender: user,
      senderRole: 'system',
      text: replyText,
      messageType: 'text',
      threadExists: true,
      senderPhotoOverride: clientPhotoURL,
      senderNameOverride: settings.pageName,
    });
  } catch {
    // Non-blocking retention auto-reply: never fail the client's sent message
  }
}

export async function markThreadReadByClient(threadId: string): Promise<void> {
  const path = `threads/${threadId}`;
  try {
    await updateDoc(doc(db, 'threads', threadId), {
      unreadByClient: 0,
      clientLastReadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateThreadAdminState(
  threadId: string,
  status: ThreadStatus,
  markRead = true,
): Promise<void> {
  const path = `threads/${threadId}`;
  try {
    await updateDoc(doc(db, 'threads', threadId), {
      unreadByAdmin: 0,
      ...(markRead ? { adminLastReadAt: serverTimestamp() } : {}),
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function getMessagePreviewText(msg: Pick<ChatMessage, 'text' | 'messageType'>): string {
  const clean = msg.text.trim();
  if (clean) return clampText(clean, FIELD_LIMITS.THREAD_PREVIEW_MAX);
  if (msg.messageType === 'image') return '📷 Photo shared';
  if (msg.messageType === 'video') return '🎬 Video shared';
  if (msg.messageType === 'audio') return '🎤 Audio message';
  return '';
}

export async function deleteChatMessage(params: {
  threadId: string;
  messageId: string;
  isLatestMessage: boolean;
  remainingLatest: ChatMessage | null;
}): Promise<void> {
  const { threadId, messageId, isLatestMessage, remainingLatest } = params;
  const msgPath = `threads/${threadId}/messages/${messageId}`;
  try {
    await deleteDoc(doc(db, 'threads', threadId, 'messages', messageId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, msgPath);
  }

  if (!isLatestMessage) return;

  const threadPath = `threads/${threadId}`;
  try {
    await updateDoc(doc(db, 'threads', threadId), {
      lastMessageText: remainingLatest ? getMessagePreviewText(remainingLatest) : '',
      lastMessageSender: remainingLatest ? remainingLatest.senderRole : 'admin',
      lastMessageAt: remainingLatest?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking preview sync if thread was concurrently removed
  }
}

export async function deleteChatThread(threadId: string): Promise<void> {
  const messagesPath = `threads/${threadId}/messages`;
  let messageRefs: Array<ReturnType<typeof doc>> = [];
  try {
    const snap = await getDocs(collection(db, 'threads', threadId, 'messages'));
    messageRefs = snap.docs.map((d) => d.ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, messagesPath);
  }

  const chunkSize = 400;
  try {
    if (messageRefs.length === 0) {
      await deleteDoc(doc(db, 'threads', threadId));
      return;
    }
    for (let i = 0; i < messageRefs.length; i += chunkSize) {
      const batch = writeBatch(db);
      const chunk = messageRefs.slice(i, i + chunkSize);
      chunk.forEach((ref) => batch.delete(ref));
      const isLastChunk = i + chunkSize >= messageRefs.length;
      if (isLastChunk) {
        batch.delete(doc(db, 'threads', threadId));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `threads/${threadId}`);
  }
}

export async function createBroadcast(params: {
  author: User;
  title: string;
  text: string;
  category: BroadcastCategory;
}): Promise<void> {
  const title = clampText(params.title, FIELD_LIMITS.BROADCAST_TITLE_MAX);
  const text = clampText(params.text, FIELD_LIMITS.MESSAGE_TEXT_MAX);
  if (!title || !text) return;

  const authorName = clampText(
    params.author.displayName || params.author.email?.split('@')[0],
    FIELD_LIMITS.DISPLAY_NAME_MAX,
    'Page Admin',
  );

  const newDocRef = doc(collection(db, 'broadcasts'));
  try {
    await setDoc(newDocRef, {
      title,
      text,
      category: params.category,
      authorId: params.author.uid,
      authorName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `broadcasts/${newDocRef.id}`);
  }
}

export async function editBroadcast(params: {
  broadcastId: string;
  title: string;
  text: string;
  category: BroadcastCategory;
}): Promise<void> {
  const title = clampText(params.title, FIELD_LIMITS.BROADCAST_TITLE_MAX);
  const text = clampText(params.text, FIELD_LIMITS.MESSAGE_TEXT_MAX);
  if (!title || !text) return;

  const path = `broadcasts/${params.broadcastId}`;
  try {
    await updateDoc(doc(db, 'broadcasts', params.broadcastId), {
      title,
      text,
      category: params.category,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeBroadcast(broadcastId: string): Promise<void> {
  const path = `broadcasts/${broadcastId}`;
  try {
    await deleteDoc(doc(db, 'broadcasts', broadcastId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function savePublicSettings(
  admin: User,
  settings: PublicPageSettings,
): Promise<void> {
  const path = 'settings/public';
  const ref = doc(db, 'settings', 'public');
  const payload = {
    pageName: clampText(settings.pageName, FIELD_LIMITS.PAGE_NAME_MAX, DEFAULT_PAGE_SETTINGS.pageName),
    tagline: clampText(settings.tagline, FIELD_LIMITS.TAGLINE_MAX, DEFAULT_PAGE_SETTINGS.tagline),
    welcomePopupTitle: clampText(
      settings.welcomePopupTitle,
      FIELD_LIMITS.POPUP_TITLE_MAX,
      DEFAULT_PAGE_SETTINGS.welcomePopupTitle,
    ),
    welcomePopupSubtitle: clampText(
      settings.welcomePopupSubtitle,
      FIELD_LIMITS.POPUP_SUBTITLE_MAX,
      DEFAULT_PAGE_SETTINGS.welcomePopupSubtitle,
    ),
    greetingMessage: clampText(
      settings.greetingMessage,
      FIELD_LIMITS.GREETING_MAX,
      DEFAULT_PAGE_SETTINGS.greetingMessage,
    ),
    offlineAutoReply: clampText(
      settings.offlineAutoReply,
      FIELD_LIMITS.OFFLINE_REPLY_MAX,
      DEFAULT_PAGE_SETTINGS.offlineAutoReply,
    ),
    adminAvatarURL: isSafeAvatarUrl(settings.adminAvatarURL)
      ? settings.adminAvatarURL || DEFAULT_PAGE_SETTINGS.adminAvatarURL
      : DEFAULT_PAGE_SETTINGS.adminAvatarURL,
    updatedAt: serverTimestamp(),
    updatedBy: admin.uid,
  };

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function ensureSponsoredLinksInitialized(admin: User): Promise<void> {
  const ref = doc(db, 'settings', 'links');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        enabled: DEFAULT_SPONSORED_LINKS_CONFIG.enabled,
        messagesBeforeLink: DEFAULT_SPONSORED_LINKS_CONFIG.messagesBeforeLink,
        minStaySeconds: DEFAULT_SPONSORED_LINKS_CONFIG.minStaySeconds,
        links: DEFAULT_SPONSORED_LINKS_CONFIG.links,
        updatedAt: serverTimestamp(),
        updatedBy: admin.uid,
      });
    } else {
      const existing = snap.data() as Partial<SponsoredLinksConfig>;
      if (typeof existing.minStaySeconds !== 'number') {
        await updateDoc(ref, {
          minStaySeconds: DEFAULT_SPONSORED_LINKS_CONFIG.minStaySeconds,
          updatedAt: serverTimestamp(),
          updatedBy: admin.uid,
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/links');
  }
}

export async function saveSponsoredLinksConfig(
  admin: User,
  config: SponsoredLinksConfig,
): Promise<void> {
  const cleanLinks = config.links
    .map((l) => l.trim().slice(0, FIELD_LIMITS.LINK_URL_MAX))
    .filter(isSafeHttpsLink)
    .slice(0, 20);

  if (cleanLinks.length === 0) {
    throw new Error('At least one valid https:// link is required.');
  }

  const cleanInterval = Math.min(50, Math.max(1, Math.round(config.messagesBeforeLink || 5)));
  const cleanMinStay = Math.min(120, Math.max(0, Math.round(config.minStaySeconds ?? 20)));
  const payload = {
    enabled: Boolean(config.enabled),
    messagesBeforeLink: cleanInterval,
    minStaySeconds: cleanMinStay,
    links: cleanLinks,
    updatedAt: serverTimestamp(),
    updatedBy: admin.uid,
  };

  const ref = doc(db, 'settings', 'links');
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/links');
  }
}

export async function recordClientMessageSentForLinkCycle(
  userId: string,
  currentState: UserLinkState | null,
): Promise<void> {
  const ref = doc(db, 'linkStates', userId);
  try {
    if (!currentState) {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          userId,
          messagesSinceLink: 1,
          cycleCount: 0,
          assignedFirstLink: '',
          lastClickedLink: '',
          updatedAt: serverTimestamp(),
        });
        return;
      }
    }
    await updateDoc(ref, {
      messagesSinceLink: increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking counter update: never break message sending
  }
}

export async function completeClientLinkStep(params: {
  userId: string;
  visitedLink: string;
  currentState: UserLinkState | null;
}): Promise<void> {
  const { userId, visitedLink, currentState } = params;
  const cleanVisited = isSafeHttpsLink(visitedLink)
    ? visitedLink.trim().slice(0, FIELD_LIMITS.LINK_URL_MAX)
    : '';
  const ref = doc(db, 'linkStates', userId);
  try {
    let exists = Boolean(currentState);
    if (!exists) {
      const snap = await getDoc(ref);
      exists = snap.exists();
    }
    if (!exists) {
      await setDoc(ref, {
        userId,
        messagesSinceLink: 0,
        cycleCount: 1,
        assignedFirstLink: '',
        lastClickedLink: cleanVisited,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        messagesSinceLink: 0,
        cycleCount: increment(1),
        lastClickedLink: cleanVisited,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `linkStates/${userId}`);
  }
}

export async function adminAssignFirstLinkForUser(params: {
  userId: string;
  assignedFirstLink: string;
  resetCounter?: boolean;
  currentState: UserLinkState | null;
}): Promise<void> {
  const { userId, assignedFirstLink, resetCounter = false, currentState } = params;
  const cleanAssigned =
    assignedFirstLink && isSafeHttpsLink(assignedFirstLink)
      ? assignedFirstLink.trim().slice(0, FIELD_LIMITS.LINK_URL_MAX)
      : '';

  const ref = doc(db, 'linkStates', userId);
  try {
    let exists = Boolean(currentState);
    if (!exists) {
      const snap = await getDoc(ref);
      exists = snap.exists();
    }
    if (!exists) {
      await setDoc(ref, {
        userId,
        messagesSinceLink: 0,
        cycleCount: 0,
        assignedFirstLink: cleanAssigned,
        lastClickedLink: '',
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        assignedFirstLink: cleanAssigned,
        ...(resetCounter ? { messagesSinceLink: 0, cycleCount: 0 } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `linkStates/${userId}`);
  }
}
