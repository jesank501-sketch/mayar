import React, { useState } from 'react';
import {
  ArrowRight,
  Bell,
  Lock,
  MessageSquare,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { AdminPresence, Language, PublicPageSettings } from '../types';
import { formatRelativeTime } from '../utils/formatters';
import { Avatar } from './Avatar';
import { PWAInstallButton } from './PWAInstallButton';

const HERO_IMAGE_URL = '/src/assets/images/welcome_chat_hero_1795440123383.jpg';

interface LandingViewProps {
  settings: PublicPageSettings;
  adminOnline: boolean;
  adminPresence: AdminPresence | null;
  lang: Language;
  onToggleLang: () => void;
  onOpenChatPopup: () => void;
}

export const LandingView: React.FC<LandingViewProps> = ({
  settings,
  adminOnline,
  adminPresence,
  lang,
  onToggleLang,
  onOpenChatPopup,
}) => {
  const [heroImgError, setHeroImgError] = useState(false);

  const activeText = adminOnline
    ? lang === 'bn'
      ? 'অ্যাডমিন এখন অনলাইনে আছেন'
      : 'Admin is active now'
    : adminPresence?.lastSeenAt
      ? lang === 'bn'
        ? `অফলাইন · শেষ দেখা ${formatRelativeTime(adminPresence.lastSeenAt, lang)} আগে`
        : `Offline · Last seen ${formatRelativeTime(adminPresence.lastSeenAt, lang)} ago`
      : lang === 'bn'
        ? 'অ্যাডমিন অফলাইনে আছেন · মেসেজ রেখে যান'
        : 'Admin is offline · Leave a message';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-4 sm:gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
          >
            {settings.pageName}
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#features"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              {lang === 'bn' ? 'সুবিধাসমূহ' : 'Features'}
            </a>
            <a
              href="#privacy"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              {lang === 'bn' ? 'নিরাপত্তা' : 'Privacy'}
            </a>
            <a
              href="#how-it-works"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              {lang === 'bn' ? 'কিভাবে কাজ করে' : 'How It Works'}
            </a>
            <button
              type="button"
              onClick={onToggleLang}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {lang === 'bn' ? 'English' : 'বাংলা'}
            </button>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <PWAInstallButton lang={lang} variant="header" />
            <button
              type="button"
              onClick={onOpenChatPopup}
              className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {lang === 'bn' ? 'ফ্রি চ্যাট করুন' : 'Chat Free'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main id="top" className="flex-1">
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-14 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-semibold text-blue-700 tracking-wide mb-2.5 sm:mb-3">
                {lang === 'bn'
                  ? 'সরাসরি মেসেঞ্জার কমিউনিকেশন · টেক্সট, অডিও ও ভিডিও'
                  : 'Direct Messenger Communication · Text, Audio & Video'}
              </p>
              <h1
                className="text-2xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight leading-tight"
                style={{ textWrap: 'balance' }}
              >
                {lang === 'bn'
                  ? 'ফেসবুক গাইডলাইনের ঝামেলা ছাড়াই সরাসরি কথা বলুন'
                  : 'Talk Directly With Our Page Admin Without Limits'}
              </h1>
              <p className="mt-4 sm:mt-5 text-[15px] sm:text-base text-slate-600 leading-relaxed max-w-xl">
                {lang === 'bn'
                  ? 'লগইন করে সাথে সাথেই পেজ অ্যাডমিনের সাথে রিয়েল-টাইম মেসেঞ্জারের মতো চ্যাট শুরু করুন। ভিডিও ও অডিও শেয়ার করতে পারবেন সম্পূর্ণ ব্যক্তিগতভাবে।'
                  : 'Sign in once and start real-time Messenger-style private conversations with text, voice notes, and video sharing.'}
              </p>

              <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={onOpenChatPopup}
                  className="w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2.5 px-6 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>{lang === 'bn' ? 'এখনই ফ্রি চ্যাট করুন' : 'Start Free Chat Now'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <PWAInstallButton lang={lang} variant="primary" />
                <div className="flex items-center gap-2.5 text-xs text-slate-600">
                  <Avatar src={settings.adminAvatarURL} name={settings.pageName} size="sm" />
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                        adminOnline ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}
                    />
                    <span>{activeText}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 flex">
              <div className="w-full rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm flex items-center justify-center min-h-[300px]">
                {!heroImgError ? (
                  <img
                    src={HERO_IMAGE_URL}
                    alt={lang === 'bn' ? 'সরাসরি মেসেঞ্জার চ্যাট ডেস্কটপ' : 'Direct Messenger Workspace'}
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="p-10 text-center text-slate-500">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 text-blue-600" />
                    <p className="text-sm font-medium text-slate-700">{settings.pageName}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Core Capabilities Row */}
        <section id="features" className="border-t border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-6 py-14 grid grid-cols-1 md:grid-cols-3 gap-8">
            <div id="privacy" className="space-y-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Lock className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">
                {lang === 'bn' ? 'একান্ত ব্যক্তিগত চ্যাট' : 'Strict Client Isolation'}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {lang === 'bn'
                  ? 'আপনি শুধু অ্যাডমিনের সাথেই কথা বলতে পারবেন। অন্য কোনো ভিজিটর বা ক্লায়েন্ট আপনার প্রোফাইল বা মেসেজ দেখতে পারবে না।'
                  : 'You communicate strictly with the page admin. Other clients cannot view your messages, name, or profile.'}
              </p>
            </div>

            <div id="how-it-works" className="space-y-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">
                {lang === 'bn' ? 'ভিডিও, অডিও ও টেক্সট শেয়ার' : 'Video, Audio & Text'}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {lang === 'bn'
                  ? 'চ্যাটের মধ্যেই সরাসরি ভয়েস মেসেজ রেকর্ড, অডিও ক্লিপ এবং ভিডিও ফাইল বা লিংক আদান-প্রদান করা যায়।'
                  : 'Share voice recordings, audio files, and video clips directly inside your real-time Messenger thread.'}
              </p>
            </div>

            <div className="space-y-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Bell className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">
                {lang === 'bn' ? 'তাৎক্ষণিক পেজ আপডেট' : 'Instant Page Announcements'}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {lang === 'bn'
                  ? 'অ্যাডমিনের পাঠানো গুরুত্বপূর্ণ নোটিশ বা অফার সরাসরি আপনার চ্যাট ইনবক্সেই সাথে সাথে পেয়ে যাবেন।'
                  : 'Important announcements and updates sent by the page admin arrive directly inside your chat timeline.'}
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-400" />
            <span>
              {settings.pageName} · {lang === 'bn' ? 'নিরাপদ সরাসরি যোগাযোগ' : 'Secure Direct Messaging'}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleLang}
            className="hover:text-slate-800 transition-colors cursor-pointer"
          >
            {lang === 'bn' ? 'Switch to English' : 'বাংলায় দেখুন'}
          </button>
        </div>
      </footer>

      {/* Floating Messenger Launcher Button */}
      <button
        type="button"
        onClick={onOpenChatPopup}
        className="fixed bottom-safe right-4 sm:right-5 z-40 min-h-[48px] inline-flex items-center gap-2.5 px-4 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-full shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
      >
        <MessageSquare className="w-4 h-4" />
        <span>{lang === 'bn' ? 'চ্যাট করুন ফ্রি' : 'Chat Free'}</span>
      </button>
    </div>
  );
};
