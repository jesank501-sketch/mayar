import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Film, Pause, Play, Reply } from 'lucide-react';
import { ChatMessage, Language } from '../types';
import { extractYouTubeEmbedUrl, isSafeMediaUrl } from '../utils/media';

interface MediaMessageContentProps {
  message: ChatMessage;
  isOwn: boolean;
  lang?: Language;
  onJumpToMessage?: (messageId: string) => void;
}

function formatAudioSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return `${mins}:${rem.toString().padStart(2, '0')}`;
}

function formatQuotedPreview(message: ChatMessage, lang: Language): string {
  const clean = (message.replyToText ?? '').trim();
  if (clean) return clean;
  const rType = message.replyToMessageType;
  if (rType === 'image') return lang === 'bn' ? '📷 ছবি' : '📷 Photo';
  if (rType === 'video') return lang === 'bn' ? '🎬 ভিডিও' : '🎬 Video';
  if (rType === 'audio') return lang === 'bn' ? '🎤 ভয়েস মেসেজ' : '🎤 Voice note';
  return lang === 'bn' ? 'মেসেজ' : 'Message';
}

const VoiceNotePlayer: React.FC<{ url: string; isOwn: boolean }> = ({ url, isOwn }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [url]);

  const togglePlayback = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setIsPlaying(false));
    } else {
      el.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const nextTime = Number(e.target.value);
    el.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      className={`flex items-center gap-2.5 rounded-2xl px-2.5 py-2 w-full min-w-[205px] max-w-[260px] sm:max-w-[280px] ${
        isOwn ? 'bg-blue-700/70' : 'bg-white border border-slate-200'
      }`}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        src={url}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => {
          setCurrentTime(e.currentTarget.currentTime);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />

      <button
        type="button"
        onClick={togglePlayback}
        aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
        className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer ${
          isOwn
            ? 'bg-white text-blue-700 hover:bg-blue-50'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="relative h-5 flex items-center">
          <div
            className={`w-full h-1.5 rounded-full overflow-hidden ${
              isOwn ? 'bg-blue-900/50' : 'bg-slate-200'
            }`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-75 ${
                isOwn ? 'bg-white' : 'bg-blue-600'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            aria-label="Seek voice note"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>

        <div
          className={`flex items-center justify-between text-[11px] font-mono-tabular ${
            isOwn ? 'text-blue-100' : 'text-slate-500'
          }`}
        >
          <span>{formatAudioSeconds(currentTime)}</span>
          <span>{duration > 0 ? formatAudioSeconds(duration) : 'Voice'}</span>
        </div>
      </div>
    </div>
  );
};

export const MediaMessageContent: React.FC<MediaMessageContentProps> = ({
  message,
  isOwn,
  lang = 'bn',
  onJumpToMessage,
}) => {
  const [imgError, setImgError] = useState(false);
  const mType = message.messageType || 'text';
  const url = message.mediaUrl || '';
  const safeUrl = isSafeMediaUrl(url);
  const ytEmbed = mType === 'video' && safeUrl ? extractYouTubeEmbedUrl(url) : null;
  const hasReplyQuote = Boolean(message.replyToMessageId);

  return (
    <div className="space-y-2 max-w-full">
      {hasReplyQuote && message.replyToMessageId && (
        <button
          type="button"
          data-no-swipe="true"
          onClick={() => onJumpToMessage?.(message.replyToMessageId!)}
          className={`w-full text-left rounded-xl px-2.5 py-1.5 border-l-2 transition-colors cursor-pointer ${
            isOwn
              ? 'bg-blue-700/60 hover:bg-blue-700/80 border-blue-200 text-blue-50'
              : 'bg-white/90 hover:bg-white border-blue-500 text-slate-700'
          }`}
        >
          <span
            className={`flex items-center gap-1 text-[11px] font-semibold truncate ${
              isOwn ? 'text-blue-100' : 'text-blue-700'
            }`}
          >
            <Reply className="w-3 h-3 shrink-0" />
            <span className="truncate">{message.replyToSenderName || 'Reply'}</span>
          </span>
          <span
            className={`block text-xs truncate mt-0.5 ${
              isOwn ? 'text-blue-100/90' : 'text-slate-600'
            }`}
          >
            {formatQuotedPreview(message, lang)}
          </span>
        </button>
      )}

      {mType === 'image' && safeUrl && !imgError && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-xl bg-slate-100 w-full max-w-[260px] sm:max-w-[320px]"
        >
          <img
            src={url}
            alt={message.text || 'Shared photo'}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full max-h-72 object-cover rounded-xl"
          />
        </a>
      )}

      {mType === 'video' && safeUrl && (
        <div className="overflow-hidden rounded-xl bg-slate-950/90 w-full max-w-[260px] sm:max-w-[320px]">
          {ytEmbed ? (
            <div className="w-full aspect-video">
              <iframe
                src={ytEmbed}
                title="Shared video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
          ) : (
            <video
              controls
              playsInline
              preload="metadata"
              src={url}
              className="w-full max-h-64 rounded-xl bg-slate-950"
            />
          )}
          {url.startsWith('https://') && !ytEmbed && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] underline ${
                isOwn ? 'text-blue-100' : 'text-slate-600'
              }`}
            >
              <Film className="w-3 h-3 shrink-0" />
              <span className="truncate">{url}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          )}
        </div>
      )}

      {mType === 'audio' && safeUrl && <VoiceNotePlayer url={url} isOwn={isOwn} />}

      {message.text && (
        <p className="text-[15px] sm:text-sm leading-relaxed whitespace-pre-wrap break-words">
          {message.text}
        </p>
      )}
    </div>
  );
};
