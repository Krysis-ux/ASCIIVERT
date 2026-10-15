import { describe, expect, it } from "vitest";

import { rowsForColumns } from "./convert";
import { resolveDestination } from "./destinations";

describe("rowsForColumns", () => {
  it("preserves a landscape source's aspect ratio", () => {
    expect(rowsForColumns(1600, 900, 80, 2)).toBe(23);
  });
});

describe("resolveDestination", () => {
  it.each([
    ["terminal", 1600, 900, 80, 23],
    ["terminal", 900, 1600, 27, 24],
    ["phone", 1600, 900, 40, 11],
    ["readme", 1600, 900, 120, 34],
    ["detailed", 1600, 900, 200, 56],
    ["poster", 1600, 900, 320, 90],
  ] as const)("resolves %s", (id, width, height, cols, rows) => {
    expect(
      resolveDestination({
        selection: { id, customColumns: 80, customMaxRows: null },
        sourceWidth: width,
        sourceHeight: height,
        detail: 50,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({ cols, rows });
  });

  it("keeps a portrait Chat result within 2,000 worst-case characters", () => {
    const result = resolveDestination({
      selection: { id: "chat", customColumns: 60, customMaxRows: null },
      sourceWidth: 900,
      sourceHeight: 1600,
      detail: 50,
      charAspect: 2,
      mode: "density",
    });

    expect(result).toMatchObject({
      cols: 46,
      rows: 41,
      characterBudgetSatisfied: true,
    });
    expect(result.worstCaseCharacters).toBeLessThanOrEqual(2_000);
  });

  it("contains Custom inside its optional row limit", () => {
    expect(
      resolveDestination({
        selection: { id: "custom", customColumns: 80, customMaxRows: 20 },
        sourceWidth: 900,
        sourceHeight: 1600,
        detail: 50,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({ cols: 23, rows: 20, rowBudgetSatisfied: true });
  });

  it("uses the detail-derived column count for Auto", () => {
    expect(
      resolveDestination({
        selection: { id: "auto", customColumns: 80, customMaxRows: null },
        sourceWidth: 1600,
        sourceHeight: 900,
        detail: 50,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({ requestedColumns: 143, cols: 143, rows: 40 });
  });

  it("preserves an extreme portrait aspect ratio", () => {
    expect(
      resolveDestination({
        selection: { id: "custom", customColumns: 16, customMaxRows: null },
        sourceWidth: 1,
        sourceHeight: 100,
        detail: 50,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({ cols: 16, rows: 800 });
  });

  it("keeps an extreme landscape grid at one row", () => {
    expect(
      resolveDestination({
        selection: { id: "phone", customColumns: 80, customMaxRows: null },
        sourceWidth: 10_000,
        sourceHeight: 1,
        detail: 50,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({ cols: 40, rows: 1 });
  });

  it("reports when an extreme portrait cannot satisfy Chat's character budget", () => {
    expect(
      resolveDestination({
        selection: { id: "chat", customColumns: 60, customMaxRows: null },
        sourceWidth: 1,
        sourceHeight: 100,
        detail: 50,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({
      cols: 16,
      rows: 800,
      characterBudget: 2_000,
      characterBudgetSatisfied: false,
    });
  });

  it("reports when an extreme portrait cannot satisfy Terminal's row budget", () => {
    expect(
      resolveDestination({
        selection: { id: "terminal", customColumns: 80, customMaxRows: null },
        sourceWidth: 1,
        sourceHeight: 100,
        detail: 50,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({
      cols: 16,
      rows: 800,
      rowBudget: 24,
      rowBudgetSatisfied: false,
    });
  });

  it("reports when Custom's row limit is below the minimum-column grid", () => {
    expect(
      resolveDestination({
        selection: { id: "custom", customColumns: 80, customMaxRows: 1 },
        sourceWidth: 1600,
        sourceHeight: 900,
        detail: 50,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({
      cols: 16,
      rows: 5,
      rowBudget: 1,
      rowBudgetSatisfied: false,
    });
  });

  it("clamps Custom to the engine's minimum column count", () => {
    expect(
      resolveDestination({
        selection: { id: "custom", customColumns: 1, customMaxRows: null },
        sourceWidth: 1600,
        sourceHeight: 900,
        detail: 50,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({ requestedColumns: 16, cols: 16, rows: 5 });
  });

  it("preserves a Custom request up to the engine's exact-column maximum", () => {
    const result = resolveDestination({
      selection: { id: "custom", customColumns: 2048, customMaxRows: null },
      sourceWidth: 1600,
      sourceHeight: 900,
      detail: 50,
      charAspect: 2,
      mode: "density",
    });

    expect(result.requestedColumns).toBe(2048);
    expect(result.cols).toBeLessThan(2048);
    expect(result.reducedBy).toBe("cells");
  });

  it("keeps Auto at the Detail slider's 600-column maximum", () => {
    expect(
      resolveDestination({
        selection: { id: "auto", customColumns: 2048, customMaxRows: null },
        sourceWidth: 1600,
        sourceHeight: 900,
        detail: 100,
        charAspect: 2,
        mode: "density",
      })
    ).toMatchObject({ requestedColumns: 600, cols: 600 });
  });

  it("never rounds a reduced grid above the render-mode cell budget", () => {
    const result = resolveDestination({
      selection: { id: "custom", customColumns: 600, customMaxRows: null },
      sourceWidth: 1000,
      sourceHeight: 1000,
      detail: 50,
      charAspect: 2,
      mode: "shape",
    });

    expect(result).toMatchObject({
      requestedColumns: 600,
      cols: 469,
      rows: 234,
      reducedBy: "cells",
    });
    expect(result.cols * result.rows).toBeLessThanOrEqual(110_000);
  });
});
