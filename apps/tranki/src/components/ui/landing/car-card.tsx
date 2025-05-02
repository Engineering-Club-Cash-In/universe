import { Camera, Video } from "lucide-react";

interface CarCardProps {
  image: string;
  category: string;
  name: string;
  year: string;
  mileage: string;
  fuel: string[];
  price: string;
  featured?: boolean;
  hasPhotos?: boolean;
  hasVideo?: boolean;
}

export default function CarCard({
  image,
  category,
  name,
  year,
  mileage,
  fuel,
  price,
  featured = false,
  hasPhotos = false,
  hasVideo = false,
}: CarCardProps) {
  return (
    <div className="bg-transparent rounded-2xl overflow-hidden transition-shadow">
      {/* Image Section with Badges */}
      <div className="relative h-48">
        <img src={image} alt={name} className="w-full h-full object-cover" />

        {/* Top Badges */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {featured && (
              <span className="bg-purple-500 text-white text-xs px-3 py-1 rounded-full">
                Featured
              </span>
            )}
            <div className="flex gap-2">
              {hasPhotos && (
                <span className="bg-purple-500 text-white p-1 rounded-full">
                  <Camera className="w-4 h-4" />
                </span>
              )}
              {hasVideo && (
                <span className="bg-purple-500 text-white p-1 rounded-full">
                  <Video className="w-4 h-4" />
                </span>
              )}
            </div>
          </div>
          <span className="bg-purple-500 text-white text-xs px-3 py-1 rounded-full">
            {year}
          </span>
        </div>

        {/* Image Navigation Dots */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
          {[1, 2, 3, 4].map((dot, index) => (
            <button
              key={dot}
              className={`w-1.5 h-1.5 rounded-full ${
                index === 0 ? "bg-white" : "bg-white/50"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Info Section */}
      <div className="p-4 bg-transparent">
        {/* Category */}
        <span className="text-gray-500 text-sm">{category}</span>

        {/* Vehicle Name */}
        <h3 className="font-semibold text-gray-900 mb-2">{name}</h3>

        {/* Specifications */}
        <div className="flex gap-4 text-sm text-gray-600 mb-3">
          <span>{mileage}</span>
          {fuel.map((type, index) => (
            <span key={type}>
              {type}
              {index < fuel.length - 1 && " •"}
            </span>
          ))}
        </div>

        {/* Price */}
        <div className="text-purple-500 font-semibold text-lg">{price}</div>
      </div>
    </div>
  );
}
