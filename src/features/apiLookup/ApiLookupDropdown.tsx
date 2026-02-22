import { useState, useEffect, useRef, useCallback } from 'react';
import { API_REGISTRY, filterApis } from './apiRegistry';
import type { ApiDefinition } from './apiRegistry';

interface ApiLookupDropdownProps {
  position: { x: number; y: number };
  onSelect: (api: ApiDefinition) => void;
  onClose: () => void;
}

export function ApiLookupDropdown({ position, onSelect, onClose }: ApiLookupDropdownProps) {
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = filterApis(query);

  // Group by category
  const grouped = new Map<string, ApiDefinition[]>();
  for (const api of filtered) {
    const list = grouped.get(api.category) ?? [];
    list.push(api);
    grouped.set(api.category, list);
  }
  // Flat list for keyboard navigation
  const flatList = filtered;

  // Focus search on mount
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  // Click-outside and Escape to close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onClose]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((prev) => Math.min(prev + 1, flatList.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flatList[highlightIdx]) {
          onSelect(flatList[highlightIdx]);
        }
      }
    },
    [flatList, highlightIdx, onSelect],
  );

  // Determine positioning: keep dropdown on screen
  const dropdownStyle: React.CSSProperties = {
    left: position.x,
    top: position.y,
  };

  return (
    <div ref={ref} className="api-lookup-dropdown" style={dropdownStyle}>
      <input
        ref={searchRef}
        className="api-lookup-search"
        placeholder="Search APIs..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="api-lookup-list">
        {flatList.length === 0 && (
          <div className="api-lookup-empty">No APIs match</div>
        )}
        {Array.from(grouped.entries()).map(([category, apis]) => (
          <div key={category}>
            <div className="api-lookup-category">{category}</div>
            {apis.map((api) => {
              const idx = flatList.indexOf(api);
              return (
                <div
                  key={api.id}
                  className={`api-lookup-item ${idx === highlightIdx ? 'highlighted' : ''}`}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onClick={() => onSelect(api)}
                >
                  <span className="api-lookup-item-icon">{api.icon}</span>
                  <div className="api-lookup-item-info">
                    <div className="api-lookup-item-name">{api.name}</div>
                    <div className="api-lookup-item-desc">{api.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
