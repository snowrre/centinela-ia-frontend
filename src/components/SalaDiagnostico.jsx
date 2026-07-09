import React, { useState, useEffect, useRef } from 'react';
// Usaremos los íconos de lucide-react para un diseño limpio
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export default function SalaDiagnostico({ onDiagnosticoCompletado }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState({
    camara: 'cargando', // 'cargando', 'ok', 'error'
    ia: 'cargando',
    red: 'cargando',
  });

  const [todoListo, setTodoListo] = useState(false);

  useEffect(() => {
    iniciarDiagnostico();
  }, []);

  useEffect(() => {
    // Si todos los estados están en 'ok', habilitamos el botón de inicio
    if (status.camara === 'ok' && status.ia === 'ok' && status.red === 'ok') {
      setTodoListo(true);
    }
  }, [status]);

  const iniciarDiagnostico = async () => {
    // 1. Prueba de Red
    if (navigator.onLine) {
      setStatus((prev) => ({ ...prev, red: 'ok' }));
    } else {
      setStatus((prev) => ({ ...prev, red: 'error' }));
    }

    // 2. Prueba de Cámara y Permisos
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStatus((prev) => ({ ...prev, camara: 'ok' }));
    } catch (error) {
      console.error("Error al acceder a la cámara:", error);
      setStatus((prev) => ({ ...prev, camara: 'error' }));
    }

    // 3. Prueba de WebGL / Motor de IA
    // Aquí simulamos la carga de los modelos de TensorFlow.js / @vladmandic/human
    try {
      // Si estuvieras inicializando tfjs, harías algo como: await tf.ready();
      // Simulamos un pequeño retraso de carga del modelo en memoria
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      // Validamos si WebGL está disponible en el navegador
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      
      if (gl && gl instanceof WebGLRenderingContext) {
        setStatus((prev) => ({ ...prev, ia: 'ok' }));
      } else {
        setStatus((prev) => ({ ...prev, ia: 'error' }));
      }
    } catch (error) {
      setStatus((prev) => ({ ...prev, ia: 'error' }));
    }
  };

  useEffect(() => {
    return () => {
      // Apagar la cámara de prueba al salir del diagnóstico
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const renderIcono = (estado) => {
    if (estado === 'cargando') return <Loader2 className="animate-spin text-blue-500 w-6 h-6" />;
    if (estado === 'ok') return <CheckCircle className="text-green-500 w-6 h-6" />;
    return <AlertCircle className="text-red-500 w-6 h-6" />;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 w-full">
      <div className="max-w-3xl w-full bg-white/5 rounded-3xl shadow-2xl overflow-hidden border border-white/10 backdrop-blur-md">
        
        {/* Encabezado */}
        <div className="bg-white/5 p-8 border-b border-white/10 text-center">
          <h2 className="text-3xl font-black tracking-tighter text-blue-400">Diagnóstico de Entorno (Edge AI)</h2>
          <p className="text-neutral-400 mt-3 max-w-xl mx-auto leading-relaxed">
            Verificando compatibilidad de hardware local para Centinela IA. Ningún video será transmitido al servidor, todo se procesa en tu dispositivo.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-8">
          
          {/* Panel de Video */}
          <div className="flex flex-col items-center justify-center bg-black rounded-2xl overflow-hidden border border-white/10 aspect-video relative shadow-inner">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover"
            />
            {status.camara !== 'ok' && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/90 backdrop-blur-sm">
                <p className="text-neutral-400 font-medium flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" /> Esperando acceso a la cámara...
                </p>
              </div>
            )}
          </div>

          {/* Lista de Verificación */}
          <div className="flex flex-col justify-center space-y-4">
            
            <div className="flex items-center space-x-4 bg-white/5 border border-white/5 p-5 rounded-2xl transition-all duration-300 hover:bg-white/10">
              <div className="flex-shrink-0 bg-black/50 p-2 rounded-full">{renderIcono(status.camara)}</div>
              <div>
                <h3 className="font-bold text-white tracking-tight">Cámara Web</h3>
                <p className="text-sm text-neutral-400 mt-1">Permisos otorgados y video capturado</p>
              </div>
            </div>

            <div className="flex items-center space-x-4 bg-white/5 border border-white/5 p-5 rounded-2xl transition-all duration-300 hover:bg-white/10">
              <div className="flex-shrink-0 bg-black/50 p-2 rounded-full">{renderIcono(status.ia)}</div>
              <div>
                <h3 className="font-bold text-white tracking-tight">Aceleración WebGL (GPU)</h3>
                <p className="text-sm text-neutral-400 mt-1">Motor de Visión Artificial cargado en memoria</p>
              </div>
            </div>

            <div className="flex items-center space-x-4 bg-white/5 border border-white/5 p-5 rounded-2xl transition-all duration-300 hover:bg-white/10">
              <div className="flex-shrink-0 bg-black/50 p-2 rounded-full">{renderIcono(status.red)}</div>
              <div>
                <h3 className="font-bold text-white tracking-tight">Conexión de Telemetría</h3>
                <p className="text-sm text-neutral-400 mt-1">Enlace estable para envío de alertas</p>
              </div>
            </div>

          </div>
        </div>

        {/* Botón de Acción */}
        <div className="p-8 bg-white/5 border-t border-white/10 flex justify-center">
          <button
            disabled={!todoListo}
            onClick={onDiagnosticoCompletado}
            className={`px-10 py-4 rounded-xl font-bold text-lg transition-all duration-500 flex items-center gap-3 ${
              todoListo 
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_40px_rgba(37,99,235,0.4)] hover:shadow-[0_0_60px_rgba(37,99,235,0.6)] scale-100' 
                : 'bg-white/5 text-neutral-500 cursor-not-allowed border border-white/10 scale-95'
            }`}
          >
            {todoListo ? 'Ingresar a la Evaluación' : (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> Procesando Diagnóstico...
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
