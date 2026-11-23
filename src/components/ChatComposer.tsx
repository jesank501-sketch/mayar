import React, { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  ExternalLink,
  FileAudio,
  Film,
  Image as ImageIcon,
  Link2,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { FIELD_LIMITS, Language, MessageType } from '../types';
import { formatLinkDomain, isSafeHttpsLink } from '../utils/linkRotation';
import {
  convertVoiceToGoogleFemaleVoice,
  generateGoogleFemaleVoiceFromText,
  inferMediaMimeType,
  isSafeMediaUrl,
  uploadMediaFile,
} from '../utils/media';

export interface SponsoredGateProps {
  active: boolean;
  linkUrl: string;
  messagesSentInCycle: number;
  messagesBeforeLink: number;
  onLinkVisited: () => Promise<void> | void;
}

interface ChatComposerProps {
  user: User;
  threadId: string;
  lang: Language;
  placeholder: string;
  enableFemaleVoiceOption?: boolean;
  sponsoredGate?: SponsoredGateProps;
  onSendPayload: (payload: {
    messageType: MessageType;
    text: string;
    mediaUrl?: string;
    mediaMimeType?: string;
  }) => Promise<void>;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  user,
  threadId,
  lang,
  placeholder,
  enableFemaleVoiceOption = false,
  sponsoredGate,
  onSendPayload,
}) => {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [femaleVoiceEnabled, setFemaleVoiceEnabled] = useState(enableFemaleVoiceOption);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  // Unified Pic/Video/Audio link popover
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkType, setLinkType] = useState<'image' | 'video' | 'audio'>('video');

  // Voice Recorder state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRecordRef = useRef(false);

  const picVideoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const isGateBlocking = Boolean(
    sponsoredGate?.active && sponsoredGate.linkUrl && isSafeHttpsLink(sponsoredGate.linkUrl),
  );

  const gateBlockedMessage =
    lang === 'bn'
      ? 'পরবর্তী মেসেজ পাঠাতে ডানের "লিংক ওপেন করুন" বাটনে ক্লিক করে স্পন্সরড লিংকটি ভিজিট করুন।'
      : 'Please click the "Open Link" button on the right to continue sending messages.';

  const handleSendText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isGateBlocking) {
      setErrorMsg(gateBlockedMessage);
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed || sending || uploadingLabel) return;

    setSending(true);
    setErrorMsg(null);
    try {
      await onSendPayload({
        messageType: 'text',
        text: trimmed,
      });
      setDraft('');
    } catch (err) {
      console.error('Send text failed:', err);
      setErrorMsg(
        lang === 'bn'
          ? 'মেসেজ পাঠানো যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
          : 'Failed to send message. Please try again.',
      );
    } finally {
      setSending(false);
    }
  };

  const handlePicOrVideoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMobileMoreOpen(false);
    if (isGateBlocking) {
      setErrorMsg(gateBlockedMessage);
      return;
    }

    const mime = inferMediaMimeType(file);
    const isImage = mime.startsWith('image/');
    const isVideo = mime.startsWith('video/');

    if (!isImage && !isVideo) {
      setErrorMsg(
        lang === 'bn'
          ? 'দয়া করে সঠিক ছবি (JPG/PNG/WebP) বা ভিডিও (MP4/WebM/MOV) ফাইল নির্বাচন করুন।'
          : 'Please choose a valid image (JPG/PNG/WebP) or video (MP4/WebM/MOV) file.',
      );
      return;
    }

    const maxBytes = isVideo ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      setErrorMsg(
        lang === 'bn'
          ? isVideo
            ? 'ভিডিও ফাইল সর্বোচ্চ ২৫ মেগাবাইট হতে পারবে।'
            : 'ছবি ফাইল সর্বোচ্চ ১০ মেগাবাইট হতে পারবে।'
          : isVideo
            ? 'Video file must be under 25 MB.'
            : 'Image file must be under 10 MB.',
      );
      return;
    }

    setErrorMsg(null);
    setUploadingLabel(
      lang === 'bn'
        ? isVideo
          ? 'ভিডিও আপলোড হচ্ছে...'
          : 'ছবি আপলোড হচ্ছে...'
        : isVideo
          ? 'Uploading video...'
          : 'Uploading photo...',
    );

    try {
      const uploaded = await uploadMediaFile({
        file,
        mimeType: mime,
        threadId,
        user,
      });
      await onSendPayload({
        messageType: uploaded.mediaType,
        text: draft.trim(),
        mediaUrl: uploaded.url,
        mediaMimeType: uploaded.mimeType,
      });
      setDraft('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : lang === 'bn'
            ? 'ফাইল আপলোড ব্যর্থ হয়েছে।'
            : 'Media upload failed.',
      );
    } finally {
      setUploadingLabel(null);
    }
  };

  const handleAudioFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMobileMoreOpen(false);
    if (isGateBlocking) {
      setErrorMsg(gateBlockedMessage);
      return;
    }

    const mime = inferMediaMimeType(file) || 'audio/mpeg';
    if (!mime.startsWith('audio/')) {
      setErrorMsg(
        lang === 'bn'
          ? 'দয়া করে একটি অডিও ফাইল (MP3/WAV/M4A/OGG) নির্বাচন করুন।'
          : 'Please choose a valid audio file.',
      );
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setErrorMsg(
        lang === 'bn'
          ? 'অডিও ফাইল সর্বোচ্চ ১৫ মেগাবাইট হতে পারবে।'
          : 'Audio file must be under 15 MB.',
      );
      return;
    }

    setErrorMsg(null);
    try {
      if (enableFemaleVoiceOption && femaleVoiceEnabled) {
        setUploadingLabel(
          lang === 'bn'
            ? 'একক নারী কণ্ঠে রূপান্তর হচ্ছে...'
            : 'Converting to unified female voice...',
        );
        const converted = await convertVoiceToGoogleFemaleVoice({
          file,
          mimeType: mime,
          threadId,
          user,
          voiceName: 'Kore',
        });
        await onSendPayload({
          messageType: 'audio',
          text: draft.trim(),
          mediaUrl: converted.url,
          mediaMimeType: converted.mimeType,
        });
        setDraft('');
      } else {
        setUploadingLabel(lang === 'bn' ? 'অডিও আপলোড হচ্ছে...' : 'Uploading audio...');
        const uploaded = await uploadMediaFile({
          file,
          mimeType: mime,
          threadId,
          user,
        });
        await onSendPayload({
          messageType: 'audio',
          text: draft.trim(),
          mediaUrl: uploaded.url,
          mediaMimeType: uploaded.mimeType,
        });
        setDraft('');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : lang === 'bn'
            ? 'অডিও আপলোড ব্যর্থ হয়েছে।'
            : 'Audio upload failed.',
      );
    } finally {
      setUploadingLabel(null);
    }
  };

  const startVoiceRecording = async () => {
    setMobileMoreOpen(false);
    if (isGateBlocking) {
      setErrorMsg(gateBlockedMessage);
      return;
    }
    if (isRecording || sending || uploadingLabel) return;
    setErrorMsg(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMsg(
        lang === 'bn'
          ? 'আপনার ব্রাউজারে ভয়েস রেকর্ডিং সাপোর্টেড নয়। অডিও ফাইল আপলোড করুন।'
          : 'Voice recording is not supported in this browser. Try uploading an audio file.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      cancelledRecordRef.current = false;
      recordedChunksRef.current = [];

      const preferredMime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (recordTimerRef.current) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        setIsRecording(false);
        setRecordSeconds(0);

        if (cancelledRecordRef.current || recordedChunksRef.current.length === 0) {
          return;
        }

        const rawMime = recorder.mimeType || preferredMime || 'audio/webm';
        const finalBlob = new Blob(recordedChunksRef.current, { type: rawMime });

        try {
          if (enableFemaleVoiceOption && femaleVoiceEnabled) {
            setUploadingLabel(
              lang === 'bn'
                ? 'একক নারী কণ্ঠে রূপান্তর হচ্ছে...'
                : 'Converting to unified female voice...',
            );
            const converted = await convertVoiceToGoogleFemaleVoice({
              file: finalBlob,
              mimeType: rawMime,
              threadId,
              user,
              voiceName: 'Kore',
            });
            await onSendPayload({
              messageType: 'audio',
              text: '',
              mediaUrl: converted.url,
              mediaMimeType: converted.mimeType,
            });
          } else {
            setUploadingLabel(lang === 'bn' ? 'ভয়েস পাঠানো হচ্ছে...' : 'Sending voice note...');
            const uploaded = await uploadMediaFile({
              file: finalBlob,
              mimeType: rawMime,
              threadId,
              user,
            });
            await onSendPayload({
              messageType: 'audio',
              text: '',
              mediaUrl: uploaded.url,
              mediaMimeType: uploaded.mimeType,
            });
          }
        } catch (err) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : lang === 'bn'
                ? 'ভয়েস মেসেজ পাঠানো যায়নি।'
                : 'Could not send voice note.',
          );
        } finally {
          setUploadingLabel(null);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setErrorMsg(
        lang === 'bn'
          ? 'মাইক্রোফোন অনুমতি পাওয়া যায়নি। ব্রাউজার সেটিংস থেকে মাইক্রোফোন চালু করুন।'
          : 'Microphone permission denied. Enable microphone access or upload an audio file.',
      );
    }
  };

  const stopVoiceRecording = (cancel: boolean) => {
    cancelledRecordRef.current = cancel;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isGateBlocking) {
      setErrorMsg(gateBlockedMessage);
      return;
    }
    const cleaned = linkUrl.trim();
    if (!cleaned.startsWith('https://') || !isSafeMediaUrl(cleaned)) {
      setErrorMsg(
        lang === 'bn'
          ? 'সঠিক https:// ছবি, ভিডিও বা অডিও লিংক দিন।'
          : 'Please enter a valid https:// media URL.',
      );
      return;
    }

    setSending(true);
    setErrorMsg(null);
    try {
      await onSendPayload({
        messageType: linkType,
        text: draft.trim(),
        mediaUrl: cleaned,
        mediaMimeType:
          linkType === 'image'
            ? 'image/jpeg'
            : linkType === 'video'
              ? 'video/mp4'
              : 'audio/mpeg',
      });
      setLinkUrl('');
      setShowLinkInput(false);
      setMobileMoreOpen(false);
      setDraft('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : lang === 'bn'
            ? 'মিডিয়া লিংক পাঠানো যায়নি। আবার চেষ্টা করুন।'
            : 'Could not share media link. Please try again.',
      );
    } finally {
      setSending(false);
    }
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${mins}:${rem.toString().padStart(2, '0')}`;
  };

  const handleSendTextAsFemaleVoice = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending || uploadingLabel) return;
    if (trimmed.length > 1000) {
      setErrorMsg(
        lang === 'bn'
          ? 'ভয়েসে রূপান্তরের জন্য লেখা সর্বোচ্চ ১০০০ অক্ষরের মধ্যে রাখুন।'
          : 'Text for female voice generation must be 1000 characters or fewer.',
      );
      return;
    }

    setErrorMsg(null);
    setUploadingLabel(
      lang === 'bn' ? 'একক নারী কণ্ঠ তৈরি হচ্ছে...' : 'Generating unified female voice...',
    );
    try {
      const generated = await generateGoogleFemaleVoiceFromText({
        text: trimmed,
        threadId,
        user,
        voiceName: 'Kore',
      });
      await onSendPayload({
        messageType: 'audio',
        text: '',
        mediaUrl: generated.url,
        mediaMimeType: generated.mimeType,
      });
      setDraft('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : lang === 'bn'
            ? 'নারী কণ্ঠ তৈরি করা যায়নি।'
            : 'Could not generate female voice.',
      );
    } finally {
      setUploadingLabel(null);
    }
  };

  return (
    <div className="px-3 pt-2.5 pb-safe sm:p-4 border-t border-slate-200 bg-white shrink-0 space-y-2">
      {errorMsg && (
        <div className="flex items-center justify-between gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <span className="leading-snug">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center text-red-500 hover:text-red-700 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {uploadingLabel && (
        <div className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
          {uploadingLabel}
        </div>
      )}

      {/* Transparent 5-Message Sponsored Link Gate Banner */}
      {isGateBlocking && sponsoredGate && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <ExternalLink className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span className="leading-snug">
              {lang === 'bn'
                ? `${sponsoredGate.messagesSentInCycle}/${sponsoredGate.messagesBeforeLink} মেসেজ হয়েছে — নিচের "লিংক ওপেন করুন" বাটনে ক্লিক করে পরের ${sponsoredGate.messagesBeforeLink}টি মেসেজ আনলক করুন।`
                : `${sponsoredGate.messagesSentInCycle}/${sponsoredGate.messagesBeforeLink} messages reached — tap "Open Link" below (${formatLinkDomain(sponsoredGate.linkUrl)}) to continue.`}
            </span>
          </div>
          <span className="text-[11px] font-mono text-amber-800 bg-white/80 border border-amber-200 px-2 py-0.5 rounded-md truncate max-w-[180px]">
            {formatLinkDomain(sponsoredGate.linkUrl)}
          </span>
        </div>
      )}

      {/* Single Consistent Female Voice Persona Lock Indicator (Admin) */}
      {enableFemaleVoiceOption && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs">
          <button
            type="button"
            onClick={() => setFemaleVoiceEnabled((prev) => !prev)}
            className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border font-medium transition-colors cursor-pointer ${
              femaleVoiceEnabled
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>
              {femaleVoiceEnabled
                ? lang === 'bn'
                  ? 'একক নারী কণ্ঠ: চালু (সব ভয়েস একই পিচে যাবে)'
                  : 'Unified Female Voice: ON (Locked Same Pitch)'
                : lang === 'bn'
                  ? 'একক নারী কণ্ঠ: বন্ধ (আসল ভয়েস)'
                  : 'Unified Female Voice: OFF'}
            </span>
          </button>
        </div>
      )}

      {/* Mobile Overflow Media Tray (< sm) */}
      {mobileMoreOpen && (
        <div className="sm:hidden grid grid-cols-2 gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setMobileMoreOpen(false);
              audioInputRef.current?.click();
            }}
            disabled={Boolean(uploadingLabel)}
            className="min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg active:scale-[0.98] cursor-pointer"
          >
            <FileAudio className="w-4 h-4 text-blue-600 shrink-0" />
            <span>{lang === 'bn' ? 'অডিও ফাইল' : 'Audio File'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMobileMoreOpen(false);
              setShowLinkInput((prev) => !prev);
            }}
            disabled={Boolean(uploadingLabel)}
            className="min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg active:scale-[0.98] cursor-pointer"
          >
            <Link2 className="w-4 h-4 text-blue-600 shrink-0" />
            <span>{lang === 'bn' ? 'মিডিয়া লিংক' : 'Media Link'}</span>
          </button>
        </div>
      )}

      {showLinkInput && (
        <form
          onSubmit={handleSendLink}
          className="flex flex-wrap items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
        >
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setLinkType('image')}
              className={`min-h-[36px] px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                linkType === 'image' ? 'bg-blue-600 text-white' : 'text-slate-600'
              }`}
            >
              {lang === 'bn' ? 'ছবি' : 'Photo'}
            </button>
            <button
              type="button"
              onClick={() => setLinkType('video')}
              className={`min-h-[36px] px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                linkType === 'video' ? 'bg-blue-600 text-white' : 'text-slate-600'
              }`}
            >
              {lang === 'bn' ? 'ভিডিও' : 'Video'}
            </button>
            <button
              type="button"
              onClick={() => setLinkType('audio')}
              className={`min-h-[36px] px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                linkType === 'audio' ? 'bg-blue-600 text-white' : 'text-slate-600'
              }`}
            >
              {lang === 'bn' ? 'অডিও' : 'Audio'}
            </button>
          </div>

          <input
            type="url"
            required
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 min-w-[160px] min-h-[40px] px-3 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none"
          />

          <button
            type="submit"
            disabled={sending}
            className="min-h-[40px] px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer shrink-0"
          >
            {lang === 'bn' ? 'শেয়ার' : 'Share'}
          </button>
          <button
            type="button"
            onClick={() => setShowLinkInput(false)}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-500 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </form>
      )}

      {/* Unified Photo & Video File Picker */}
      <input
        ref={picVideoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(e) => void handlePicOrVideoSelected(e)}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => void handleAudioFileSelected(e)}
      />

      {isRecording ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-red-700 min-w-0">
            <Mic className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {lang === 'bn'
                ? enableFemaleVoiceOption && femaleVoiceEnabled
                  ? 'নারী কণ্ঠে রেকর্ড'
                  : 'ভয়েস রেকর্ড'
                : 'Recording'}{' '}
              · <span className="font-mono-tabular">{formatDuration(recordSeconds)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => stopVoiceRecording(true)}
              className="min-h-[44px] px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl cursor-pointer"
            >
              {lang === 'bn' ? 'বাতিল' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => stopVoiceRecording(false)}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>{lang === 'bn' ? 'পাঠান' : 'Send'}</span>
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSendText} className="flex items-end gap-1.5 sm:gap-2">
          {/* Thumb-friendly Media Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => picVideoInputRef.current?.click()}
              disabled={Boolean(uploadingLabel)}
              title={lang === 'bn' ? 'ছবি বা ভিডিও পাঠান' : 'Send Photo or Video'}
              aria-label={lang === 'bn' ? 'ছবি বা ভিডিও পাঠান' : 'Send Photo or Video'}
              className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 active:scale-95 transition-colors cursor-pointer"
            >
              <ImageIcon className="w-4 h-4 shrink-0" />
              <Film className="hidden sm:inline w-4 h-4 shrink-0" />
              <span className="hidden lg:inline">
                {lang === 'bn' ? 'ছবি / ভিডিও' : 'Pic / Video'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void startVoiceRecording()}
              disabled={Boolean(uploadingLabel)}
              title={lang === 'bn' ? 'ভয়েস রেকর্ড করে পাঠান' : 'Record Voice Note'}
              aria-label={lang === 'bn' ? 'ভয়েস রেকর্ড করুন' : 'Record Voice Note'}
              className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-700 bg-slate-100 sm:bg-transparent hover:text-blue-600 hover:bg-blue-50 active:scale-95 transition-colors cursor-pointer"
            >
              <Mic className="w-4 h-4" />
            </button>

            {/* Mobile + button for Audio upload / URL */}
            <button
              type="button"
              onClick={() => setMobileMoreOpen((prev) => !prev)}
              disabled={Boolean(uploadingLabel)}
              aria-label={lang === 'bn' ? 'আরও মিডিয়া অপশন' : 'More media options'}
              className={`sm:hidden min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                mobileMoreOpen || showLinkInput
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Plus className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => audioInputRef.current?.click()}
              disabled={Boolean(uploadingLabel)}
              title={lang === 'bn' ? 'অডিও ফাইল পাঠান' : 'Upload Audio File'}
              aria-label={lang === 'bn' ? 'অডিও ফাইল পাঠান' : 'Upload Audio File'}
              className="hidden sm:flex min-w-[40px] min-h-[40px] rounded-xl items-center justify-center text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
            >
              <FileAudio className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowLinkInput((prev) => !prev)}
              disabled={Boolean(uploadingLabel)}
              title={lang === 'bn' ? 'মিডিয়া লিংক শেয়ার করুন' : 'Share Media Link'}
              aria-label={lang === 'bn' ? 'মিডিয়া লিংক শেয়ার করুন' : 'Share Media Link'}
              className={`hidden sm:flex min-w-[40px] min-h-[40px] rounded-xl items-center justify-center transition-colors cursor-pointer ${
                showLinkInput
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-600 hover:text-blue-600 hover:bg-blue-50'
              }`}
            >
              <Link2 className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-w-0 relative">
            <textarea
              rows={1}
              value={draft}
              onChange={(e) =>
                setDraft(e.target.value.slice(0, FIELD_LIMITS.MESSAGE_TEXT_MAX))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendText();
                }
              }}
              placeholder={placeholder}
              className="w-full min-h-[44px] resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15 max-h-32"
            />
          </div>

          {enableFemaleVoiceOption && femaleVoiceEnabled && draft.trim() && (
            <button
              type="button"
              onClick={() => void handleSendTextAsFemaleVoice()}
              disabled={sending || Boolean(uploadingLabel)}
              title={
                lang === 'bn'
                  ? 'লেখাটি একক নারী কণ্ঠে ভয়েস মেসেজ হিসেবে পাঠান'
                  : 'Send text as unified female voice note'
              }
              aria-label={
                lang === 'bn' ? 'নারী কণ্ঠে পাঠান' : 'Send as female voice'
              }
              className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 hover:bg-blue-50 text-blue-700 text-xs font-semibold transition-colors shrink-0 cursor-pointer"
            >
              <Volume2 className="w-4 h-4" />
              <span className="hidden lg:inline">
                {lang === 'bn' ? 'ভয়েসে পাঠান' : 'Speak'}
              </span>
            </button>
          )}

          {isGateBlocking && sponsoredGate ? (
            <a
              href={sponsoredGate.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setErrorMsg(null);
                void sponsoredGate.onLinkVisited();
              }}
              aria-label={
                lang === 'bn' ? 'স্পন্সরড লিংক ওপেন করুন' : 'Open Sponsored Link'
              }
              className="min-h-[44px] px-3.5 sm:px-4 inline-flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs sm:text-sm font-semibold transition-colors shrink-0 cursor-pointer shadow-xs active:scale-95"
            >
              <ExternalLink className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">
                {lang === 'bn' ? 'লিংক ওপেন করুন' : 'Open Link'}
              </span>
            </a>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim() || sending || Boolean(uploadingLabel)}
              aria-label={lang === 'bn' ? 'পাঠান' : 'Send'}
              className="min-h-[44px] min-w-[44px] px-3.5 sm:px-4 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium transition-colors shrink-0 cursor-pointer active:scale-95"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">{lang === 'bn' ? 'পাঠান' : 'Send'}</span>
            </button>
          )}
        </form>
      )}
    </div>
  );
};
