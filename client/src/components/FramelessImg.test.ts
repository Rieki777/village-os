import { describe, expect, it } from "vitest";
import { safeImageSrc } from "./FramelessImg";

describe("safeImageSrc", () => {
  it("passes every picture address the app hands it, unchanged", () => {
    for (const src of [
      "/uploads/portraits/a.webp",
      "uploads/a.webp",
      "https://cdn.example.test/a.webp",
      "http://localhost:5000/a.png",
      "blob:http://localhost/1234-5678",
      "data:image/webp;base64,AAAA",
    ]) {
      expect(safeImageSrc(src)).toBe(src);
    }
  });

  it("draws nothing for an address that is not a picture", () => {
    expect(safeImageSrc("javascript:alert(1)")).toBeUndefined();
    expect(safeImageSrc(" JavaScript:alert(1)")).toBeUndefined();
    expect(safeImageSrc("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeImageSrc("vbscript:x")).toBeUndefined();
    expect(safeImageSrc("")).toBeUndefined();
    expect(safeImageSrc(null)).toBeUndefined();
  });
});
