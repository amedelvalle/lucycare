import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Al cambiar de ruta, lleva la vista al inicio. Resuelve el scroll
 * restoration: abrir /doctor/:id (u otra ruta) ya no conserva la
 * posición de scroll anterior. Funciona en mobile y desktop.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
