import React, { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Clock,
  ExternalLink,
  FileAudio,
  Film,
  Image as ImageIcon,
  Link2,
  Mic,
  RefreshCw,
  Reply,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { FIELD_LIMITS, Language, MessageType, ReplyTarget } from '../types';
import { formatLinkDomain, isSafeHttpsLink } from '../utils/linkRotation';
import {
  convertVoiceToGoogleFemaleVoice,
  encodePcmFloat32ToWavBlob,
  generateGoogleFemaleVoiceFromText,
  inferMediaMimeType,
  isSafeMediaUrl,
  uploadAudioWithFallback,
  uploadChatPhotoWithFallback,
  uploadMediaFile,
} from '../utils/media';

export interface SponsoredGateProps {
  active: boolean;
  linkUrl: string;
  messagesSentInCycle: number;
  messagesBeforeLink: number;
  minStaySeconds?: number;
  onLinkVisited: () => Promise<void> | void;
}

interface ChatComposerProps {
  user: User;
  threadId: string;
  lang: Language;
  placeholder: string;
  enableFemaleVoiceOption?: boolean;
  replyingTo?: ReplyTarget | null;
  onCancelReply?: () => void;
  sponsoredGate?: SponsoredGateProps;
  onSendPayload: (payload: {
    messageType: MessageType;
    text: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    replyTo?: ReplyTarget | null;
  }) => Promise<void>;
}

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function isBackendUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes('BACKEND_HTML_RESPONSE') ||
    err.message.includes('Failed to fetch') ||
    err.message.includes('Load failed') ||
    err.message.includes('NetworkError')
  );
}

function mergeFloat32Chunks(chunks: Float32Array[], totalLength: number): Float32Array {
  const out = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function downsampleTo16kHz(samples: Float32Array, inputSampleRate: number): Float32Array {
  const targetRate = 16000;
  if (inputSampleRate <= targetRate) return samples;
  const ratio = inputSampleRate / targetRate;
  const newLength = Math.max(1, Math.floor(samples.length / ratio));
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    result[i] = samples[Math.min(samples.length - 1, Math.floor(i * ratio))];
  }
  return result;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  user,
  threadId,
  lang,
  placeholder,
  enableFemaleVoiceOption = false,
  replyingTo = null,
  onCancelReply,
  sponsoredGate,
  onSendPayload,
}) => {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [femaleVoiceEnabled, setFemaleVoiceEnabled] = useState(enableFemaleVoiceOption);

  // Instant Mic Permission Popup Modal
  const [micPermPopupOpen, setMicPermPopupOpen] = useState(false);
  const [micPermReason, setMicPermReason] = useState<'denied' | 'unsupported' | 'unavailable'>(
    'denied',
  );

  // Unified Pic/Video/Audio link popover
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkType, setLinkType] = useState<'image' | 'video' | 'audio'>('video');

  // Strict 20-second Sponsored Link Stay Tracker
  const [visitState, setVisitState] = useState<{
    active: boolean;
    accumulatedAwayMs: number;
    liveTotalMs: number;
    returnedEarly: boolean;
    completing: boolean;
  }>({
    active: false,
    accumulatedAwayMs: 0,
    liveTotalMs: 0,
    returnedEarly: false,
    completing: false,
  });
  const awayStartedAtRef = useRef<number | null>(null);
  const completingGateRef = useRef(false);
  const sponsoredGateRef = useRef(sponsoredGate);
  useEffect(() => {
    sponsoredGateRef.current = sponsoredGate;
  }, [sponsoredGate]);

  // Voice Recorder state (MediaRecorder + PCM AudioContext fallback)
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pcmRecorderRef = useRef<{
    stop: (cancel: boolean) => Promise<void>;
  } | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRecordRef = useRef(false);

  const picVideoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (replyingTo) {
      window.setTimeout(() => {
        textareaRef.current?.focus();
      }, 40);
    }
  }, [replyingTo]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const isGateBlocking = Boolean(
    sponsoredGate?.active && sponsoredGate.linkUrl && isSafeHttpsLink(sponsoredGate.linkUrl),
  );
  const minStaySeconds = Math.max(0, sponsoredGate?.minStaySeconds ?? 20);
  const targetAwayMs = minStaySeconds * 1000;
  const gateStorageKey = `bartaconnect_gate_${user.uid}`;

  useEffect(() => {
    completingGateRef.current = false;
    awayStartedAtRef.current = null;
    if (!isGateBlocking || !sponsoredGate?.linkUrl) {
      setVisitState({
        active: false,
        accumulatedAwayMs: 0,
        liveTotalMs: 0,
        returnedEarly: false,
        completing: false,
      });
      return;
    }

    let restoredMs = 0;
    try {
      const raw = window.localStorage.getItem(gateStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { linkUrl?: string; awayMs?: number };
        if (parsed.linkUrl === sponsoredGate.linkUrl && typeof parsed.awayMs === 'number') {
          restoredMs = Math.max(0, Math.min(targetAwayMs, parsed.awayMs));
        }
      }
    } catch {
      restoredMs = 0;
    }

    setVisitState({
      active: restoredMs > 0,
      accumulatedAwayMs: restoredMs,
      liveTotalMs: restoredMs,
      returnedEarly: restoredMs > 0 && restoredMs < targetAwayMs,
      completing: false,
    });
  }, [isGateBlocking, sponsoredGate?.linkUrl, gateStorageKey, targetAwayMs]);

  useEffect(() => {
    if (!isGateBlocking || !visitState.active || !sponsoredGate?.linkUrl) return;
    const activeUrl = sponsoredGate.linkUrl;

    const persistProgress = (awayMs: number) => {
      try {
        window.localStorage.setItem(
          gateStorageKey,
          JSON.stringify({ linkUrl: activeUrl, awayMs }),
        );
      } catch {
        // Ignore storage quota issues
      }
    };

    const completeStep = async () => {
      if (completingGateRef.current) return;
      completingGateRef.current = true;
      awayStartedAtRef.current = null;
      setVisitState((prev) => ({
        ...prev,
        liveTotalMs: targetAwayMs,
        accumulatedAwayMs: targetAwayMs,
        returnedEarly: false,
        completing: true,
      }));
      try {
        window.localStorage.removeItem(gateStorageKey);
      } catch {
        // Ignore
      }
      try {
        await sponsoredGateRef.current?.onLinkVisited();
      } catch (err) {
        console.error('Complete link step failed:', err);
        completingGateRef.current = false;
        setVisitState((prev) => ({ ...prev, completing: false }));
      }
    };

    const syncClock = (userJustReturned: boolean) => {
      if (completingGateRef.current) return;
      const isAway = document.visibilityState === 'hidden' || !document.hasFocus();
      const now = Date.now();

      setVisitState((prev) => {
        if (!prev.active || completingGateRef.current) return prev;

        if (isAway) {
          if (awayStartedAtRef.current === null) {
            awayStartedAtRef.current = now;
          }
          const sessionElapsed = now - awayStartedAtRef.current;
          const total = prev.accumulatedAwayMs + sessionElapsed;
          if (total >= targetAwayMs) {
            void completeStep();
            return {
              ...prev,
              liveTotalMs: targetAwayMs,
              returnedEarly: false,
            };
          }
          persistProgress(total);
          return {
            ...prev,
            liveTotalMs: total,
            returnedEarly: false,
          };
        }

        if (awayStartedAtRef.current !== null) {
          const sessionElapsed = now - awayStartedAtRef.current;
          awayStartedAtRef.current = null;
          const total = prev.accumulatedAwayMs + sessionElapsed;
          if (total >= targetAwayMs) {
            void completeStep();
            return {
              ...prev,
              accumulatedAwayMs: targetAwayMs,
              liveTotalMs: targetAwayMs,
              returnedEarly: false,
            };
          }
          persistProgress(total);
          return {
            ...prev,
            accumulatedAwayMs: total,
            liveTotalMs: total,
            returnedEarly: true,
          };
        }

        if (userJustReturned && prev.accumulatedAwayMs < targetAwayMs) {
          return {
            ...prev,
            returnedEarly: true,
          };
        }
        return prev;
      });
    };

    const handleVisibilityOrBlur = () => {
      const isAway = document.visibilityState === 'hidden' || !document.hasFocus();
      syncClock(!isAway);
    };

    const intervalId = window.setInterval(() => {
      syncClock(false);
    }, 500);

    document.addEventListener('visibilitychange', handleVisibilityOrBlur);
    window.addEventListener('blur', handleVisibilityOrBlur);
    window.addEventListener('focus', handleVisibilityOrBlur);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityOrBlur);
      window.removeEventListener('blur', handleVisibilityOrBlur);
      window.removeEventListener('focus', handleVisibilityOrBlur);
    };
  }, [isGateBlocking, visitState.active, sponsoredGate?.linkUrl, gateStorageKey, targetAwayMs]);

  const staySecondsDone = Math.min(minStaySeconds, Math.floor(visitState.liveTotalMs / 1000));
  const staySecondsRemaining = Math.max(0, minStaySeconds - staySecondsDone);

  const gateBlockedMessage =
    lang === 'bn'
      ? `পরবর্তী মেসেজ পাঠাতে ডানের "লিংক ওপেন করুন" বাটনে ক্লিক করে লিংকটিতে অন্তত ${minStaySeconds} সেকেন্ড থাকুন।`
      : `Please click "Open Link" and stay on the page for at least ${minStaySeconds}s to continue.`;

  const handleOpenSponsoredLinkClick = () => {
    setErrorMsg(null);
    if (minStaySeconds <= 0) {
      if (!completingGateRef.current) {
        completingGateRef.current = true;
        void sponsoredGate?.onLinkVisited();
      }
      return;
    }
    awayStartedAtRef.current = Date.now();
    setVisitState((prev) => ({
      ...prev,
      active: true,
      returnedEarly: false,
    }));
  };

  const dispatchWithReply = async (payload: {
    messageType: MessageType;
    text: string;
    mediaUrl?: string;
    mediaMimeType?: string;
  }) => {
    await onSendPayload({
      ...payload,
      replyTo: replyingTo,
    });
    if (replyingTo) {
      onCancelReply?.();
    }
  };

  const dispatchAudioBlob = async (blob: Blob, rawMime: string, caption: string) => {
    if (enableFemaleVoiceOption && femaleVoiceEnabled) {
      setUploadingLabel(
        lang === 'bn'
          ? 'একক নারী কণ্ঠে রূপান্তর হচ্ছে...'
          : 'Converting to unified female voice...',
      );
      try {
        const converted = await convertVoiceToGoogleFemaleVoice({
          file: blob,
          mimeType: rawMime,
          threadId,
          user,
          voiceName: 'Kore',
        });
        await dispatchWithReply({
          messageType: 'audio',
          text: caption,
          mediaUrl: converted.url,
          mediaMimeType: converted.mimeType,
        });
        return;
      } catch {
        // Always fall back cleanly to sending the recorded/selected audio directly
      }
    }

    setUploadingLabel(lang === 'bn' ? 'ভয়েস পাঠানো হচ্ছে...' : 'Sending voice note...');
    const uploaded = await uploadAudioWithFallback({
      file: blob,
      mimeType: rawMime,
      threadId,
      user,
    });
    await dispatchWithReply({
      messageType: 'audio',
      text: caption,
      mediaUrl: uploaded.url,
      mediaMimeType: uploaded.mimeType,
    });
  };

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
      await dispatchWithReply({
        messageType: 'text',
        text: trimmed,
      });
      setDraft('');
    } catch (err) {
      console.error('Send text failed:', err);
      const errDetail = err instanceof Error && err.message ? err.message : '';
      setErrorMsg(
        errDetail && !errDetail.includes('<')
          ? errDetail
          : lang === 'bn'
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
    if (isGateBlocking) {
      setErrorMsg(gateBlockedMessage);
      return;
    }

    const mime = inferMediaMimeType(file);
    const isVideo = mime.startsWith('video/');
    const isImage = mime.startsWith('image/') || (!mime && !isVideo);

    if (!isImage && !isVideo) {
      setErrorMsg(
        lang === 'bn'
          ? 'দয়া করে সঠিক ছবি (JPG/PNG/WebP) বা ভিডিও (MP4/WebM/MOV) ফাইল নির্বাচন করুন।'
          : 'Please choose a valid image (JPG/PNG/WebP) or video (MP4/WebM/MOV) file.',
      );
      return;
    }

    const maxBytes = isVideo ? 25 * 1024 * 1024 : 15 * 1024 * 1024;
    if (file.size > maxBytes) {
      setErrorMsg(
        lang === 'bn'
          ? isVideo
            ? 'ভিডিও ফাইল সর্বোচ্চ ২৫ মেগাবাইট হতে পারবে।'
            : 'ছবি ফাইল সর্বোচ্চ ১৫ মেগাবাইট হতে পারবে।'
          : isVideo
            ? 'Video file must be under 25 MB.'
            : 'Image file must be under 15 MB.',
      );
      return;
    }

    setErrorMsg(null);
    setUploadingLabel(
      lang === 'bn'
        ? isVideo
          ? 'ভিডিও আপলোড হচ্ছে...'
          : 'ছবি প্রস্তুত করে পাঠানো হচ্ছে...'
        : isVideo
          ? 'Uploading video...'
          : 'Preparing & sending photo...',
    );

    try {
      if (isImage) {
        const uploaded = await uploadChatPhotoWithFallback({
          file,
          threadId,
          user,
        });
        await dispatchWithReply({
          messageType: 'image',
          text: draft.trim(),
          mediaUrl: uploaded.url,
          mediaMimeType: uploaded.mimeType,
        });
        setDraft('');
      } else {
        const uploaded = await uploadMediaFile({
          file,
          mimeType: mime,
          threadId,
          user,
        });
        await dispatchWithReply({
          messageType: uploaded.mediaType,
          text: draft.trim(),
          mediaUrl: uploaded.url,
          mediaMimeType: uploaded.mimeType,
        });
        setDraft('');
      }
    } catch (err) {
      if (isVideo && isBackendUnavailableError(err)) {
        setErrorMsg(
          lang === 'bn'
            ? 'সরাসরি বড় ভিডিও আপলোড শুধু ফুল-স্ট্যাক সার্ভারে চলে। "লিংক" বাটন থেকে https:// ভিডিও বা YouTube লিংক শেয়ার করুন।'
            : 'Direct large video uploads require the Node backend. Share an https:// or YouTube URL via Media Link instead.',
        );
      } else {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : lang === 'bn'
              ? 'ফাইল আপলোড ব্যর্থ হয়েছে।'
              : 'Media upload failed.',
        );
      }
    } finally {
      setUploadingLabel(null);
    }
  };

  const handleAudioFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
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
      await dispatchAudioBlob(file, mime, draft.trim());
      setDraft('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : lang === 'bn'
            ? 'অডিও পাঠানো ব্যর্থ হয়েছে।'
            : 'Audio upload failed.',
      );
    } finally {
      setUploadingLabel(null);
    }
  };

  const startPcmFallbackRecorder = (stream: MediaStream) => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Audio recording unavailable');
    }

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    let totalSamples = 0;

    processor.onaudioprocess = (ev) => {
      const channel = ev.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(channel));
      totalSamples += channel.length;
    };

    source.connect(processor);
    processor.connect(ctx.destination);

    pcmRecorderRef.current = {
      stop: async (cancel: boolean) => {
        try {
          processor.disconnect();
          source.disconnect();
        } catch {
          // Ignore
        }
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (recordTimerRef.current) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        const inputRate = ctx.sampleRate || 44100;
        void ctx.close().catch(() => {});
        pcmRecorderRef.current = null;
        setIsRecording(false);
        setRecordSeconds(0);

        if (cancel || totalSamples < 1000) {
          if (!cancel) {
            setErrorMsg(
              lang === 'bn'
                ? 'ভয়েস রেকর্ড খুব ছোট বা খালি ছিল। অন্তত ১-২ সেকেন্ড কথা বলে পাঠান।'
                : 'Recorded voice was too short. Please speak for 1-2 seconds.',
            );
          }
          return;
        }

        const merged = mergeFloat32Chunks(chunks, totalSamples);
        const downsampled = downsampleTo16kHz(merged, inputRate);
        const wavBlob = encodePcmFloat32ToWavBlob(downsampled, Math.min(inputRate, 16000));

        try {
          await dispatchAudioBlob(wavBlob, 'audio/wav', '');
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
      },
    };
  };

  const startVoiceRecording = async () => {
    if (isGateBlocking) {
      setErrorMsg(gateBlockedMessage);
      return;
    }
    if (isRecording || sending || uploadingLabel) return;
    setErrorMsg(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermReason('unsupported');
      setMicPermPopupOpen(true);
      return;
    }

    // Proactively surface clear permission popup immediately if mic permission is already denied
    try {
      if (navigator.permissions?.query) {
        const perm = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        });
        if (perm.state === 'denied') {
          setMicPermReason('denied');
          setMicPermPopupOpen(true);
          return;
        }
      }
    } catch {
      // Safari / some WebViews throw for permissions.query('microphone'); proceed directly to getUserMedia
    }

    let stream: MediaStream;
    try {
      // Calling getUserMedia triggers browser's native permission popup immediately when in 'prompt' state
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const errName = (err as { name?: string })?.name ?? '';
      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setMicPermReason('unavailable');
      } else {
        setMicPermReason('denied');
      }
      setMicPermPopupOpen(true);
      return;
    }

    setMicPermPopupOpen(false);
    streamRef.current = stream;
    cancelledRecordRef.current = false;

    if (typeof MediaRecorder === 'undefined') {
      try {
        startPcmFallbackRecorder(stream);
        setIsRecording(true);
        setRecordSeconds(0);
        recordTimerRef.current = window.setInterval(() => {
          setRecordSeconds((prev) => prev + 1);
        }, 1000);
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setMicPermReason('unsupported');
        setMicPermPopupOpen(true);
      }
      return;
    }

    try {
      const localChunks: Blob[] = [];
      const preferredMime =
        AUDIO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          ...(preferredMime ? { mimeType: preferredMime } : {}),
          audioBitsPerSecond: 24000,
        });
      } catch {
        recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          localChunks.push(ev.data);
        }
      };

      recorder.onstop = () => {
        void (async () => {
          await new Promise((r) => window.setTimeout(r, 60));
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          mediaRecorderRef.current = null;
          if (recordTimerRef.current) {
            window.clearInterval(recordTimerRef.current);
            recordTimerRef.current = null;
          }
          setIsRecording(false);
          setRecordSeconds(0);

          if (cancelledRecordRef.current) return;

          const rawMime = recorder.mimeType || preferredMime || 'audio/webm';
          const finalBlob = new Blob(localChunks, { type: rawMime });

          if (localChunks.length === 0 || finalBlob.size < 120) {
            setErrorMsg(
              lang === 'bn'
                ? 'ভয়েস রেকর্ড খুব ছোট বা খালি ছিল। অনুগ্রহ করে অন্তত ১-২ সেকেন্ড কথা বলে পাঠান।'
                : 'Recorded voice was too short. Please speak for at least 1-2 seconds.',
            );
            return;
          }

          try {
            await dispatchAudioBlob(finalBlob, rawMime, '');
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
        })();
      };

      mediaRecorderRef.current = recorder;
      try {
        recorder.start(500);
      } catch {
        recorder.start();
      }
      setIsRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      // Fall back transparently to Web Audio PCM WAV recorder if MediaRecorder failed to initialize
      try {
        startPcmFallbackRecorder(stream);
        setIsRecording(true);
        setRecordSeconds(0);
        recordTimerRef.current = window.setInterval(() => {
          setRecordSeconds((prev) => prev + 1);
        }, 1000);
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setMicPermReason('unsupported');
        setMicPermPopupOpen(true);
      }
    }
  };

  const stopVoiceRecording = (cancel: boolean) => {
    cancelledRecordRef.current = cancel;
    if (pcmRecorderRef.current) {
      void pcmRecorderRef.current.stop(cancel);
      return;
    }
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
      await dispatchWithReply({
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
      await dispatchWithReply({
        messageType: 'audio',
        text: '',
        mediaUrl: generated.url,
        mediaMimeType: generated.mimeType,
      });
      setDraft('');
    } catch (err) {
      if (isBackendUnavailableError(err)) {
        setErrorMsg(
          lang === 'bn'
            ? 'টেক্সট-টু-নারী-কণ্ঠ AI ফিচারটি শুধু ফুল-স্ট্যাক সার্ভারে চলে। সাধারণ টেক্সট অথবা "ভয়েস" বাটন দিয়ে সরাসরি ভয়েস পাঠান।'
            : 'Text-to-female-voice requires the Node backend. Send text directly or record voice using the Mic button.',
        );
      } else {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : lang === 'bn'
              ? 'নারী কণ্ঠ তৈরি করা যায়নি।'
              : 'Could not generate female voice.',
        );
      }
    } finally {
      setUploadingLabel(null);
    }
  };

  return (
    <>
      <div className="px-3 pt-2.5 pb-24 sm:px-4 sm:pt-3 sm:pb-8 border-t border-slate-200 bg-white shrink-0 space-y-2 shadow-[0_-6px_20px_rgba(15,23,42,0.06)] relative z-20">
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

        {replyingTo && (
          <div className="flex items-center justify-between gap-2.5 pl-3 pr-2 py-2 bg-slate-50 border border-slate-200 border-l-4 border-l-blue-600 rounded-xl">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 truncate">
                <Reply className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {lang === 'bn'
                    ? `${replyingTo.senderName}-এর মেসেজে রিপ্লাই দিচ্ছেন`
                    : `Replying to ${replyingTo.senderName}`}
                </span>
              </p>
              <p className="text-xs text-slate-600 truncate mt-0.5">
                {replyingTo.text.trim()
                  ? replyingTo.text
                  : replyingTo.messageType === 'image'
                    ? lang === 'bn'
                      ? '📷 ছবি'
                      : '📷 Photo'
                    : replyingTo.messageType === 'video'
                      ? lang === 'bn'
                        ? '🎬 ভিডিও'
                        : '🎬 Video'
                      : lang === 'bn'
                        ? '🎤 ভয়েস মেসেজ'
                        : '🎤 Voice note'}
              </p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label={lang === 'bn' ? 'রিপ্লাই বাতিল করুন' : 'Cancel reply'}
              className="min-w-[34px] min-h-[34px] rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Strict 20-Second Stay Sponsored Link Gate Banner */}
        {isGateBlocking && sponsoredGate && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              {visitState.active ? (
                <Clock className="w-4 h-4 text-amber-700 shrink-0" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              )}
              <span className="leading-snug font-medium">
                {visitState.completing
                  ? lang === 'bn'
                    ? '২০ সেকেন্ড সম্পন্ন! চ্যাট আনলক হচ্ছে...'
                    : 'Stay verified! Unlocking chat...'
                  : visitState.returnedEarly
                    ? lang === 'bn'
                      ? `লিংকে অন্তত ${minStaySeconds} সেকেন্ড থাকতে হবে — হয়েছে ${staySecondsDone}/${minStaySeconds} সেকেন্ড। বাকি ${staySecondsRemaining} সেকেন্ড থাকতে আবার লিংক ওপেন করুন।`
                      : `Must stay ${minStaySeconds}s on link — ${staySecondsDone}/${minStaySeconds}s completed. Re-open link for remaining ${staySecondsRemaining}s.`
                    : visitState.active
                      ? lang === 'bn'
                        ? `লিংকে থাকুন: ${staySecondsDone}/${minStaySeconds} সেকেন্ড সম্পন্ন (${staySecondsRemaining} সেকেন্ড বাকি)`
                        : `Stay on link tab: ${staySecondsDone}/${minStaySeconds}s (${staySecondsRemaining}s left)`
                      : lang === 'bn'
                        ? `${sponsoredGate.messagesSentInCycle}/${sponsoredGate.messagesBeforeLink} মেসেজ হয়েছে — নিচের "লিংক ওপেন করুন" বাটনে ক্লিক করে লিংকে অন্তত ${minStaySeconds} সেকেন্ড থাকুন।`
                        : `${sponsoredGate.messagesSentInCycle}/${sponsoredGate.messagesBeforeLink} messages reached — open the link below and stay ${minStaySeconds}s to continue.`}
              </span>
            </div>
            <span className="text-[11px] font-mono text-amber-800 bg-white/80 border border-amber-200 px-2 py-0.5 rounded-md truncate max-w-[180px]">
              {visitState.active && minStaySeconds > 0
                ? `${staySecondsDone}/${minStaySeconds}s`
                : formatLinkDomain(sponsoredGate.linkUrl)}
            </span>
          </div>
        )}

        {/* Locked Raised Image, Voice & Media Action Menu Row (above input row so Netlify never hides it & text box never squishes) */}
        {!isRecording && (
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-0.5">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => picVideoInputRef.current?.click()}
                disabled={Boolean(uploadingLabel)}
                title={lang === 'bn' ? 'ছবি বা ভিডিও পাঠান' : 'Send Photo or Video'}
                aria-label={lang === 'bn' ? 'ছবি বা ভিডিও পাঠান' : 'Send Photo or Video'}
                className="min-h-[40px] px-3 rounded-xl inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 active:scale-95 transition-colors cursor-pointer shrink-0"
              >
                <ImageIcon className="w-4 h-4 text-blue-600 shrink-0" />
                <span>{lang === 'bn' ? 'ছবি' : 'Photo'}</span>
                <Film className="hidden sm:inline w-3.5 h-3.5 text-slate-500 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => void startVoiceRecording()}
                disabled={Boolean(uploadingLabel)}
                title={lang === 'bn' ? 'ভয়েস রেকর্ড করে পাঠান' : 'Record Voice Note'}
                aria-label={lang === 'bn' ? 'ভয়েস রেকর্ড করুন' : 'Record Voice Note'}
                className="min-h-[40px] px-3 rounded-xl inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 active:scale-95 transition-colors cursor-pointer shrink-0"
              >
                <Mic className="w-4 h-4 text-blue-600 shrink-0" />
                <span>{lang === 'bn' ? 'ভয়েস' : 'Voice'}</span>
              </button>

              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                disabled={Boolean(uploadingLabel)}
                title={lang === 'bn' ? 'অডিও ফাইল পাঠান' : 'Upload Audio File'}
                aria-label={lang === 'bn' ? 'অডিও ফাইল পাঠান' : 'Upload Audio File'}
                className="min-h-[40px] px-3 rounded-xl inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 active:scale-95 transition-colors cursor-pointer shrink-0"
              >
                <FileAudio className="w-4 h-4 text-slate-600 shrink-0" />
                <span>{lang === 'bn' ? 'অডিও' : 'Audio'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowLinkInput((prev) => !prev)}
                disabled={Boolean(uploadingLabel)}
                title={lang === 'bn' ? 'মিডিয়া লিংক শেয়ার করুন' : 'Share Media Link'}
                aria-label={lang === 'bn' ? 'মিডিয়া লিংক শেয়ার করুন' : 'Share Media Link'}
                className={`min-h-[40px] px-3 rounded-xl inline-flex items-center justify-center gap-1.5 text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                  showLinkInput
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                <Link2 className="w-4 h-4 shrink-0" />
                <span>{lang === 'bn' ? 'লিংক' : 'Link'}</span>
              </button>
            </div>

            {enableFemaleVoiceOption && (
              <button
                type="button"
                onClick={() => setFemaleVoiceEnabled((prev) => !prev)}
                className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 rounded-xl border text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                  femaleVoiceEnabled
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">
                  {femaleVoiceEnabled
                    ? lang === 'bn'
                      ? 'নারী কণ্ঠ: চালু'
                      : 'Female Voice: ON'
                    : lang === 'bn'
                      ? 'নারী কণ্ঠ: বন্ধ'
                      : 'Female Voice: OFF'}
                </span>
              </button>
            )}
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
          accept="image/*,video/*"
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
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-red-700 min-w-0">
              <Mic className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {lang === 'bn'
                  ? enableFemaleVoiceOption && femaleVoiceEnabled
                    ? 'নারী কণ্ঠে রেকর্ড'
                    : 'ভয়েস রেকর্ড চলছে'
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
          <form onSubmit={handleSendText} className="flex items-end gap-2">
            <div className="flex-1 min-w-0 relative">
              <textarea
                ref={textareaRef}
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
                className="w-full min-h-[46px] resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15 max-h-32"
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
                className="min-h-[46px] min-w-[46px] px-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 hover:bg-blue-50 text-blue-700 text-xs font-semibold transition-colors shrink-0 cursor-pointer"
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
                onClick={handleOpenSponsoredLinkClick}
                aria-label={
                  lang === 'bn' ? 'স্পন্সরড লিংক ওপেন করুন' : 'Open Sponsored Link'
                }
                className="min-h-[46px] px-4 inline-flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs sm:text-sm font-semibold transition-colors shrink-0 cursor-pointer shadow-xs active:scale-95"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span className="whitespace-nowrap">
                  {visitState.active && staySecondsRemaining > 0
                    ? lang === 'bn'
                      ? `লিংক ওপেন (${staySecondsRemaining}সে)`
                      : `Open (${staySecondsRemaining}s)`
                    : lang === 'bn'
                      ? 'লিংক ওপেন করুন'
                      : 'Open Link'}
                </span>
              </a>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim() || sending || Boolean(uploadingLabel)}
                aria-label={lang === 'bn' ? 'পাঠান' : 'Send'}
                className="min-h-[46px] min-w-[46px] px-4 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium transition-colors shrink-0 cursor-pointer active:scale-95"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">{lang === 'bn' ? 'পাঠান' : 'Send'}</span>
              </button>
            )}
          </form>
        )}
      </div>

      {/* Instant Microphone Permission Popup Modal */}
      {micPermPopupOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {lang === 'bn'
                      ? 'মাইক্রোফোন অনুমতি প্রয়োজন'
                      : 'Microphone Permission Required'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {micPermReason === 'unavailable'
                      ? lang === 'bn'
                        ? 'ডিভাইসে মাইক্রোফোন খুঁজে পাওয়া যায়নি'
                        : 'No microphone device detected'
                      : micPermReason === 'unsupported'
                        ? lang === 'bn'
                          ? 'এই ব্রাউজারে লাইভ রেকর্ডার অনুমোদিত নয়'
                          : 'Live mic recording blocked or unsupported'
                        : lang === 'bn'
                          ? 'ভয়েস মেসেজ পাঠাতে মাইক্রোফোন চালু করুন'
                          : 'Allow microphone access to send voice messages'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMicPermPopupOpen(false)}
                aria-label="Close"
                className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1.5 leading-relaxed">
              {micPermReason === 'unavailable' ? (
                <p>
                  {lang === 'bn'
                    ? 'আপনার ফোনের মাইক্রোফোন চালু আছে কিনা দেখুন অথবা সরাসরি নিচের "অডিও ফাইল আপলোড করুন" বাটনে ক্লিক করে যেকোনো অডিও পাঠান।'
                    : 'Please verify your microphone is connected, or upload a recorded audio file directly below.'}
                </p>
              ) : (
                <>
                  <p className="font-semibold text-slate-800">
                    {lang === 'bn'
                      ? 'অনুমতি দেওয়ার সহজ নিয়ম:'
                      : 'How to enable microphone permission:'}
                  </p>
                  <p>
                    {lang === 'bn'
                      ? '১. ব্রাউজারের উপরে থাকা তালা (Lock) বা সেটিংস আইকনে ক্লিক করুন।'
                      : '1. Tap the Lock / Site Settings icon in the browser address bar.'}
                  </p>
                  <p>
                    {lang === 'bn'
                      ? '২. Microphone অপশনটি "Allow" করে দিয়ে নিচের "আবার চেষ্টা করুন" বাটনে ক্লিক করুন।'
                      : '2. Set Microphone to "Allow", then tap "Retry Microphone" below.'}
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => {
                  setMicPermPopupOpen(false);
                  void startVoiceRecording();
                }}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>{lang === 'bn' ? 'আবার মাইক চেষ্টা করুন' : 'Retry Microphone'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMicPermPopupOpen(false);
                  audioInputRef.current?.click();
                }}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-medium cursor-pointer"
              >
                <FileAudio className="w-4 h-4" />
                <span>{lang === 'bn' ? 'অডিও ফাইল পাঠান' : 'Upload Audio File'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
