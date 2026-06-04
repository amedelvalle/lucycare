import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  // El dropdown se renderiza en un PORTAL con posición fixed para escapar el
  // overflow del modal/accordion y cualquier stacking context que lo recorte.
  const [pos, setPos] = useState<{
    left: number; width: number; openUp: boolean; top?: number; bottom?: number; maxH: number;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);    // wrapper del input (ancla)
  const dropdownRef = useRef<HTMLDivElement>(null); // el menú portaleado

  const updatePos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxH = Math.min(256, Math.max(openUp ? spaceAbove : spaceBelow, 120));
    setPos(openUp
      ? { left: r.left, width: r.width, openUp, bottom: window.innerHeight - r.top + 4, maxH }
      : { left: r.left, width: r.width, openUp, top: r.bottom + 4, maxH });
  }, []);

  // Posicionar al abrir + seguir scroll/resize (capture: cubre scroll del modal).
  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const onMove = () => updatePos();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, updatePos]);

  // Cerrar al click fuera (considera input + dropdown portaleado).
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || dropdownRef.current?.contains(t)) return;
      setOpen(false);
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
    <div className={className ?? ''}>
      <div ref={wrapRef} className="relative">
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

      {open && !disabled && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxH,
            ...(pos.openUp ? { bottom: pos.bottom } : { top: pos.top }),
          }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg z-[100] overflow-y-auto"
        >
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
        </div>,
        document.body
      )}
    </div>
  );
}
