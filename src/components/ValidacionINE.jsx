import React, { useState } from 'react';

export default function ValidacionINE({ idAlumno, darkMode = false, onSuccess }) {
  const [archivo, setArchivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fase, setFase] = useState('inicio'); // 'inicio' | 'subiendo' | 'exito' | 'error'
  const [mensaje, setMensaje] = useState('');

  const handleSeleccionarArchivo = (e) => {
    const file = e.target.files[0];
    if (file) {
      setArchivo(file);
      const url = URL.createObjectURL(file);
      setPreview(url);
      setFase('inicio');
      setMensaje('');
    }
  };

  const enviarFotoAVercel = async () => {
    if (!archivo) return;
    
    setFase('subiendo');
    setMensaje('Analizando credencial con Inteligencia Artificial...');

    try {
      const formData = new FormData();
      formData.append('foto', archivo);
      // Usamos el idAlumno que entra por props
      formData.append('id_alumno', idAlumno || "9b1c8183-524d-4a48-9873-1ad87ae39576"); 

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
      const respuesta = await fetch(`${apiUrl}/api/leer_ine`, {
        method: 'POST',
        body: formData, 
      });

      const datos = await respuesta.json();

      if (!respuesta.ok) {
        throw new Error(datos.error || 'Error al procesar la INE');
      }

      setFase('exito');
      setMensaje(`¡Credencial leída! Hola, ${datos.nombre}`);
      
      // Pasamos tanto el nombre extraído COMO el archivo File de la INE al siguiente paso
      // para que VerificacionRostroAWS pueda hacer el face match
      setTimeout(() => {
        if (onSuccess) onSuccess({ nombre: datos.nombre, archivoIne: archivo });
      }, 2000);

    } catch (error) {
      console.error("Error en la conexión:", error);
      setFase('error');
      setMensaje(error.message || "Hubo un problema al leer la credencial.");
    }
  };

  // ── ESTILOS DINÁMICOS ──
  const bg = darkMode ? 'bg-[#0a0a0a]' : 'bg-slate-50';
  const card = darkMode ? 'bg-[#111111] border-white/10' : 'bg-white border-slate-200';
  const text = darkMode ? 'text-white' : 'text-slate-900';
  const sub = darkMode ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`min-h-screen ${bg} flex flex-col items-center justify-center p-4 transition-colors`}>
      <div className={`w-full max-w-md rounded-3xl border shadow-2xl p-8 ${card} flex flex-col items-center gap-6`}>
        
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-600/10 mb-2">
            <svg className="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z" />
            </svg>
          </div>
          <h2 className={`text-2xl font-black ${text}`}>Validación de Identidad</h2>
          <p className={`text-sm ${sub}`}>Sube una foto de tu credencial (INE) para verificar tu identidad antes del examen.</p>
        </div>

        {/* Zona de previsualización / Carga */}
        <div className={`relative w-full h-48 rounded-2xl overflow-hidden border-2 border-dashed flex items-center justify-center ${
          fase === 'exito' ? 'border-green-500 bg-green-500/10' :
          fase === 'error' ? 'border-red-500 bg-red-500/10' :
          preview ? 'border-blue-500/50' : 'border-slate-400/50 hover:border-blue-500'
        } transition-all`}>
          
          {preview ? (
            <img src={preview} alt="Vista previa" className="w-full h-full object-cover opacity-90" />
          ) : (
            <label className="cursor-pointer w-full h-full flex flex-col items-center justify-center gap-2">
              <svg className={`w-10 h-10 ${sub}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span className={`font-semibold ${text}`}>Haz clic para subir foto</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleSeleccionarArchivo} />
            </label>
          )}

          {/* Overlays de estado */}
          {fase === 'subiendo' && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center backdrop-blur-sm">
               <svg className="w-8 h-8 text-blue-400 animate-spin mb-2" fill="none" viewBox="0 0 24 24">
                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
               </svg>
               <span className="text-white font-bold text-sm">Analizando...</span>
            </div>
          )}
        </div>

        {/* Mensaje de respuesta */}
        {mensaje && (
          <p className={`text-center text-sm font-bold ${
            fase === 'exito' ? 'text-green-500' :
            fase === 'error' ? 'text-red-500' : 'text-blue-500'
          }`}>
            {mensaje}
          </p>
        )}

        {/* Botones */}
        <div className="w-full space-y-3">
          {preview && fase !== 'subiendo' && fase !== 'exito' && (
            <button
              onClick={enviarFotoAVercel}
              className="w-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold py-3 rounded-xl shadow-lg transition-all"
            >
              Verificar Identidad
            </button>
          )}

          {preview && fase !== 'subiendo' && (
             <label className="cursor-pointer w-full flex items-center justify-center gap-2 bg-slate-700/50 hover:bg-slate-700 active:scale-95 text-white font-bold py-3 rounded-xl transition-all">
               Cambiar foto
               <input type="file" accept="image/*" className="hidden" onChange={handleSeleccionarArchivo} />
             </label>
          )}
        </div>

      </div>
    </div>
  );
}
