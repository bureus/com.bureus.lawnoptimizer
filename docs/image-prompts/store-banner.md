# Store Banner — Image Generation Prompt

## Target file
`assets/images/store-banner.png`

## Homey store screenshot slots
| Field      | Path                          | Size          |
|------------|-------------------------------|---------------|
| `small`    | `assets/images/small.png`     | 500 × 350 px  |
| `large`    | `assets/images/large.png`     | 1000 × 700 px |
| `xlarge`   | `assets/images/xlarge.png`    | 1920 × 1080 px|

Generate the banner at **1920 × 1080**, then downscale to the required sizes.

## Format
PNG

## Prompt
> Premium smart lawn optimization banner for Homey smart home ecosystem, lush Scandinavian garden viewed from above, glowing underground soil temperature visualization, smart automation overlays, weather intelligence, irrigation optimization, futuristic but realistic, elegant green and blue color palette, cinematic lighting, ultra clean composition, modern IoT ecosystem feeling

## Style notes
- Cinematic 16:9 composition
- Two-thirds lush green garden from above; one-third subtle underground cross-section
- Homey-compatible aesthetic: clean, premium, minimal UI chrome
- No third-party logos or app store badges

## Adding to app.json
Once PNGs are ready, add to the root of `app.json`:
```json
"images": {
  "small":  "./assets/images/small.png",
  "large":  "./assets/images/large.png",
  "xlarge": "./assets/images/xlarge.png"
}
```
And to the driver object:
```json
"images": {
  "small":  "./drivers/lawn_soil_optimizer/assets/small.png",
  "large":  "./drivers/lawn_soil_optimizer/assets/large.png"
}
```
> **Important**: Only add the `images` block once the files exist and are correctly sized.
> Homey CLI validates that referenced files are present during `homey app install`.
