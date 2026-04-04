import { useState } from 'react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  doctorName: string;
  consultationFee: number;
  selectedDate: string;
  selectedTime: string;
  onSuccess: () => void;
}

export default function PaymentModal({ 
  isOpen,
  onClose, 
  doctorName, 
  consultationFee, 
  selectedDate, 
  selectedTime,
  onSuccess 
}: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [cardNumber, setCardNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [cvc, setCvc] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [country, setCountry] = useState('El Salvador');
  const [saveCard, setSaveCard] = useState(false);
  const [loading, setLoading] = useState(false);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // Aquí se procesará el pago cuando esté conectado Stripe
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Llamar al callback de éxito
      onSuccess();
    } catch (error) {
      alert('Error al procesar el pago. Por favor, intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Obtener nombre del paciente
  const getPatientName = () => {
    const user = localStorage.getItem('user');
    if (user) {
      try {
        const userData = JSON.parse(user);
        return userData.name || 'María Elena González';
      } catch (e) {
        return 'María Elena González';
      }
    }
    return 'María Elena González';
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
          <h2 className="text-lg font-semibold text-gray-900">
            Confirmar y pagar
          </h2>
          <div className="w-8"></div>
        </div>

        <div className="p-6">
          {/* Appointment Summary */}
          <div className="bg-gray-50 rounded-xl p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Resumen de la cita</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Médico:</span>
                <span className="text-gray-900 font-medium">{doctorName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Paciente:</span>
                <span className="text-gray-900 font-medium">{getPatientName()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Fecha:</span>
                <span className="text-gray-900 font-medium">{formatDate(selectedDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Hora:</span>
                <span className="text-gray-900 font-medium">{selectedTime}</span>
              </div>
              <div className="border-t border-gray-200 pt-3 mt-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Consulta:</span>
                  <span className="text-gray-900 font-medium">${consultationFee.toLocaleString('en-US')} USD</span>
                </div>
                <div className="flex justify-between text-lg font-semibold mt-2">
                  <span className="text-gray-900">Total:</span>
                  <span className="text-gray-900">${consultationFee.toLocaleString('en-US')} USD</span>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Form */}
          <form onSubmit={handleSubmit}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Método de pago</h3>

            {/* Payment Method Selection */}
            <div className="space-y-3 mb-6">
              <div 
                className={`border-2 rounded-xl p-4 cursor-pointer transition-colors ${
                  paymentMethod === 'card' ? 'border-[#3C2285] bg-purple-50' : 'border-gray-200'
                }`}
                onClick={() => setPaymentMethod('card')}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    paymentMethod === 'card' ? 'border-[#3C2285]' : 'border-gray-300'
                  }`}>
                    {paymentMethod === 'card' && (
                      <div className="w-2.5 h-2.5 bg-[#3C2285] rounded-full"></div>
                    )}
                  </div>
                  <i className="ri-bank-card-line text-xl"></i>
                  <span className="font-medium">Tarjeta</span>
                </div>
              </div>

              <div 
                className={`border-2 rounded-xl p-4 cursor-pointer transition-colors ${
                  paymentMethod === 'alipay' ? 'border-[#3C2285] bg-purple-50' : 'border-gray-200'
                }`}
                onClick={() => setPaymentMethod('alipay')}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    paymentMethod === 'alipay' ? 'border-[#3C2285]' : 'border-gray-300'
                  }`}>
                    {paymentMethod === 'alipay' && (
                      <div className="w-2.5 h-2.5 bg-[#3C2285] rounded-full"></div>
                    )}
                  </div>
                  <i className="ri-alipay-line text-xl text-blue-600"></i>
                  <span className="font-medium">Alipay</span>
                </div>
              </div>
            </div>

            {/* Card Form */}
            {paymentMethod === 'card' && (
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Información de la tarjeta
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      placeholder="1234 1234 1234 1234"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#3C2285] transition-colors pr-20"
                      required
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
                      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='16'%3E%3Crect width='24' height='16' rx='4' fill='%234169E1'/%3E%3Cpath d='M8.5 8a.5.5 0 01.5-.5h6a.5.5 0 010 1H9a.5.5 0 01-.5-.5z' fill='white'/%3E%3C/svg%3E" alt="Visa" className="w-6 h-4" />
                      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='16'%3E%3Crect width='24' height='16' rx='4' fill='%23EB001B'/%3E%3Ccircle cx='9' cy='8' r='4' fill='%23FF5F00'/%3E%3Ccircle cx='15' cy='8' r='4' fill='%23F79E1B'/%3E%3C/svg%3E" alt="Mastercard" className="w-6 h-4" />
                      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='16'%3E%3Crect width='24' height='16' rx='4' fill='%230066CC'/%3E%3Cpath d='M6 6h12v4H6z' fill='white'/%3E%3C/svg%3E" alt="American Express" className="w-6 h-4" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <input
                      type="text"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      placeholder="MM / AA"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#3C2285] transition-colors"
                      required
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={cvc}
                      onChange={(e) => setCvc(e.target.value)}
                      placeholder="CVC"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#3C2285] transition-colors"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre del titular de la tarjeta
                  </label>
                  <input
                    type="text"
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                    placeholder="Nombre completo"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#3C2285] transition-colors"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    País o región
                  </label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#3C2285] transition-colors pr-8"
                  >
                    <option value="El Salvador">El Salvador</option>
                    <option value="Guatemala">Guatemala</option>
                    <option value="Honduras">Honduras</option>
                    <option value="México">México</option>
                    <option value="Estados Unidos">Estados Unidos</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="saveCard"
                    checked={saveCard}
                    onChange={(e) => setSaveCard(e.target.checked)}
                    className="w-4 h-4 text-[#3C2285] border-gray-300 rounded focus:ring-[#3C2285]"
                  />
                  <label htmlFor="saveCard" className="text-sm text-gray-700">
                    Guarda mis datos para un proceso de compra más rápido
                  </label>
                </div>
              </div>
            )}

            {/* Alipay Message */}
            {paymentMethod === 'alipay' && (
              <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                <div className="flex items-start gap-3">
                  <i className="ri-alipay-line text-xl text-blue-600 mt-0.5"></i>
                  <div>
                    <p className="text-sm text-blue-800 font-medium mb-1">Alipay</p>
                    <p className="text-xs text-blue-700">
                      Paga de forma segura en INTERACTIVE LINK PTE. LTD. y en cualquier lugar donde se acepte Link.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-emerald-700 text-white rounded-xl font-semibold text-lg hover:bg-emerald-800 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Procesando...' : 'Agendar'}
            </button>

            {/* Security Notice */}
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600">
                Paga de forma segura en INTERACTIVE LINK PTE. LTD. y en cualquier lugar donde se acepte Link.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
