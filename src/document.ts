import {
  cloneGrid,
  createGrid,
  getGridSize,
  gridsEqual,
  mergeGrids,
  sameGridSize,
  type StudioCell,
  type StudioGrid,
} from "./grid.ts";

type StudioStroke = {
  baseline: StudioGrid;
  changedCells: number;
};

export type StudioDocumentState = {
  grid: StudioGrid;
  past: StudioGrid[];
  future: StudioGrid[];
  stroke: StudioStroke | null;
  isPristine: boolean;
};

export type StudioDocumentAction =
  | {
      type: "hydrate";
      grid: StudioGrid;
    }
  | {
      type: "begin-stroke";
      row: number;
      column: number;
      color: StudioCell;
    }
  | {
      type: "update-stroke";
      row: number;
      column: number;
      color: StudioCell;
    }
  | { type: "commit-stroke" }
  | { type: "cancel-stroke" }
  | { type: "clear" }
  | {
      type: "recolor";
      from: string;
      to: string;
    }
  | {
      type: "load";
      grid: StudioGrid;
    }
  | {
      type: "affix";
      grid: StudioGrid;
    }
  | { type: "undo" }
  | { type: "redo" };

function tryCloneMatchingGrid(
  state: StudioDocumentState,
  grid: StudioGrid,
): StudioGrid | null {
  try {
    return sameGridSize(state.grid, grid) ? cloneGrid(grid) : null;
  } catch {
    return null;
  }
}

function isValidCoordinate(
  grid: StudioGrid,
  row: number,
  column: number,
): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(column) &&
    row >= 0 &&
    row < grid.length &&
    column >= 0 &&
    column < grid[row].length
  );
}

function paintCell(
  grid: StudioGrid,
  row: number,
  column: number,
  color: StudioCell,
): StudioGrid {
  if (!isValidCoordinate(grid, row, column) || grid[row][column] === color) {
    return grid;
  }

  const nextGrid = [...grid];
  nextGrid[row] = [...grid[row]];
  nextGrid[row][column] = color;
  return nextGrid;
}

function committedGrid(state: StudioDocumentState): StudioGrid {
  return state.stroke?.baseline ?? state.grid;
}

function commitAtomicEdit(
  state: StudioDocumentState,
  nextGrid: StudioGrid,
): StudioDocumentState {
  const baseline = committedGrid(state);
  if (baseline === nextGrid || gridsEqual(baseline, nextGrid)) {
    return state.stroke === null
      ? state
      : { ...state, grid: baseline, stroke: null };
  }

  return {
    grid: nextGrid,
    past: [...state.past, baseline],
    future: [],
    stroke: null,
    isPristine: false,
  };
}

function beginStroke(
  state: StudioDocumentState,
  row: number,
  column: number,
  color: StudioCell,
): StudioDocumentState {
  if (!isValidCoordinate(state.grid, row, column)) return state;

  let nextState = state;
  if (state.stroke !== null) {
    nextState = state.stroke.changedCells > 0
      ? {
          grid: state.grid,
          past: [...state.past, state.stroke.baseline],
          future: [],
          stroke: null,
          isPristine: false,
        }
      : { ...state, grid: state.stroke.baseline, stroke: null };
  }

  const baseline = nextState.grid;
  const grid = paintCell(baseline, row, column, color);
  return {
    ...nextState,
    grid,
    stroke: {
      baseline,
      changedCells: grid === baseline ? 0 : 1,
    },
  };
}

function updateStroke(
  state: StudioDocumentState,
  row: number,
  column: number,
  color: StudioCell,
): StudioDocumentState {
  if (state.stroke === null || !isValidCoordinate(state.grid, row, column)) {
    return state;
  }

  const previousColor = state.grid[row][column];
  const baselineColor = state.stroke.baseline[row][column];
  const grid = paintCell(state.grid, row, column, color);
  if (grid === state.grid) return state;

  const wasChanged = previousColor !== baselineColor;
  const isChanged = color !== baselineColor;
  let { changedCells } = state.stroke;
  if (wasChanged !== isChanged) changedCells += isChanged ? 1 : -1;
  return {
    ...state,
    grid,
    stroke: {
      ...state.stroke,
      changedCells,
    },
  };
}

function commitStroke(state: StudioDocumentState): StudioDocumentState {
  if (state.stroke === null) return state;
  if (state.stroke.changedCells === 0) {
    return { ...state, grid: state.stroke.baseline, stroke: null };
  }

  return {
    grid: state.grid,
    past: [...state.past, state.stroke.baseline],
    future: [],
    stroke: null,
    isPristine: false,
  };
}

function cancelStroke(state: StudioDocumentState): StudioDocumentState {
  if (state.stroke === null) return state;
  return { ...state, grid: state.stroke.baseline, stroke: null };
}

export function createStudioDocument(
  initialGrid: StudioGrid,
): StudioDocumentState {
  return {
    grid: cloneGrid(initialGrid),
    past: [],
    future: [],
    stroke: null,
    isPristine: true,
  };
}

export function canUndo(state: StudioDocumentState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: StudioDocumentState): boolean {
  return state.future.length > 0;
}

export function studioDocumentReducer(
  state: StudioDocumentState,
  action: StudioDocumentAction,
): StudioDocumentState {
  switch (action.type) {
    case "hydrate": {
      if (!state.isPristine || state.stroke !== null) return state;
      const grid = tryCloneMatchingGrid(state, action.grid);
      if (grid === null) return state;
      return { ...state, grid };
    }
    case "begin-stroke":
      return beginStroke(state, action.row, action.column, action.color);
    case "update-stroke":
      return updateStroke(state, action.row, action.column, action.color);
    case "commit-stroke":
      return commitStroke(state);
    case "cancel-stroke":
      return cancelStroke(state);
    case "clear":
      return commitAtomicEdit(state, createGrid(getGridSize(state.grid)));
    case "recolor": {
      const baseline = committedGrid(state);
      if (action.from === action.to) {
        return commitAtomicEdit(state, baseline);
      }
      let changed = false;
      const grid = baseline.map((row) =>
        row.map((color) => {
          if (color !== action.from) return color;
          changed = true;
          return action.to;
        }),
      );
      return commitAtomicEdit(state, changed ? grid : baseline);
    }
    case "load": {
      const grid = tryCloneMatchingGrid(state, action.grid);
      return grid === null ? state : commitAtomicEdit(state, grid);
    }
    case "affix": {
      try {
        const grid = mergeGrids(committedGrid(state), action.grid);
        return commitAtomicEdit(state, grid);
      } catch {
        return state;
      }
    }
    case "undo": {
      if (state.stroke !== null) return cancelStroke(state);
      const grid = state.past.at(-1);
      if (grid === undefined) return state;
      return {
        ...state,
        grid,
        past: state.past.slice(0, -1),
        future: [state.grid, ...state.future],
      };
    }
    case "redo": {
      if (state.stroke !== null) return cancelStroke(state);
      const [grid, ...future] = state.future;
      if (grid === undefined) return state;
      return {
        ...state,
        grid,
        past: [...state.past, state.grid],
        future,
      };
    }
    default:
      action satisfies never;
      return state;
  }
}
