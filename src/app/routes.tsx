import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { InboxView } from './components/views/InboxView';
import { TasksView } from './components/views/TasksView';
import { PropertiesView } from './components/views/PropertiesView';
import { SettingsView } from './components/views/SettingsView';
import { OnboardingView } from './components/views/OnboardingView';
import { HostPortalLayout } from './components/layout/HostPortalLayout';
import { HostPortalView } from './components/views/HostPortalView';
import { FormBuilderView } from './components/views/FormBuilderView';
import { AnalyticsView } from './components/views/AnalyticsView';
import { TestGuideView } from './components/views/TestGuideView';
import { RouteErrorFallback } from './components/shared/RouteErrorFallback';

function RedirectToInbox() {
  return <Navigate to="/inbox" replace />;
}

/** Passthrough layout — just renders child routes. Used to attach ErrorBoundary. */
function ErrorBoundaryLayout() {
  return <Outlet />;
}

/**
 * Pathless wrapper route that catches errors in child views.
 * Because it renders inside AppLayout (and thus inside AppProvider),
 * the ErrorBoundary has full access to context — preventing the
 * "useAppContext must be used within AppProvider" cascade error.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppLayout,
    children: [
      {
        // Pathless error-boundary wrapper — renders children normally,
        // switches to RouteErrorFallback when any child throws.
        // Because this sits inside AppLayout (inside AppProvider),
        // the ErrorBoundary has full access to context — preventing the
        // "useAppContext must be used within AppProvider" cascade error.
        ErrorBoundary: RouteErrorFallback,
        Component: ErrorBoundaryLayout,
        children: [
          { index: true, Component: RedirectToInbox },
          { path: 'inbox', Component: InboxView },
          { path: 'inbox/:ticketId', Component: InboxView },
          { path: 'tasks', Component: TasksView },
          { path: 'kb', Component: PropertiesView },
          { path: 'kb/:propertyId', Component: OnboardingView },
          { path: 'analytics', Component: AnalyticsView },
          { path: 'settings', Component: SettingsView },
          { path: 'settings/form-builder', Component: FormBuilderView },
          { path: 'settings/:tab', Component: SettingsView },
          { path: 'guide', Component: TestGuideView },
          { path: '*', Component: RedirectToInbox },
        ],
      },
    ],
  },
  {
    path: '/host/:propertyId/:token',
    Component: HostPortalLayout,
    children: [
      {
        Component: ErrorBoundaryLayout,
        ErrorBoundary: RouteErrorFallback,
        children: [
          { index: true, Component: HostPortalView },
        ],
      },
    ],
  },
]);