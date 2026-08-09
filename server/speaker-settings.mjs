export const DEFAULT_MAX_SPEAKERS = 6;
export const SUPPORTED_MAX_SPEAKERS = [6, 12, 20];

export function normalizeMaxSpeakers(value) {
  const parsed = Number(value);
  return SUPPORTED_MAX_SPEAKERS.includes(parsed) ? parsed : DEFAULT_MAX_SPEAKERS;
}
