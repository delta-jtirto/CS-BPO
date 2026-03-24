import { useState, useEffect } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';

const ZOOM_KEY = 'app-zoom-level';
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.5;

const updateZoom = (level: number) => {
  document.documentElement.style.setProperty('--zoom-level', level.toString());
  window.dispatchEvent(new CustomEvent('zoom-change'));
};

export function ZoomControl() {
  const [zoomLevel, setZoomLevel] = useState(() => {
    const stored = localStorage.getItem(ZOOM_KEY);
    return stored ? parseFloat(stored) : 1;
  });

  const handleZoom = (delta: number) => {
    const newLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, parseFloat((zoomLevel + delta).toFixed(2))));
    setZoomLevel(newLevel);
  };

  const handleReset = () => setZoomLevel(1);

  useEffect(() => {
    updateZoom(zoomLevel);
    localStorage.setItem(ZOOM_KEY, zoomLevel.toString());
  }, [zoomLevel]);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (!modifier) return;

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoom(0.1);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        handleZoom(-0.1);
      } else if (e.key === '0') {
        e.preventDefault();
        handleReset();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [zoomLevel]);

  const percentage = Math.round(zoomLevel * 100);

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors">
      <button
        onClick={() => handleZoom(-0.1)}
        className="p-1 text-slate-400 hover:text-white transition-colors"
        title="Zoom Out (Ctrl/Cmd −)"
        disabled={zoomLevel <= 0.8}
      >
        <ZoomOut size={14} />
      </button>

      <button
        onClick={handleReset}
        className="text-[11px] font-bold text-slate-300 hover:text-white min-w-[30px] text-center transition-colors"
        title="Reset Zoom (Ctrl/Cmd 0)"
      >
        {percentage}%
      </button>

      <button
        onClick={() => handleZoom(0.1)}
        className="p-1 text-slate-400 hover:text-white transition-colors"
        title="Zoom In (Ctrl/Cmd +)"
        disabled={zoomLevel >= 1.5}
      >
        <ZoomIn size={14} />
      </button>
    </div>
  );
}
