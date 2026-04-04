"use client";

import { useId, useState } from "react";

interface StarIconProps {
  /** 0 = empty, 1 = full, 0-1 = partial fill */
  fill: number;
  size: number;
  clipId: string;
  className?: string;
}

function StarIcon({ fill, size, clipId, className = "" }: StarIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      {fill > 0 && fill < 1 && (
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={24 * fill} height="24" />
          </clipPath>
        </defs>
      )}
      {/* Empty star outline */}
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-muted"
      />
      {/* Filled star (full or partial) */}
      {fill > 0 && (
        <path
          d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-accent"
          clipPath={fill < 1 ? `url(#${clipId})` : undefined}
        />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Display-only star rating (supports fractional values)
// ---------------------------------------------------------------------------

interface StarDisplayProps {
  rating: number;
  size?: number;
}

export function StarDisplay({ rating, size = 16 }: StarDisplayProps) {
  const baseId = useId();
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.min(1, Math.max(0, rating - (star - 1)));
        return <StarIcon key={star} fill={fill} size={size} clipId={`${baseId}-${star}`} />;
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Interactive star rating input
// ---------------------------------------------------------------------------

interface StarInputProps {
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
  size?: number;
}

export function StarInput({ value, onChange, disabled = false, size = 24 }: StarInputProps) {
  const baseId = useId();
  const [hovered, setHovered] = useState(0);
  const display = hovered || value;

  return (
    <span
      className="inline-flex items-center gap-0.5"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => !disabled && onChange(star)}
          onMouseEnter={() => !disabled && setHovered(star)}
          disabled={disabled}
          className="cursor-pointer p-0.5 transition-transform hover:scale-110 disabled:cursor-default disabled:opacity-50"
          aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
        >
          <StarIcon fill={star <= display ? 1 : 0} size={size} clipId={`${baseId}-${star}`} />
        </button>
      ))}
    </span>
  );
}
