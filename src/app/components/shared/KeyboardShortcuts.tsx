import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

interface KeyboardShortcutsProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['G', 'I'], description: 'Go to Inbox' },
      { keys: ['G', 'T'], description: 'Go to Tasks' },
      { keys: ['G', 'K'], description: 'Go to Knowledge Base' },
      { keys: ['G', 'A'], description: 'Go to Analytics' },
      { keys: ['G', 'S'], description: 'Go to Settings' },
    ],
  },
  {
    title: 'Inbox',
    shortcuts: [
      { keys: ['Ctrl', 'Enter'], description: 'Send reply' },
      { keys: ['Ctrl', 'Shift', 'A'], description: 'Toggle Smart Reply' },
      { keys: ['Ctrl', 'Shift', 'R'], description: 'Resolve ticket' },
    ],
  },
  {
    title: 'Global',
    shortcuts: [
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close dialogs / Cancel' },
    ],
  },
];

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/40" />
      <div
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden relative animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
              <Keyboard size={16} />
            </div>
            <h3 className="font-bold text-slate-800">Keyboard Shortcuts</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-5">
          {SHORTCUT_GROUPS.map(group => (
            <div key={group.title}>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">{group.title}</h4>
              <div className="space-y-1.5">
                {group.shortcuts.map(shortcut => (
                  <div key={shortcut.description} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-slate-600">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-[10px] text-slate-300 mx-0.5">+</span>}
                          <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-[11px] font-mono font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded shadow-[0_1px_0_rgba(0,0,0,0.08)]">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
          <p className="text-[10px] text-slate-400 text-center">Press <kbd className="px-1 py-0.5 text-[10px] font-mono bg-slate-100 border border-slate-200 rounded">?</kbd> anywhere to toggle this panel</p>
        </div>
      </div>
    </div>
  );
}