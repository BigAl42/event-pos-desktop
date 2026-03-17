import "@testing-library/jest-dom";
import { randomFillSync } from "crypto";

// jsdom has no WebCrypto; required for crypto.randomUUID() in db.ts
Object.defineProperty(globalThis, "crypto", {
  value: {
    getRandomValues: (buffer: ArrayBufferView) => randomFillSync(buffer),
    randomUUID: () => {
      const hex = [...randomFillSync(new Uint8Array(16))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  },
  writable: true,
});
