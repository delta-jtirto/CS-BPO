import { useState, useEffect, useCallback } from 'react';

const ZOOM_KEY = 'app-zoom-level';
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.5;
const STEP = 0.1;

export function useZoom() {
  const [zoomLevel, setZoomLevel] = useState(() => {
    const stored = localStorage.getItem(ZOOM_KEY);
    return stored ? parseFloat(stored) : 1;
  });

  const zoom = useCallback((delta: number) => {
    setZoomLevel(prev => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, parseFloat((prev + delta).toFixed(2)))));
  }, []);

  const reset = useCallback(() => setZoomLevel(1), []);

  // Update DOM when zoom changes
  useEffect(() => {
    document.documentElement.style.setProperty('--zoom-level', zoomLevel.toString());
    const effectiveViewportWidth = window.innerWidth / zoomLevel;
    document.documentElement.classList.toggle('zoom-mobile', effectiveViewportWidth < 768);
    localStorage.setItem(ZOOM_KEY, zoomLevel.toString());
  }, [zoomLevel]);

  // Keyboard shortcuts (only set once)
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (!modifier) return;

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoom(STEP);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoom(-STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [zoom, reset]);

  // Responsive state on resize
  useEffect(() => {
    const handleResize = () => {
      const effectiveViewportWidth = window.innerWidth / zoomLevel;
      document.documentElement.classList.toggle('zoom-mobile', effectiveViewportWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [zoomLevel]);

  return { zoomLevel, zoom, reset };
}
