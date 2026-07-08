import { cn } from "@/lib/utils";

interface LogoIconProps {
  className?: string;
  size?: number;
}

/**
 * AI Comic Builder logo — a comic speech bubble with a sparkle/AI star,
 * representing AI-powered comic creation.
 */
export function LogoIcon({ className, size = 20 }: LogoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Comic panel / film frame */}
      <rect x="3" y="4" width="26" height="20" rx="4" fill="currentColor" />
      {/* Panel divider lines */}
      <line x1="14" y1="4" x2="14" y2="24" stroke="white" strokeWidth="1.5" strokeOpacity="0.3" />
      <line x1="3" y1="14" x2="14" y2="14" stroke="white" strokeWidth="1.5" strokeOpacity="0.3" />
      {/* Speech bubble tail */}
      <path d="M10 24L7 29L14 24" fill="currentColor" />
      {/* AI sparkle star */}
      <path
        d="M22 10L23.2 13.2L26 14L23.2 14.8L22 18L20.8 14.8L18 14L20.8 13.2L22 10Z"
        fill="white"
      />
      {/* Small sparkle */}
      <circle cx="8" cy="9" r="1.2" fill="white" fillOpacity="0.6" />
    </svg>
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[--brand-cyan] via-[--brand-blue] to-[--brand-violet] text-white shadow-[0_0_22px_rgba(47,107,255,0.35)]">
        <LogoIcon size={18} />
      </div>
      <span className="frame-gradient-text font-display text-[15px] font-extrabold tracking-tight">
        AI Comic Builder
      </span>
    </div>
  );
}
