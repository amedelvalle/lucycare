import { useEffect } from 'react';
import BookingCard from './BookingCard';
import type { DoctorService } from '../../../types/directory.types';

/**
 * Bottom sheet móvil de reserva: shell visual que monta el flujo REAL de
 * reserva (`BookingCard` — servicios reales, slots reales, createBooking).
 *
 * Reemplaza al scaffold legacy que generaba horarios falsos en el cliente y
 * "confirmaba" reservas contra un PaymentModal mock sin crear la cita.
 *
 * Nota: el contenedor NO usa transform — un ancestro con transform crea
 * containing block para los descendientes `position: fixed` (LoginModal /
 * WaitlistModal del BookingCard quedarían atrapados dentro del sheet).
 */
interface MobileBookingSheetProps {
  isOpen: boolean;
  onClose: () => void;
  doctorId: string;
  doctorName: string;
  consultationFee: number;
  phone: string;
  canBook: boolean;
  lucyStatus: string;
  services?: DoctorService[];
  clinicId?: string;
}

export default function MobileBookingSheet({
  isOpen,
  onClose,
  doctorId,
  doctorName,
  consultationFee,
  phone,
  canBook,
  lucyStatus,
  services,
  clinicId,
}: MobileBookingSheetProps) {
  // Cerrar con ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Prevenir scroll del body cuando está abierto
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-50 lg:hidden"
        onClick={onClose}
      />

      {/* Bottom Sheet */}
      <div
        className="fixed inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl z-50 lg:hidden"
        style={{ maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-semibold text-gray-900">Reservar cita</h2>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
        </div>

        {/* Contenido con scroll — flujo real de reserva */}
        <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(85vh - 60px)' }}>
          <BookingCard
            doctorId={doctorId}
            doctorName={doctorName}
            consultationFee={consultationFee}
            phone={phone}
            canBook={canBook}
            lucyStatus={lucyStatus}
            services={services}
            clinicId={clinicId}
          />
        </div>
      </div>
    </>
  );
}
