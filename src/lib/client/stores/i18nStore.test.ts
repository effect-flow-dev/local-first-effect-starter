import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { t, setLocale, localeState } from "./i18nStore";

describe("i18nStore", () => {
  beforeEach(() => {
    setLocale("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("translates basic keys", () => {
    expect(t("common.save")).toBe("Save");
  });

  it("interpolates variables", () => {
    expect(t("business.alert_sent", { contact: "Mom" })).toBe("Alert sent to Mom");
  });

  it("switches language reactively", () => {
    expect(t("common.save")).toBe("Save");
    setLocale("es");
    expect(localeState.value).toBe("es");
    expect(t("common.save")).toBe("Guardar");
  });

  it("falls back gracefully for missing keys", () => {
    // Spy on console.warn to suppress the expected warning output
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    
    expect(t("missing.key")).toBe("missing.key");
    
    // Assert that the warning was logged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Missing key: missing.key")
    );
  });
});
