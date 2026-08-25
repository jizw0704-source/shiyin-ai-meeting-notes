export const DEFAULT_MAX_SPEAKERS = 6;
export const SUPPORTED_MAX_SPEAKERS = [6, 12, 20];
export const DEFAULT_SPEAKER_LIMIT_MODE = "auto";
export const SUPPORTED_SPEAKER_LIMIT_MODES = ["auto", "manual"];

export function normalizeMaxSpeakers(value) {
  const parsed = Number(value);
  return SUPPORTED_MAX_SPEAKERS.includes(parsed) ? parsed : DEFAULT_MAX_SPEAKERS;
}

export function normalizeSpeakerLimitMode(value, fallback = DEFAULT_SPEAKER_LIMIT_MODE) {
  return SUPPORTED_SPEAKER_LIMIT_MODES.includes(value) ? value : fallback;
}
