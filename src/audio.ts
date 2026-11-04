// Codec/container knowledge and small formatting helpers.
import type { ProbeStream } from "./engine";

export interface OutputFormat {
  id: string;
  label: string;
  ext: string;
  mime: string;
  /** ffmpeg codec/muxer args (placed after stream mapping). */
  args: string[];
  hint: string;
}

/** Where each codec can be stream-copied without re-encoding. Anything else goes into Matroska audio. */
const COPY_TARGETS: Record<string, { ext: string; mime: string; muxer?: string }> = {
  aac: { ext: "m4a", mime: "audio/mp4", muxer: "ipod" },
  alac: { ext: "m4a", mime: "audio/mp4", muxer: "ipod" },
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  mp2: { ext: "mp2", mime: "audio/mpeg" },
  opus: { ext: "opus", mime: "audio/ogg", muxer: "opus" },
  vorbis: { ext: "ogg", mime: "audio/ogg", muxer: "ogg" },
  flac: { ext: "flac", mime: "audio/flac" },
  ac3: { ext: "ac3", mime: "audio/ac3" },
  eac3: { ext: "eac3", mime: "audio/eac3" },
  dts: { ext: "dts", mime: "audio/vnd.dts" },
  truehd: { ext: "thd", mime: "audio/vnd.dolby.mlp", muxer: "truehd" },
  wmav1: { ext: "wma", mime: "audio/x-ms-wma", muxer: "asf" },
  wmav2: { ext: "wma", mime: "audio/x-ms-wma", muxer: "asf" },
  amr_nb: { ext: "amr", mime: "audio/amr" },
  pcm_u8: { ext: "wav", mime: "audio/wav" },
  pcm_s16le: { ext: "wav", mime: "audio/wav" },
  pcm_s24le: { ext: "wav", mime: "audio/wav" },
  pcm_s32le: { ext: "wav", mime: "audio/wav" },
  pcm_f32le: { ext: "wav", mime: "audio/wav" },
  pcm_f64le: { ext: "wav", mime: "audio/wav" },
  pcm_alaw: { ext: "wav", mime: "audio/wav" },
  pcm_mulaw: { ext: "wav", mime: "audio/wav" },
};

export const MKA_FALLBACK = { ext: "mka", mime: "audio/x-matroska", muxer: "matroska" };

export function copyFormat(stream: ProbeStream, forceMka = false): OutputFormat {
  const codec = stream.codec_name ?? "";
  const t = (!forceMka && COPY_TARGETS[codec]) || MKA_FALLBACK;
  return {
    id: "copy",
    label: `Original quality (${codecName(codec)}, .${t.ext})`,
    ext: t.ext,
    mime: t.mime,
    args: ["-c:a", "copy", ...(t.muxer ? ["-f", t.muxer] : [])],
    hint: "Fastest. Copies the audio exactly as it is, with no quality loss.",
  };
}

export const MP3_FORMAT: OutputFormat = {
  id: "mp3",
  label: "MP3 (plays everywhere)",
  ext: "mp3",
  mime: "audio/mpeg",
  args: ["-c:a", "libmp3lame", "-q:a", "2"],
  hint: "Re-encodes to high-quality VBR MP3 (~190 kbps). Slower, but plays on anything.",
};

export const WAV_FORMAT: OutputFormat = {
  id: "wav",
  label: "WAV (uncompressed)",
  ext: "wav",
  mime: "audio/wav",
  args: ["-c:a", "pcm_s16le"],
  hint: "Uncompressed 16-bit PCM. Large files; handy for editing software.",
};

/** Audio codecs that browsers can generally decode in a <video> element. */
const BROWSER_AUDIO = new Set([
  "aac", "mp3", "opus", "vorbis", "flac", "pcm_u8", "pcm_s16le", "pcm_s24le", "pcm_f32le",
]);

export function browserLikelyPlays(codec: string | undefined): boolean {
  return !!codec && BROWSER_AUDIO.has(codec);
}

const CODEC_NAMES: Record<string, string> = {
  aac: "AAC", mp3: "MP3", mp2: "MP2", opus: "Opus", vorbis: "Vorbis", flac: "FLAC", alac: "ALAC",
  ac3: "Dolby Digital (AC-3)", eac3: "Dolby Digital Plus (E-AC-3)", truehd: "Dolby TrueHD",
  dts: "DTS", wmav1: "WMA", wmav2: "WMA", amr_nb: "AMR",
};

export function codecName(codec: string | undefined): string {
  if (!codec) return "unknown";
  if (CODEC_NAMES[codec]) return CODEC_NAMES[codec];
  if (codec.startsWith("pcm_")) return "PCM";
  return codec.toUpperCase();
}

const LANGS: Record<string, string> = {
  eng: "English", spa: "Spanish", fre: "French", fra: "French", ger: "German", deu: "German",
  ita: "Italian", por: "Portuguese", rus: "Russian", jpn: "Japanese", chi: "Chinese", zho: "Chinese",
  kor: "Korean", hin: "Hindi", ara: "Arabic", dut: "Dutch", nld: "Dutch", swe: "Swedish",
  nor: "Norwegian", dan: "Danish", fin: "Finnish", pol: "Polish", tur: "Turkish", cze: "Czech",
  ces: "Czech", hun: "Hungarian", gre: "Greek", ell: "Greek", heb: "Hebrew", tha: "Thai",
  ukr: "Ukrainian", vie: "Vietnamese", ind: "Indonesian",
};

function channelsLabel(s: ProbeStream): string {
  const layout = s.channel_layout;
  if (layout === "mono" || s.channels === 1) return "mono";
  if (layout === "stereo" || s.channels === 2) return "stereo";
  if (layout?.startsWith("5.1")) return "5.1";
  if (layout?.startsWith("7.1")) return "7.1";
  return s.channels ? `${s.channels} ch` : "";
}

export function describeStream(s: ProbeStream): { title: string; detail: string } {
  const lang = s.tags?.language && s.tags.language !== "und" ? LANGS[s.tags.language] ?? s.tags.language : "";
  const name = s.tags?.title ?? s.tags?.handler_name;
  const usefulName = name && !/^(SoundHandler|Sound Media Handler|ISO Media file.*)$/i.test(name) ? name : "";
  const title = [usefulName, lang].filter(Boolean).join(" · ") || "Untitled track";
  const parts = [
    codecName(s.codec_name),
    channelsLabel(s),
    s.sample_rate ? `${+s.sample_rate / 1000} kHz` : "",
    s.bit_rate ? `${Math.round(+s.bit_rate / 1000)} kbps` : "",
  ];
  if (s.disposition?.default) parts.push("default");
  if (s.disposition?.comment) parts.push("commentary");
  return { title, detail: parts.filter(Boolean).join(" · ") };
}

/** 83.456 -> "1:23.46" (or "1:02:03.46"). */
export function formatTime(sec: number, decimals = 2): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(decimals).padStart(decimals ? 3 + decimals : 2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Accepts "83.4", "1:23.4", "1:02:03". Returns NaN if unparseable. */
export function parseTime(text: string): number {
  const parts = text.trim().split(":");
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d*\.?\d*$/.test(p) || p === "")) return NaN;
  return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "") || "audio";
}
