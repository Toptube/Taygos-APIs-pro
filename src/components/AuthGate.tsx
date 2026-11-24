import React, { useState } from 'react';
import { Lock, ShieldCheck, Globe } from 'lucide-react';
import type { AuthStatusResponse, Language } from '../types/taygos';
import { useT } from '../i18n/translations';

interface AuthGateProps {
  lang: Language;
  onToggleLang: () => void;
  authStatus: AuthStatusResponse;
  onAuthenticated: (token: string) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  lang,
  onToggleLang,
  authStatus,
  onAuthenticated,
}) => {
  const t = useT(lang);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSetup = authStatus.requiresSetup;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.trim().length < 6) {
      setError(t.passcodeTooShort);
      return;
    }
    if (isSetup && password.trim() !== confirm.trim()) {
      setError(t.passcodeMismatch);
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = isSetup ? '/api/admin/auth/claim' : '/api/admin/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error || 'Authentication failed.');
        return;
      }
      onAuthenticated(data.token);
    } catch {
      setError('Network error while connecting to Taygos server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between px-4 py-8">
      <div className="max-w-md w-full mx-auto flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <img
            src="/assets/aistudio/1793697498664_09da0ce6.png"
            alt="Taygos APIs"
            className="w-8 h-8 object-contain"
          />
          <span className="text-lg font-bold tracking-tight text-slate-900">
            {t.brand}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleLang}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:text-slate-900 hover:border-slate-300 transition-colors whitespace-nowrap shrink-0"
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
        </button>
      </div>

      <div className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
            {isSetup ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <h1 className="text-xl font-semibold text-slate-900 leading-snug">
            {isSetup ? t.authSetupTitle : t.authLoginTitle}
          </h1>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          {isSetup ? t.authSetupDesc : t.authLoginDesc}
        </p>

        {authStatus.envPasscodeActive && (
          <div className="mb-5 px-3.5 py-2.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg">
            {t.authEnvNotice}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              {t.passcodeLabel}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              dir="ltr"
              required
              minLength={6}
              autoFocus
              className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              placeholder="••••••••"
            />
          </div>

          {isSetup && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                {t.passcodeConfirmLabel}
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                dir="ltr"
                required
                minLength={6}
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {submitting ? '...' : isSetup ? t.claimPasscodeBtn : t.loginBtn}
          </button>
        </form>
      </div>

      <div className="max-w-md w-full mx-auto text-center text-xs text-slate-500">
        Taygos APIs · Unified Gateway &amp; Key Control
      </div>
    </div>
  );
};
