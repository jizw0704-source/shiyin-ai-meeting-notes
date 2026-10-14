/** @typedef {"small" | "standard" | "large" | "extra-large"} FontSizeId */

/** @type {ReadonlyArray<{id: FontSizeId, label: string, scale: number}>} */
export const fontSizeOptions = Object.freeze([
  { id: "small", label: "小", scale: 0.9 },
  { id: "standard", label: "标准", scale: 1 },
  { id: "large", label: "大", scale: 1.15 },
  { id: "extra-large", label: "特大", scale: 1.3 },
].map((option) => Object.freeze(option)));

/** @param {unknown} value @returns {FontSizeId} */
export function normalizeFontSize(value) {
  return value === "small" || value === "large" || value === "extra-large" ? value : "standard";
}

/** @param {unknown} value */
export function fontSizeScale(value) {
  return fontSizeOptions.find((option) => option.id === normalizeFontSize(value)).scale;
}
