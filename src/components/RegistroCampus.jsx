import React, { useEffect, useState } from 'react';
import { Building, UploadCloud, AlertCircle, ChevronRight, CheckCircle, Loader2 } from 'lucide-react';

export default function RegistroCampus() {
  const [paymentId, setPaymentId] = useState('');
  const [institution, setInstitution] = useState('');
  const [file, setFile] = useState(null);

  useEffect(() => {
    // Esto lee la URL completa (ej. /exito?payment_id=123456789)
    const searchParams = new URLSearchParams(window.location.search);
    const idExtraido = searchParams.get('payment_id');
    
    if (idExtraido) {
      setPaymentId(idExtraido);
      // Opcional: Limpiar la URL para que el usuario no vea el ID largo
      window.history.replaceState(null, '', '/registro-campus'); 
    }
  }, []);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resultData, setResultData] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setResultData(null);

    // ¡CRÍTICO! FormData empaca texto + archivo físico en una sola petición.
    // NUNCA pongas 'Content-Type': 'application/json' — el navegador genera el boundary solo.
    const formData = new FormData();
    formData.append('payment_id', paymentId);
    formData.append('nombre_institucion', institution);
    formData.append('archivo_csv', file);

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      
      const response = await fetch(`${API_URL}/api/crear-campus`, {
        method: 'POST',
        headers: {
          // SIN Content-Type — FormData lo genera con el boundary correcto automáticamente
          'ngrok-skip-browser-warning': 'true'
        },
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Ocurrió un error al registrar el campus.');
      }

      setSuccess(true);
      setResultData(data);
      console.log("Éxito:", data.mensaje);

    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Decorative background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="w-full max-w-md relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="bg-white/5 border border-white/10 rounded-[28px] p-8 md:p-10 backdrop-blur-3xl shadow-2xl">
          <div className="w-16 h-16 bg-blue-600/20 border border-blue-500/30 rounded-[20px] flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(37,99,235,0.2)]">
            <Building className="w-8 h-8 text-blue-500" />
          </div>
          
          <h2 className="text-3xl font-black tracking-tight mb-2">Configura tu Universidad</h2>
          <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
            Completa los datos para crear tu campus y generar los accesos de tus profesores.
          </p>
          
          {/* Si no hay payment_id, puedes mostrar un mensaje de error diciendo "Pago no detectado" */}
          {!paymentId ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-[20px] p-5 flex gap-4 items-start">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-400 text-sm font-medium leading-relaxed">
                Error: No se detectó un pago válido. Por favor, adquiere una licencia.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Error Message from Backend */}
              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-[20px] p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm font-medium">{errorMsg}</p>
                </div>
              )}

              {/* Success Message */}
              {success && resultData && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-[20px] p-4 flex gap-3 items-start">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm font-medium">
                    <p className="text-green-400 font-bold">{resultData.mensaje}</p>
                    {resultData.cuentas_fallidas?.length > 0 && (
                      <p className="text-yellow-400/80 mt-1 text-xs">
                        ⚠ {resultData.cuentas_fallidas.length} correo(s) ya existían y fueron omitidos.
                      </p>
                    )}
                    <p className="text-green-500/70 mt-2 text-xs">
                      Contraseña temporal: <span className="font-mono font-black text-green-400/90">Centinela + [matrícula]</span>
                    </p>
                  </div>
                </div>
              )}

              {/* El ID se guarda de forma invisible para enviarlo a Python */}
              <input type="hidden" value={paymentId} />
              
              <div className="space-y-2.5">
                <label className="text-xs font-black uppercase tracking-widest text-neutral-400">
                  Nombre de la Institución:
                </label>
                <div className="relative group">
                  <Building className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 group-focus-within:text-blue-400 transition-colors" />
                  <input 
                    type="text" 
                    placeholder="Ej. Universidad Tres Culturas" 
                    required 
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    disabled={loading || success}
                    className="w-full pl-11 pr-4 py-4 bg-white/5 border border-white/10 rounded-[20px] text-sm font-bold placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/50 focus:bg-blue-500/5 transition-all text-white disabled:opacity-50"
                  />
                </div>
              </div>
              
              <div className="space-y-2.5">
                <label className="text-xs font-black uppercase tracking-widest text-neutral-400">
                  CSV de Profesores:
                </label>
                <div className="relative group cursor-pointer">
                  <input 
                    type="file" 
                    accept=".csv" 
                    required 
                    onChange={(e) => setFile(e.target.files[0])}
                    disabled={loading || success}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                  />
                  <div className="w-full px-4 py-8 bg-white/5 border border-white/10 border-dashed rounded-[20px] flex flex-col items-center justify-center gap-3 group-hover:bg-white/10 group-hover:border-white/20 transition-all">
                    <UploadCloud className="w-6 h-6 text-neutral-400 group-hover:text-blue-400 transition-colors" />
                    <div className="text-center">
                      <p className="text-sm font-bold text-neutral-300">
                        {file ? file.name : "Seleccionar archivo .csv"}
                      </p>
                      <p className="text-xs font-medium text-neutral-500 mt-1">
                        Arrastra o haz clic para explorar
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              
              <button 
                type="submit" 
                disabled={loading || success}
                className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all rounded-[20px] text-white font-black text-[13px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(37,99,235,0.3)] mt-4 disabled:opacity-50 disabled:pointer-events-none"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creando Campus...
                  </>
                ) : success ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    ¡Completado!
                  </>
                ) : (
                  <>
                    Crear Campus y Generar Accesos
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
