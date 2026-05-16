# Pairing Hero — Image Generation Prompt

## Target file
`assets/images/pairing-hero.png`

## Required size
**1280 × 720 px** (16:9)

## Format
PNG (or JPG at 90 % quality for smaller file size)

## Prompt
> Modern smart lawn monitoring scene for a Homey smart home app, Scandinavian garden, healthy green grass, subtle underground heat visualization, weather-aware smart automation feeling, elegant UI-inspired composition, premium Nordic aesthetic, realistic but clean, sunlight after rain, highly polished product visualization

## Style notes
- Landscape orientation (16:9)
- Bright daylight, post-rain atmosphere — fresh and clean
- Subtle underground cross-section in the lower third showing soil layers and temperature gradients
- No text or UI overlays in the image itself (text is added by the pairing HTML)
- Safe zone: keep the focal subject in the centre 60 %, edges can bleed/blur

## Usage
Displayed in `drivers/lawn_soil_optimizer/pair/start.html` as the hero image above the setup form.

## Export steps
1. Generate at 1280 × 720
2. Save as `assets/images/pairing-hero.png`
3. Optionally compress with `pngquant` or `oxipng` for web delivery
