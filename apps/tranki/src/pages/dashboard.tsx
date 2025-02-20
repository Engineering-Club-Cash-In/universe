import BellIcon from "/assets/dashboard/bell.svg";
import CCILogo from "/assets/dashboard/cci-logo-white.svg";
import UserIcon from "/assets/dashboard/user.svg";
import { useState } from "react";
import DashboardIcon from "/assets/dashboard/dashboard.svg";
import { useDropzone } from "react-dropzone";
import { predictMissingPayments } from "@/services/data-science";
import {
  pollCreditRecord,
  checkCreditRecord,
  createLead,
  getRenapData,
} from "@/services/submissions";

// Update the type definition for the lead object
type LeadData = {
  id?: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  desiredAmount: number | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

export default function Dashboard() {
  const [activeSection, setActiveSection] = useState("gestiones");

  return (
    <div className="min-h-screen flex flex-col items-center justify-between bg-white text-black text-[calc(10px+2vmin)]">
      <header className="w-full p-4 px-6 max-w-screen-2xl bg-black text-white">
        <div className="flex flex-row w-full items-center justify-between relative">
          <img src={CCILogo} alt="CCI Logo" width={200} height={100} />
          <span className="text-3xl font-bold absolute left-1/2 -translate-x-1/2">
            Vive tu vida Tranki
          </span>
          <img src={BellIcon} alt="Bell Icon" className="w-6 h-6" />
        </div>
      </header>
      <main className="w-full flex flex-row max-w-screen-2xl h-[calc(100vh-88px)] border-l border-r">
        <aside className="flex flex-col w-1/4 bg-white p-4 border-r gap-4">
          <div
            className={`flex flex-col items-center justify-center p-4 border cursor-pointer ${
              activeSection === "gestiones"
                ? "bg-purple-500"
                : "hover:bg-purple-200"
            }`}
            onClick={() => setActiveSection("gestiones")}
          >
            <img src={UserIcon} alt="User Icon" className="w-6 h-6" />
            <span className="text-lg font-bold">Gestiones</span>
          </div>
          <div
            className={`flex flex-col items-center justify-center p-4 border cursor-pointer ${
              activeSection === "dashboard"
                ? "bg-purple-500"
                : "hover:bg-purple-200"
            }`}
            onClick={() => setActiveSection("dashboard")}
          >
            <img src={DashboardIcon} alt="Dashboard Icon" className="w-6 h-6" />
            <span className="text-lg font-bold">Dashboard</span>
          </div>
        </aside>
        <div className="w-full p-8">
          {activeSection === "gestiones" ? (
            <GestionesSection />
          ) : (
            <DashboardSection />
          )}
        </div>
      </main>
    </div>
  );
}

const GestionesSection = () => {
  const [amount, setAmount] = useState<number | "">("");
  const [income, setIncome] = useState<number | "">("");
  const [age, setAge] = useState<number | "">("");
  const [dependents, setDependents] = useState<number | "">("");
  const [occupation, setOccupation] = useState("");
  const [seniority, setSeniority] = useState(0);
  const [civilStatus, setCivilStatus] = useState("");
  const [moneyUsage, setMoneyUsage] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [isVehicle, setIsVehicle] = useState(false);
  const [isCreditCard, setIsCreditCard] = useState(false);
  const [purchaseType, setPurchaseType] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);

  const onDrop = (acceptedFiles: File[]) => {
    const pdfFiles = acceptedFiles.filter(
      (file) => file.type === "application/pdf"
    );
    if (pdfFiles.length > 0) {
      setFiles((currentFiles) => {
        const newFiles = [...currentFiles, ...pdfFiles];
        return newFiles.slice(0, 3);
      });
    }
  };

  const handleRemoveFile = (index: number) => {
    setFiles((currentFiles) => currentFiles.filter((_, i) => i !== index));
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
    },
    maxFiles: 3,
    disabled: files.length >= 3,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    // Validate amount
    if (!amount) {
      newErrors.amount = "El monto es requerido";
    }

    // Validate income
    if (!income) {
      newErrors.income = "El sueldo es requerido";
    }

    // Validate age
    if (!age) {
      newErrors.age = "La edad es requerida";
    } else if (age < 18 || age > 99) {
      newErrors.age = "La edad debe estar entre 18 y 99 años";
    }

    // Validate dependents
    if (dependents === "") {
      newErrors.dependents = "El número de dependientes es requerido";
    }

    // Validate selects
    if (!occupation) {
      newErrors.occupation = "La ocupación es requerida";
    }
    if (!seniority) {
      newErrors.seniority = "La antigüedad es requerida";
    }
    if (!civilStatus) {
      newErrors.civilStatus = "El estado civil es requerido";
    }
    if (!moneyUsage) {
      newErrors.moneyUsage = "La utilización del dinero es requerida";
    }
    if (!purchaseType) {
      newErrors.purchaseType = "El tipo de compras es requerido";
    }

    setErrors(newErrors);

    // If no errors, proceed with form submission
    if (Object.keys(newErrors).length === 0) {
      console.log("Form submitted successfully", {
        amount,
        income,
        age,
        dependents,
        occupation,
        seniority,
        civilStatus,
        moneyUsage,
        isOwner,
        isVehicle,
        isCreditCard,
        purchaseType,
      });
    }
    // First check renap data
    const renapData = await getRenapData("3004735750101");

    // First create a lead
    const lead = {
      id: -1,
      name: "Luis Ralda",
      desiredAmount: amount || 0,
      email: "bachejin@gmail.com",
      phone: "502 5555 5555",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const leadResponse = await createLead(lead);
    // Now create the credit record
    await checkCreditRecord(leadResponse.data.id, files);
    // Now poll the credit record
    // Now we can predict the missing payments
    const missingPayments = await predictMissingPayments({
      PRECIO_PRODUCTO: amount || 0,
      SUELDO: income || 0,
      EDAD: age || 0,
      DEPENDIENTES_ECONOMICOS: dependents || 0,
      OCUPACION: occupation === "empleado" ? 0 : 1,
      ANTIGUEDAD: seniority || 0,
      ESTADO_CIVIL: civilStatus === "soltero" ? 0 : 1,
      UTILIZACION_DINERO: moneyUsage === "personal" ? 0 : 1,
      VIVIENDA_PROPIA: isOwner ? 1 : 0,
      VEHICULO_PROPIO: isVehicle ? 1 : 0,
      TARJETA_DE_CREDITO: isCreditCard ? 1 : 0,
      TIPO_DE_COMPRAS: purchaseType === "contado" ? 0 : 1,
    });
    alert(JSON.stringify(missingPayments));
    setTimeout(async () => {
      await pollCreditRecord();
    }, 30000);
  };

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold text-center mb-8">
        Realiza una precalificación
      </h2>

      <form className="space-y-6" onSubmit={handleSubmit}>
        {/* First row - Financial Information */}
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col">
            <label className="text-lg mb-2 font-medium">
              Monto que desea solicitar
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-500">Q</span>
              <input
                type="number"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value === "" ? "" : Number(e.target.value))
                }
                className={`border p-2 pl-8 rounded w-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500 ${
                  errors.amount ? "border-red-500" : ""
                }`}
              />
              {errors.amount && (
                <span className="text-red-500 text-sm mt-1">
                  {errors.amount}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col">
            <label className="text-lg mb-2 font-medium">Sueldo</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-500">Q</span>
              <input
                type="number"
                value={income}
                onChange={(e) =>
                  setIncome(e.target.value === "" ? "" : Number(e.target.value))
                }
                className={`border p-2 pl-8 rounded w-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500 ${
                  errors.income ? "border-red-500" : ""
                }`}
              />
              {errors.income && (
                <span className="text-red-500 text-sm mt-1">
                  {errors.income}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Second row - Personal Information */}
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col">
            <label className="text-lg mb-2 font-medium">Edad</label>
            <input
              type="number"
              placeholder="Años"
              min="18"
              max="99"
              value={age}
              onChange={(e) =>
                setAge(e.target.value === "" ? "" : Number(e.target.value))
              }
              className={`border p-2 pl-8 rounded w-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500 ${
                errors.age ? "border-red-500" : ""
              }`}
            />
            {errors.age && (
              <span className="text-red-500 text-sm mt-1">{errors.age}</span>
            )}
          </div>

          <div className="flex flex-col">
            <label className="text-lg mb-2 font-medium">
              Dependientes Económicos
            </label>
            <input
              type="number"
              min="0"
              value={dependents}
              placeholder="Cantidad de personas"
              onChange={(e) =>
                setDependents(
                  e.target.value === "" ? "" : Number(e.target.value)
                )
              }
              className={`border p-2 pl-8 rounded w-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500 ${
                errors.dependents ? "border-red-500" : ""
              }`}
            />
            {errors.dependents && (
              <span className="text-red-500 text-sm mt-1">
                {errors.dependents}
              </span>
            )}
          </div>
        </div>

        {/* Third row - Employment Information */}
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col">
            <label className="text-lg mb-2 font-medium">Ocupación</label>
            <select
              className="border p-2 rounded w-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              value={occupation}
              onChange={(e) => setOccupation(e.target.value)}
            >
              <option value="">Seleccione una opción</option>
              <option value="empleado">Empleado</option>
              <option value="empresario">Dueño</option>
            </select>
            {errors.occupation && (
              <span className="text-red-500 text-sm mt-1">
                {errors.occupation}
              </span>
            )}
          </div>

          <div className="flex flex-col">
            <label className="text-lg mb-2 font-medium">Antigüedad</label>
            <select
              className="border p-2 rounded w-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              value={seniority}
              onChange={(e) => setSeniority(Number(e.target.value))}
            >
              <option value="">Seleccione una opción</option>
              <option value="1">0-1 año</option>
              <option value="2">1-5 años</option>
              <option value="3">5-10 años</option>
              <option value="4">10+ años</option>
            </select>
            {errors.seniority && (
              <span className="text-red-500 text-sm mt-1">
                {errors.seniority}
              </span>
            )}
          </div>
        </div>

        {/* Fourth row - Additional Information */}
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col">
            <label className="text-lg mb-2 font-medium">Estado Civil</label>
            <select
              className="border p-2 rounded w-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              value={civilStatus}
              onChange={(e) => setCivilStatus(e.target.value)}
            >
              <option value="">Seleccione una opción</option>
              <option value="soltero">Soltero</option>
              <option value="casado">Casado</option>
              <option value="divorciado">Divorciado</option>
              <option value="viudo">Viudo</option>
            </select>
            {errors.civilStatus && (
              <span className="text-red-500 text-sm mt-1">
                {errors.civilStatus}
              </span>
            )}
          </div>

          <div className="flex flex-col">
            <label className="text-lg mb-2 font-medium">
              Utilización Dinero
            </label>
            <select
              className="border p-2 rounded w-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              value={moneyUsage}
              onChange={(e) => setMoneyUsage(e.target.value)}
            >
              <option value="">Seleccione una opción</option>
              <option value="personal">Personal</option>
              <option value="negocio">Negocio</option>
            </select>
            {errors.moneyUsage && (
              <span className="text-red-500 text-sm mt-1">
                {errors.moneyUsage}
              </span>
            )}
          </div>
        </div>

        {/* Fifth row - Checkboxes */}
        <div className="grid grid-cols-3 gap-6">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="vivienda"
              className="w-5 h-5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
              checked={isOwner}
              onChange={() => setIsOwner(!isOwner)}
            />
            <label htmlFor="vivienda" className="text-lg">
              Vivienda Propia
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="vehiculo"
              className="w-5 h-5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
              checked={isVehicle}
              onChange={() => setIsVehicle(!isVehicle)}
            />
            <label htmlFor="vehiculo" className="text-lg">
              Vehículo Propio
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="tarjeta"
              className="w-5 h-5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
              checked={isCreditCard}
              onChange={() => setIsCreditCard(!isCreditCard)}
            />
            <label htmlFor="tarjeta" className="text-lg">
              Tarjeta de Crédito
            </label>
          </div>
        </div>

        {/* Sixth row - Purchase Type */}
        <div className="flex flex-col">
          <label className="text-lg mb-2 font-medium">Tipo de Compras</label>
          <select
            className="border p-2 rounded w-full focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            value={purchaseType}
            onChange={(e) => setPurchaseType(e.target.value)}
          >
            <option value="">Seleccione una opción</option>
            <option value="contado">Contado</option>
            <option value="credito">Crédito</option>
            <option value="mixto">Mixto</option>
          </select>
          {errors.purchaseType && (
            <span className="text-red-500 text-sm mt-1">
              {errors.purchaseType}
            </span>
          )}
        </div>

        {/* Seventh row - Estados de cuenta */}
        <div className="flex flex-col gap-4">
          <label className="text-lg mb-2 font-medium">
            Estados de Cuenta (Máximo 3 archivos PDF)
          </label>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center
              ${
                files.length >= 3
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:border-purple-500"
              }
              ${isDragActive ? "border-purple-500 bg-purple-50" : ""}`}
          >
            <input {...getInputProps()} />
            <p className="text-gray-600">
              {files.length >= 3
                ? "Límite máximo de archivos alcanzado"
                : isDragActive
                ? "Suelte los archivos aquí"
                : "Arrastre los archivos aquí o haga clic para seleccionar"}
            </p>
          </div>

          {/* File list */}
          <div className="space-y-2">
            {files.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-gray-50 rounded"
              >
                <span className="truncate">{file.name}</span>
                <button
                  onClick={() => handleRemoveFile(index)}
                  className="text-red-500 hover:text-red-700"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-purple-500 text-white py-3 px-4 rounded-lg text-lg font-medium hover:bg-purple-600 transition-colors focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
        >
          Enviar Precalificación
        </button>
      </form>
    </div>
  );
};

const DashboardSection = () => {
  return (
    <div>
      <h2>Dashboard</h2>
    </div>
  );
};
