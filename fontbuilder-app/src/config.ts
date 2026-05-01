export const appConfig = {
  sessionAccentColor: "#ff3b3f", // FFEC6B yellow, 2F55FF blue, ff3b3f orange
  silentMode: false,
} as const;

export function applyAppConfig(): void {
  document.documentElement.style.setProperty("--session-accent", appConfig.sessionAccentColor);
}
