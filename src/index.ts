export {
  cellIndex,
  cellsEqual,
  cloneGrid,
  createGrid,
  getCell,
  getGridSize,
  gridFromRows,
  gridsEqual,
  gridToRows,
  mergeGrids,
  sameGridSize,
  setCell,
  type ReadonlyStudioGrid,
  type StudioCell,
  type StudioGrid,
  type StudioGridSize,
} from "./grid.ts";

export {
  StudioDocument,
  type StudioDocumentAction,
  type StudioFloatingSelection,
} from "./document.ts";

export {
  addSelectionCell,
  clearSelection,
  createSelection,
  fillSelection,
  isSelectionContiguous,
  readSelection,
  removeSelectionCell,
  selectionBounds,
  selectionHas,
  selectionOutline,
  selectionRectangle,
  selectionRegions,
  selectionWithinGrid,
  stampSelection,
  toggleSelectionCell,
  translateSelection,
  type StudioSelection,
  type StudioSelectionBounds,
  type StudioSelectionCell,
  type StudioSelectionContent,
  type StudioSelectionEdge,
  type StudioSelectionOffset,
  type StudioSelectionSide,
} from "./selection.ts";

export {
  bindStudioInput,
  type BindStudioInputOptions,
  type StudioInputActions,
  type StudioInputBinding,
  type StudioInputPolicy,
  type StudioSelectionInputActions,
  type StudioShortcut,
} from "./input.ts";

export {
  drawStudioGrid,
  saveStudioGridImage,
  studioGridToDataUrl,
  type StudioFillContext,
  type StudioImageEncodingOptions,
  type StudioImageOptions,
} from "./image.ts";

export {
  createDesignStore,
  type StudioDesignStore,
  type StudioDesignStoreOptions,
  type StudioStorage,
} from "./storage.ts";
