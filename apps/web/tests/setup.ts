import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const canvasContextStub = {
  imageSmoothingEnabled: true,
  clearRect() {},
  fillRect() {},
  save() {},
  restore() {},
  beginPath() {},
  moveTo() {},
  quadraticCurveTo() {},
  lineTo() {},
  closePath() {},
  stroke() {},
  fill() {},
  ellipse() {},
  arc() {},
};

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => canvasContextStub,
});

globalThis.WebSocket = class WebSocket {
  addEventListener() {}
  removeEventListener() {}
  close() {}
} as typeof WebSocket;
