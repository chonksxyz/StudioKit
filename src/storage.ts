export type StudioStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type StudioDesignStoreOptions<Design> = {
  storage: StudioStorage;
  key: string;
  legacyKeys?: readonly string[];
  normalize: (value: unknown) => Design | null;
  isEqual?: (left: Design, right: Design) => boolean;
};

export type StudioDesignStore<Design> = {
  load: () => Design[];
  save: (design: Design) => Design[];
  remove: (index: number) => Design[];
};

function defaultIsEqual<Design>(left: Design, right: Design): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createDesignStore<Design>({
  storage,
  key,
  legacyKeys = [],
  normalize,
  isEqual = defaultIsEqual,
}: StudioDesignStoreOptions<Design>): StudioDesignStore<Design> {
  const parse = (value: string): Design[] | null => {
    try {
      const parsed: unknown = JSON.parse(value);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      return candidates.flatMap((candidate) => {
        const design = normalize(candidate);
        return design === null ? [] : [design];
      });
    } catch {
      return null;
    }
  };

  const write = (designs: Design[]): void => {
    storage.setItem(key, JSON.stringify(designs));
  };

  const load = (): Design[] => {
    const current = storage.getItem(key);
    if (current !== null) return parse(current) ?? [];

    for (const legacyKey of legacyKeys) {
      const legacy = storage.getItem(legacyKey);
      if (legacy === null) continue;

      const migrated = parse(legacy);
      if (migrated === null) return [];
      write(migrated);
      return migrated;
    }
    return [];
  };

  return {
    load,
    save: (design) => {
      const normalized = normalize(design);
      if (normalized === null) {
        throw new Error("Cannot save an invalid Studio design");
      }

      const designs = load();
      if (designs.some((saved) => isEqual(saved, normalized))) {
        return designs;
      }

      const updatedDesigns = [normalized, ...designs];
      write(updatedDesigns);
      return updatedDesigns;
    },
    remove: (index) => {
      const designs = load();
      if (!Number.isInteger(index) || index < 0 || index >= designs.length) {
        return designs;
      }

      const updatedDesigns = designs.filter(
        (_design, designIndex) => designIndex !== index,
      );
      write(updatedDesigns);
      return updatedDesigns;
    },
  };
}
