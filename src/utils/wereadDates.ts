import { WeReadNotebook } from "../types";

const MIN_VALID_YEAR = 2000;
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export interface NotebookTimeInfo {
  year: number;
  month: number;
  time: number;
  estimated: boolean;
}

export function isValidReadingTimestamp(timestamp?: number | null, now = new Date()): timestamp is number {
  if (!Number.isFinite(timestamp) || !timestamp) return false;
  const ms = timestamp * 1000;
  if (ms > now.getTime() + FUTURE_TOLERANCE_MS) return false;

  const date = new Date(ms);
  const year = date.getFullYear();
  return year >= MIN_VALID_YEAR && year <= now.getFullYear();
}

export function getNotebookReadingTimestamp(nb: WeReadNotebook, now = new Date()): number | undefined {
  const candidates = [
    nb.book?.readUpdateTime,
    nb.book?.finishReading,
    nb.sort
  ];
  return candidates.find((timestamp) => isValidReadingTimestamp(timestamp, now));
}

export function getEstimatedPastDate(idx: number, now = new Date()): Date {
  const day = Math.min(now.getDate(), 28);
  return new Date(now.getFullYear(), now.getMonth() - idx, day);
}

export function getNotebookTimeInfo(nb: WeReadNotebook, idx: number, now = new Date()): NotebookTimeInfo {
  const timestamp = getNotebookReadingTimestamp(nb, now);
  if (timestamp) {
    const date = new Date(timestamp * 1000);
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      time: timestamp,
      estimated: false
    };
  }

  const fallbackDate = getEstimatedPastDate(idx, now);
  return {
    year: fallbackDate.getFullYear(),
    month: fallbackDate.getMonth(),
    time: Math.floor(fallbackDate.getTime() / 1000),
    estimated: true
  };
}
