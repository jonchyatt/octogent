import type { PrimaryNavIndex } from "./constants";

const PRIMARY_NAV_KEY_PATTERN = /^[0-4]$/;
const MAX_TICKER_QUERY_LENGTH = 16;
const TICKER_QUERY_ALLOWED_PATTERN = /[^A-Z0-9._/-]/g;

export const isEditableEventTarget = (target: EventTarget | null): boolean => {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable === true || target.contentEditable === "true";
};

export const parsePrimaryNavKey = (key: string): PrimaryNavIndex | null => {
  if (!PRIMARY_NAV_KEY_PATTERN.test(key)) {
    return null;
  }

  return Number.parseInt(key, 10) as PrimaryNavIndex;
};

export const normalizeTickerQueryInput = (value: string): string =>
  value.toUpperCase().replace(TICKER_QUERY_ALLOWED_PATTERN, "").slice(0, MAX_TICKER_QUERY_LENGTH);
