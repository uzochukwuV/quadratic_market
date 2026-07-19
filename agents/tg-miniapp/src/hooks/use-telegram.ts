import { useEffect } from "react";

export function useTelegramApp() {
  useEffect(() => {
    // @ts-ignore
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor?.('#0a111a'); // Dark slate match
      tg.setBackgroundColor?.('#0a111a');
    }
  }, []);

  return {
    // @ts-ignore
    tg: typeof window !== 'undefined' ? window.Telegram?.WebApp : null
  };
}
