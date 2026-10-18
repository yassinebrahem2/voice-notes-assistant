export interface TabFilters {
  search: string;
  tagIds: string[];
  scrollOffset: number;
}

const defaultFilters: TabFilters = {
  search: '',
  tagIds: [],
  scrollOffset: 0,
};

const store: Record<'meeting' | 'note', TabFilters> = {
  meeting: { ...defaultFilters },
  note: { ...defaultFilters },
};

export function getTabFilters(kind: 'meeting' | 'note'): TabFilters {
  return { ...store[kind] };
}

export function setTabFilters(
  kind: 'meeting' | 'note',
  filters: Partial<TabFilters>,
): void {
  store[kind] = {
    ...store[kind],
    ...filters,
  };
}

export function resetTabFilters(kind: 'meeting' | 'note'): void {
  store[kind] = { search: '', tagIds: [], scrollOffset: 0 };
}
