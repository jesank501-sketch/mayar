import React from 'react';
import { Film, Image as ImageIcon, X } from 'lucide-react';
import { ChatMessage, Language } from '../types';
import { formatRelativeTime } from '../utils/formatters';
import { extractYouTubeEmbedUrl, isSafeMediaUrl } from '../utils/media';

interface MediaGalleryPanelProps {
  messages: ChatMessage[];
  lang: Language;
  onClose?: () => void;
}

export const MediaGalleryPanel: React.FC<MediaGalleryPanelProps> = ({
  messages,
  lang,
  onClose,
}) => {
  const mediaItems = messages.filter(
    (m) =>
      (m.messageType === 'image' || m.messageType === 'video') &&
      isSafeMediaUrl(m.mediaUrl),
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/40">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              {lang === 'bn'
                ? 'শেয়ার করা ছবি ও ভিডিও'
                : 'Shared Photos & Videos'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {mediaItems.length}{' '}
              {lang === 'bn' ? 'টি ছবি ও ভিডিও' : 'photos & videos'}
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'চ্যাটে ফিরুন' : 'Back to Chat'}</span>
            </button>
          )}
        </div>

        {mediaItems.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto gap-0.5">
              <ImageIcon className="w-4 h-4" />
              <Film className="w-4 h-4" />
            </div>
            <p className="text-sm font-semibold text-slate-800">
              {lang === 'bn'
                ? 'এখনো কোনো ছবি বা ভিডিও শেয়ার করা হয়নি'
                : 'No photos or videos shared yet'}
            </p>
            <p className="text-xs text-slate-500">
              {lang === 'bn'
                ? 'চ্যাটের নিচের ছবি/ভিডিও বাটন ব্যবহার করে পাঠালে সেগুলো একসাথে এই সেকশনে জমা থাকবে।'
                : 'Any photos or videos sent in this chat will appear together in this section.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {mediaItems
              .slice()
              .reverse()
              .map((m) => {
                const ytEmbed =
                  m.messageType === 'video'
                    ? extractYouTubeEmbedUrl(m.mediaUrl)
                    : null;

                return (
                  <div
                    key={m.id}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col"
                  >
                    <div className="bg-slate-950/95 aspect-video flex items-center justify-center overflow-hidden">
                      {m.messageType === 'image' ? (
                        <a
                          href={m.mediaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full h-full block"
                        >
                          <img
                            src={m.mediaUrl}
                            alt={m.text || 'Shared photo'}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </a>
                      ) : ytEmbed ? (
                        <iframe
                          src={ytEmbed}
                          title={m.text || 'Shared video'}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          className="w-full h-full border-0"
                        />
                      ) : (
                        <video
                          controls
                          playsInline
                          preload="metadata"
                          src={m.mediaUrl}
                          className="w-full h-full object-contain"
                        />
                      )}
                    </div>

                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-800 truncate">
                        {m.text ||
                          (m.messageType === 'image'
                            ? lang === 'bn'
                              ? 'ছবি'
                              : 'Photo'
                            : lang === 'bn'
                              ? 'ভিডিও'
                              : 'Video')}
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                        {formatRelativeTime(m.createdAt, lang)}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};
