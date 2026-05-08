import { forwardRef } from 'react';

/**
 * Botón estándar del sistema. Ver CLAUDE.md → "Sistema de diseño" para
 * cuándo usar cada variant.
 *
 * Uso:
 *   <Button variant="primary" size="md" onClick={...}>Guardar</Button>
 *   <Button variant="subtle" leftIcon={<Icon />}>Crear nuevo</Button>
 *   <Button variant="danger" loading={isDeleting}>Eliminar</Button>
 */

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white',
  secondary: 'bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700',
  subtle:
    'bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 border border-emerald-200',
  danger: 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2 text-sm gap-2 rounded-xl',
  lg: 'px-5 py-2.5 text-sm font-semibold gap-2 rounded-xl',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    leftIcon,
    rightIcon,
    fullWidth,
    disabled,
    children,
    className = '',
    type = 'button',
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center font-medium transition-colors
        focus:outline-none focus:ring-2 focus:ring-emerald-200
        disabled:opacity-50 disabled:cursor-not-allowed
        ${VARIANT_CLASSES[variant]}
        ${SIZE_CLASSES[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `.trim()}
      {...rest}
    >
      {loading ? (
        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export default Button;
