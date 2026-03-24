import { Outlet } from 'react-router';
import { Toaster } from 'sonner';
import { AppProvider } from '../../context/AppContext';

/**
 * Minimal layout wrapper for the host-facing portal.
 * AppProvider must be inside the router tree for context to work with RouterProvider.
 */
export function HostPortalLayout() {
  return (
    <AppProvider>
      <Toaster position="top-center" richColors />
      <Outlet />
    </AppProvider>
  );
}