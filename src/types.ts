import { Timestamp } from 'firebase/firestore';

export type Language = 'bn' | 'en';

export type ThreadStatus = 'open' | 'resolved';
export type SenderRole = 'client' | 'admin' | 'system';
export type MessageType = 'text' | 'image' | 'video' | 'audio';
export type BroadcastCategory = 'announcement' | 'update' | 'offer' | 'urgent';
export type PresenceMode = 'auto' | 'online' | 'offline';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
}

export interface ChatThread {
  id: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhotoURL: string;
  lastMessageText: string;
  lastMessageSender: SenderRole;
  lastMessageAt: Timestamp;
  unreadByAdmin: number;
  unreadByClient: number;
  status: ThreadStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderRole: SenderRole;
  senderName: string;
  messageType: MessageType;
  text: string;
  mediaUrl: string;
  mediaMimeType: string;
  createdAt: Timestamp;
}

export interface BroadcastMessage {
  id: string;
  title: string;
  text: string;
  category: BroadcastCategory;
  authorId: string;
  authorName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PublicPageSettings {
  pageName: string;
  tagline: string;
  welcomePopupTitle: string;
  welcomePopupSubtitle: string;
  greetingMessage: string;
  offlineAutoReply: string;
  adminAvatarURL: string;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export interface AdminPresence {
  isOnline: boolean;
  mode: PresenceMode;
  lastSeenAt?: Timestamp;
  updatedBy?: string;
}

export interface SponsoredLinksConfig {
  enabled: boolean;
  messagesBeforeLink: number;
  minStaySeconds: number;
  links: string[];
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export interface UserLinkState {
  id?: string;
  userId: string;
  messagesSinceLink: number;
  cycleCount: number;
  assignedFirstLink: string;
  lastClickedLink: string;
  updatedAt?: Timestamp;
}

export const DEFAULT_SPONSORED_LINKS: string[] = [
  'https://uplcm.com/4/12240576',
  'https://uplcm.com/4/12240577',
  'https://uplcm.com/4/12240574',
  'https://uplcm.com/4/12240623',
  'https://uplcm.com/4/12240588',
  'https://auctionr.org/4/a5769319bb3fab124d20d3d2bb46a16a',
  'https://auctionr.org/4/e9a3ac3549909488e20bcaba38056e66',
  'https://auctionr.org/4/d1be89ac325f308a8c1871c57c3139fc',
];

export const DEFAULT_SPONSORED_LINKS_CONFIG: SponsoredLinksConfig = {
  enabled: true,
  messagesBeforeLink: 5,
  minStaySeconds: 20,
  links: DEFAULT_SPONSORED_LINKS,
};

export const DEFAULT_ADMIN_AVATAR_URL = '/src/assets/images/admin_brand_avatar_1795440123338.jpg';

export const DEFAULT_PAGE_SETTINGS: PublicPageSettings = {
  pageName: 'BartaConnect Support',
  tagline: 'সরাসরি পেজ অ্যাডমিনের সাথে রিয়েল-টাইম নিরাপদ কথোপকথন',
  welcomePopupTitle: 'ফ্রি চ্যাট করুন',
  welcomePopupSubtitle:
    'ফেসবুক লিমিটেশনের ঝামেলা ছাড়াই সরাসরি আমাদের অ্যাডমিনের সাথে ব্যক্তিগতভাবে কথা বলুন।',
  greetingMessage:
    'স্বাগতম! আপনার যেকোনো প্রশ্ন বা প্রয়োজন সরাসরি এখানে লিখে পাঠান, আমরা দ্রুত উত্তর দেব।',
  offlineAutoReply:
    'ধন্যবাদ আপনার বার্তার জন্য! আমি এখন অফলাইনে আছি। আপনার মেসেজটি সংরক্ষিত রয়েছে — অনলাইনে আসামাত্রই উত্তর দেব।',
  adminAvatarURL: DEFAULT_ADMIN_AVATAR_URL,
};

export const FIELD_LIMITS = {
  DISPLAY_NAME_MAX: 100,
  EMAIL_MAX: 150,
  PHOTO_URL_MAX: 65536,
  MESSAGE_TEXT_MAX: 2000,
  MEDIA_URL_MAX: 900000,
  MEDIA_MIME_MAX: 100,
  THREAD_PREVIEW_MAX: 500,
  BROADCAST_TITLE_MAX: 120,
  PAGE_NAME_MAX: 80,
  TAGLINE_MAX: 160,
  POPUP_TITLE_MAX: 100,
  POPUP_SUBTITLE_MAX: 240,
  GREETING_MAX: 500,
  OFFLINE_REPLY_MAX: 500,
  LINK_URL_MAX: 300,
} as const;
