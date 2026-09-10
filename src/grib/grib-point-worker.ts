import { parentPort } from "node:worker_threads";
import { decodePointChunk } from "./grib-point-chunk.js";

interface DecodeJob {
  id: number;
  bytes: Uint8Array;
  points: Array<{ longitude: number; latitude: number }>;
  forecastHour?: number;
}

parentPort?.on("message", (job: DecodeJob) => {
  try {
    const valuesByPoint = decodePointChunk(
      job.bytes,
      job.points,
      job.forecastHour,
    );
    parentPort!.postMessage({ id: job.id, valuesByPoint });
  } catch (error) {
    parentPort!.postMessage({
      id: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
