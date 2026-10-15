import {
  applyCellBudget,
  detailToColumns,
  MAX_EXACT_COLS,
  MAX_COLS,
  MIN_COLS,
  rowsForColumns,
} from "./convert";
import type {
  DestinationId,
  DestinationSelection,
  RenderMode,
  ResolvedDestination,
} from "./types";

interface ResolveDestinationOptions {
  selection: DestinationSelection;
  sourceWidth: number;
  sourceHeight: number;
  detail: number;
  charAspect: number;
  mode: RenderMode;
}

interface DestinationProfile {
  columns: number;
  characterBudget: number | null;
  rowBudget: number | null;
}

const PROFILES: Record<
  Exclude<DestinationId, "auto" | "custom">,
  DestinationProfile
> = {
  phone: { columns: 40, characterBudget: null, rowBudget: null },
  chat: { columns: 60, characterBudget: 2_000, rowBudget: null },
  terminal: { columns: 80, characterBudget: null, rowBudget: 24 },
  readme: { columns: 120, characterBudget: null, rowBudget: null },
  detailed: { columns: 200, characterBudget: null, rowBudget: null },
  poster: { columns: 320, characterBudget: null, rowBudget: null },
};

function clampColumns(columns: number, maximum = MAX_COLS): number {
  return Math.max(MIN_COLS, Math.min(maximum, Math.round(columns)));
}

function worstCaseCharacters(cols: number, rows: number): number {
  return cols * rows + rows - 1;
}

export function resolveDestination({
  selection,
  sourceWidth,
  sourceHeight,
  detail,
  charAspect,
  mode,
}: ResolveDestinationOptions): ResolvedDestination {
  const profile =
    selection.id === "auto" || selection.id === "custom"
      ? null
      : PROFILES[selection.id];
  const requestedColumns =
    selection.id === "custom"
      ? clampColumns(selection.customColumns, MAX_EXACT_COLS)
      : clampColumns(
          selection.id === "auto" ? detailToColumns(detail) : profile!.columns
        );
  const rowBudget =
    selection.id === "custom" && selection.customMaxRows !== null
      ? Math.max(1, Math.round(selection.customMaxRows))
      : profile?.rowBudget ?? null;
  const characterBudget = profile?.characterBudget ?? null;

  let cols = requestedColumns;
  let rows = rowsForColumns(sourceWidth, sourceHeight, cols, charAspect);
  let reducedBy: ResolvedDestination["reducedBy"] = null;

  if (rowBudget !== null) {
    while (cols > MIN_COLS && rows > rowBudget) {
      cols -= 1;
      rows = rowsForColumns(sourceWidth, sourceHeight, cols, charAspect);
    }
    if (cols < requestedColumns) reducedBy = "rows";
  }

  if (characterBudget !== null) {
    while (
      cols > MIN_COLS &&
      worstCaseCharacters(cols, rows) > characterBudget
    ) {
      cols -= 1;
      rows = rowsForColumns(sourceWidth, sourceHeight, cols, charAspect);
    }
    if (cols < requestedColumns) reducedBy = "characters";
  }

  const budgeted = applyCellBudget(cols, rows, mode);
  if (budgeted.cols !== cols || budgeted.rows !== rows) {
    reducedBy = "cells";
    ({ cols, rows } = budgeted);
  }

  const finalCharacterCount = worstCaseCharacters(cols, rows);
  return {
    id: selection.id,
    requestedColumns,
    cols,
    rows,
    worstCaseCharacters: finalCharacterCount,
    characterBudget,
    characterBudgetSatisfied:
      characterBudget === null || finalCharacterCount <= characterBudget,
    rowBudget,
    rowBudgetSatisfied: rowBudget === null || rows <= rowBudget,
    reducedBy,
  };
}
