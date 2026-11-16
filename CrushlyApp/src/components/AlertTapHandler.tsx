/**
 * Where a tapped notification takes you.
 *
 * A tap can arrive at the worst possible moment — while the app is still drawing
 * its first screen after a cold start, when the navigator exists but is not ready
 * to take a route. Dropping the tap there sends the member to the home feed and
 * leaves them wondering what they pressed, so the route is held and retried until
 * navigation can accept it (or a few seconds pass and it is better to do nothing
 * than to jump them somewhere late).
 */
import { useEffect } from 'react';
import { openAlertRoute } from '../navigation/ref';
import { onAlertTapped } from '../lib/systemAlert';
import type { AlertRoute } from '../lib/alertContent';

export function AlertTapHandler() {
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setInterval>>();

    const go = (route: AlertRoute) => {
      if (openAlertRoute(route)) return;
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (openAlertRoute(route) || tries > 24) {
          clearInterval(timer);
          timers.delete(timer);
        }
      }, 250);
      timers.add(timer);
    };

    void onAlertTapped(go).then((off) => {
      if (cancelled) off();
      else stop = off;
    });

    return () => {
      cancelled = true;
      stop?.();
      timers.forEach((t) => clearInterval(t));
    };
  }, []);

  return null;
}
