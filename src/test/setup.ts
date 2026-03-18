import "@testing-library/jest-dom";
import { vi } from "vitest";
import { randomFillSync } from "crypto";

// Tauri dialog plugin is used for confirm/open/save in UI.
// In tests we provide safe defaults; specific tests can override via vi.mocked(...).
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn().mockResolvedValue(true),
  open: vi.fn(),
  save: vi.fn(),
}));

// jsdom has no WebCrypto; required for crypto.randomUUID() in db.ts
Object.defineProperty(globalThis, "crypto", {
  value: {
    getRandomValues: (buffer: ArrayBufferView) =>
      randomFillSync(buffer as unknown as NodeJS.ArrayBufferView),
    randomUUID: () => {
      const hex = [...randomFillSync(new Uint8Array(16))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  },
  writable: true,
});

// Some components call `fetch(...)` for debug logging. In tests we stub it to avoid
// unhandled "fetch is not defined" errors in jsdom environments.
if (typeof globalThis.fetch !== "function") {
  Object.defineProperty(globalThis, "fetch", {
    value: () => Promise.resolve({ ok: true } as unknown),
    writable: true,
  });
}
