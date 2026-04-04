
interface ReviewsSectionProps {
  rating: number;
  reviewCount: number;
}

interface Review {
  id: number;
  userName: string;
  userImage: string;
  rating: number;
  date: string;
  comment: string;
}

const mockReviews: Review[] = [
  {
    id: 1,
    userName: 'María González',
    userImage: 'https://readdy.ai/api/search-image?query=Professional%20portrait%20of%20Hispanic%20woman%20smiling%2C%20friendly%20expression%2C%20casual%20business%20attire%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20professional%20headshot%20photography&width=100&height=100&seq=5001&orientation=squarish',
    rating: 5,
    date: 'Hace 2 semanas',
    comment: 'Excelente atención, muy profesional y dedicado. Explicó todo con claridad y me sentí muy bien atendida. El consultorio está muy limpio y moderno.'
  },
  {
    id: 2,
    userName: 'Carlos Ramírez',
    userImage: 'https://readdy.ai/api/search-image?query=Professional%20portrait%20of%20Hispanic%20man%20smiling%2C%20friendly%20expression%2C%20casual%20business%20attire%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20professional%20headshot%20photography&width=100&height=100&seq=5002&orientation=squarish',
    rating: 5,
    date: 'Hace 1 mes',
    comment: 'El mejor médico que he visitado. Muy atento, escucha todas tus preocupaciones y te da un diagnóstico preciso. Totalmente recomendado.'
  },
  {
    id: 3,
    userName: 'Ana Martínez',
    userImage: 'https://readdy.ai/api/search-image?query=Professional%20portrait%20of%20Hispanic%20woman%20smiling%20warmly%2C%20friendly%20expression%2C%20casual%20attire%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20professional%20headshot%20photography&width=100&height=100&seq=5003&orientation=squarish',
    rating: 4,
    date: 'Hace 1 mes',
    comment: 'Muy buena experiencia. El doctor es muy profesional y el personal es amable. Solo tuve que esperar un poco más de lo esperado.'
  },
  {
    id: 4,
    userName: 'Roberto Silva',
    userImage: 'https://readdy.ai/api/search-image?query=Professional%20portrait%20of%20Hispanic%20man%20with%20glasses%20smiling%2C%20friendly%20expression%2C%20business%20casual%20attire%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20professional%20headshot%20photography&width=100&height=100&seq=5004&orientation=squarish',
    rating: 5,
    date: 'Hace 2 meses',
    comment: 'Excelente médico, muy preparado y actualizado. Me resolvió un problema que tenía hace años. Muy agradecido con su atención.'
  },
  {
    id: 5,
    userName: 'Laura Hernández',
    userImage: 'https://readdy.ai/api/search-image?query=Professional%20portrait%20of%20Hispanic%20woman%20with%20long%20hair%20smiling%2C%20friendly%20expression%2C%20professional%20attire%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20professional%20headshot%20photography&width=100&height=100&seq=5005&orientation=squarish',
    rating: 5,
    date: 'Hace 2 meses',
    comment: 'Súper recomendado. Muy profesional, empático y dedicado. Las instalaciones son de primera y el trato es excelente.'
  },
  {
    id: 6,
    userName: 'Jorge Morales',
    userImage: 'https://readdy.ai/api/search-image?query=Professional%20portrait%20of%20Hispanic%20man%20smiling%20confidently%2C%20friendly%20expression%2C%20casual%20business%20attire%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20professional%20headshot%20photography&width=100&height=100&seq=5006&orientation=squarish',
    rating: 5,
    date: 'Hace 3 meses',
    comment: 'Excelente atención médica. El doctor se toma el tiempo necesario para explicar todo detalladamente. Muy satisfecho con el servicio.'
  }
];

export default function ReviewsSection({ rating, reviewCount }: ReviewsSectionProps) {
  const ratingCriteria = [
    { name: 'Precio', rating: 4.8 },
    { name: 'Puntualidad', rating: 4.6 },
    { name: 'Amabilidad', rating: 5.0 },
    { name: 'Coordinación', rating: 4.7 },
    { name: 'Información', rating: 4.9 }
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <i className="ri-star-fill text-yellow-500 text-2xl"></i>
        <h2 className="text-2xl font-semibold text-gray-900">
          {rating} · {reviewCount} reseñas
        </h2>
      </div>

      {/* Rating Criteria */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div className="space-y-3">
          {ratingCriteria.map((item) => (
            <div key={item.name} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 w-28">{item.name}</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#3C2285]"
                  style={{ width: `${(item.rating / 5) * 100}%` }}
                ></div>
              </div>
              <span className="text-sm font-semibold text-gray-900 w-12 text-right">{item.rating}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reviews List */}
      <div className="space-y-8">
        {mockReviews.map((review) => (
          <div key={review.id} className="border-b border-gray-200 pb-8 last:border-b-0">
            <div className="flex items-start gap-4">
              <img
                src={review.userImage}
                alt={review.userName}
                className="w-12 h-12 rounded-full object-cover"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-gray-900">{review.userName}</h4>
                    <p className="text-sm text-gray-600">{review.date}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: review.rating }).map((_, i) => (
                      <i key={i} className="ri-star-fill text-yellow-500 text-sm"></i>
                    ))}
                  </div>
                </div>
                <p className="text-gray-700 leading-relaxed">{review.comment}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Show More Button */}
      <button className="mt-8 px-6 py-3 border border-gray-900 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap font-semibold">
        Mostrar todas las {reviewCount} reseñas
      </button>
    </div>
  );
}
