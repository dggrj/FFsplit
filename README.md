# FFsplit

Extract the audio from a video, entirely in the browser. Nothing is uploaded: the file is read
locally by [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm).

- Choose or drag in a video (MP4, MKV, MOV, WebM, AVI, WMV, TS, …).
- Pick which audio track to keep if there's more than one.
- Optionally trim with a range slider (with a live preview when the browser can play the file;
  if it can't, the preview is disabled and you can still trim by slider or typed times).
- Export the original audio untouched (fast, lossless stream copy), or convert to MP3 / WAV.
- The result downloads automatically. If you switched tabs, the tab title and icon change, and
  you can opt in to a desktop notification.

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
npm run preview  # serve dist/
```

`dist/` is a fully static site (relative paths) and can be hosted anywhere, including a
sub-path such as GitHub Pages. It uses the single-threaded ffmpeg core, so no special
COOP/COEP headers are required. Note that the core's `.wasm` file is ~32 MB, which is over
some hosts' per-file limits (e.g. Cloudflare Pages' 25 MB).

## How it works

- `src/engine.ts` wraps ffmpeg.wasm. The chosen file is mounted with `WORKERFS`, so ffmpeg reads
  it in slices instead of copying it into WebAssembly memory. `ffprobe` lists the streams.
- `src/audio.ts` maps each audio codec to a container it can be copied into without re-encoding
  (AAC → .m4a, Opus → .opus, AC-3 → .ac3, …). Anything else, or a copy that fails, falls back to
  Matroska audio (.mka).
- `src/main.ts` is the UI. The range slider is [noUiSlider](https://refreshless.com/nouislider/).

Trimming uses output-side seeking (`-i in -ss … -t …`). With stream copy, input-side seeking snaps
to the previous video keyframe, which can be seconds early.

## Licence note

`@ffmpeg/core` is GPL-2.0-or-later. Hosting this site distributes that binary, so keep the
attribution and a pointer to its source (linked in the page footer).
