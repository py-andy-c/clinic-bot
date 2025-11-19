/**
 * Type definition for LIFF navigation history state.
 * Used to track navigation state in browser history for back button handling.
 */
export interface LiffNavigationState {
  mode: 'home' | 'book' | 'query' | 'settings' | 'notifications';
  liffNavigation: true;
}

