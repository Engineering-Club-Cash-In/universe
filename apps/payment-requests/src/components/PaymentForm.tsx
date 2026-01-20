import React, { useState, useEffect } from 'react';
import { Calendar, Upload, DollarSign, CreditCard, Building, User, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';

export const PaymentForm = () => {
    const [currentTime, setCurrentTime] = useState(new Date());
    const [formData, setFormData] = useState({
        department: '',
        paymentType: '',
        bankAccount: '',
        bankName: '',
        accountType: 'monetaria',
        currency: 'Q',
        amount: '',
        paymentDate: '',
        isUrgent: false,
    });
    const [file, setFile] = useState<File | null>(null);
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const isBusinessHours = () => {
        const hour = currentTime.getHours();
        return hour >= 8 && hour < 16;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const newRequest = {
            id: crypto.randomUUID(),
            ...formData,
            fileName: file ? file.name : null,
            submittedAt: new Date().toISOString(),
            status: 'pending'
        };

        const existingRequests = JSON.parse(localStorage.getItem('paymentRequests') || '[]');
        localStorage.setItem('paymentRequests', JSON.stringify([newRequest, ...existingRequests]));

        console.log('Form submitted:', newRequest);
        setSubmitted(true);
        setTimeout(() => {
            setSubmitted(false);
            // Reset form
            setFormData({
                department: '',
                paymentType: '',
                bankAccount: '',
                bankName: '',
                accountType: 'monetaria',
                currency: 'Q',
                amount: '',
                paymentDate: '',
                isUrgent: false,
            });
            setFile(null);
        }, 3000);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    return (
        <div className="text-zinc-100 p-4 font-sans selection:bg-indigo-500/30 flex justify-center">
            <div className="w-full max-w-2xl bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 rounded-3xl shadow-2xl overflow-hidden relative">
                {/* Decorative gradients */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
                <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-pink-500/10 rounded-full blur-3xl" />

                <div className="relative p-8 md:p-12">
                    <div className="flex justify-between items-start mb-8">
                        <div>
                            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
                                Solicitud de Pago
                            </h1>
                            <p className="text-zinc-400 mt-2">Complete los detalles para procesar su pago.</p>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="flex items-center gap-2 text-sm font-medium text-zinc-400 bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-700/50">
                                <Clock className="w-4 h-4 text-indigo-400" />
                                <span>{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            {isBusinessHours() ? (
                                <span className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    Horario Hábil
                                </span>
                            ) : (
                                <span className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    Fuera de Horario
                                </span>
                            )}
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Department */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <Building className="w-4 h-4 text-zinc-500" />
                                    Departamento
                                </label>
                                <select
                                    name="department"
                                    required
                                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all appearance-none"
                                    onChange={handleChange}
                                >
                                    <option value="">Seleccionar...</option>
                                    <option value="finanzas">Finanzas</option>
                                    <option value="rrhh">Recursos Humanos</option>
                                    <option value="ventas">Ventas</option>
                                    <option value="it">Tecnología</option>
                                    <option value="operaciones">Operaciones</option>
                                </select>
                            </div>

                            {/* Payment Type */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <CreditCard className="w-4 h-4 text-zinc-500" />
                                    Tipo de Pago
                                </label>
                                <select
                                    name="paymentType"
                                    required
                                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all appearance-none"
                                    onChange={handleChange}
                                >
                                    <option value="">Seleccionar...</option>
                                    <option value="proveedor">Proveedor</option>
                                    <option value="reembolso">Reembolso</option>
                                    <option value="servicio">Servicio</option>
                                    <option value="otro">Otro</option>
                                </select>
                            </div>

                            {/* Bank Name */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <Building className="w-4 h-4 text-zinc-500" />
                                    Banco
                                </label>
                                <input
                                    type="text"
                                    name="bankName"
                                    required
                                    placeholder="Ej. Banco Industrial"
                                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder:text-zinc-600"
                                    onChange={handleChange}
                                />
                            </div>

                            {/* Account Number */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <User className="w-4 h-4 text-zinc-500" />
                                    No. Cuenta
                                </label>
                                <input
                                    type="text"
                                    name="bankAccount"
                                    required
                                    placeholder="000-000000-0"
                                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder:text-zinc-600"
                                    onChange={handleChange}
                                />
                            </div>

                            {/* Amount & Currency */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-zinc-500" />
                                    Monto
                                </label>
                                <div className="flex gap-2">
                                    <select
                                        name="currency"
                                        className="bg-zinc-800/50 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                                        onChange={handleChange}
                                    >
                                        <option value="Q">Q</option>
                                        <option value="$">$</option>
                                    </select>
                                    <input
                                        type="number"
                                        name="amount"
                                        required
                                        placeholder="0.00"
                                        className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder:text-zinc-600"
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>

                            {/* Account Type */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <CreditCard className="w-4 h-4 text-zinc-500" />
                                    Tipo de Cuenta
                                </label>
                                <div className="flex gap-4 pt-3">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <div className="relative flex items-center">
                                            <input
                                                type="radio"
                                                name="accountType"
                                                value="monetaria"
                                                defaultChecked
                                                className="peer sr-only"
                                                onChange={handleChange}
                                            />
                                            <div className="w-5 h-5 border-2 border-zinc-600 rounded-full peer-checked:border-indigo-500 peer-checked:bg-indigo-500 transition-all" />
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 transition-opacity">
                                                <div className="w-2 h-2 bg-white rounded-full" />
                                            </div>
                                        </div>
                                        <span className="text-zinc-400 group-hover:text-zinc-200 transition-colors">Monetaria</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <div className="relative flex items-center">
                                            <input
                                                type="radio"
                                                name="accountType"
                                                value="ahorro"
                                                className="peer sr-only"
                                                onChange={handleChange}
                                            />
                                            <div className="w-5 h-5 border-2 border-zinc-600 rounded-full peer-checked:border-indigo-500 peer-checked:bg-indigo-500 transition-all" />
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 transition-opacity">
                                                <div className="w-2 h-2 bg-white rounded-full" />
                                            </div>
                                        </div>
                                        <span className="text-zinc-400 group-hover:text-zinc-200 transition-colors">Ahorro</span>
                                    </label>
                                </div>
                            </div>

                            {/* Payment Date */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <Calendar className="w-4 h-4 text-zinc-500" />
                                    Fecha Solicitada de Pago
                                </label>
                                <input
                                    type="date"
                                    name="paymentDate"
                                    required
                                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all [color-scheme:dark]"
                                    onChange={handleChange}
                                />
                            </div>

                            {/* File Upload */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <Upload className="w-4 h-4 text-zinc-500" />
                                    Cotización / Factura
                                </label>
                                <div className="relative group">
                                    <input
                                        type="file"
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    />
                                    <div className="w-full bg-zinc-800/50 border border-dashed border-zinc-700 rounded-xl px-4 py-3 text-zinc-400 group-hover:border-indigo-500/50 group-hover:text-zinc-300 transition-all flex items-center justify-center gap-2">
                                        {file ? (
                                            <span className="text-indigo-400 truncate">{file.name}</span>
                                        ) : (
                                            <>
                                                <Upload className="w-4 h-4" />
                                                <span>Subir archivo</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Info Box */}
                        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 flex gap-3 items-start">
                            <AlertCircle className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-sm text-indigo-200 font-medium">Información de Pagos</p>
                                <p className="text-xs text-indigo-300/80 leading-relaxed">
                                    Todo pago solicitado de 8:00 a 16:00 horas se realizará al día siguiente en el transcurso del día.
                                    Solicitudes fuera de este horario pueden tener tiempos de procesamiento diferentes.
                                </p>
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium py-4 rounded-xl shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 group"
                        >
                            {submitted ? (
                                <>
                                    <CheckCircle2 className="w-5 h-5 animate-bounce" />
                                    Solicitud Enviada
                                </>
                            ) : (
                                <>
                                    Enviar Solicitud
                                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};
