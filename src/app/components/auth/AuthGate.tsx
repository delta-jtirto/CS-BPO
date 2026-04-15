import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase-client';
import { Loader2, LogIn, KeyRound } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

interface AuthGateProps {
  children: React.ReactNode;
  onSession: (session: Session) => void;
}

/**
 * Supabase Auth gate — replaces the old access code gate.
 * Shows sign-in form if no session, or password-set form if arriving from invite link.
 * Admin invites users via Supabase dashboard (no self sign-up).
 */
export default function AuthGate({ children, onSession }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'sign-in' | 'set-password'>('sign-in');

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Check for invite/recovery tokens in URL (from magic link)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    if (type === 'invite' || type === 'recovery') {
      setView('set-password');
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) onSession(s);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) onSession(s);
    });

    return () => subscription.unsubscribe();
  }, [onSession]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session) return <>{children}</>;

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setSubmitting(false);
    if (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Invalid email or password.'
        : err.message);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      setSubmitting(false);
      return;
    }

    const { error: err } = await supabase.auth.updateUser({ password });

    setSubmitting(false);
    if (err) {
      setError(err.message);
    }
    // onAuthStateChange will pick up the new session
  }

  // Set Password view (after invite magic link click)
  if (view === 'set-password') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm p-8 rounded-xl border border-border shadow-lg space-y-6">
          <div className="space-y-1 text-center">
            <div className="flex justify-center mb-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center">
                <KeyRound size={20} className="text-white" />
              </div>
            </div>
            <h1 className="text-xl font-semibold">Set Your Password</h1>
            <p className="text-sm text-muted-foreground">
              Create a password to sign in on any device
            </p>
          </div>
          <form onSubmit={handleSetPassword} className="space-y-3">
            <input
              autoFocus
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="Choose a password (8+ characters)"
              className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 transition-all placeholder:text-slate-400"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              Set Password & Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Sign In view (default)
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm p-8 rounded-xl border border-border shadow-lg space-y-6">
        <div className="space-y-1 text-center">
          <div className="flex justify-center mb-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">
              Δ
            </div>
          </div>
          <h1 className="text-xl font-semibold">Delta AI Ops</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>
        <form onSubmit={handleSignIn} className="space-y-3">
          <input
            autoFocus
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(''); }}
            placeholder="Email"
            className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 transition-all placeholder:text-slate-400"
          />
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            placeholder="Password"
            className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 transition-all placeholder:text-slate-400"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
            Sign In
          </button>
        </form>
        <p className="text-xs text-center text-muted-foreground">
          Contact your administrator for an account invitation.
        </p>
      </div>
    </div>
  );
}
