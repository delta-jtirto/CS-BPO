import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const ZOOM_KEY = 'app-zoom-level';

function getEffectiveWidth() {
  const zoom = parseFloat(localStorage.getItem(ZOOM_KEY) ?? '1') || 1;
  return window.innerWidth / zoom;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => getEffectiveWidth() < MOBILE_BREAKPOINT);

  React.useEffect(() => {
    const check = () => setIsMobile(getEffectiveWidth() < MOBILE_BREAKPOINT);

    window.addEventListener('resize', check);
    window.addEventListener('zoom-change', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('zoom-change', check);
    };
  }, []);

  return isMobile;
}
