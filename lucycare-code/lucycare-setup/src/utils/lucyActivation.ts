/**
 * Utilidades para gestionar la activación de Lucy en doctores
 */

export interface LucyActivationPayload {
  doctorId: number;
  lucyStatus: 'BOOKING_ENABLED';
  bookingEnabled: true;
  nextAvailableSlot: string;
}

/**
 * Verifica si un doctor está activado en localStorage
 */
export const isActivatedInLocalStorage = (doctorId: number): boolean => {
  try {
    const activatedDoctors = JSON.parse(localStorage.getItem('lucyActivatedDoctors') || '[]');
    return activatedDoctors.includes(doctorId);
  } catch (e) {
    return false;
  }
};

/**
 * Guarda un doctor como activado en localStorage
 */
export const saveActivatedDoctor = (doctorId: number): void => {
  try {
    const activatedDoctors = JSON.parse(localStorage.getItem('lucyActivatedDoctors') || '[]');
    if (!activatedDoctors.includes(doctorId)) {
      activatedDoctors.push(doctorId);
      localStorage.setItem('lucyActivatedDoctors', JSON.stringify(activatedDoctors));
    }
  } catch (e) {
    console.error('Error al guardar doctor activado:', e);
  }
};

/**
 * Genera un próximo slot disponible (mañana a las 10:00)
 */
export const generateNextAvailableSlot = (): string => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  return tomorrow.toISOString();
};

/**
 * Obtiene todos los doctores activados
 */
export const getActivatedDoctors = (): number[] => {
  try {
    return JSON.parse(localStorage.getItem('lucyActivatedDoctors') || '[]');
  } catch (e) {
    return [];
  }
};
