import { useState, useEffect, useRef, useCallback } from 'react';
import { filterApis } from './apiRegistry';
import type { ApiDefinition } from './apiRegistry';

const CATEGORIES = ['All', 'Data', 'Reference', 'Transform', 'AI'] as const;
type Category = (typeof CATEGORIES)[number];

interface ApiLookupDropdownProps {
  position: { x: number; y: number };
  onSelect: (api: ApiDefinition) => void;
  onClose: () => void;
}

export function ApiLookupDropdown({ position, onSelect, onClose }: ApiLookupDropdownProps) {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Category>('All');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Filter by search, then by active tab
  const searched = filterApis(query);
  const filtered = activeTab === 'All'
    ? searched
    : searched.filter((a) => a.category === activeTab);

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

  // Reset highlight when filter or tab changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [query, activeTab]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[highlightIdx]) {
          onSelect(filtered[highlightIdx]);
        }
      }
    },
    [filtered, highlightIdx, onSelect],
  );

  return (
    <div ref={ref} className="api-lookup-dropdown" style={{ left: position.x, top: position.y }}>
      <input
        ref={searchRef}
        className="api-lookup-search"
        placeholder="Search APIs..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="api-lookup-tabs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`api-lookup-tab ${activeTab === cat ? 'active' : ''}`}
            onClick={() => setActiveTab(cat)}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="api-lookup-list">
        {filtered.length === 0 && (
          <div className="api-lookup-empty">No APIs match</div>
        )}
        {filtered.map((api, idx) => (
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
        ))}
      </div>
    </div>
  );
}
