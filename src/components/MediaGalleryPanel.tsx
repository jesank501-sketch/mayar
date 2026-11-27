import React, { useState } from 'react';
import { Download, Film, Image as ImageIcon, Trash2, X } from 'lucide-react';
import { ChatMessage, Language } from '../types';
import { formatRelativeTime } from '../utils/formatters';
import {
  extractYouTubeEmbedUrl,
  getMediaDownloadInfo,
  isSafeMediaUrl,
} from '../utils/media';

interface MediaGalleryPanelProps {
  messages: ChatMessage[];
  lang: Language;
  onClose?: () => void;
  onDeleteMessage?: (message: ChatMessage) => Promise<void> | void;
}

export const MediaGalleryPanel: React.FC<MediaGalleryPanelProps> = ({
  messages,
  lang,
  onClose,
  onDeleteMessage,
}) => {
  const [confirmMsgId, setConfirmMsgId] = useState<string | null>(null);
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);

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
                      <div className="flex items-center gap-2 shrink-0">
                        {!ytEmbed && (() => {
                          const dl = getMediaDownloadInfo(
                            m.mediaUrl,
                            m.messageType === 'image' ? 'image' : 'video',
                          );
                          return (
                            <a
                              href={dl.href}
                              download={dl.filename}
                              target={dl.isExternal ? '_blank' : undefined}
                              rel={dl.isExternal ? 'noopener noreferrer' : undefined}
                              aria-label={lang === 'bn' ? 'ডাউনলোড করুন' : 'Download'}
                              title={lang === 'bn' ? 'ডাউনলোড করুন' : 'Download'}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer"
                            >
                              <Download className="w-3 h-3 shrink-0" />
                              <span>{lang === 'bn' ? 'ডাউনলোড' : 'Save'}</span>
                            </a>
                          );
                        })()}
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          {formatRelativeTime(m.createdAt, lang)}
                        </span>
                        {onDeleteMessage && (
                          confirmMsgId === m.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={deletingMsgId === m.id}
                                onClick={async () => {
                                  setDeletingMsgId(m.id);
                                  try {
                                    await onDeleteMessage(m);
                                    setConfirmMsgId(null);
                                  } finally {
                                    setDeletingMsgId(null);
                                  }
                                }}
                                className="px-2 py-0.5 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer disabled:opacity-50"
                              >
                                {lang === 'bn' ? 'মুছুন' : 'Delete'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmMsgId(null)}
                                className="px-1.5 py-0.5 text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer"
                              >
                                {lang === 'bn' ? 'না' : 'No'}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmMsgId(m.id)}
                              aria-label={lang === 'bn' ? 'মিডিয়া মুছুন' : 'Delete media'}
                              className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                      </div>
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

