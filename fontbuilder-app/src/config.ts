export const appConfig = {
  sessionAccentColor: "#ff3b3f",
  silentMode: false,
} as const;

export function applyAppConfig(): void {
  document.documentElement.style.setProperty("--session-accent", appConfig.sessionAccentColor);
}
