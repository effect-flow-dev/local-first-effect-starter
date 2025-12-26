// FILE: src/lib/client/stores/pwaStore.ts
import { signal } from "@preact/signals-core";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

/**
 * Valid 'beforeinstallprompt' event interface
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export const installPromptState = signal<BeforeInstallPromptEvent | null>(null);
export const isAppInstalledState = signal<boolean>(false);

export const initPWA = () => {
  // 1. Check if already installed
  if (window.matchMedia("(display-mode: standalone)").matches) {
    isAppInstalledState.value = true;
  }

  // 2. Listen for install prompt
  window.addEventListener("beforeinstallprompt", (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    runClientUnscoped(clientLog("info", "[PWA] Install prompt captured"));
    // Stash the event so it can be triggered later.
    installPromptState.value = e as BeforeInstallPromptEvent;
  });

  // 3. Listen for successful install
  window.addEventListener("appinstalled", () => {
    runClientUnscoped(clientLog("info", "[PWA] App installed successfully"));
    installPromptState.value = null;
    isAppInstalledState.value = true;
  });
};

export const promptInstall = async () => {
  const promptEvent = installPromptState.value;
  if (!promptEvent) return;

  await promptEvent.prompt();
  
  const { outcome } = await promptEvent.userChoice;
  runClientUnscoped(clientLog("info", `[PWA] User install choice: ${outcome}`));
  
  // Reset prompt after usage
  installPromptState.value = null;
};
