import { useState, useRef, useEffect } from 'react';

const MIN_CENTER = 350;
const LEFT_MIN = 240;
const RIGHT_MIN = 260;

export function useInboxPanels(isMobile: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem('inbox-left-width');
    return saved ? Math.max(240, Math.min(480, parseInt(saved))) : 320;
  });
  const [rightWidth, setRightWidth] = useState(() => {
    const saved = localStorage.getItem('inbox-right-width');
    return saved ? Math.max(260, Math.min(480, parseInt(saved))) : 320;
  });
  const [resizing, setResizing] = useState<'left' | 'right' | null>(null);

  const [containerWidth, setContainerWidth] = useState(1400);
  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    const saved = localStorage.getItem('inbox-left-collapsed');
    return saved === 'true';
  });
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    const saved = localStorage.getItem('inbox-right-collapsed');
    return saved === 'true';
  });
  const [rightOverlayOpen, setRightOverlayOpen] = useState(false);
  const [leftOverlayOpen, setLeftOverlayOpen] = useState(false);

  // Dynamic collapse thresholds
  const autoCollapseRightThreshold = LEFT_MIN + RIGHT_MIN + MIN_CENTER; // 850
  const autoCollapseLeftThreshold = LEFT_MIN + MIN_CENTER; // 590

  // Progressive shrink: compute display widths
  let displayLeftWidth = leftWidth;
  let displayRightWidth = rightWidth;

  if (!isMobile && !leftCollapsed && !rightCollapsed) {
    const totalNeeded = leftWidth + rightWidth + MIN_CENTER;
    if (containerWidth < totalNeeded) {
      const deficit = totalNeeded - containerWidth;
      const leftShrinkable = leftWidth - LEFT_MIN;
      const rightShrinkable = rightWidth - RIGHT_MIN;
      const totalShrinkable = leftShrinkable + rightShrinkable;
      if (totalShrinkable > 0) {
        const leftShare = leftShrinkable / totalShrinkable;
        displayLeftWidth = Math.max(LEFT_MIN, Math.round(leftWidth - deficit * leftShare));
        displayRightWidth = Math.max(RIGHT_MIN, Math.round(rightWidth - deficit * (1 - leftShare)));
      }
      const centerRemaining = containerWidth - displayLeftWidth - displayRightWidth;
      if (centerRemaining < MIN_CENTER) {
        const overshoot = MIN_CENTER - centerRemaining;
        displayRightWidth = Math.max(RIGHT_MIN, displayRightWidth - overshoot);
      }
    }
  } else if (!isMobile && rightCollapsed && !leftCollapsed) {
    displayLeftWidth = Math.max(LEFT_MIN, Math.min(leftWidth, containerWidth - MIN_CENTER));
  }

  const shouldAutoCollapseRight = !isMobile && containerWidth > 0 && containerWidth < autoCollapseRightThreshold;
  const shouldAutoCollapseLeft = !isMobile && containerWidth > 0 && containerWidth < autoCollapseLeftThreshold;

  // Track container width with ResizeObserver
  useEffect(() => {
    if (!containerRef.current || isMobile) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 1400;
      setContainerWidth(w);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isMobile]);

  // Auto-collapse/expand panels
  const prevCollapseRightRef = useRef(shouldAutoCollapseRight);
  const prevCollapseLeftRef = useRef(shouldAutoCollapseLeft);

  useEffect(() => {
    if (isMobile) return;
    if (shouldAutoCollapseRight && !prevCollapseRightRef.current) {
      setRightCollapsed(true);
      setRightOverlayOpen(false);
    }
    if (!shouldAutoCollapseRight && prevCollapseRightRef.current) {
      setRightCollapsed(false);
    }
    prevCollapseRightRef.current = shouldAutoCollapseRight;
  }, [shouldAutoCollapseRight, isMobile]);

  useEffect(() => {
    if (isMobile) return;
    if (shouldAutoCollapseLeft && !prevCollapseLeftRef.current) {
      setLeftCollapsed(true);
      setLeftOverlayOpen(false);
    }
    if (!shouldAutoCollapseLeft && prevCollapseLeftRef.current) {
      setLeftCollapsed(false);
    }
    prevCollapseLeftRef.current = shouldAutoCollapseLeft;
  }, [shouldAutoCollapseLeft, isMobile]);

  // Persist collapse prefs
  useEffect(() => {
    if (!isMobile) localStorage.setItem('inbox-left-collapsed', String(leftCollapsed));
  }, [leftCollapsed, isMobile]);
  useEffect(() => {
    if (!isMobile) localStorage.setItem('inbox-right-collapsed', String(rightCollapsed));
  }, [rightCollapsed, isMobile]);

  // Close overlays when expanding
  useEffect(() => {
    if (!rightCollapsed) setRightOverlayOpen(false);
    if (!leftCollapsed) setLeftOverlayOpen(false);
  }, [rightCollapsed, leftCollapsed]);

  // Persist panel widths
  useEffect(() => {
    if (!isMobile) localStorage.setItem('inbox-left-width', String(leftWidth));
  }, [leftWidth, isMobile]);
  useEffect(() => {
    if (!isMobile) localStorage.setItem('inbox-right-width', String(rightWidth));
  }, [rightWidth, isMobile]);

  // Mouse drag resize handler
  useEffect(() => {
    if (!resizing || isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const effectiveRightWidth = rightCollapsed ? 0 : rightWidth;
      const effectiveLeftWidth = leftCollapsed ? 0 : leftWidth;

      if (resizing === 'left' && !leftCollapsed) {
        let newWidth = e.clientX - rect.left;
        newWidth = Math.max(LEFT_MIN, Math.min(480, newWidth));
        if (rect.width - newWidth - effectiveRightWidth < MIN_CENTER) {
          newWidth = rect.width - effectiveRightWidth - MIN_CENTER;
        }
        if (newWidth >= LEFT_MIN) setLeftWidth(newWidth);
      } else if (resizing === 'right' && !rightCollapsed) {
        let newWidth = rect.right - e.clientX;
        newWidth = Math.max(RIGHT_MIN, Math.min(480, newWidth));
        if (rect.width - effectiveLeftWidth - newWidth < MIN_CENTER) {
          newWidth = rect.width - effectiveLeftWidth - MIN_CENTER;
        }
        if (newWidth >= RIGHT_MIN) setRightWidth(newWidth);
      }
    };

    const handleMouseUp = () => setResizing(null);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, isMobile, leftWidth, rightWidth, leftCollapsed, rightCollapsed]);

  return {
    containerRef,
    leftWidth, setLeftWidth,
    rightWidth, setRightWidth,
    resizing, setResizing,
    leftCollapsed, setLeftCollapsed,
    rightCollapsed, setRightCollapsed,
    rightOverlayOpen, setRightOverlayOpen,
    leftOverlayOpen, setLeftOverlayOpen,
    displayLeftWidth, displayRightWidth,
    shouldAutoCollapseLeft, shouldAutoCollapseRight,
    MIN_CENTER, LEFT_MIN, RIGHT_MIN,
  };
}
