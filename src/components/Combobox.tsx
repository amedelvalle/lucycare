import { useEffect, useRef, useState } from 'react';

/**
 * Combobox reusable: input con dropdown de búsqueda + opción "Crear nuevo".
 *
 * Uso típico:
 *   - El consumidor maneja `searchValue` y `items` (debounced query).
 *   - `onSelect(item)` cuando el usuario elige uno existente.
 *   - `onCreate(name)` cuando elige "Crear nuevo: 'X'" — opcional.
 */
interface ComboboxProps<T> {
  items: T[];
  searchValue: string;
  onSearch: (value: string) => void;
  onSelect: (item: T) => void;
  onCreate?: (name: string) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSubLabel?: (item: T) => string | null;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  /** Texto que aparece al hover/abajo cuando es opción de crear */
  createLabel?: (input: string) => string;
  className?: string;
}

export default function Combobox<T>({
  items,
  searchValue,
  onSearch,
  onSelect,
  onCreate,
  getKey,
  getLabel,
  getSubLabel,
  placeholder,
  disabled,
  isLoading,
  createLabel,
  className,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const trimmed = searchValue.trim();
  const exactMatch = items.some(
    (it) => getLabel(it).trim().toLowerCase() === trimmed.toLowerCase()
  );
  const showCreate = onCreate && trimmed.length >= 2 && !exactMatch && !isLoading;

  const handleSelect = (item: T) => {
    onSelect(item);
    setOpen(false);
    onSearch('');
  };

  const handleCreate = () => {
    if (!onCreate || !trimmed) return;
    onCreate(trimmed);
    setOpen(false);
    onSearch('');
  };

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={searchValue}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onSearch(e.target.value);
            setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-800 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
        />
      </div>

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 max-h-64 overflow-y-auto">
          {isLoading ? (
            <p className="px-3 py-2 text-xs text-gray-400">Buscando...</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">
              {trimmed.length === 0 ? 'Empezá a escribir para buscar' : 'Sin resultados'}
            </p>
          ) : (
            <ul>
              {items.map((it) => {
                const sub = getSubLabel?.(it);
                return (
                  <li key={getKey(it)}>
                    <button
                      type="button"
                      onClick={() => handleSelect(it)}
                      className="w-full text-left px-3 py-2 hover:bg-emerald-50/50 border-b border-gray-50 last:border-b-0"
                    >
                      <p className="text-sm text-gray-900">{getLabel(it)}</p>
                      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {showCreate && (
            <button
              type="button"
              onClick={handleCreate}
              className="w-full text-left px-3 py-2 bg-emerald-50/40 hover:bg-emerald-100/40 border-t border-emerald-100 flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <p className="text-sm text-emerald-700">
                {createLabel ? createLabel(trimmed) : `Crear nuevo: "${trimmed}"`}
              </p>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
