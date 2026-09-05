# Brand assets

| File | Use |
|------|-----|
| `mark.svg` | Icon only (square). App headers, social avatars, GitHub org icon. |
| `logo.svg` | Horizontal lockup, **dark text** — use on light backgrounds. |
| `logo-dark.svg` | Horizontal lockup, **light text** — use on dark backgrounds. |
| `../apps/web/public/favicon.svg` | 3-stone favicon, scales down to 16px. |

## The mark

Rujoom (رجوم) is the Arabic word for cairns — stacked trail-marker stones. Four rounded stones, alternating slight tilt,
gradient `#8FB4FA → #3E68C0` top-to-bottom, hairline white stroke at 18% for separation.

## Colours

| Token | Hex | Use |
|-------|-----|-----|
| Stone light | `#8FB4FA` | gradient top |
| Stone deep | `#3E68C0` | gradient bottom |
| Accent | `#6EA8FE` | UI accent (links, buttons) |
| Ink | `#17171B` | wordmark on light |
| Paper | `#F0F0F2` | wordmark on dark |

## Wordmark

"Rujoom" — system sans (`ui-sans-serif, system-ui, …`), weight 650, letter-spacing −0.5.

## TODO before store submission

The browser extension needs raster PNG icons (16/32/48/128 px) rendered from `mark.svg`.
Generate them with any SVG rasteriser (e.g. `resvg`, `sharp`, or an online converter)
and drop them in `apps/extension/` referenced from `manifest.json`.
