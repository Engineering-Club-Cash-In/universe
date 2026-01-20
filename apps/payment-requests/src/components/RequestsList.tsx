import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { FileText, Clock, Search } from 'lucide-react';

interface PaymentRequest {
    id: string;
    department: string;
    paymentType: string;
    bankName: string;
    bankAccount: string;
    accountType: string;
    currency: string;
    amount: string;
    paymentDate: string;
    fileName: string | null;
    submittedAt: string;
    status: 'pending' | 'processed' | 'rejected';
}

export const RequestsList = () => {
    const [requests, setRequests] = useState<PaymentRequest[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const loadRequests = () => {
            const saved = localStorage.getItem('paymentRequests');
            if (saved) {
                setRequests(JSON.parse(saved));
            }
        };
        loadRequests();

        // Listen for storage events to update list if changed in another tab
        window.addEventListener('storage', loadRequests);
        return () => window.removeEventListener('storage', loadRequests);
    }, []);

    const filteredRequests = requests.filter(req =>
        req.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
        req.paymentType.toLowerCase().includes(searchTerm.toLowerCase()) ||
        req.bankName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'processed': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
            case 'rejected': return 'text-rose-400 bg-rose-400/10 border-rose-400/20';
            default: return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'processed': return 'Procesado';
            case 'rejected': return 'Rechazado';
            default: return 'Pendiente';
        }
    };

    return (
        <div className="text-zinc-100 p-4 font-sans selection:bg-indigo-500/30">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
                            Listado de Solicitudes
                        </h1>
                        <p className="text-zinc-400 mt-2">Gestione y visualice el estado de los pagos solicitados.</p>
                    </div>

                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                            type="text"
                            placeholder="Buscar por departamento, tipo o banco..."
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder:text-zinc-600"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 rounded-3xl shadow-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-zinc-800 text-zinc-400">
                                    <th className="px-6 py-4 font-medium">Fecha Solicitud</th>
                                    <th className="px-6 py-4 font-medium">Departamento</th>
                                    <th className="px-6 py-4 font-medium">Tipo Pago</th>
                                    <th className="px-6 py-4 font-medium">Beneficiario / Banco</th>
                                    <th className="px-6 py-4 font-medium text-right">Monto</th>
                                    <th className="px-6 py-4 font-medium">Fecha Pago</th>
                                    <th className="px-6 py-4 font-medium">Estado</th>
                                    <th className="px-6 py-4 font-medium text-center">Archivo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/50">
                                {filteredRequests.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-12 text-center text-zinc-500">
                                            No se encontraron solicitudes
                                        </td>
                                    </tr>
                                ) : (
                                    filteredRequests.map((req) => (
                                        <tr key={req.id} className="hover:bg-zinc-800/30 transition-colors">
                                            <td className="px-6 py-4 text-zinc-300">
                                                <div className="flex items-center gap-2">
                                                    <Clock className="w-4 h-4 text-zinc-600" />
                                                    {format(new Date(req.submittedAt), 'dd MMM yyyy HH:mm', { locale: es })}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="capitalize bg-zinc-800 border border-zinc-700 px-2 py-1 rounded-md text-xs text-zinc-300">
                                                    {req.department}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-zinc-300 capitalize">{req.paymentType}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="text-zinc-200 font-medium">{req.bankName}</span>
                                                    <span className="text-xs text-zinc-500 font-mono">{req.bankAccount}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right font-medium text-zinc-100">
                                                {req.currency} {parseFloat(req.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-6 py-4 text-zinc-300">
                                                {format(new Date(req.paymentDate), 'dd MMM yyyy', { locale: es })}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(req.status)}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${req.status === 'processed' ? 'bg-emerald-400' : req.status === 'rejected' ? 'bg-rose-400' : 'bg-amber-400'}`} />
                                                    {getStatusText(req.status)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {req.fileName ? (
                                                    <button className="text-indigo-400 hover:text-indigo-300 transition-colors" title={req.fileName}>
                                                        <FileText className="w-4 h-4 mx-auto" />
                                                    </button>
                                                ) : (
                                                    <span className="text-zinc-700">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
