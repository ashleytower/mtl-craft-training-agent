import { cn } from "@/lib/utils";
import { Sparkles, TrendingUp, Zap, Mic, BookOpen, Menu } from "lucide-react";
import { Link } from "wouter";

interface BottomNavProps {
  onSignatures: () => void;
  onUpselling: () => void;
  onQuickTips: () => void;
  onVoiceMode: () => void;
  voiceModeActive: boolean;
  disabled?: boolean;
  translations: {
    signatures: string;
    upselling: string;
    quickTips: string;
    voiceMode: string;
  };
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  primary?: boolean;
}

function NavItem({ icon, label, onClick, active, disabled, primary }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-lg transition-all duration-200",
        "min-w-[60px] touch-manipulation",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        active
          ? primary
            ? "bg-neutral-900 text-white scale-105"
            : "bg-neutral-100 text-neutral-900"
          : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 active:scale-95"
      )}
    >
      <div className={cn(
        "transition-transform duration-200",
        active && "scale-110"
      )}>
        {icon}
      </div>
      <span className={cn(
        "text-[10px] font-medium leading-none transition-all",
        active && "font-semibold"
      )}>
        {label}
      </span>
    </button>
  );
}

export function BottomNav({
  onSignatures,
  onUpselling,
  onQuickTips,
  onVoiceMode,
  voiceModeActive,
  disabled,
  translations,
}: BottomNavProps) {
  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-neutral-200 safe-area-inset-bottom"
      style={{
        boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div className="container mx-auto max-w-3xl px-4 py-2">
        <div className="flex items-center justify-around gap-1">
          <NavItem
            icon={<Sparkles className="w-5 h-5" />}
            label={translations.signatures}
            onClick={onSignatures}
            disabled={disabled}
          />
          <NavItem
            icon={<TrendingUp className="w-5 h-5" />}
            label={translations.upselling}
            onClick={onUpselling}
            disabled={disabled}
          />
          <NavItem
            icon={<Zap className="w-5 h-5" />}
            label={translations.quickTips}
            onClick={onQuickTips}
            disabled={disabled}
          />
          <Link href="/sops">
            <NavItem
              icon={<BookOpen className="w-5 h-5" />}
              label="SOPs"
              onClick={() => {}}
              disabled={disabled}
            />
          </Link>
          <Link href="/menus">
            <NavItem
              icon={<Menu className="w-5 h-5" />}
              label="Menus"
              onClick={() => {}}
              disabled={disabled}
            />
          </Link>
          <NavItem
            icon={<Mic className="w-6 h-6" />}
            label={translations.voiceMode}
            onClick={onVoiceMode}
            active={voiceModeActive}
            primary
          />
        </div>
      </div>
    </nav>
  );
}
