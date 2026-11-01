/*
 * Desktop notifications + sound when a printer gets a NEW critical fault.
 * The same active fault is not repeated every poll; if it is resolved and
 * comes back later, it is notified again. Off by default, stored per browser.
 * Press "T" (outside text fields) to test the sound.
 */
import { t } from "./i18n.js";
import { translatePrinterMessage } from "./printer-messages.js";
import { getLanguage } from "./i18n.js";

const ENABLED_KEY = "rm_notifications";
const KNOWN_KEY = "rm_known_critical";
const supported = "Notification" in window;

let enabled = false;
let known = null; // Set of "printerId|message" seen last poll; null = no baseline yet
let audioContext = null;
let button = null;

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
};

function getAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  audioContext ||= new AudioCtx();
  return audioContext;
}

export function playSound() {
  const ctx = getAudio();
  if (!ctx) return;
  const play = () => {
    const start = ctx.currentTime;
    [660, 880, 440].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const toneStart = start + index * 0.16;
      const toneEnd = toneStart + 0.13;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, toneStart);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(0.25, toneStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneEnd);
    });
  };
  if (ctx.state === "suspended") ctx.resume().then(play).catch(() => {});
  else play();
}

export function updateButton() {
  if (!button) return;
  const label = button.querySelector("[data-label]");
  const icon = button.querySelector("[data-icon]");
  if (!supported) {
    button.disabled = true;
    button.title = t("notify.unsupported");
    label.textContent = t("notify.unsupported");
    return;
  }
  const denied = Notification.permission === "denied";
  const on = enabled && Notification.permission === "granted";
  button.classList.toggle("is-active", on);
  button.setAttribute("aria-pressed", String(on));
  button.title = denied ? t("notify.blocked") : on ? t("notify.disable") : t("notify.enable");
  icon.dataset.state = on ? "on" : denied ? "blocked" : "off";
  label.textContent = on ? t("notify.on") : t("notify.off");
}

async function toggle() {
  if (!supported) return;
  if (enabled) {
    enabled = false;
    store.set(ENABLED_KEY, "false");
    updateButton();
    return;
  }
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  enabled = permission === "granted";
  store.set(ENABLED_KEY, String(enabled));
  if (!enabled) alert(t("notify.denied"));
  else getAudio()?.resume?.().catch(() => {});
  updateButton();
}

export function initNotifications(toggleButton) {
  button = toggleButton;
  enabled = supported && store.get(ENABLED_KEY) === "true" && Notification.permission === "granted";

  try {
    const stored = store.get(KNOWN_KEY);
    if (stored !== null) known = new Set(JSON.parse(stored));
  } catch { known = null; }

  button?.addEventListener("click", toggle);
  updateButton();

  // Browsers only allow audio after a user gesture.
  const unlock = () => {
    if (enabled) getAudio()?.resume?.().catch(() => {});
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
  };
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);

  document.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    if (event.key.toLowerCase() === "t") playSound();
  });
}

/** Call after every poll with the built printer models. */
export function processCritical(printers) {
  const current = new Set();
  const fresh = new Map();

  for (const printer of printers) {
    const critical = printer.messages.filter((m) => m.level === "critical").map((m) => m.message);
    if (printer.offline) critical.push("offline");
    for (const message of critical) {
      const key = `${printer.id}|${message.toLowerCase()}`;
      current.add(key);
      if (known && !known.has(key)) {
        if (!fresh.has(printer.id)) fresh.set(printer.id, { printer, messages: [] });
        fresh.get(printer.id).messages.push(message === "offline" ? t("status.offline") : message);
      }
    }
  }

  if (known && enabled && supported && Notification.permission === "granted") {
    const language = getLanguage();
    fresh.forEach(({ printer, messages }) => {
      const notification = new Notification(t("notify.title", { name: printer.name }), {
        body: `${printer.model ? `${printer.model}: ` : ""}${messages.map((m) => translatePrinterMessage(m, language)).join(", ")}`,
        icon: "android-chrome-192x192.png",
        tag: `printer-critical-${printer.id}`,
        renotify: true,
        requireInteraction: true,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    });
    if (fresh.size) playSound();
  }

  known = current;
  store.set(KNOWN_KEY, JSON.stringify([...current]));
}
