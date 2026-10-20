# AIR FX

[ブラウザで使う](https://gakkii415.github.io/air-fx/)

A browser audio deck with three licensed EDM/electronic tracks, six effects, touch/keyboard performance, and local audio loading. Static HTML/CSS/JavaScript; no build or dependencies. GitHub Pages serves the repository root.

Run locally:

```sh
python -m http.server 4173
```

Open http://localhost:4173. Use HTTPS for a remote host because AudioWorklet requires a secure context. Select a track to start, tap pads to toggle effects, or select hold mode. Keyboard: A/S/D/J/K/L; Space plays/pauses. Drag the XY pad to change timbre and intensity. Multiple effects can be combined; BPM sync applies to gate, repeat, and echo. Loop playback can be disabled.

Audio is decoded and processed in the browser. Local files are never uploaded. Recording/export is not included.

## Included music

- Unity — TheFatRat: https://www.newgrounds.com/audio/listen/621134 — CC BY 3.0, https://creativecommons.org/licenses/by/3.0/
- Cipher — Kevin MacLeod (incompetech.com): https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100844 — CC BY 4.0, https://creativecommons.org/licenses/by/4.0/
- EDM Detection Mode — Kevin MacLeod (incompetech.com): https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500026 — CC BY 4.0, https://creativecommons.org/licenses/by/4.0/

Tracks were re-encoded to 128 kbps MP3. Interactive effects alter playback. Detailed attribution is retained in `tracks.json` and shown through Credits & Licenses. Album designs are original geometric artwork, not official covers. This project is independent and not affiliated with SOUND VOLTEX.
