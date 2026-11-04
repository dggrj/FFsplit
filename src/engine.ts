// Thin wrapper around ffmpeg.wasm: loading, mounting the user's file, probing, extracting.
import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
// Self-hosted core (single-threaded build: no SharedArrayBuffer / COOP+COEP headers needed).
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

const INPUT_DIR = "/input";

export interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bit_rate?: string;
  duration?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format?: { format_name?: string; format_long_name?: string; duration?: string; bit_rate?: string };
}

export class Engine {
  private ffmpeg: FFmpeg | null = null;
  private loading: Promise<FFmpeg> | null = null;
  private mounted: File | null = null;
  private logListeners = new Set<(line: string) => void>();
  private progressListeners = new Set<(seconds: number) => void>();
  private logTail: string[] = [];

  /** Loads the engine (once). Safe to call repeatedly. */
  load(): Promise<FFmpeg> {
    if (this.ffmpeg) return Promise.resolve(this.ffmpeg);
    if (!this.loading) {
      const ff = new FFmpeg();
      ff.on("log", ({ message }) => {
        this.logTail.push(message);
        if (this.logTail.length > 200) this.logTail.shift();
        this.logListeners.forEach((fn) => fn(message));
      });
      // `time` is the output position in microseconds.
      ff.on("progress", ({ time }) => this.progressListeners.forEach((fn) => fn(time / 1e6)));
      this.loading = ff
        .load({
          coreURL: new URL(coreURL, location.href).href,
          wasmURL: new URL(wasmURL, location.href).href,
        })
        .then(() => {
          this.ffmpeg = ff;
          return ff;
        })
        .catch((err) => {
          this.loading = null;
          throw err;
        });
    }
    return this.loading;
  }

  onLog(fn: (line: string) => void): () => void {
    this.logListeners.add(fn);
    return () => this.logListeners.delete(fn);
  }

  /** Reports how many seconds of output have been written so far. */
  onProgress(fn: (seconds: number) => void): () => void {
    this.progressListeners.add(fn);
    return () => this.progressListeners.delete(fn);
  }

  recentLog(): string {
    return this.logTail.join("\n");
  }

  /**
   * Makes the file visible to ffmpeg without copying it into wasm memory
   * (WORKERFS reads slices of the File on demand), so large videos are fine.
   */
  private async mount(file: File): Promise<string> {
    const ff = await this.load();
    if (this.mounted !== file) {
      if (this.mounted) {
        await ff.unmount(INPUT_DIR).catch(() => {});
        await ff.deleteDir(INPUT_DIR).catch(() => {});
      }
      await ff.createDir(INPUT_DIR).catch(() => {});
      await ff.mount(FFFSType.WORKERFS, { files: [file] }, INPUT_DIR);
      this.mounted = file;
    }
    return `${INPUT_DIR}/${file.name}`;
  }

  async probe(file: File): Promise<ProbeResult> {
    const ff = await this.load();
    const input = await this.mount(file);
    const out = "/probe.json";
    this.logTail = [];
    await ff.ffprobe([
      "-v", "error",
      "-print_format", "json",
      "-show_format", "-show_streams",
      input,
      "-o", out,
    ]);
    let text: string;
    try {
      text = (await ff.readFile(out, "utf8")) as string;
    } catch {
      throw new Error("Couldn't read this file. It may not be a video, or the format isn't supported.");
    }
    await ff.deleteFile(out).catch(() => {});
    const result = JSON.parse(text || "{}") as ProbeResult;
    if (!result.streams?.length) {
      throw new Error("Couldn't find any streams in this file. It may not be a video, or the format isn't supported.");
    }
    return result;
  }

  /**
   * Runs ffmpeg with `args`, where the literal strings "{in}" and "{out}" are replaced by
   * the mounted input and the given output path. Returns the output bytes.
   */
  async run(file: File, args: string[], outName: string, timeoutMs = -1): Promise<Uint8Array> {
    const ff = await this.load();
    const input = await this.mount(file);
    const out = `/${outName}`;
    this.logTail = [];
    const finalArgs = args.map((a) => (a === "{in}" ? input : a === "{out}" ? out : a));
    const code = await ff.exec(finalArgs, timeoutMs);
    if (code !== 0) {
      await ff.deleteFile(out).catch(() => {});
      throw new ExecError(`ffmpeg exited with code ${code}`, this.recentLog());
    }
    const data = (await ff.readFile(out)) as Uint8Array;
    await ff.deleteFile(out).catch(() => {});
    if (!data.byteLength) throw new ExecError("ffmpeg produced an empty file", this.recentLog());
    return data;
  }

  /** Hard-stops whatever is running. The engine reloads itself on next use. */
  terminate(): void {
    this.ffmpeg?.terminate();
    this.ffmpeg = null;
    this.loading = null;
    this.mounted = null;
  }
}

export class ExecError extends Error {
  constructor(message: string, readonly log: string) {
    super(message);
  }
}
