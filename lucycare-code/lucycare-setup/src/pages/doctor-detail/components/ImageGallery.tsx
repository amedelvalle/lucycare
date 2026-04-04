
import { useState } from 'react';

interface ImageGalleryProps {
  images: string[];
  doctorName: string;
}

export default function ImageGallery({ images, doctorName }: ImageGalleryProps) {
  const [showAllPhotos, setShowAllPhotos] = useState(false);

  if (showAllPhotos) {
    return (
      <div className="fixed inset-0 bg-black z-[9999] overflow-y-auto">
        <div className="min-h-screen p-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-semibold text-white">Fotos del consultorio</h2>
              <button
                onClick={() => setShowAllPhotos(false)}
                className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
              >
                <i className="ri-close-line text-2xl text-white"></i>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {images.map((image, index) => (
                <div key={index} className="rounded-xl overflow-hidden">
                  <img
                    src={image}
                    alt={`${doctorName} - Foto ${index + 1}`}
                    className="w-full h-auto object-cover object-top"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="grid grid-cols-4 gap-2 h-[500px]">
        {/* Main Image */}
        <div className="col-span-2 row-span-2 overflow-hidden">
          <img
            src={images[0]}
            alt={`${doctorName} - Principal`}
            className="w-full h-full object-cover object-top cursor-pointer"
            onClick={() => setShowAllPhotos(true)}
          />
        </div>
        
        {/* Secondary Images */}
        {images.slice(1, 5).map((image, index) => (
          <div key={index} className="relative overflow-hidden">
            <img
              src={image}
              alt={`${doctorName} - Foto ${index + 2}`}
              className="w-full h-full object-cover object-top cursor-pointer"
              onClick={() => setShowAllPhotos(true)}
            />
            {index === 3 && images.length > 5 && (
              <div
                className="absolute inset-0 bg-black/50 flex items-center justify-center cursor-pointer"
                onClick={() => setShowAllPhotos(true)}
              >
                <span className="text-white font-semibold">+{images.length - 5} fotos</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Show All Photos Button */}
      <button
        onClick={() => setShowAllPhotos(true)}
        className="absolute bottom-6 right-6 px-4 py-2 bg-white border border-gray-900 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-2"
      >
        <i className="ri-grid-line"></i>
        <span>Mostrar todas las fotos</span>
      </button>
    </div>
  );
}
