import { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import Fuse from 'fuse.js';
import type { Ticket } from '../../../data/types';

export function useInboxSearch(filteredTickets: Ticket[]) {
  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterChannel, setFilterChannel] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Categorical filters (AND logic, applied before fuzzy search)
  const categoryFiltered = useMemo(() => filteredTickets.filter(t => {
    if (filterCompany && (t.companyName || t.host.name) !== filterCompany) return false;
    if (filterChannel && t.channel !== filterChannel) return false;
    return true;
  }), [filteredTickets, filterCompany, filterChannel]);

  // Fuse.js fuzzy search on the filtered set
  const fuse = useMemo(() => new Fuse(categoryFiltered, {
    keys: [
      { name: 'guestName', weight: 0.6 },
      { name: 'bookingId', weight: 0.3 },
      { name: 'summary', weight: 0.1 },
    ],
    threshold: 0.3,
    ignoreLocation: true,
  }), [categoryFiltered]);

  const searchedTickets = deferredQuery.trim()
    ? fuse.search(deferredQuery).map(r => r.item)
    : categoryFiltered;

  const isSearchActive = Boolean(deferredQuery.trim() || filterCompany || filterChannel);

  // Unique values for filter dropdowns
  const uniqueCompanies = useMemo(() => [...new Set(filteredTickets.map(t => t.companyName || t.host.name).filter(Boolean))], [filteredTickets]);
  const uniqueChannels = useMemo(() => [...new Set(filteredTickets.map(t => t.channel).filter(Boolean))], [filteredTickets]);

  // "/" keyboard shortcut to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return {
    searchQuery, setSearchQuery, deferredQuery,
    searchInputRef,
    filterCompany, setFilterCompany,
    filterChannel, setFilterChannel,
    showFilters, setShowFilters,
    searchedTickets,
    isSearchActive,
    uniqueCompanies, uniqueChannels,
  };
}
