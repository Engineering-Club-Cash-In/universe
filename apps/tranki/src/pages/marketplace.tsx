import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Car, DollarSign, Filter } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsTrigger, TabsList, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { sendDocumentsForSignature } from "../services/eden";

// Define types
interface CreditRecord {
  maxPayment: number;
  maximumCredit: number;
}

interface Car {
  id: number;
  make: string;
  model: string;
  year: number;
  price: number;
  monthlyPayment: number;
  downPayment: number;
  image: string;
  mileage: number;
  fuelType: string;
  transmission: string;
  color: string;
}

export default function CarMarketplace() {
  // State for cars and filters
  const [cars, _setCars] = useState<Car[]>(carsData);
  const [filteredCars, setFilteredCars] = useState<Car[]>(carsData);
  const [creditRecord, setCreditRecord] = useState<CreditRecord | null>(null);
  const [makeFilter, setMakeFilter] = useState<string>("");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 300000]);
  const [yearRange, setYearRange] = useState<[number, number]>([2010, 2024]);
  const [sortOption, setSortOption] = useState<string>("price-asc");
  const [showOnlyAffordable, setShowOnlyAffordable] = useState<boolean>(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isDisabled, setIsDisabled] = useState(true);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  // Get credit record from local storage on component mount
  useEffect(() => {
    try {
      const storedCreditRecord = localStorage.getItem("creditRecordResult");
      console.log(storedCreditRecord);
      if (storedCreditRecord) {
        setCreditRecord(JSON.parse(storedCreditRecord));
        setIsDisabled(false);
      } else {
        // For demo purposes, set a default credit record if none exists
        const defaultCreditRecord = { maxPayment: 500, maximumCredit: 30000 };
        localStorage.setItem(
          "creditRecordResult",
          JSON.stringify(defaultCreditRecord)
        );
        setCreditRecord(defaultCreditRecord);
        setIsDisabled(true);
      }
    } catch (error) {
      console.error("Error accessing localStorage:", error);
      // Set default values if localStorage is not available
      setCreditRecord({ maxPayment: 500, maximumCredit: 30000 });
    }
  }, []);

  // Apply filters whenever filter state or credit record changes
  useEffect(() => {
    console.log("applying filters, showOnlyAffordable:", showOnlyAffordable);
    if (!creditRecord) return;

    // Start with all cars
    let result = [...cars];
    console.log("Initial cars count:", result.length);

    // Filter by make
    if (makeFilter) {
      if (makeFilter === "All Makes") {
        // No filtering needed for "All Makes"
      } else {
        result = result.filter((car) => car.make === makeFilter);
        console.log("After make filter:", result.length);
      }
    }

    // Filter by price range
    result = result.filter(
      (car) => car.price >= priceRange[0] && car.price <= priceRange[1]
    );
    console.log("After price range filter:", result.length);

    // Filter by year range
    result = result.filter(
      (car) => car.year >= yearRange[0] && car.year <= yearRange[1]
    );
    console.log("After year range filter:", result.length);

    // Filter by affordability if enabled
    if (showOnlyAffordable && creditRecord) {
      const beforeCount = result.length;
      result = result.filter(
        (car) =>
          car.monthlyPayment <= creditRecord.maxPayment &&
          car.price <= creditRecord.maximumCredit
      );
      console.log(
        "After affordability filter:",
        result.length,
        "removed:",
        beforeCount - result.length
      );
    }

    // Apply sorting
    result = sortCars(result, sortOption);

    console.log("Final filtered cars count:", result.length);
    setFilteredCars(result);
  }, [
    cars,
    makeFilter,
    priceRange,
    yearRange,
    sortOption,
    creditRecord,
    showOnlyAffordable,
  ]);

  // Function to sort cars
  const sortCars = (carsToSort: Car[], option: string) => {
    const sortedCars = [...carsToSort];
    switch (option) {
      case "price-asc":
        return sortedCars.sort((a, b) => a.price - b.price);
      case "price-desc":
        return sortedCars.sort((a, b) => b.price - a.price);
      case "year-desc":
        return sortedCars.sort((a, b) => b.year - a.year);
      case "year-asc":
        return sortedCars.sort((a, b) => a.year - b.year);
      case "payment-asc":
        return sortedCars.sort((a, b) => a.monthlyPayment - b.monthlyPayment);
      default:
        return sortedCars;
    }
  };

  // Function to reset filters
  const resetFilters = () => {
    setMakeFilter("");
    setPriceRange([0, 300000]);
    setYearRange([2010, 2024]);
    setSortOption("price-asc");
  };

  // Get unique makes for the filter dropdown
  const uniqueMakes = Array.from(new Set(cars.map((car) => car.make))).sort();

  const handleBuyNow = async () => {
    const emails = [
      "luis.r@clubcashin.com",
      "boris.l@clubcashin.com",
      "a.sofia.garciap@gmail.com",
    ];
    await sendDocumentsForSignature(emails);
    console.log("Documents sent for signature");
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col md:flex-row justify-between items-start gap-8">
        {/* Mobile filter button */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" className="md:hidden mb-4">
              <Filter className="h-4 w-4 mr-2" />
              Filtros
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] sm:w-[400px]">
            <SheetHeader>
              <SheetTitle>Filtros</SheetTitle>
              <SheetDescription>
                Ajusta tus criterios de búsqueda
              </SheetDescription>
            </SheetHeader>
            <div className="py-4 space-y-6">
              {/* Mobile filters - same as desktop */}
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="affordable-mobile"
                    checked={showOnlyAffordable}
                    onCheckedChange={(checked) =>
                      setShowOnlyAffordable(checked as boolean)
                    }
                  />
                  <Label
                    htmlFor="affordable-mobile"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Mostrar solo autos dentro de tu crédito
                  </Label>
                </div>
                {creditRecord && (
                  <div className="text-sm text-muted-foreground">
                    <p>
                      Tu pago mensual máximo: Q
                      {creditRecord.maxPayment.toLocaleString()}
                    </p>
                    <p>
                      Tu crédito máximo: Q
                      {creditRecord.maximumCredit.toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-2 w-full">
                <Label htmlFor="make-mobile">Marca</Label>
                <Select value={makeFilter} onValueChange={setMakeFilter}>
                  <SelectTrigger id="make-mobile">
                    <SelectValue placeholder="Todas las marcas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All Makes">Todas las marcas</SelectItem>
                    {uniqueMakes.map((make) => (
                      <SelectItem key={make} value={make}>
                        {make}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Rango de precio</Label>
                  <span className="text-sm text-muted-foreground">
                    Q{priceRange[0].toLocaleString()} - Q
                    {priceRange[1].toLocaleString()}
                  </span>
                </div>
                <Slider
                  defaultValue={[0, 100000]}
                  max={100000}
                  step={1000}
                  value={priceRange}
                  onValueChange={(value) =>
                    setPriceRange(value as [number, number])
                  }
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Rango de año</Label>
                  <span className="text-sm text-muted-foreground">
                    {yearRange[0]} - {yearRange[1]}
                  </span>
                </div>
                <Slider
                  defaultValue={[2010, 2024]}
                  min={2010}
                  max={2024}
                  step={1}
                  value={yearRange}
                  onValueChange={(value) =>
                    setYearRange(value as [number, number])
                  }
                />
              </div>
              <Button
                variant="outline"
                onClick={resetFilters}
                className="w-full"
              >
                Reiniciar filtros
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Desktop sidebar */}
        <div className="hidden md:block w-64 space-y-6">
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Filtros</h2>
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="affordable"
                  checked={showOnlyAffordable}
                  onCheckedChange={(checked) =>
                    setShowOnlyAffordable(checked as boolean)
                  }
                />
                <Label
                  htmlFor="affordable"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Mostrar solo autos dentro de tu crédito
                </Label>
              </div>
              {creditRecord && (
                <div className="text-sm text-muted-foreground">
                  <p>
                    Tu pago mensual máximo: Q
                    {creditRecord.maxPayment.toLocaleString()}
                  </p>
                  <p>
                    Tu crédito máximo: Q
                    {creditRecord.maximumCredit.toLocaleString()}
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="make">Marca</Label>
              <Select value={makeFilter} onValueChange={setMakeFilter}>
                <SelectTrigger id="make" className="w-full ">
                  <SelectValue placeholder="Todas las marcas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All Makes">Todas las marcas</SelectItem>
                  {uniqueMakes.map((make) => (
                    <SelectItem key={make} value={make}>
                      {make}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Rango de precio</Label>
                <span className="text-sm text-muted-foreground">
                  Q{priceRange[0].toLocaleString()} - Q
                  {priceRange[1].toLocaleString()}
                </span>
              </div>
              <Slider
                defaultValue={[0, 100000]}
                max={100000}
                step={1000}
                value={priceRange}
                onValueChange={(value) =>
                  setPriceRange(value as [number, number])
                }
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Rango de año</Label>
                <span className="text-sm text-muted-foreground">
                  {yearRange[0]} - {yearRange[1]}
                </span>
              </div>
              <Slider
                defaultValue={[2010, 2024]}
                min={2010}
                max={2024}
                step={1}
                value={yearRange}
                onValueChange={(value) =>
                  setYearRange(value as [number, number])
                }
              />
            </div>
            <Button variant="outline" onClick={resetFilters} className="w-full">
              Reiniciar filtros
            </Button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
            <div>
              <h1 className="text-3xl font-bold">Marketplace Club Cash In</h1>
              <p className="text-muted-foreground">
                {filteredCars.length}{" "}
                {filteredCars.length === 1 ? "auto" : "autos"} disponible
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="sort" className="sr-only">
                Ordenar por
              </Label>
              <Select value={sortOption} onValueChange={setSortOption}>
                <SelectTrigger id="sort" className="w-[180px]">
                  <SelectValue placeholder="Ordenar por" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="price-asc">Precio: Bajo a Alto</SelectItem>
                  <SelectItem value="price-desc">
                    Precio: Alto a Bajo
                  </SelectItem>
                  <SelectItem value="year-desc">
                    Año: Más reciente primero
                  </SelectItem>
                  <SelectItem value="year-asc">
                    Año: Más antiguo primero
                  </SelectItem>
                  <SelectItem value="payment-asc">
                    Pago mensual: Bajo a Alto
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Car grid */}
          {filteredCars.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredCars.map((car) => (
                <Card key={car.id} className="overflow-hidden">
                  <CardHeader className="p-0">
                    <div className="relative h-48 w-full">
                      <img
                        src={car.image || "/placeholder.svg"}
                        alt={`Q{car.year} Q{car.make} Q{car.model}`}
                        className="object-cover h-48 w-full"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">
                          {car.year} {car.make} {car.model}
                        </CardTitle>
                        <p className="text-2xl font-bold mt-1">
                          Q{car.price.toLocaleString()}
                        </p>
                      </div>
                      {creditRecord &&
                      car.monthlyPayment <= creditRecord.maxPayment &&
                      car.price <= creditRecord.maximumCredit ? (
                        <Badge className="bg-yellow-600 h-6">Accesible</Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-red-500 border-red-500"
                        >
                          No accesible
                        </Badge>
                      )}
                    </div>
                    <div className="mt-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Pago mensual
                        </span>
                        <span className="font-medium">
                          Q{car.monthlyPayment}/mo
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Pago inicial
                        </span>
                        <span className="font-medium">
                          Q{car.downPayment.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Kilometraje
                        </span>
                        <span className="font-medium">
                          {car.mileage.toLocaleString()} km
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Transmisión
                        </span>
                        <span className="font-medium">{car.transmission}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Combustible
                        </span>
                        <span className="font-medium">{car.fuelType}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Color</span>
                        <span className="font-medium">{car.color}</span>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="p-4 pt-0">
                    <Dialog open={isOpen} onOpenChange={setIsOpen}>
                      <DialogTrigger asChild>
                        <Button
                          className="w-full bg-purple-500 text-white font-bold hover:bg-purple-600 
                        hover:text-white cursor-pointer whitespace-normal overflow-wrap break-word text-center"
                        >
                          Ver detalles
                        </Button>
                      </DialogTrigger>

                      <DialogContent className="sm:max-w-[700px] p-0 overflow-hidden">
                        <div className="relative h-64 sm:h-80 w-full">
                          <img
                            src={car.image || "/placeholder.svg"}
                            alt={`Q{car.year} Q{car.make} Q{car.model}`}
                            className="object-cover w-full h-full"
                          />
                          <DialogClose className="absolute top-4 right-4 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 transition-colors">
                            <span className="sr-only">Cerrar</span>
                          </DialogClose>
                        </div>

                        <DialogHeader className="px-6 pt-6 pb-0">
                          <div className="flex justify-between items-start">
                            <div>
                              <DialogTitle className="text-3xl font-bold">
                                {car.year} {car.make} {car.model}
                              </DialogTitle>
                              <DialogDescription className="text-lg">
                                {car.color}
                              </DialogDescription>
                            </div>
                            <Badge
                              className={
                                car.monthlyPayment <=
                                  (creditRecord?.maxPayment || 0) &&
                                car.price <= (creditRecord?.maximumCredit || 0)
                                  ? "text-lg px-3 py-1 bg-green-100 text-green-500 border-green-200 hover:bg-green-200"
                                  : "text-lg px-3 py-1 bg-red-100 text-red-500 border-red-200 hover:bg-red-200"
                              }
                            >
                              {car.monthlyPayment <=
                                (creditRecord?.maxPayment || 0) &&
                              car.price <= (creditRecord?.maximumCredit || 0)
                                ? "Accesible"
                                : "No accesible"}
                            </Badge>
                          </div>
                        </DialogHeader>

                        <div className="px-6 py-4">
                          <Tabs defaultValue="specs" className="w-full">
                            <TabsList className="grid grid-cols-2 mb-4">
                              <TabsTrigger value="specs">
                                Especificaciones
                              </TabsTrigger>
                              <TabsTrigger value="features">
                                Características
                              </TabsTrigger>
                            </TabsList>

                            <TabsContent value="specs" className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="flex items-center justify-between p-3 rounded-md bg-gray-100">
                                  <span className="text-sm text-black">
                                    Tipo de motor
                                  </span>
                                  <span className="font-medium text-right">
                                    {car.fuelType}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-md bg-gray-100">
                                  <span className="text-sm text-black">
                                    Transmisión
                                  </span>
                                  <span className="font-medium text-right">
                                    {car.transmission}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-md bg-gray-100">
                                  <span className="text-sm text-black">
                                    Pago mensual
                                  </span>
                                  <span className="font-medium text-right">
                                    Q{car.monthlyPayment.toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-md bg-gray-100">
                                  <span className="text-sm text-black">
                                    Precio total
                                  </span>
                                  <span className="font-medium text-right">
                                    Q{car.price.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </TabsContent>

                            <TabsContent value="features">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-purple-100 text-purple-700">
                                  <span className="text-lg">
                                    Aire acondicionado
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-purple-100 text-purple-700">
                                  <span className="text-lg">
                                    Cierre centralizado
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-purple-100 text-purple-700">
                                  <span className="text-lg">
                                    Elevalunas eléctricos
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-purple-100 text-purple-700">
                                  <span className="text-lg">
                                    Sistema de navegación
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-purple-100 text-purple-700">
                                  <span className="text-lg">
                                    Faros de xenon
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-purple-100 text-purple-700">
                                  <span className="text-lg">Techo solar</span>
                                </div>
                              </div>
                            </TabsContent>
                          </Tabs>
                        </div>

                        <div className="p-6 bg-gray-50">
                          <div className="flex gap-4">
                            <Button
                              className="flex-1 bg-purple-500 text-white font-bold hover:bg-purple-600 
                        hover:text-white cursor-pointer whitespace-normal overflow-wrap break-word text-center"
                              disabled={isDisabled}
                              onClick={() => {
                                // Close the dialog
                                setIsOpen(false);
                                // Open the alert dialog
                                setIsAlertOpen(true);
                              }}
                            >
                              <DollarSign className="mr-2 h-4 w-4" />
                              Comprar ahora
                            </Button>
                            <Button
                              variant="outline"
                              className="flex-1 cursor-pointer"
                            >
                              Programar prueba de conducción
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </CardFooter>
                </Card>
              ))}
              <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-2xl font-bold">
                      ¿Confirmas la solicitud de compra?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-lg">
                      Al confirmar, se generarán los documentos necesarios para
                      que firmes y serán enviados a tu correo. Por favor, esta
                      atento a tu correo.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-purple-500 text-white font-bold hover:bg-purple-600 
                        hover:text-white cursor-pointer whitespace-normal overflow-wrap break-word text-center"
                      onClick={handleBuyNow}
                    >
                      Confirmar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Car className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold">
                No hay autos que coincidan con tus criterios
              </h3>
              <p className="text-muted-foreground mt-2">
                Intenta ajustar tus filtros o límites de crédito
              </p>
              <Button variant="outline" onClick={resetFilters} className="mt-4">
                Reiniciar filtros
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Sample car data
const carsData: Car[] = [
  {
    id: 1,
    make: "Toyota",
    model: "Corolla",
    year: 2018,
    price: 12000 * 8,
    monthlyPayment: 250 * 8,
    downPayment: 1500 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 15000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Plateado",
  },
  {
    id: 2,
    make: "Honda",
    model: "Civic",
    year: 2017,
    price: 9000 * 8,
    monthlyPayment: 280 * 8,
    downPayment: 1800 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 20000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Azul",
  },
  {
    id: 3,
    make: "Ford",
    model: "Mustang",
    year: 2016,
    price: 25000 * 8,
    monthlyPayment: 450 * 8,
    downPayment: 2800 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 25000,
    fuelType: "Gasolina",
    transmission: "Manual",
    color: "Rojo",
  },
  {
    id: 4,
    make: "Chevrolet",
    model: "Malibu",
    year: 2017,
    price: 12000 * 8,
    monthlyPayment: 290 * 8,
    downPayment: 1800 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 18000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Negro",
  },
  {
    id: 5,
    make: "Tesla",
    model: "Model 3",
    year: 2019,
    price: 23000 * 8,
    monthlyPayment: 600 * 8,
    downPayment: 3800 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 10000,
    fuelType: "Eléctrico",
    transmission: "Automática",
    color: "Blanco",
  },
  {
    id: 6,
    make: "BMW",
    model: "3 Series",
    year: 2015,
    price: 21000 * 8,
    monthlyPayment: 460 * 8,
    downPayment: 2900 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 22000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Gris",
  },
  {
    id: 7,
    make: "Audi",
    model: "A4",
    year: 2016,
    price: 22000 * 8,
    monthlyPayment: 500 * 8,
    downPayment: 3200 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 15000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Negro",
  },
  {
    id: 8,
    make: "Hyundai",
    model: "Elantra",
    year: 2018,
    price: 9000 * 8,
    monthlyPayment: 240 * 8,
    downPayment: 1500 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 12000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Plateado",
  },
  {
    id: 9,
    make: "Kia",
    model: "Forte",
    year: 2017,
    price: 10000 * 8,
    monthlyPayment: 220 * 8,
    downPayment: 1400 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 18000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Blanco",
  },
  {
    id: 10,
    make: "Mazda",
    model: "CX-5",
    year: 2016,
    price: 14000 * 8,
    monthlyPayment: 320 * 8,
    downPayment: 2000 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 30000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Rojo",
  },
  {
    id: 11,
    make: "Subaru",
    model: "Outback",
    year: 2017,
    price: 14000 * 8,
    monthlyPayment: 350 * 8,
    downPayment: 2200 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 22000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Verde",
  },
  {
    id: 12,
    make: "Volkswagen",
    model: "Jetta",
    year: 2018,
    price: 12000 * 8,
    monthlyPayment: 270 * 8,
    downPayment: 1700 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 10000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Azul",
  },
  {
    id: 13,
    make: "Nissan",
    model: "Altima",
    year: 2016,
    price: 12000 * 8,
    monthlyPayment: 250 * 8,
    downPayment: 1600 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 25000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Gris",
  },
  {
    id: 14,
    make: "Lexus",
    model: "ES",
    year: 2015,
    price: 27000 * 8,
    monthlyPayment: 440 * 8,
    downPayment: 2800 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 30000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Negro",
  },
  {
    id: 15,
    make: "Toyota",
    model: "Camry",
    year: 2017,
    price: 14000 * 8,
    monthlyPayment: 300 * 8,
    downPayment: 1900 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 18000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Blanco",
  },
  {
    id: 16,
    make: "Honda",
    model: "Accord",
    year: 2016,
    price: 14000 * 8,
    monthlyPayment: 290 * 8,
    downPayment: 1800 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 22000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Plateado",
  },
  {
    id: 17,
    make: "Chevrolet",
    model: "Equinox",
    year: 2017,
    price: 14000 * 8,
    monthlyPayment: 330 * 8,
    downPayment: 2100 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 15000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Azul",
  },
  {
    id: 18,
    make: "Ford",
    model: "Escape",
    year: 2018,
    price: 14000 * 8,
    monthlyPayment: 350 * 8,
    downPayment: 2200 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 10000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Gris",
  },
  {
    id: 19,
    make: "Jeep",
    model: "Cherokee",
    year: 2016,
    price: 14000 * 8,
    monthlyPayment: 380 * 8,
    downPayment: 2400 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 25000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Negro",
  },
  {
    id: 20,
    make: "Toyota",
    model: "RAV4",
    year: 2017,
    price: 14000 * 8,
    monthlyPayment: 360 * 8,
    downPayment: 2300 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 18000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Rojo",
  },
  {
    id: 21,
    make: "Honda",
    model: "CR-V",
    year: 2018,
    price: 14000 * 8,
    monthlyPayment: 380 * 8,
    downPayment: 2400 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 8000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Blanco",
  },
  {
    id: 22,
    make: "Kia",
    model: "Sportage",
    year: 2016,
    price: 12000 * 8,
    monthlyPayment: 270 * 8,
    downPayment: 1700 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 28000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Plateado",
  },
  {
    id: 23,
    make: "Hyundai",
    model: "Tucson",
    year: 2017,
    price: 12000 * 8,
    monthlyPayment: 300 * 8,
    downPayment: 1900 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 20000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Azul",
  },
  {
    id: 24,
    make: "Mazda",
    model: "Mazda3",
    year: 2018,
    price: 12000 * 8,
    monthlyPayment: 250 * 8,
    downPayment: 1600 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 12000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Rojo",
  },
  {
    id: 25,
    make: "Subaru",
    model: "Forester",
    year: 2016,
    price: 14000 * 8,
    monthlyPayment: 320 * 8,
    downPayment: 2000 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 25000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Verde",
  },
  {
    id: 26,
    make: "Volkswagen",
    model: "Tiguan",
    year: 2017,
    price: 14000 * 8,
    monthlyPayment: 350 * 8,
    downPayment: 2200 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 18000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Gris",
  },
  {
    id: 27,
    make: "Nissan",
    model: "Rogue",
    year: 2018,
    price: 16000 * 8,
    monthlyPayment: 330 * 8,
    downPayment: 2100 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 10000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Negro",
  },
  {
    id: 28,
    make: "Ford",
    model: "F-150",
    year: 2016,
    price: 27000 * 8,
    monthlyPayment: 500 * 8,
    downPayment: 3200 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 25000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Azul",
  },
  {
    id: 29,
    make: "Chevrolet",
    model: "Silverado",
    year: 2017,
    price: 26000 * 8,
    monthlyPayment: 530 * 8,
    downPayment: 3400 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 20000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Rojo",
  },
  {
    id: 30,
    make: "Toyota",
    model: "Tacoma",
    year: 2018,
    price: 28000 * 8,
    monthlyPayment: 470 * 8,
    downPayment: 3000 * 8,
    image: "/placeholder.svg?height=400&width=600",
    mileage: 8000,
    fuelType: "Gasolina",
    transmission: "Automática",
    color: "Plateado",
  },
];
