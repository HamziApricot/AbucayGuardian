import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

/**
 * Navigates to a specific screen when a notification action button is tapped.
 */
export function navigateToNotificationTarget(target: 'Tracker' | 'SOS' | 'Hotlines') {
  if (!navigationRef.isReady()) {
    console.warn('[NavigationService] Navigation container is not ready yet');
    return;
  }

  try {
    if (target === 'Tracker') {
      navigationRef.navigate('Tracker');
    } else if (target === 'Hotlines') {
      navigationRef.navigate('Hotlines');
    } else if (target === 'SOS') {
      try {
        navigationRef.navigate('Home', { screen: 'SOS' });
      } catch {
        navigationRef.navigate('SOS');
      }
    }
  } catch (err) {
    console.warn('[NavigationService] Navigation error:', err);
  }
}

