/**
 * Controles de paginación para listas largas.
 *
 * Uso:
 *   <Pagination
 *     page={page}
 *     pageSize={50}
 *     total={total}
 *     onPageChange={setPage}
 *   />
 */
interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Etiqueta singular/plural para el label "X resultados" */
  itemLabel?: { singular: string; plural: string };
}

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  itemLabel = { singular: 'resultado', plural: 'resultados' },
}: PaginationProps) {
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;

  return (
    <nav className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-gray-200 flex-wrap">
      <p className="text-xs text-gray-600">
        Mostrando <span className="font-medium text-gray-900">{from}</span>–
        <span className="font-medium text-gray-900">{to}</span> de{' '}
        <span className="font-medium text-gray-900">{total}</span>{' '}
        {total === 1 ? itemLabel.singular : itemLabel.plural}
        {totalPages > 1 && (
          <span className="text-gray-400">
            {' '}
            · Página <span className="font-medium text-gray-700">{safePage}</span> de {totalPages}
          </span>
        )}
      </p>

      <div className="flex items-center gap-1">
        <PageButton
          disabled={!canPrev}
          onClick={() => onPageChange(1)}
          ariaLabel="Primera página"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </PageButton>
        <PageButton
          disabled={!canPrev}
          onClick={() => onPageChange(safePage - 1)}
          ariaLabel="Anterior"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="ml-1 hidden sm:inline">Anterior</span>
        </PageButton>
        <PageButton
          disabled={!canNext}
          onClick={() => onPageChange(safePage + 1)}
          ariaLabel="Siguiente"
        >
          <span className="mr-1 hidden sm:inline">Siguiente</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </PageButton>
        <PageButton
          disabled={!canNext}
          onClick={() => onPageChange(totalPages)}
          ariaLabel="Última página"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </PageButton>
      </div>
    </nav>
  );
}

function PageButton({
  disabled,
  onClick,
  children,
  ariaLabel,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}
