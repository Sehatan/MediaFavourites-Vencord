# MediaFavourites

Save images and videos from Discord chat to your GIF favourites with a hover star or the message context menu.

> MediaFavourites is a **Vencord userplugin**. It is not a BetterDiscord plugin and cannot be installed as a normal Vencord plugin.

## Features

- **Hover star** on images and videos in chat.
  - White outline means the media is not saved; a gold star means it is already in your favourites.
  - Click the star to add or remove it.
  - Appears on hover (or always, with the setting enabled) and works before an image is opened or a video is played.
- **Context menu** — right-click a message and choose **Add image/video to favourites** or **Remove … from favourites**.
- **Multiple attachments** — every eligible image and video in a message gets its own star and, when needed, its own context-menu entry.
- **Discord GIF favourites** — saved media appears in the normal **GIFs → Favourites** picker and can be sent like any other favourite.
- **Full-size URLs** — stores the original CDN link instead of Discord's resized chat thumbnail, so images are not silently downscaled.
- **Supported media** — PNG, JPG/JPEG, WebP, AVIF, GIF, BMP, MP4, and WebM. Direct media links and image/video embeds work.
- **Safe defaults** — ignores emoji, avatars, reactions, stickers, spoilers, and media smaller than 64×40. GIFs keep Discord's own favourite star, so no second star is drawn over it.

## Installation

1. Set up Vencord from source by following the [official guide](https://docs.vencord.dev/installing/).
2. On this GitHub page, click the green **Code** button and choose **Download ZIP**.
3. Extract the downloaded ZIP.
4. Copy extracted folder (not the ZIP file) into `Vencord/src/userplugins/`. Create the `userplugins` folder if it does not exist.
6. From the Vencord folder, build and inject:

   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   pnpm inject
   ```

7. Fully restart Discord.
8. Open **Settings → Vencord → Plugins** and enable **MediaFavourites**.
9. Hover an image or video in chat and click the star, then open **GIFs → Favourites**.

More information: [Vencord custom plugins](https://docs.vencord.dev/installing/custom-plugins/).

## Usage

- **Add:** hover an image or video and click the star, or use the message context menu.
- **Remove:** click the gold star again, or use the context menu.
- **Find saved media:** open the emoji/GIF picker and switch to **Favourites**.
- **Settings** (under **Settings → Vencord → Plugins → MediaFavourites**):
  - **Show a favourite star when hovering images and videos** — turn the star off and keep only the context menu.
  - **Always show the star** — keep stars visible instead of showing them only on hover.

## Notes and limitations

- Saves the media URL, **not the file**. Discord's normal favourites size limit still applies.
- Existing Discord favourites are preserved; this plugin uses Discord's native favourites storage and picker.
- Discord attachment links can expire. If an old favourite stops loading, favourite it again from the original message.
- YouTube/Twitch watch pages are not video files and are not supported.
- Video codec support depends on Discord's Chromium build; MP4/H.264 and WebM are the intended formats.
- The hover star depends on Discord's message layout. If a Discord update changes it, the context menu still works and the plugin may need an update.
- Does not download, re-upload, or bypass access permissions.

## Credits

Built by **Sehatan**. Made with **DeepSeek Harness**.

License: GPL-3.0-or-later. See [LICENSE](LICENSE).
