import { getTabFilters, resetTabFilters, setTabFilters } from './filters';

describe('filters store', () => {
  beforeEach(() => {
    resetTabFilters('meeting');
    resetTabFilters('note');
  });

  test('returns initial default filters for both tabs', () => {
    expect(getTabFilters('meeting')).toEqual({
      search: '',
      tagIds: [],
      scrollOffset: 0,
    });
    expect(getTabFilters('note')).toEqual({
      search: '',
      tagIds: [],
      scrollOffset: 0,
    });
  });

  test('stores and retrieves tab filters independently (round-trip per tab)', () => {
    setTabFilters('meeting', {
      search: 'standup',
      tagIds: ['tag-1', 'tag-2'],
      scrollOffset: 120,
    });

    expect(getTabFilters('meeting')).toEqual({
      search: 'standup',
      tagIds: ['tag-1', 'tag-2'],
      scrollOffset: 120,
    });
    expect(getTabFilters('note')).toEqual({
      search: '',
      tagIds: [],
      scrollOffset: 0,
    });

    setTabFilters('note', {
      search: 'groceries',
      tagIds: ['tag-3'],
      scrollOffset: 45,
    });

    expect(getTabFilters('meeting')).toEqual({
      search: 'standup',
      tagIds: ['tag-1', 'tag-2'],
      scrollOffset: 120,
    });
    expect(getTabFilters('note')).toEqual({
      search: 'groceries',
      tagIds: ['tag-3'],
      scrollOffset: 45,
    });
  });

  test('supports partial updates preserving previous fields', () => {
    setTabFilters('meeting', {
      search: 'initial',
      tagIds: ['tag-1'],
      scrollOffset: 200,
    });

    setTabFilters('meeting', { search: 'updated' });

    expect(getTabFilters('meeting')).toEqual({
      search: 'updated',
      tagIds: ['tag-1'],
      scrollOffset: 200,
    });
  });

  test('resets filters back to defaults', () => {
    setTabFilters('meeting', {
      search: 'test',
      tagIds: ['1'],
      scrollOffset: 50,
    });
    resetTabFilters('meeting');
    expect(getTabFilters('meeting')).toEqual({
      search: '',
      tagIds: [],
      scrollOffset: 0,
    });
  });
});
