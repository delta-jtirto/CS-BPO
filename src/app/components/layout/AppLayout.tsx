import { useState, useEffect, useCallback } from 'react';
import type React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import { MessageSquare, Building2, Settings, Keyboard, Zap, PauseCircle } from 'lucide-react';
import { Toaster } from 'sonner';
import { TopBar } from './TopBar';
import { NavItem } from './NavItem';
import { KeyboardShortcuts } from '../shared/KeyboardShortcuts';
import { AppProvider, useAppContext } from '../../context/AppContext';
import { useGlobalAutoReply } from '../inbox/useAutoReply';
import { useIsMobile } from '../ui/use-mobile';
import { AIDebugPanel } from '../shared/AIDebugPanel';

// Inner component that mounts global hooks inside AppProvider context
function AppInner({
  navigate,
  location,
  showShortcuts,
  setShowShortcuts,
  isMobile,
  isActive
}: {
  navigate: (path: string) => void;
  location: { pathname: string };
  showShortcuts: boolean;
  setShowShortcuts: (v: boolean) => void;
  isMobile: boolean;
  isActive: (prefix: string) => boolean;
}) {
  useGlobalAutoReply();
  const appContext = useAppContext();

  // Build nav items
  const navItems = [
    { icon: MessageSquare, path: '/inbox', label: 'Inbox', tooltip: 'Omnichannel Inbox', shortcut: 'I', badge: undefined as number | undefined },
    { icon: Building2, path: '/kb', label: 'Props', tooltip: 'Property Info Forms', shortcut: 'K', badge: undefined as number | undefined },
  ];

  return (
    <div className="flex flex-col bg-slate-50 text-slate-800 font-sans overflow-hidden selection:bg-indigo-100 selection:text-indigo-900" style={{ height: 'calc(100dvh / var(--zoom-level, 1))' }}>
      <TopBar onShowShortcuts={() => setShowShortcuts(true)} />

      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Navigation Sidebar */}
        {!isMobile && (
          <div className="w-[72px] bg-white border-r border-slate-200 flex flex-col items-center py-3 shrink-0 shadow-sm z-20">
            <nav className="flex flex-col gap-1 w-full px-2">
              {navItems.map(item => (
                <NavItem key={item.path} icon={item.icon} active={isActive(item.path)} onClick={() => navigate(item.path)} tooltip={item.tooltip} label={item.label} shortcut={item.shortcut} badge={item.badge} />
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-1 w-full px-2">
              {/* Global AI Toggle */}
              {(() => {
                const { hostSettings, updateHostSettings } = appContext;
                const anyHostConnected = hostSettings.length > 0;
                const allAiOn = anyHostConnected && hostSettings.every(s => s.autoReply);
                return anyHostConnected ? (
                  <button
                    onClick={() => {
                      const newVal = !allAiOn;
                      hostSettings.forEach(s => updateHostSettings(s.hostId, { autoReply: newVal }));
                    }}
                    title={allAiOn ? 'Disable AI for all hosts' : 'Enable AI for all hosts'}
                    className={`py-2 px-1 rounded-xl transition-all flex flex-col items-center justify-center w-full gap-0.5 ${
                      allAiOn
                        ? 'text-violet-600 bg-violet-50 hover:bg-violet-100'
                        : 'text-slate-300 hover:bg-slate-50 hover:text-slate-500'
                    }`}
                  >
                    {allAiOn ? <Zap size={16} /> : <PauseCircle size={16} />}
                    <span className="text-[8px] font-bold tracking-wide leading-none">{allAiOn ? 'AI On' : 'AI Off'}</span>
                  </button>
                ) : null;
              })()}
              <NavItem icon={Settings} active={isActive('/settings')} onClick={() => navigate('/settings')} tooltip="Platform Settings" label="Settings" shortcut="S" />
              <button
                onClick={() => setShowShortcuts(true)}
                title="Keyboard Shortcuts (?)"
                className="py-2 px-1 rounded-xl transition-all flex flex-col items-center justify-center w-full gap-0.5 text-slate-300 hover:bg-slate-50 hover:text-slate-500"
              >
                <Keyboard size={14} />
                <span className="text-[7px] font-bold tracking-wide leading-none">?</span>
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Content Area */}
        <Outlet />
      </div>

      {/* Mobile Bottom Tab Bar */}
      {isMobile && (
        <div className="bg-white border-t border-slate-200 flex items-center justify-around shrink-0 z-30 safe-area-bottom shadow-[0_-1px_3px_rgba(0,0,0,0.05)]">
          {navItems.map(item => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors min-h-[52px] active:scale-95 ${
                  active ? 'text-indigo-600' : 'text-slate-400'
                }`}
              >
                <div className="relative">
                  <item.icon size={20} strokeWidth={active ? 2.5 : 2} />
                  {item.badge != null && item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-white border border-orange-400 text-orange-500 text-[7px] font-bold leading-none px-0.5">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[9px] font-bold">{item.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => navigate('/settings')}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors min-h-[52px] active:scale-95 ${
              isActive('/settings') ? 'text-indigo-600' : 'text-slate-400'
            }`}
          >
            <Settings size={20} strokeWidth={isActive('/settings') ? 2.5 : 2} />
            <span className="text-[9px] font-bold">Settings</span>
          </button>
        </div>
      )}

      <KeyboardShortcuts open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {appContext.devMode && <AIDebugPanel />}
    </div>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const isMobile = useIsMobile();

  const currentPath = location.pathname;
  const isActive = (prefix: string) => currentPath.startsWith(prefix);

  // Global keyboard shortcut handler
  const handleKeydown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

    // ? key always works
    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      if (isInput && e.key === '?') return; // Don't trigger from inputs
      e.preventDefault();
      setShowShortcuts(prev => !prev);
      return;
    }

    // Don't process other shortcuts from inputs
    if (isInput) return;

    // G+key navigation (two-key combo via sequential press)
    if (e.key === 'i' && !e.ctrlKey) { navigate('/inbox'); return; }
    if (e.key === 'k' && !e.ctrlKey) { navigate('/kb'); return; }
    if (e.key === 's' && !e.ctrlKey) { navigate('/settings'); return; }
  }, [navigate]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handleKeydown]);

  // PWA: inject viewport + manifest meta tags
  useEffect(() => {
    // Viewport
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.setAttribute('name', 'viewport');
      document.head.appendChild(viewport);
    }
    viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');

    // Theme color
    let themeColor = document.querySelector('meta[name="theme-color"]');
    if (!themeColor) {
      themeColor = document.createElement('meta');
      themeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(themeColor);
    }
    themeColor.setAttribute('content', '#0f172a');

    // Apple mobile web app capable
    let appleMeta = document.querySelector('meta[name="apple-mobile-web-app-capable"]');
    if (!appleMeta) {
      appleMeta = document.createElement('meta');
      appleMeta.setAttribute('name', 'apple-mobile-web-app-capable');
      appleMeta.setAttribute('content', 'yes');
      document.head.appendChild(appleMeta);
    }

    let appleStatusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (!appleStatusBar) {
      appleStatusBar = document.createElement('meta');
      appleStatusBar.setAttribute('name', 'apple-mobile-web-app-status-bar-style');
      appleStatusBar.setAttribute('content', 'black-translucent');
      document.head.appendChild(appleStatusBar);
    }

    // PWA Web App Manifest (inline via blob URL)
    let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    if (!manifestLink) {
      const manifest = {
        name: 'Delta AI Ops',
        short_name: 'Delta Ops',
        description: 'AI-powered customer success operations for hospitality',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#0f172a',
        orientation: 'any',
        icons: [
          {
            src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%234f46e5" width="100" height="100" rx="20"/><text x="50" y="68" font-size="52" text-anchor="middle" fill="white" font-family="system-ui" font-weight="bold">Δ</text></svg>',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      };
      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
      manifestLink = document.createElement('link');
      manifestLink.setAttribute('rel', 'manifest');
      manifestLink.setAttribute('href', URL.createObjectURL(blob));
      document.head.appendChild(manifestLink);
    }
  }, []);

  return (
    <AppProvider>
      <AppInner
        navigate={navigate}
        location={location}
        showShortcuts={showShortcuts}
        setShowShortcuts={setShowShortcuts}
        isMobile={isMobile}
        isActive={isActive}
      />
      <Toaster position={isMobile ? 'top-center' : 'bottom-right'} richColors closeButton />
    </AppProvider>
  );
}