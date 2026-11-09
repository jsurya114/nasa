// Chart colours for Insights (#227). The app is light only. Two lines use the validated categorical slots 1 and 2 (blue, orange: they pass the
// colour-blind and contrast checks as a pair); one-series charts and the calendar use the NASA brand violet from the theme.
export const SERIES_BLUE = "#2a78d6";
export const SERIES_ORANGE = "#eb6834";
export const BRAND = "var(--color-brand-600)";
export const BRAND_STRONG = "var(--color-brand-800)";
export const GRID = "var(--color-line)";
export const AXIS_TEXT = "oklch(0.5 0.03 290)"; // the same value as the theme's muted ink; SVG text needs a plain colour
// Calendar shades, light to dark: one hue, stepped by lightness. Level 0 is a day that has records but no deliveries.
export const HEAT_COLORS = ["var(--color-brand-50)", "var(--color-brand-200)", "var(--color-brand-400)", "var(--color-brand-600)", "var(--color-brand-800)"];
