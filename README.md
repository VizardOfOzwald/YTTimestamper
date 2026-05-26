# YouTube Timestamp Looper

Browser extension (Chrome + Firefox, Manifest V3) that lets you add multiple timestamp markers to a YouTube video, then loop playback between any selected marker pair.

## Features

- Add unlimited markers at current playback position.
- Select a start marker and end marker to create a loop range.
- Jump directly to selected start or end marker.
- Repeat playback inside that range automatically.
- Jump to any marker quickly.
- Optional timeline click mode: click on the YouTube seek bar to place markers.
- Auto Jump Timeline with unlimited jump modules:
  - each module is a direct `from marker -> to marker` jump rule
  - when playback crosses the `from` marker, it jumps immediately to the `to` marker
  - this allows skipping multiple segments (example: 0:20 -> 0:30, 1:20 -> 2:00, 3:40 -> 4:30)
- Save markers per YouTube video (stored locally in browser storage).
- UI is isolated to a single fixed panel and runs only on YouTube watch pages.
- Toolbar popup (extension icon) can control markers/loop on the active YouTube tab.


## Install in Firefox (temporary add-on)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select the `manifest.json` file in this folder.

Note: temporary Firefox add-ons are removed after browser restart unless packaged/signed.

## Usage

1. Open any YouTube video page.
2. Use **Add marker** where you want key timestamps.
3. Pick **Start marker** and **End marker**.
4. Click **Start loop**.
5. Add more markers any time and switch loop range as needed.
6. Use **Jump to start** / **Jump to end** for quick navigation.
7. Turn on **Timeline click add** and click YouTube's timeline to place markers.
8. Use **Add jump module** to create as many jump modules as needed, then click **Start auto jump**.

## Notes on extension compatibility

- Script runs only on `https://www.youtube.com/watch*`.
- No prototype patching or global keyboard interception is used.
- All state is namespaced under one storage key for this extension.

## Linux compatibility

- Linux does not interfere with extension behavior.
- This extension is pure WebExtension code (JS/CSS/manifest), so it works the same on Linux, Windows, and macOS.
- You only need a recent browser version with Manifest V3 support.
