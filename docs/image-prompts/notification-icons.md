# Notification / Capability Icons — Image Generation Prompt

## Target files
| Icon               | Path                                  |
|--------------------|---------------------------------------|
| App icon (SVG)     | `assets/icon.svg`                     |
| Device icon (SVG)  | `drivers/lawn_soil_optimizer/assets/icon.svg` |
| Frost risk         | `assets/icons/frost_risk.svg`         |
| Heat stress        | `assets/icons/heat_stress.svg`        |
| Watering           | `assets/icons/watering.svg`           |
| Mowing             | `assets/icons/mowing.svg`             |
| Fertilizing        | `assets/icons/fertilizing.svg`        |

> **Note**: Placeholder SVGs for all the above files already exist in the repo.
> Replace them with generated/designed artwork when available.

## Format
SVG preferred (scales to any size); PNG fallback at **200 × 200 px**

## Prompt
> Minimal monochrome icon set for lawn care smart home app: grass with underground heat waves, frost risk snowflake, heat stress sun waves, watering droplet, mowing blade, fertilizer leaf, clean line art, optimized for small smart home notification usage, ultra simple vector design, transparent background

## Style guidelines per icon

### frost_risk
- 6- or 8-arm snowflake
- Single colour: `#5B9BD5` (cool blue)
- Works well inverted on dark backgrounds

### heat_stress
- Sun disc with 8 rays + wavy descending heat lines
- Single colour: `#F57C00` (warm amber)

### watering
- Large water droplet or 3 small droplets falling onto grass
- Single colour: `#42A5F5` (sky blue)

### mowing
- Horizontal blade/cut line bisecting grass blades
- Two tones: `#4CAF50` (grass) + `#F9A825` (blade)

### fertilizing
- Sprouting leaf with nutrient dots at the base
- Two tones: `#4CAF50` (leaf) + `#FDD835` (nutrients)

## SVG conventions
- `viewBox="0 0 100 100"` — all icons use the same grid
- No embedded text, no `<title>` needed
- Transparent background (no background rect)
- Stroke-based designs preferred (easier to recolour via CSS)
