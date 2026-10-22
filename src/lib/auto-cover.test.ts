import { describe, expect, it } from "vitest";
import { canAutoCoverOnPointerLeave } from "./auto-cover";

const ready = {
  enabled: true,
  concealed: false,
  bookReady: true,
  coverReady: true,
  importing: false,
  coverLoading: false,
  coverSettingsOpen: false,
  propertiesOpen: false,
  imageOpen: false,
  dragging: false,
};

describe("automatic cover mode", () => {
  it("allows a ready book to switch when the pointer leaves", () => {
    expect(canAutoCoverOnPointerLeave(ready, { pointerType: "mouse" })).toBe(true);
  });

  it.each(["touch", "pen"])("ignores %s pointer leave events", pointerType => {
    expect(canAutoCoverOnPointerLeave(ready, { pointerType })).toBe(false);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["already concealed", { concealed: true }],
    ["book is loading", { bookReady: false }],
    ["cover is not ready", { coverReady: false }],
    ["book import is active", { importing: true }],
    ["cover import is active", { coverLoading: true }],
    ["cover settings is open", { coverSettingsOpen: true }],
    ["properties dialog is open", { propertiesOpen: true }],
    ["image preview is open", { imageOpen: true }],
    ["a file is being dragged", { dragging: true }],
  ])("does not switch when %s", (_name, change) => {
    expect(canAutoCoverOnPointerLeave({ ...ready, ...change }, { pointerType: "mouse" })).toBe(false);
  });
});
