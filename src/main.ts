import "nouislider/dist/nouislider.css";
import "./style.css";
import noUiSlider, { type API as SliderAPI } from "nouislider";
import { Engine, ExecError, type ProbeResult, type ProbeStream } from "./engine";
import {
  MP3_FORMAT, WAV_FORMAT, baseName, browserLikelyPlays, codecName, copyFormat, describeStream,
  formatBytes, formatTime, parseTime, type OutputFormat,
} from "./audio";

// ---------- DOM ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>("file-input");
const dropzone = $("dropzone");
const editor = $("editor");
const fileNameEl = $("file-name");
const fileDetailsEl = $("file-details");
const changeFileBtn = $<HTMLButtonElement>("change-file");
const probeStatus = $("probe-status");
const previewWrap = $("preview-wrap");
const video = $<HTMLVideoElement>("preview");
const previewNote = $("preview-note");
const trimBlock = $("trim");
const sliderEl = $("slider");
const startInput = $<HTMLInputElement>("start-input");
const endInput = $<HTMLInputElement>("end-input");
const lengthLabel = $("length-label");
const trimReset = $<HTMLButtonElement>("trim-reset");
const setStartBtn = $<HTMLButtonElement>("set-start");
const setEndBtn = $<HTMLButtonElement>("set-end");
const playSelBtn = $<HTMLButtonElement>("play-selection");
const trimButtons = $("trim-buttons");
const tracksBlock = $("tracks");
const trackList = $("track-list");
const formatBlock = $("format-block");
const formatSelect = $<HTMLSelectElement>("format");
const formatHint = $("format-hint");
const extractBtn = $<HTMLButtonElement>("extract");
const progressWrap = $("progress");
const progressBar = $("progress-bar");
const progressLabel = $("progress-label");
const notifyBtn = $<HTMLButtonElement>("notify-me");
const cancelBtn = $<HTMLButtonElement>("cancel");
const doneBox = $("done");
const doneDetail = $("done-detail");
const downloadLink = $<HTMLAnchorElement>("download");
const errorBox = $("error");
const errorText = $("error-text");
const errorLogWrap = $<HTMLDetailsElement>("error-log-wrap");
const errorLog = $("error-log");
const engineStatus = $("engine-status");
const favicon = $<HTMLLinkElement>("favicon");

// ---------- State ----------
type PreviewState = "loading" | "ok" | "failed";

const engine = new Engine();
let file: File | null = null;
let fileToken = 0; // bumps on every new file so stale async work can bail out
let probe: ProbeResult | null = null;
let audioStreams: ProbeStream[] = [];
let selected: ProbeStream | null = null;
let duration = 0;
let slider: SliderAPI | null = null;
let previewState: PreviewState = "loading";
let previewTimer = 0;
let videoUrl = "";
let resultUrl = "";
let busy = false;
let playingSelection = false;
let cancelled = false;
const baseTitle = document.title;

// ---------- Engine boot ----------
// Start fetching the ~32 MB engine right away; the browser caches it for next time.
engineStatus.textContent = "Loading audio engine (about 32 MB, cached after the first visit)…";
engine.load().then(
  () => (engineStatus.textContent = "Audio engine ready."),
  (err) => (engineStatus.textContent = `Couldn't load the audio engine: ${err?.message ?? err}`),
);

// ---------- File selection ----------
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) openFile(f);
  fileInput.value = "";
});
changeFileBtn.addEventListener("click", () => fileInput.click());

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const f = e.dataTransfer?.files?.[0];
  if (f && !busy) openFile(f);
});

async function openFile(f: File) {
  const token = ++fileToken;
  file = f;
  probe = null;
  audioStreams = [];
  selected = null;
  duration = 0;

  dropzone.hidden = true;
  editor.hidden = false;
  fileNameEl.textContent = f.name;
  fileDetailsEl.textContent = formatBytes(f.size);
  trimBlock.hidden = tracksBlock.hidden = formatBlock.hidden = true;
  extractBtn.disabled = true;
  clearResult();
  hideError();
  setProbeStatus("Reading file…");
  startPreview(f);

  try {
    const result = await engine.probe(f);
    if (token !== fileToken) return;
    probe = result;
  } catch (err) {
    if (token !== fileToken) return;
    setProbeStatus("");
    showError(
      err instanceof Error && !(err instanceof ExecError) ? err.message
        : "Couldn't read this file. It may be damaged or in a format that isn't supported.",
      engine.recentLog(),
    );
    return;
  }
  setProbeStatus("");

  audioStreams = probe.streams.filter((s) => s.codec_type === "audio");
  const fmtName = probe.format?.format_long_name;
  duration = parseFloat(probe.format?.duration ?? "") || 0;
  if (!duration) {
    duration = Math.max(0, ...audioStreams.map((s) => parseFloat(s.duration ?? "") || 0));
  }
  if (!duration && isFinite(video.duration)) duration = video.duration;
  fileDetailsEl.textContent = [formatBytes(f.size), duration ? formatTime(duration, 0) : "", fmtName]
    .filter(Boolean).join(" · ");

  if (!audioStreams.length) {
    showError("This file doesn't contain any audio tracks.");
    updatePreviewNote();
    return;
  }

  selected = audioStreams.find((s) => s.disposition?.default) ?? audioStreams[0];
  renderTracks();
  setupTrim();
  renderFormats();
  updatePreviewNote();
  extractBtn.disabled = false;
}

function setProbeStatus(text: string) {
  probeStatus.textContent = text;
  probeStatus.hidden = !text;
}

// ---------- Preview ----------
function startPreview(f: File) {
  stopSelectionPlayback();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  clearTimeout(previewTimer);
  previewState = "loading";
  previewWrap.hidden = false;
  previewWrap.classList.remove("audio-only");
  videoUrl = URL.createObjectURL(f);
  video.src = videoUrl;
  // Some browsers neither play nor error on formats they don't understand; give up after a while.
  previewTimer = window.setTimeout(() => {
    if (previewState === "loading") failPreview();
  }, 10000);
}

video.addEventListener("loadedmetadata", () => {
  if (previewState === "failed") return;
  clearTimeout(previewTimer);
  previewState = "ok";
  if (!duration && isFinite(video.duration) && probe) {
    duration = video.duration;
    setupTrim();
  }
  updatePreviewNote();
});

video.addEventListener("error", () => {
  if (!file || !video.getAttribute("src")) return;
  failPreview();
});

function failPreview() {
  clearTimeout(previewTimer);
  previewState = "failed";
  video.removeAttribute("src");
  video.load();
  previewWrap.hidden = true;
  updatePreviewNote();
}

function hasRealVideo(): boolean {
  return !!probe?.streams.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
}

interface AudioTrackLike { enabled: boolean }
function browserAudioTracks(): ArrayLike<AudioTrackLike> | null {
  const t = (video as unknown as { audioTracks?: ArrayLike<AudioTrackLike> }).audioTracks;
  return t && t.length ? t : null;
}

/** Tries to make the preview play the chosen track. Returns false if the browser can't switch tracks. */
function syncPreviewTrack(): boolean {
  const tracks = browserAudioTracks();
  if (!tracks || !selected || tracks.length !== audioStreams.length) return false;
  const ordinal = audioStreams.indexOf(selected);
  for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === ordinal;
  return true;
}

function updatePreviewNote() {
  const notes: string[] = [];
  const playheadButtons = [setStartBtn, setEndBtn, playSelBtn];

  if (previewState === "failed") {
    const what = probe
      ? [probe.format?.format_long_name, ...probe.streams.filter((s) => s.codec_type === "video" || s === selected)
        .map((s) => codecName(s.codec_name))].filter(Boolean).join(", ")
      : "";
    notes.push(
      `Preview isn't available: your browser can't play this file${what ? ` (${what})` : ""}. ` +
      `You can still trim with the slider or by typing times, and extraction works normally.`,
    );
    trimButtons.hidden = true;
  } else {
    trimButtons.hidden = false;
    playheadButtons.forEach((b) => (b.disabled = busy));
    if (previewState === "ok") {
      const noPicture = hasRealVideo() && video.videoWidth === 0;
      previewWrap.classList.toggle("audio-only", !hasRealVideo() || noPicture);
      if (noPicture) notes.push("Your browser can't show this video's picture, but the sound can still be previewed.");
      if (selected && !browserLikelyPlays(selected.codec_name)) {
        notes.push(
          `The preview may be silent: browsers usually can't play ${codecName(selected.codec_name)} audio. ` +
          `The extracted file will be fine.`,
        );
      }
      if (audioStreams.length > 1 && !syncPreviewTrack()) {
        notes.push("The preview always plays the file's default audio track; your chosen track is what gets extracted.");
      }
    }
  }
  previewNote.textContent = notes.join(" ");
  previewNote.hidden = !notes.length;
}

// ---------- Trim ----------
function setupTrim() {
  if (!duration) { trimBlock.hidden = true; return; }
  trimBlock.hidden = false;
  const step = duration > 600 ? 0.1 : 0.01;
  const opts = {
    start: [0, duration],
    connect: true,
    behaviour: "drag-tap",
    step,
    margin: Math.min(0.1, duration),
    range: { min: 0, max: duration },
  } as const;
  if (slider) {
    slider.updateOptions({ ...opts, start: [0, duration], range: { min: 0, max: duration } }, true);
  } else {
    slider = noUiSlider.create(sliderEl, { ...opts, start: [0, duration], range: { min: 0, max: duration } });
    slider.on("update", () => { renderTrimFields(); clearResult(); });
    slider.on("slide", (_values, handle) => {
      if (previewState !== "ok") return;
      stopSelectionPlayback();
      video.pause();
      video.currentTime = getRange()[handle];
    });
  }
  renderTrimFields();
}

function getRange(): [number, number] {
  if (!slider) return [0, duration];
  const v = slider.get(true) as number[];
  const round = (n: number) => Math.round(Number(n) * 1000) / 1000;
  return [round(v[0]), round(v[1])];
}

function isTrimmed(): boolean {
  const [s, e] = getRange();
  return s > 0.005 || e < duration - 0.005;
}

function renderTrimFields() {
  const [s, e] = getRange();
  if (document.activeElement !== startInput) startInput.value = formatTime(s);
  if (document.activeElement !== endInput) endInput.value = formatTime(e);
  lengthLabel.textContent = formatTime(e - s);
  trimReset.hidden = !isTrimmed();
}

function commitField(input: HTMLInputElement, handle: 0 | 1) {
  const t = parseTime(input.value);
  if (slider && !isNaN(t)) {
    const v: (number | null)[] = [null, null];
    v[handle] = Math.min(Math.max(t, 0), duration);
    slider.set(v);
  }
  input.value = formatTime(getRange()[handle]);
}
for (const [input, handle] of [[startInput, 0], [endInput, 1]] as const) {
  input.addEventListener("change", () => commitField(input, handle));
  input.addEventListener("blur", () => commitField(input, handle));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
}

trimReset.addEventListener("click", () => slider?.set([0, duration]));
setStartBtn.addEventListener("click", () => slider?.set([video.currentTime, null]));
setEndBtn.addEventListener("click", () => slider?.set([null, video.currentTime]));

playSelBtn.addEventListener("click", () => {
  if (playingSelection) { stopSelectionPlayback(); video.pause(); return; }
  const [s] = getRange();
  video.currentTime = s;
  playingSelection = true;
  playSelBtn.textContent = "■ Stop";
  video.play().catch(stopSelectionPlayback);
});
video.addEventListener("timeupdate", () => {
  if (playingSelection && video.currentTime >= getRange()[1]) { video.pause(); stopSelectionPlayback(); }
});
video.addEventListener("pause", () => { if (playingSelection) stopSelectionPlayback(); });

function stopSelectionPlayback() {
  playingSelection = false;
  playSelBtn.textContent = "▶ Play selection";
}

// ---------- Tracks & formats ----------
function renderTracks() {
  tracksBlock.hidden = false;
  trackList.replaceChildren();
  const multiple = audioStreams.length > 1;
  tracksBlock.querySelector("h2")!.textContent = multiple ? `Audio track (${audioStreams.length} found)` : "Audio track";
  audioStreams.forEach((s, i) => {
    const { title, detail } = describeStream(s);
    const row = document.createElement("label");
    row.className = "track";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "track";
    radio.checked = s === selected;
    radio.hidden = !multiple;
    radio.addEventListener("change", () => {
      selected = s;
      renderFormats();
      updatePreviewNote();
      clearResult();
    });
    const text = document.createElement("span");
    text.className = "track-text";
    const t = document.createElement("span");
    t.className = "track-title";
    t.textContent = multiple ? `${i + 1}. ${title}` : title;
    const d = document.createElement("span");
    d.className = "muted small";
    d.textContent = detail;
    text.append(t, d);
    row.append(radio, text);
    trackList.append(row);
  });
}

function formats(): OutputFormat[] {
  return selected ? [copyFormat(selected), MP3_FORMAT, WAV_FORMAT] : [];
}

function renderFormats() {
  formatBlock.hidden = false;
  const previous = formatSelect.value || "copy";
  formatSelect.replaceChildren(...formats().map((f) => new Option(f.label, f.id)));
  formatSelect.value = previous;
  renderFormatHint();
}

function currentFormat(): OutputFormat {
  return formats().find((f) => f.id === formatSelect.value) ?? formats()[0];
}

function renderFormatHint() {
  const f = currentFormat();
  let hint = f.hint;
  if (f.id === "wav" && selected) {
    const [s, e] = getRange();
    const bytes = (e - s) * (+(selected.sample_rate ?? 48000)) * (selected.channels ?? 2) * 2;
    hint += ` Estimated size: ${formatBytes(bytes)}.`;
    if (bytes > 1.5 * 1024 ** 3) hint += " That may be too large for your browser; consider trimming or using MP3.";
  }
  formatHint.textContent = hint;
}

formatSelect.addEventListener("change", () => { renderFormatHint(); clearResult(); });

// ---------- Extraction ----------
extractBtn.addEventListener("click", extract);
cancelBtn.addEventListener("click", () => {
  cancelled = true;
  engine.terminate(); // the pending exec rejects; extract() cleans up
  engine.load().catch(() => {});
});
notifyBtn.addEventListener("click", async () => {
  try { await Notification.requestPermission(); } catch { /* ignore */ }
  notifyBtn.hidden = true;
});

async function extract() {
  if (!file || !selected || busy) return;
  const f = file;
  const stream = selected;
  const [start, end] = getRange();
  const trimmed = isTrimmed();
  const length = trimmed ? end - start : duration;
  let format = currentFormat();

  setBusy(true);
  cancelled = false;
  clearResult();
  hideError();
  stopSelectionPlayback();
  video.pause();
  setProgress(0, trimmed && start > 0 ? "Finding the start point…" : "Starting…");
  notifyBtn.hidden = !("Notification" in window) || Notification.permission !== "default";

  const showProgress = (t: number) => {
    if (length > 0 && t > 0) {
      setProgress(Math.min(1, t / length), `Extracting… ${formatTime(Math.min(t, length), 0)} of ${formatTime(length, 0)}`);
    }
  };
  const unlisten = engine.onProgress(showProgress);

  // Seek on the output side: with stream copy, an input-side -ss snaps to the previous *video*
  // keyframe (possibly many seconds early). Output-side seeking reads from the start but only
  // demuxes/decodes audio, which is quick, and cuts at the audio-packet level (a few ms).
  const buildArgs = (fmt: OutputFormat) => [
    "-hide_banner",
    "-i", "{in}",
    ...(trimmed && start > 0 ? ["-ss", start.toFixed(3)] : []),
    ...(trimmed ? ["-t", (end - start).toFixed(3)] : []),
    "-map", `0:${stream.index}`,
    "-vn", "-sn", "-dn",
    ...fmt.args,
    "{out}",
  ];

  try {
    let data: Uint8Array;
    try {
      data = await engine.run(f, buildArgs(format), `output.${format.ext}`);
    } catch (err) {
      // Some sources can't be copied into the "natural" container; Matroska audio takes almost anything.
      if (cancelled || format.id !== "copy" || format.ext === "mka") throw err;
      format = copyFormat(stream, true);
      setProgress(0, "Retrying with a more flexible container…");
      data = await engine.run(f, buildArgs(format), `output.${format.ext}`);
    }

    const name = `${baseName(f.name)}${trimmed ? `_${stamp(start)}-${stamp(end)}` : ""}.${format.ext}`;
    const blob = new Blob([data as BlobPart], { type: format.mime });
    resultUrl = URL.createObjectURL(blob);
    downloadLink.href = resultUrl;
    downloadLink.download = name;
    doneDetail.textContent = `${name} · ${formatBytes(blob.size)}`;
    progressWrap.hidden = true;
    doneBox.hidden = false;
    downloadLink.click(); // automatic download; the button stays for a second copy
    announceDone(name);
  } catch (err) {
    progressWrap.hidden = true;
    if (cancelled) return;
    const log = err instanceof ExecError ? err.log : engine.recentLog();
    showError(
      format.id === "copy"
        ? "Couldn't copy this audio track as-is. Try choosing MP3 or WAV under Format."
        : `Extraction failed${err instanceof Error ? `: ${err.message}` : "."}`,
      log,
    );
  } finally {
    unlisten();
    setBusy(false);
  }
}

/** 83.4 -> "1m23s" for file names. */
function stamp(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return `${h ? `${h}h` : ""}${h || m ? `${m}m` : ""}${s}s`;
}

function setBusy(b: boolean) {
  busy = b;
  extractBtn.hidden = b;
  progressWrap.hidden = !b;
  changeFileBtn.disabled = b;
  formatSelect.disabled = b;
  trimReset.disabled = b;
  startInput.disabled = endInput.disabled = b;
  trackList.querySelectorAll("input").forEach((i) => (i.disabled = b));
  if (slider) b ? slider.disable() : slider.enable();
  updatePreviewNote();
}

function setProgress(fraction: number, label: string) {
  progressBar.style.width = `${(fraction * 100).toFixed(1)}%`;
  progressLabel.textContent = label;
}

function clearResult() {
  if (busy) return;
  doneBox.hidden = true;
  if (resultUrl) {
    // Delay so an in-flight download isn't cut off.
    const old = resultUrl;
    setTimeout(() => URL.revokeObjectURL(old), 60_000);
    resultUrl = "";
  }
}

function showError(message: string, log = "") {
  errorText.textContent = message;
  errorLog.textContent = log;
  errorLogWrap.hidden = !log;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
}

// ---------- "Come back" signals ----------
function announceDone(name: string) {
  if (!document.hidden) return;
  document.title = "✓ Audio ready · FFsplit";
  favicon.href = "./favicon-done.svg";
  if ("Notification" in window && Notification.permission === "granted") {
    const n = new Notification("Your audio is ready", { body: `${name} has been downloaded.`, icon: "./favicon-done.svg" });
    n.onclick = () => { window.focus(); n.close(); };
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    document.title = baseTitle;
    favicon.href = "./favicon.svg";
  }
});

window.addEventListener("beforeunload", (e) => {
  if (busy) e.preventDefault();
});
