import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  title?: string;
  className?: string;
  compact?: boolean;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  label,
  copiedLabel,
  title = 'نسخ',
  className = '',
  compact = false,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        // Ignore
      }
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? copiedLabel || 'تم النسخ' : title}
        aria-label={title}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium border rounded transition-colors shrink-0 ${
          copied
            ? 'bg-teal-50 border-teal-300 text-teal-800'
            : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300'
        } ${className}`}
      >
        {copied ? (
          <Check className="w-3 h-3 text-teal-700" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
        <span>{copied ? copiedLabel || 'تم' : 'نسخ'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
        copied
          ? 'bg-teal-50 border-teal-300 text-teal-800'
          : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
      } ${className}`}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-teal-700" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      <span>{copied ? copiedLabel || 'تم النسخ' : label || 'نسخ'}</span>
    </button>
  );
};
