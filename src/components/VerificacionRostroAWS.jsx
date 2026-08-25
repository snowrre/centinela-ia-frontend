/**
 * VerificacionRostroAWS.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Paso 2 del flujo de primer uso:
 *   1. Recibe la foto de la INE tomada en ValidacionINE como prop `fotoIne`
 *   2. Captura una selfie en vivo con la webcam del alumno
 *   3. Manda ambas fotos al endpoint /api/verificar_rostro (AWS Rekognition)
 *   4. Si el match supera el 80%, llama a onExito() para continuar al enrolamiento facial
 *
 * Props:
 *   fotoIne   {File}     — El objeto File de la credencial, pasado desde ValidacionINE
 *   onExito   {Function} — Callback al verificar con éxito
 *   darkMode  {boolean}  — Tema visual
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';

const videoConstraints = {
  width: 400,
  height: 400,
  facingMode: 'user',
};

/** Convierte un dataURL base64 (el screenshot de la webcam) a un objeto File real */
function dataURLtoFile(dataurl, filename) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

export default function VerificacionRostroAWS({ fotoIne, onExito, darkMode = false }) {
  const webcamRef = useRef(null);
  const [selfie, setSelfie]     = useState(null);
  const [fase, setFase]         = useState('camara'); // 'camara' | 'preview' | 'analizando' | 'exito' | 'error'
  const [mensaje, setMensaje]   = useState('');
  const [similitud, setSimilitud] = useState(null);

  // ── UI helpers ─────────────────────────────────────────────────────────────
  const bg   = darkMode ? 'bg-[#0a0a0a]' : 'bg-slate-50';
  const card = darkMode ? 'bg-[#111111] border-white/10' : 'bg-white border-slate-200';
  const text = darkMode ? 'text-white' : 'text-slate-900';
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500';

  // ── Capturar selfie ────────────────────────────────────────────────────────
  const capturar = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setSelfie(imageSrc);
      setFase('preview');
    }
  }, []);

  const retomar = () => {
    setSelfie(null);
    setFase('camara');
    setMensaje('');
    setSimilitud(null);
  };

  // ── Enviar a AWS Rekognition ───────────────────────────────────────────────
  const verificarIdentidad = async () => {
    if (!selfie || !fotoIne) {
      setMensaje('Faltan fotografías para la verificación.');
      return;
    }

    setFase('analizando');
    setMensaje('Analizando biometría facial con AWS Rekognition...');

    try {
      const archivoSelfie = dataURLtoFile(selfie, 'selfie.jpg');

      const formData = new FormData();
      formData.append('foto_ine', fotoIne);       // File original de la INE
      formData.append('foto_selfie', archivoSelfie);

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
      const response = await fetch(`${apiUrl}/api/verificar_rostro`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok && data.match) {
        setSimilitud(data.similitud.toFixed(1));
        setMensaje('¡Identidad verificada con éxito!');
        setFase('exito');
        setTimeout(() => onExito?.(), 2500);
      } else {
        setMensaje(data.mensaje || 'Los rostros no coinciden.');
        setFase('error');
      }
    } catch (error) {
      console.error('[VerificacionRostroAWS]', error);
      setMensaje('Error de conexión con el servidor.');
      setFase('error');
    }
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${bg} flex items-center justify-center p-4`}>
      <div className={`w-full max-w-md rounded-3xl border shadow-2xl p-8 ${card} flex flex-col items-center gap-6`}>

        {/* Encabezado */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-violet-600 mb-3">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <h2 className={`text-xl font-black ${text}`}>Verificación Facial</h2>
          <p className={`text-xs font-semibold uppercase tracking-widest ${sub}`}>
            Paso 2 de 3 · Comparación biométrica
          </p>
        </div>

        {/* Visor de cámara o selfie */}
        <div className={`relative w-64 h-64 rounded-full overflow-hidden border-4 shadow-lg ${
          fase === 'exito'      ? 'border-green-500 shadow-green-500/30'   :
          fase === 'error'      ? 'border-red-500   shadow-red-500/30'     :
          fase === 'analizando' ? 'border-violet-500 shadow-violet-500/40 animate-pulse' :
          'border-violet-400'
        }`}>

          {fase === 'camara' ? (
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={videoConstraints}
              className="w-full h-full object-cover scale-x-[-1]"
            />
          ) : (
            <img src={selfie} alt="Selfie capturada" className="w-full h-full object-cover scale-x-[-1]" />
          )}

          {/* Overlay de analizando */}
          {fase === 'analizando' && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
              <svg className="w-8 h-8 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-white text-xs font-bold text-center px-4">AWS analizando...</span>
            </div>
          )}

          {/* Overlay de éxito */}
          {fase === 'exito' && (
            <div className="absolute inset-0 bg-green-900/70 flex flex-col items-center justify-center gap-1">
              <svg className="w-14 h-14 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {similitud && <span className="text-green-300 font-black text-xl">{similitud}%</span>}
            </div>
          )}

          {/* Overlay de error */}
          {fase === 'error' && (
            <div className="absolute inset-0 bg-red-900/70 flex items-center justify-center">
              <svg className="w-12 h-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
          )}
        </div>

        {/* Mensaje de estado */}
        {mensaje && (
          <p className={`text-center text-sm font-semibold ${
            fase === 'exito' ? 'text-green-500' :
            fase === 'error' ? 'text-red-500'   : 'text-violet-400'
          }`}>
            {mensaje}
          </p>
        )}

        {/* Instrucción por defecto */}
        {!mensaje && (
          <p className={`text-center text-sm ${sub}`}>
            Mira directamente a la cámara con buena iluminación.
          </p>
        )}

        {/* Botones de acción */}
        <div className="w-full space-y-3">
          {fase === 'camara' && (
            <button
              onClick={capturar}
              className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 active:scale-95 text-white font-bold py-3 rounded-2xl shadow-lg shadow-violet-500/30 transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Tomar Fotografía
            </button>
          )}

          {fase === 'preview' && (
            <>
              <button
                onClick={verificarIdentidad}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 active:scale-95 text-white font-bold py-3 rounded-2xl shadow-lg shadow-green-500/30 transition-all duration-200"
              >
                Verificar Identidad
              </button>
              <button
                onClick={retomar}
                className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-bold py-3 rounded-2xl transition-all duration-200"
              >
                Volver a intentar
              </button>
            </>
          )}

          {fase === 'error' && (
            <button
              onClick={retomar}
              className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-bold py-3 rounded-2xl transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Intentar de nuevo
            </button>
          )}
        </div>

        <p className={`text-center text-xs ${sub} opacity-60 leading-relaxed`}>
          🔒 Tus imágenes se procesan y se descartan de inmediato.<br />
          No se almacenan fotografías en ningún servidor.
        </p>

      </div>
    </div>
  );
}
