import React, { useEffect, useRef, useState } from 'react';
import { Reply } from 'lucide-react';

interface SwipeableMessageRowProps {
  messageId: string;
  isOwn: boolean;
  onSwipeReply: () => void;
  isHighlighted?: boolean;
  children: React.ReactNode;
}

const SWIPE_THRESHOLD = 42;
const MAX_SWIPE_DISTANCE = 66;

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('button, a, input, textarea, select, video, audio, [data-no-swipe="true"]'),
  );
}

export const SwipeableMessageRow: React.FC<SwipeableMessageRowProps> = ({
  messageId,
  isOwn,
  onSwipeReply,
  isHighlighted = false,
  children,
}) => {
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const onSwipeReplyRef = useRef(onSwipeReply);
  useEffect(() => {
    onSwipeReplyRef.current = onSwipeReply;
  }, [onSwipeReply]);

  const gestureRef = useRef<{
    active: boolean;
    locked: 'horizontal' | 'vertical' | null;
    startX: number;
    startY: number;
    currentOffset: number;
    hapticFired: boolean;
  }>({
    active: false,
    locked: null,
    startX: 0,
    startY: 0,
    currentOffset: 0,
    hapticFired: false,
  });

  const updateOffset = (dx: number) => {
    const clamped = isOwn
      ? Math.min(0, Math.max(-MAX_SWIPE_DISTANCE, dx * 0.75))
      : Math.max(0, Math.min(MAX_SWIPE_DISTANCE, dx * 0.75));
    gestureRef.current.currentOffset = clamped;
    setOffsetX(clamped);

    if (Math.abs(clamped) >= SWIPE_THRESHOLD && !gestureRef.current.hapticFired) {
      gestureRef.current.hapticFired = true;
      try {
        navigator.vibrate?.(12);
      } catch {
        // Ignore unsupported vibrate
      }
    }
  };

  const finishGesture = () => {
    if (!gestureRef.current.active) return;
    const reached = Math.abs(gestureRef.current.currentOffset) >= SWIPE_THRESHOLD;
    gestureRef.current.active = false;
    gestureRef.current.locked = null;
    gestureRef.current.currentOffset = 0;
    gestureRef.current.hapticFired = false;
    setIsDragging(false);
    setOffsetX(0);
    if (reached) {
      onSwipeReplyRef.current();
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1 || isInteractiveTarget(e.target)) return;
    const touch = e.touches[0];
    gestureRef.current = {
      active: true,
      locked: null,
      startX: touch.clientX,
      startY: touch.clientY,
      currentOffset: 0,
      hapticFired: false,
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.active || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - g.startX;
    const dy = touch.clientY - g.startY;

    if (!g.locked) {
      if (Math.hypot(dx, dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.1) {
        g.locked = 'vertical';
        g.active = false;
        return;
      }
      // Only start dragging in the natural inward direction (right for incoming, left for own)
      const isValidDir = isOwn ? dx < -4 : dx > 4;
      if (!isValidDir) {
        g.locked = 'vertical';
        g.active = false;
        return;
      }
      g.locked = 'horizontal';
      setIsDragging(true);
    }

    if (g.locked === 'horizontal') {
      updateOffset(dx);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isInteractiveTarget(e.target)) return;
    const startX = e.clientX;
    const startY = e.clientY;
    gestureRef.current = {
      active: true,
      locked: null,
      startX,
      startY,
      currentOffset: 0,
      hapticFired: false,
    };

    const handleMouseMove = (moveEv: MouseEvent) => {
      const g = gestureRef.current;
      if (!g.active) return;
      const dx = moveEv.clientX - g.startX;
      const dy = moveEv.clientY - g.startY;

      if (!g.locked) {
        if (Math.hypot(dx, dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx) * 1.1) {
          g.active = false;
          cleanup();
          return;
        }
        const isValidDir = isOwn ? dx < -4 : dx > 4;
        if (!isValidDir) {
          g.active = false;
          cleanup();
          return;
        }
        g.locked = 'horizontal';
        setIsDragging(true);
      }

      if (g.locked === 'horizontal') {
        updateOffset(dx);
      }
    };

    const handleMouseUp = () => {
      cleanup();
      finishGesture();
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const progress = Math.min(1, Math.abs(offsetX) / SWIPE_THRESHOLD);
  const thresholdReady = Math.abs(offsetX) >= SWIPE_THRESHOLD;

  return (
    <div
      id={`msg-${messageId}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={finishGesture}
      onTouchCancel={finishGesture}
      onMouseDown={handleMouseDown}
      className={`relative select-text touch-pan-y rounded-2xl transition-colors duration-500 ${
        isHighlighted ? 'bg-blue-100/75 ring-2 ring-blue-400/70' : ''
      }`}
    >
      {/* Messenger Swipe-to-Reply Icon Indicator */}
      {Math.abs(offsetX) > 4 && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 z-0 flex items-center justify-center w-8 h-8 rounded-full shadow-xs transition-transform ${
            isOwn ? 'right-1' : 'left-1'
          } ${
            thresholdReady
              ? 'bg-blue-600 text-white scale-110'
              : 'bg-slate-200 text-slate-600 scale-95'
          }`}
          style={{ opacity: progress }}
        >
          <Reply className="w-4 h-4" />
        </div>
      )}

      <div
        className={isDragging ? '' : 'transition-transform duration-200 ease-out'}
        style={{ transform: offsetX !== 0 ? `translateX(${offsetX}px)` : undefined }}
      >
        {children}
      </div>
    </div>
  );
};
