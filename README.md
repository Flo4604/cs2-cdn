# CS2-CDN An easy way to access CS2 images.

A simple script which downloads all cs2 files and extracts all their images for

- Stickers
- Patches
- Graffitis
- Character Models
- Music Kits
- Cases
- Tools
- Status Icons ( Medals + Ranks )
- Weapons

Once extracted they will be uploaded to a s3 storage provider.

You can view the images via `https://cs2cdn.com/` + ItemPath

For Example: https://cs2cdn.com/econ/status_icons/service_medal_2024_lvl1.png

You can get the item paths using the items_game.txt stored in this repository. See [Here](https://github.com/Flo4604/Cs2-cdn/blob/main/data/scripts/items/items_game.txt)

## local setup

1. **Install bun**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
2. **Install bun dependencies**
   ```bash
   bun install
   ```
3. **Run index file**
   ```bash
   bun run src/index.js
   ```
