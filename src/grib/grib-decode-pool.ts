import { availableParallelism } from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { DecodedValue } from "../types/decoded.js";
import type { GribPointSample } from "./gribberish-runtime.js";

interface DecodeJob {
  id: number;
  bytes: Uint8Array;
  points: readonly GribPointSample[];
  forecastHour?: number;
  resolve: (valuesByPoint: DecodedValue[][]) => void;
  reject: (error: Error) => void;
}

interface WorkerResponse {
  id: number;
  valuesByPoint?: DecodedValue[][];
  error?: string;
}

/**
 * Shared pool of GRIB point-decode workers. JPEG2000/CCSDS unpack is
 * CPU-bound native work; running it on the event loop serializes every
 * concurrent time step. The pool is process-global so composed queries share
 * cores instead of oversubscribing. It never performs HTTP.
 */
class GribDecodePool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: DecodeJob[] = [];
  private readonly jobs = new WeakMap<Worker, DecodeJob>();
  private nextId = 1;
  private failed = false;

  constructor(size: number) {
    const url = workerUrl();
    if (url === undefined || size < 2) {
      this.failed = true;
      return;
    }
    try {
      for (let index = 0; index < size; index += 1) {
        const worker = new Worker(url);
        worker.unref();
        worker.on("message", (response: WorkerResponse) => this.finish(worker, response));
        worker.on("error", (error) => this.failWorker(worker, error));
        worker.on("exit", (code) => {
          if (code !== 0 && !this.failed) this.failWorker(worker, new Error(`GRIB decode worker exited ${code}`));
        });
        this.workers.push(worker);
        this.idle.push(worker);
      }
    } catch {
      this.terminate();
    }
  }

  get enabled(): boolean {
    return !this.failed && this.workers.length > 1;
  }

  run(
    bytes: Uint8Array,
    points: readonly GribPointSample[],
    forecastHour?: number,
  ): Promise<DecodedValue[][]> {
    if (!this.enabled) {
      return Promise.reject(new Error("GRIB decode worker pool is not available"));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.nextId,
        bytes,
        points,
        ...(forecastHour === undefined ? {} : { forecastHour }),
        resolve,
        reject,
      });
      this.nextId += 1;
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      if (worker === undefined || job === undefined) return;
      const copy = Uint8Array.from(job.bytes);
      this.jobs.set(worker, job);
      worker.postMessage(
        {
          id: job.id,
          bytes: copy,
          points: job.points,
          ...(job.forecastHour === undefined ? {} : { forecastHour: job.forecastHour }),
        },
        [copy.buffer],
      );
    }
  }

  private finish(worker: Worker, response: WorkerResponse): void {
    const job = this.jobs.get(worker);
    this.jobs.delete(worker);
    this.idle.push(worker);
    if (job === undefined) {
      this.dispatch();
      return;
    }
    if (response.error !== undefined) {
      job.reject(new Error(response.error));
    } else if (response.valuesByPoint === undefined) {
      job.reject(new Error("GRIB decode worker returned no values"));
    } else {
      job.resolve(response.valuesByPoint);
    }
    this.dispatch();
  }

  private failWorker(worker: Worker, error: Error): void {
    const job = this.jobs.get(worker);
    this.jobs.delete(worker);
    job?.reject(error);
    this.terminate();
  }

  terminate(): void {
    this.failed = true;
    for (const queued of this.queue.splice(0)) {
      queued.reject(new Error("GRIB decode worker pool shut down"));
    }
    for (const worker of this.workers.splice(0)) {
      const job = this.jobs.get(worker);
      this.jobs.delete(worker);
      job?.reject(new Error("GRIB decode worker pool shut down"));
      void worker.terminate();
    }
    this.idle.length = 0;
  }
}

let pool: GribDecodePool | undefined;

export function gribDecodePool(): GribDecodePool {
  pool ??= new GribDecodePool(decodeWorkerCount());
  return pool;
}

export function shutdownGribDecodePool(): void {
  pool?.terminate();
  pool = undefined;
}

export function decodeWorkerCount(): number {
  if (process.env.VITEST) return 0;
  if (process.env.WFG_GRIB_DECODE_WORKERS === "0") return 0;
  const requested = Number(process.env.WFG_GRIB_DECODE_WORKERS);
  if (Number.isInteger(requested) && requested >= 0) return requested;
  try {
    return Math.max(0, Math.min(8, availableParallelism() - 1));
  } catch {
    return 0;
  }
}

function workerUrl(): URL | undefined {
  const javascript = new URL("./grib-point-worker.js", import.meta.url);
  if (existsSync(fileURLToPath(javascript))) return javascript;
  const typescript = new URL("./grib-point-worker.ts", import.meta.url);
  if (existsSync(fileURLToPath(typescript))) return typescript;
  return undefined;
}
