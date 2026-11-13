import { useEffect } from 'react';
import {
  CAPTCHA_TIMEOUT_MS,
  TURNSTILE_SCRIPT,
  captchaEnabled,
  captchaFailureMessage,
  captchaSiteKey,
  setCaptchaSolver,
} from '../lib/captcha';

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

function turnstile(): TurnstileApi | undefined {
  return (globalThis as unknown as { turnstile?: TurnstileApi }).turnstile;
}

/**
 * Loads Cloudflare's script once, whoever asks first.
 *
 * A rejected load has to be remembered: otherwise every retry appends another
 * <script> tag and the screen quietly waits forever.
 */
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  const ready = turnstile();
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;

  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    const onLoad = () => {
      const api = turnstile();
      if (api) resolve(api);
      else reject(new Error('The security check did not load. Try again.'));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', () => reject(new Error('The security check did not load. Try again.')), { once: true });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    loading = null;
    throw error;
  });

  return loading;
}

/**
 * The bot check, in a browser.
 *
 * Invisible: the widget is rendered into a hidden div and executed on demand, so
 * no checkbox appears in the layout. A person who trips the risk check still gets
 * Cloudflare's challenge inside that div — it is positioned, not `display:none`,
 * because a hidden element cannot be interacted with.
 */
export function CaptchaHost() {
  useEffect(() => {
    if (!captchaEnabled()) return undefined;

    const host = document.createElement('div');
    host.setAttribute('data-holupp-captcha', '');
    host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;';
    document.body.appendChild(host);

    let widgetId: string | null = null;
    let disposed = false;

    setCaptchaSolver(async () => {
      const api = await loadTurnstile();
      if (disposed) throw new Error('The security check is not available yet. Reopen the app and try again.');

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (widgetId) api.reset(widgetId);
          reject(new Error('The security check took too long. Try again.'));
        }, CAPTCHA_TIMEOUT_MS);

        const settle = (fn: () => void) => {
          clearTimeout(timer);
          // Tokens are single-use, so the widget is thrown away rather than reset:
          // a reset widget keeps its callback and can resolve a request that has
          // already been answered.
          if (widgetId) {
            try {
              api.remove(widgetId);
            } catch {
              /* already gone */
            }
            widgetId = null;
          }
          fn();
        };

        try {
          widgetId = api.render(host, {
            sitekey: captchaSiteKey(),
            size: 'invisible',
            retry: 'never',
            callback: (token: string) => settle(() => resolve(token)),
            'error-callback': (code: string) => settle(() => reject(new Error(captchaFailureMessage(String(code ?? ''))))),
            'timeout-callback': () => settle(() => reject(new Error('The security check took too long. Try again.'))),
          });
          api.execute(widgetId);
        } catch (error) {
          settle(() => reject(error instanceof Error ? error : new Error(String(error))));
        }
      });
    });

    return () => {
      disposed = true;
      setCaptchaSolver(null);
      if (widgetId) {
        try {
          turnstile()?.remove(widgetId);
        } catch {
          /* the script was never loaded */
        }
        widgetId = null;
      }
      host.remove();
    };
  }, []);

  return null;
}
