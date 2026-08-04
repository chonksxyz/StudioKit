import {
  addSelectionCell,
  bindStudioInput,
  canRedo,
  canUndo,
  clearSelection,
  createGrid,
  createSelection,
  createStudioDocument,
  getFloatingSelection,
  isSelectionContiguous,
  removeSelectionCell,
  saveStudioGridImage,
  selectionHas,
  selectionOutline,
  selectionRegions,
  selectionWithinGrid,
  studioDocumentReducer,
  toggleSelectionCell,
} from "/studio/index.js";

const SIZE = { rows: 30, columns: 30 };
const PALETTE = [
  { name: "Red", color: "#e5352b" },
  { name: "Green", color: "#2fa84f" },
  { name: "Blue", color: "#2b6de5" },
  { name: "White", color: "#f5f7fa" },
  { name: "Black", color: "#101216" },
  { name: "Orange", color: "#f08a24" },
];

// --- State -----------------------------------------------------------------
// The document owns the pixels and the in-flight move; this app owns the tool,
// the swatch, and which cells are selected.
let state = createStudioDocument(createGrid(SIZE));
let selection = createSelection();
let tool = "draw";
let selectedColor = PALETTE[0].color;
let previousTool = "draw";
let dragRemoves = false;

const gridElement = document.querySelector("#grid");
const paletteElement = document.querySelector("#palette");
const statusElement = document.querySelector("#selection-status");
const toolButtons = [...document.querySelectorAll("[data-tool]")];

function dispatch(action) {
  const next = studioDocumentReducer(state, action);
  if (next === state) return;
  state = next;
  render();
}

// --- Cells -----------------------------------------------------------------
const cells = [];
for (let row = 0; row < SIZE.rows; row += 1) {
  for (let column = 0; column < SIZE.columns; column += 1) {
    const element = document.createElement("div");
    element.className = "cell";
    element.dataset.row = String(row);
    element.dataset.col = String(column);
    gridElement.append(element);
    cells.push(element);
  }
}

const cellAt = (row, column) => cells[row * SIZE.columns + column];
const cellKey = (row, column) => row * SIZE.columns + column;

// --- Swatches --------------------------------------------------------------
for (const [index, { name, color }] of PALETTE.entries()) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "swatch";
  button.style.background = color;
  button.title = `${name} (${index + 1})`;
  button.setAttribute("aria-label", name);
  button.dataset.color = color;
  button.addEventListener("click", () => selectColor(color));
  paletteElement.append(button);
}

function selectColor(color) {
  selectedColor = color;
  if (tool === "erase") setTool("draw");
  // With cells selected, picking a swatch recolors them. The selection stays,
  // so trying a few colors in a row is one click each.
  if (selection.length > 0) {
    dispatch({ type: "fill-selection", selection, color });
  }
  render();
}

function setTool(next) {
  if (tool !== "pick") previousTool = tool;
  tool = next;
  // An opening "overlay" (our sampler) has to cancel any in-flight gesture.
  binding.syncPolicy();
  render();
}

// --- Rendering -------------------------------------------------------------
const EDGE_SHADOWS = {
  top: "inset 0 2px 0 0 var(--marquee)",
  right: "inset -2px 0 0 0 var(--marquee)",
  bottom: "inset 0 -2px 0 0 var(--marquee)",
  left: "inset 2px 0 0 0 var(--marquee)",
};

function render() {
  // While a move is in flight the document knows where the cells are now;
  // otherwise the outline follows what the user has picked.
  const floating = getFloatingSelection(state);
  const live = selectionWithinGrid(floating ?? selection, SIZE);
  const selected = new Set(live.map(({ row, column }) => cellKey(row, column)));

  const shadows = new Map();
  for (const { row, column, side } of selectionOutline(live)) {
    const key = cellKey(row, column);
    shadows.set(key, [...(shadows.get(key) ?? []), EDGE_SHADOWS[side]]);
  }

  for (let row = 0; row < SIZE.rows; row += 1) {
    for (let column = 0; column < SIZE.columns; column += 1) {
      const key = cellKey(row, column);
      const element = cells[key];
      const background = state.grid[row][column] ?? "transparent";
      if (element.style.background !== background) {
        element.style.background = background;
      }

      const isSelected = selected.has(key);
      const className = isSelected
        ? floating
          ? "cell selected floating"
          : "cell selected"
        : "cell";
      if (element.className !== className) element.className = className;

      const shadow = (shadows.get(key) ?? []).join(", ");
      if (element.style.boxShadow !== shadow) element.style.boxShadow = shadow;
    }
  }

  renderChrome(floating);
}

function renderChrome(floating) {
  for (const button of toolButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
  }
  for (const swatch of paletteElement.children) {
    swatch.setAttribute(
      "aria-pressed",
      String(swatch.dataset.color === selectedColor),
    );
  }

  document.querySelector("#undo").disabled = !canUndo(state);
  document.querySelector("#redo").disabled = !canRedo(state);
  document.querySelector("#apply").disabled = state.float === null;
  document.querySelector("#delete").disabled = selection.length === 0;
  document.querySelector("#cancel").disabled =
    state.float === null && selection.length === 0;

  statusElement.textContent = describeSelection(floating);
}

function describeSelection(floating) {
  const cellsChosen = floating ?? selection;
  if (cellsChosen.length === 0) {
    return "Shift-click a painted cell to start a selection.";
  }

  const shape = isSelectionContiguous(cellsChosen)
    ? "one contiguous shape"
    : `${selectionRegions(cellsChosen).length} separate pieces`;
  const count = cellsChosen.length === 1 ? "1 cell" : `${cellsChosen.length} cells`;
  const parts = [`${count} · ${shape}`];
  if (floating) {
    const { row, column } = state.float.offset;
    parts.push(`moved ${row >= 0 ? "+" : ""}${row}, ${column >= 0 ? "+" : ""}${column}`);
    const dropped =
      floating.length - selectionWithinGrid(floating, SIZE).length;
    if (dropped > 0) parts.push(`${dropped} off-canvas (deleted on apply)`);
  }
  return parts.join(" · ");
}

// --- Selection actions -----------------------------------------------------
// Only painted cells can be selected — shift-clicking bare canvas does nothing.
const isPainted = (row, column) => state.grid[row][column] !== null;

// Dropping the cells writes them and ends the selection. Keeping it alive would
// make the very next drag over those pixels move them again instead of drawing.
function applySelection() {
  if (state.float === null) return;
  dispatch({ type: "commit-selection" });
  selection = createSelection();
  render();
}

// Delete empties the selected cells wherever they currently sit — one undo
// entry — and drops the selection with them.
function deleteSelection() {
  if (selection.length === 0) return;
  // Put a move back first, so the pixels are deleted from where they started
  // rather than leaving a copy behind.
  if (state.float !== null) dispatch({ type: "cancel-selection" });
  dispatch({ type: "load", grid: clearSelection(state.grid, selection) });
  selection = createSelection();
  render();
}

function cancelSelection() {
  dispatch({ type: "cancel-selection" });
  selection = createSelection();
  render();
}

// --- Input -----------------------------------------------------------------
const binding = bindStudioInput({
  grid: gridElement,
  rows: SIZE.rows,
  columns: SIZE.columns,
  getPolicy: () => ({
    // The sampler is modelled as an overlay: Studio stays out of the way and
    // this app's own pointerdown listener reads the color underneath.
    overlay: tool === "pick" ? "picker" : "none",
    mode: tool === "select" ? "select" : tool === "erase" ? "erase" : "draw",
    selectedColor,
    isSelected: (row, column) => selectionHas(selection, row, column),
    hasSelection: selection.length > 0,
    // Shift selects instead of erasing, in every tool.
    shiftSelects: true,
  }),
  actions: {
    beginStroke: (row, column, color) => {
      // Drawing lands any selection that is still in flight and clears it —
      // painting elsewhere means the user is done with those cells.
      applySelection();
      if (selection.length > 0) {
        selection = createSelection();
        render();
      }
      dispatch({ type: "begin-stroke", row, column, color });
    },
    updateStroke: (row, column, color) =>
      dispatch({ type: "update-stroke", row, column, color }),
    commitStroke: () => dispatch({ type: "commit-stroke" }),
    cancelStroke: () => dispatch({ type: "cancel-stroke" }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    selection: {
      beginSelect: (row, column, additive) => {
        // Starting a new selection lands whatever was still in flight.
        applySelection();
        dragRemoves = additive && selectionHas(selection, row, column);
        if (dragRemoves) {
          selection = removeSelectionCell(selection, row, column);
        } else if (!isPainted(row, column)) {
          if (!additive) selection = createSelection();
        } else {
          selection = additive
            ? toggleSelectionCell(selection, row, column)
            : createSelection([{ row, column }]);
        }
        render();
      },
      // Sweeping continues whatever the gesture started as, so a shift-drag
      // across selected cells removes the run instead of flickering it.
      extendSelect: (row, column) => {
        if (dragRemoves) {
          selection = removeSelectionCell(selection, row, column);
        } else if (isPainted(row, column)) {
          selection = addSelectionCell(selection, row, column);
        }
        render();
      },
      endSelect: () => render(),
      beginMove: () => dispatch({ type: "lift-selection", selection }),
      moveTo: (rowOffset, columnOffset) =>
        dispatch({ type: "place-selection", rowOffset, columnOffset }),
      // Dropping commits: no confirmation step for the common gesture.
      endMove: () => applySelection(),
      // Passing the selection lifts on the first nudge, so the arrow keys work
      // without a drag first.
      nudge: (rowDelta, columnDelta) =>
        dispatch({ type: "move-selection", rowDelta, columnDelta, selection }),
      commit: applySelection,
      cancel: cancelSelection,
      delete: deleteSelection,
    },
  },
  shortcuts: [
    ...["draw", "erase", "select", "pick"].map((name, index) => ({
      key: ["d", "e", "v", "i"][index],
      overlays: ["none", "picker"],
      run: () => setTool(name),
    })),
    ...PALETTE.map(({ color }, index) => ({
      key: String(index + 1),
      overlays: ["none", "picker"],
      run: () => selectColor(color),
    })),
    {
      key: "s",
      overlays: ["none", "picker"],
      preventDefault: true,
      run: () => saveStudioGridImage(state.grid, { scale: 16, fileName: "studio.png" }),
    },
  ],
});

// The sampler: pick the color under the pointer, then hand back the last tool.
gridElement.addEventListener("pointerdown", (event) => {
  if (tool !== "pick" || event.button !== 0) return;
  const cell = event.target.closest?.("[data-row][data-col]");
  if (!cell) return;
  const color = state.grid[Number(cell.dataset.row)][Number(cell.dataset.col)];
  if (color !== null) selectedColor = color;
  setTool(previousTool === "pick" ? "draw" : previousTool);
});

for (const button of toolButtons) {
  button.addEventListener("click", () => setTool(button.dataset.tool));
}
document.querySelector("#undo").addEventListener("click", () => dispatch({ type: "undo" }));
document.querySelector("#redo").addEventListener("click", () => dispatch({ type: "redo" }));
document.querySelector("#clear").addEventListener("click", () => {
  selection = createSelection();
  dispatch({ type: "clear" });
  render();
});
document.querySelector("#save").addEventListener("click", () =>
  saveStudioGridImage(state.grid, { scale: 16, fileName: "studio.png" }),
);
document.querySelector("#apply").addEventListener("click", applySelection);
document.querySelector("#delete").addEventListener("click", deleteSelection);
document.querySelector("#cancel").addEventListener("click", cancelSelection);

render();
