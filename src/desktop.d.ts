export {};

declare global {
  interface Window {
    xitomatlDesktop?: {
      setReminderFullscreen(enabled: boolean): Promise<boolean>;
    };
  }
}
