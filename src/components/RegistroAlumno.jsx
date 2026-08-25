/**
 * RegistroAlumno.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Componente de registro de nuevo alumno con flujo KYC de 3 pasos:
 *
 *   PASO 1 — Formulario de datos
 *     → Nombre Completo, Correo Institucional, Matrícula
 *
 *   PASO 2 — Validación Documental (OCR con Google Cloud Vision)
 *     → El alumno sube foto de su INE
 *     → El backend extrae el nombre de la credencial
 *     → Antifraude: si el nombre del formulario NO coincide con el de la INE
 *       → Denegado inmediatamente (sin gastar consulta a AWS)
 *
 *   PASO 3 — Verificación Biométrica (AWS Rekognition)
 *     → Solo si los nombres coinciden, se activa la webcam
 *     → Se captura selfie y se compara contra la foto de la INE
 *     → Si supera 80% de similitud → cuenta creada en Supabase
 *
 * Props:
 *   darkMode   {boolean}   — Tema visual
 *   onExito    {Function}  — Callback al crear cuenta con éxito
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { supabase } from '../lib/supabase';

const videoConstraints = { width: 400, height: 400, facingMode: 'user' };

/** Normaliza un nombre para compararlo: quita acentos, a mayúsculas, recorta espacios extra */
function normalizarNombre(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte dataURL base64 (screenshot de webcam) a File real */
function dataURLtoFile(dataurl, filename) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

// ── Indicador de progreso de pasos ───────────────────────────────────────────
function PasoIndicador({ pasoActual }) {
  const pasos = [
    { num: 1, label: 'Datos' },
    { num: 2, label: 'Credencial' },
    { num: 3, label: 'Biometría' },
  ];
  return (
    <div className="flex items-center justify-center gap-2 w-full">
      {pasos.map((p, i) => (
        <React.Fragment key={p.num}>
          <div className="flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm transition-all duration-300 ${
              pasoActual > p.num  ? 'bg-green-500 text-white' :
              pasoActual === p.num ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40' :
              'bg-slate-700 text-slate-400'
            }`}>
              {pasoActual > p.num ? '✓' : p.num}
            </div>
            <span className={`text-xs font-semibold ${pasoActual === p.num ? 'text-blue-400' : 'text-slate-500'}`}>
              {p.label}
            </span>
          </div>
          {i < pasos.length - 1 && (
            <div className={`flex-1 h-0.5 mb-4 rounded-full transition-all duration-500 ${pasoActual > p.num + 1 ? 'bg-green-500' : pasoActual > p.num ? 'bg-blue-600' : 'bg-slate-700'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── PASO 1: Formulario de datos ───────────────────────────────────────────────
function FormularioDatos({ onSiguiente, darkMode }) {
  const [form, setForm] = useState({ nombre: '', correo: '', matricula: '' });
  const [error, setError] = useState('');

  const text = darkMode ? 'text-white' : 'text-slate-900';
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500';
  const inp  = darkMode
    ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-blue-500'
    : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-blue-500';

  const handleChange = (e) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSiguiente = async () => {
    const { nombre, correo, matricula } = form;
    if (!nombre.trim() || !correo.trim() || !matricula.trim()) {
      setError('Todos los campos son obligatorios.');
      return;
    }
    if (!correo.includes('@')) {
      setError('Ingresa un correo institucional válido.');
      return;
    }
    setError('');
    
    // 1. Extraemos el dominio del correo y le agregamos el @ al principio
    let dominioIngresado = "@" + correo.split('@')[1].toLowerCase();
    
    // 2. Tocamos la puerta de Supabase para ver si la universidad tiene convenio
    const { data: universidad, error: errorUni } = await supabase
      .from('universidades')
      .select('id, nombre_institucion')
      .eq('dominio_permitido', dominioIngresado)
      .maybeSingle();
      
    // 3. EL MURO DE SEGURIDAD (Aquí rebotamos a los intrusos)
    if (errorUni || !universidad) {
      setError(`Acceso denegado: El dominio @${dominioIngresado} no pertenece a ninguna universidad registrada en Centinela IA.`);
      return;
    }
    
    // 4. Universidad válida — creamos el registro del alumno en la BD
    //    (usamos upsert para tolerar el caso de que ya exista por un intento previo)
    const { error: errorInsert } = await supabase.from('alumnos').upsert([{
      id:               matricula,
      matricula:        matricula,
      nombre_completo:  nombre,
      correo:           correo,
      id_universidad:   universidad.id,
      kyc_completado:   false,
      biometria_registrada: false,
      created_at:       new Date().toISOString(),
    }], { onConflict: 'id' }); // <-- ¡Usamos 'id' porque es la llave primaria (Primary Key) y por defecto es Única en Supabase!

    if (errorInsert) {
      setError(`Error al crear la cuenta: ${errorInsert.message}`);
      return;
    }

    // 5. Pasamos los datos junto con el ID de la universidad validada
    onSiguiente({ ...form, id_universidad: universidad.id });
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <div>
        <label className={`text-xs font-bold uppercase tracking-widest ${sub} block mb-2`}>Nombre Completo</label>
        <input
          type="text"
          name="nombre"
          placeholder="Ej: María García López"
          value={form.nombre}
          onChange={handleChange}
          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all ${inp}`}
        />
      </div>
      <div>
        <label className={`text-xs font-bold uppercase tracking-widest ${sub} block mb-2`}>Correo Institucional</label>
        <input
          type="email"
          name="correo"
          placeholder="alumno@universidad.edu.mx"
          value={form.correo}
          onChange={handleChange}
          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all ${inp}`}
        />
      </div>
      <div>
        <label className={`text-xs font-bold uppercase tracking-widest ${sub} block mb-2`}>Matrícula</label>
        <input
          type="text"
          name="matricula"
          placeholder="Ej: A01234567"
          value={form.matricula}
          onChange={handleChange}
          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all ${inp}`}
        />
      </div>
      {error && <p className="text-red-400 text-sm font-semibold text-center">{error}</p>}
      <button
        onClick={handleSiguiente}
        className="w-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold py-3 rounded-xl shadow-lg shadow-blue-500/30 transition-all mt-2"
      >
        Continuar →
      </button>
    </div>
  );
}

// ── PASO 2: Validación Documental (INE + OCR + Antifraude) ────────────────────
function ValidacionDocumental({ datosFormulario, onSiguiente, darkMode }) {
  const [archivo, setArchivo]     = useState(null);
  const [preview, setPreview]     = useState(null);
  const [fase, setFase]           = useState('inicio'); // 'inicio'|'analizando'|'match'|'fraude'|'error'
  const [mensajeOcr, setMensajeOcr] = useState('');

  const sub = darkMode ? 'text-slate-400' : 'text-slate-500';

  const handleSeleccionar = (e) => {
    const file = e.target.files[0];
    if (file) {
      setArchivo(file);
      setPreview(URL.createObjectURL(file));
      setFase('inicio');
      setMensajeOcr('');
    }
  };

  const verificarINE = async () => {
    if (!archivo) return;
    setFase('analizando');
    setMensajeOcr('Google Cloud Vision analizando credencial...');

    try {
      // El microservicio Python solo recibe la foto y devuelve el nombre
      const formData = new FormData();
      formData.append('foto', archivo);

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
      const res = await fetch(`${apiUrl}/api/leer_ine`, { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Error al leer la INE');

      const nombreOcr        = normalizarNombre(data.nombre || '');
      const nombreFormulario = normalizarNombre(datosFormulario.nombre);

      // ── CANDADO ANTIFRAUDE (100% en React, sin Python) ────────────
      const palabrasFormulario = nombreFormulario.split(' ').filter(Boolean);
      const coincidencias = palabrasFormulario.filter(p => nombreOcr.includes(p));
      const porcentajeMatch = coincidencias.length / palabrasFormulario.length;

      if (porcentajeMatch >= 0.6) {
        // ✅ Coincidencia aprobada — registrar en Supabase desde el frontend
        await supabase.from('verificacion_identidad').insert([{
          id_alumno:            datosFormulario.matricula, // usamos matrícula como ID temporal
          ine_nombre_extraido:  data.nombre,
          ocr_exitoso:          true,
          estado_verificacion:  'pendiente_biometria',
        }]);

        setFase('match');
        setMensajeOcr(`✅ Nombre verificado. Coincidencia: ${Math.round(porcentajeMatch * 100)}%`);
        setTimeout(() => onSiguiente(archivo), 1800);
      } else {
        // 🚫 Posible suplantación — bloquear sin gastar AWS
        setFase('fraude');
        setMensajeOcr(
          `🚫 Alerta de seguridad: "${datosFormulario.nombre}" no coincide con la credencial (encontrado: "${data.nombre}"). Registro denegado.`
        );
      }
    } catch (err) {
      setFase('error');
      setMensajeOcr(err.message || 'Error de conexión con el servidor.');
    }
  };

  return (
    <div className="flex flex-col items-center gap-5 w-full">
      <p className={`text-sm text-center ${sub}`}>
        Sube una foto clara de tu <strong>INE / credencial oficial</strong> con el nombre completo visible.
      </p>

      {/* Zona de carga */}
      <div className={`relative w-full h-44 rounded-2xl overflow-hidden border-2 border-dashed flex items-center justify-center transition-all ${
        fase === 'match'  ? 'border-green-500 bg-green-500/10' :
        fase === 'fraude' || fase === 'error' ? 'border-red-500 bg-red-500/10' :
        preview           ? 'border-blue-500/50' :
        'border-slate-600 hover:border-blue-500 cursor-pointer'
      }`}>
        {preview ? (
          <img src={preview} alt="INE" className="w-full h-full object-cover" />
        ) : (
          <label className="cursor-pointer flex flex-col items-center gap-2 p-4">
            <svg className={`w-10 h-10 ${sub}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className={`font-semibold text-sm ${sub}`}>Haz clic para subir tu INE</span>
            <input type="file" accept="image/*" className="hidden" onChange={handleSeleccionar} />
          </label>
        )}

        {/* Overlay de carga */}
        {fase === 'analizando' && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
            <svg className="w-8 h-8 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-white text-xs font-bold">OCR en proceso...</span>
          </div>
        )}
      </div>

      {/* Mensaje de resultado */}
      {mensajeOcr && (
        <p className={`text-sm font-semibold text-center leading-relaxed ${
          fase === 'match'  ? 'text-green-400' :
          fase === 'fraude' ? 'text-red-400'   :
          fase === 'error'  ? 'text-red-400'   : 'text-blue-400'
        }`}>
          {mensajeOcr}
        </p>
      )}

      {/* Botones */}
      {preview && fase !== 'analizando' && fase !== 'match' && (
        <button
          onClick={verificarINE}
          disabled={fase === 'fraude'}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed active:scale-95 text-white font-bold py-3 rounded-xl shadow-lg transition-all"
        >
          {fase === 'fraude' ? 'Registro Bloqueado' : 'Verificar Credencial'}
        </button>
      )}
      {preview && (fase === 'error' || fase === 'fraude') && (
        <label className="cursor-pointer w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-bold py-3 rounded-xl transition-all text-sm">
          Subir otra foto
          <input type="file" accept="image/*" className="hidden" onChange={handleSeleccionar} />
        </label>
      )}
    </div>
  );
}

// ── PASO 3: Verificación Biométrica (webcam + AWS Rekognition) ────────────────
function VerificacionBiometrica({ datosFormulario, archivoIne, darkMode, onExito }) {
  const webcamRef = useRef(null);
  const [selfie, setSelfie]       = useState(null);
  const [fase, setFase]           = useState('camara'); // 'camara'|'preview'|'analizando'|'exito'|'error'
  const [mensaje, setMensaje]     = useState('');
  const [similitud, setSimilitud] = useState(null);

  const sub = darkMode ? 'text-slate-400' : 'text-slate-500';

  const capturar = useCallback(() => {
    const img = webcamRef.current?.getScreenshot();
    if (img) { setSelfie(img); setFase('preview'); }
  }, []);

  const retomar = () => { setSelfie(null); setFase('camara'); setMensaje(''); setSimilitud(null); };

  const verificar = async () => {
    setFase('analizando');
    setMensaje('AWS Rekognition comparando biometría...');
    try {
      const selfieFile = dataURLtoFile(selfie, 'selfie.jpg');
      const formData = new FormData();
      formData.append('foto_ine', archivoIne);
      formData.append('foto_selfie', selfieFile);

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
      const res = await fetch(`${apiUrl}/api/verificar_rostro`, { method: 'POST', body: formData });
      const data = await res.json();

      if (res.ok && data.match) {
        setSimilitud(data.similitud.toFixed(1));
        setMensaje(`¡Identidad confirmada! Similitud: ${data.similitud.toFixed(1)}%`);
        setFase('exito');

        // Crear cuenta en Supabase
        await crearCuentaEnSupabase();
      } else {
        setMensaje(data.mensaje || 'Los rostros no coinciden. Intenta de nuevo.');
        setFase('error');
      }
    } catch (err) {
      setMensaje('Error de conexión. Intenta de nuevo.');
      setFase('error');
    }
  };

  const crearCuentaEnSupabase = async () => {
    try {
      // El alumno ya existe en la BD desde el Paso 1 (FormularioDatos).
      // Solo actualizamos su fila marcando que completó el KYC con AWS Rekognition.
      const { error } = await supabase
        .from('alumnos')
        .update({
          kyc_completado:   true,
          updated_at:       new Date().toISOString(),
        })
        .eq('matricula', datosFormulario.matricula);

      if (error) throw error;
      setTimeout(() => onExito?.(datosFormulario), 2500);
    } catch (err) {
      console.error('[RegistroAlumno] Error actualizando cuenta:', err);
      setMensaje('Error al guardar la cuenta. Contacta al administrador.');
      setFase('error');
    }
  };

  return (
    <div className="flex flex-col items-center gap-5 w-full">
      <p className={`text-sm text-center ${sub}`}>
        Mira a la cámara con buena iluminación. AWS comparará tu selfie contra tu credencial.
      </p>

      {/* Visor circular */}
      <div className={`relative w-56 h-56 rounded-full overflow-hidden border-4 shadow-lg ${
        fase === 'exito'      ? 'border-green-500 shadow-green-500/30' :
        fase === 'error'      ? 'border-red-500   shadow-red-500/30'   :
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
          <img src={selfie} alt="Selfie" className="w-full h-full object-cover scale-x-[-1]" />
        )}

        {fase === 'analizando' && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
            <svg className="w-7 h-7 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="text-white text-xs font-bold">AWS analizando...</span>
          </div>
        )}

        {fase === 'exito' && (
          <div className="absolute inset-0 bg-green-900/70 flex flex-col items-center justify-center gap-1">
            <svg className="w-12 h-12 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            {similitud && <span className="text-green-300 font-black text-lg">{similitud}%</span>}
          </div>
        )}

        {fase === 'error' && (
          <div className="absolute inset-0 bg-red-900/70 flex items-center justify-center">
            <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </div>
        )}
      </div>

      {mensaje && (
        <p className={`text-sm font-semibold text-center ${
          fase === 'exito' ? 'text-green-400' : fase === 'error' ? 'text-red-400' : 'text-violet-400'
        }`}>{mensaje}</p>
      )}

      {/* Botones */}
      {fase === 'camara' && (
        <button onClick={capturar} className="w-full bg-violet-600 hover:bg-violet-500 active:scale-95 text-white font-bold py-3 rounded-xl shadow-lg shadow-violet-500/30 transition-all">
          📸 Tomar Selfie
        </button>
      )}
      {fase === 'preview' && (
        <>
          <button onClick={verificar} className="w-full bg-green-600 hover:bg-green-500 active:scale-95 text-white font-bold py-3 rounded-xl transition-all">
            Verificar Identidad
          </button>
          <button onClick={retomar} className="w-full bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-bold py-3 rounded-xl transition-all">
            Volver a intentar
          </button>
        </>
      )}
      {fase === 'error' && (
        <button onClick={retomar} className="w-full bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-bold py-3 rounded-xl transition-all">
          🔄 Intentar de nuevo
        </button>
      )}
    </div>
  );
}

// ── COMPONENTE PRINCIPAL ──────────────────────────────────────────────────────
export default function RegistroAlumno({ darkMode = false, onExito }) {
  const [paso, setPaso]             = useState(1);
  const [datosFormulario, setDatos] = useState(null);
  const [archivoIne, setArchivoIne] = useState(null);

  const bg   = darkMode ? 'bg-[#0a0a0a]' : 'bg-slate-50';
  const card = darkMode ? 'bg-[#111111] border-white/10' : 'bg-white border-slate-200';
  const text = darkMode ? 'text-white' : 'text-slate-900';

  const titulos = ['Crea tu cuenta', 'Valida tu identidad', 'Verificación facial'];
  const subtitulos = [
    'Ingresa tus datos institucionales para comenzar.',
    'Necesitamos confirmar que tú eres tú antes de continuar.',
    'El último paso: compara tu selfie con tu credencial.',
  ];

  return (
    <div className={`min-h-screen ${bg} flex items-center justify-center p-4`}>
      <div className={`w-full max-w-md rounded-3xl border shadow-2xl p-8 ${card} flex flex-col items-center gap-6`}>

        {/* Ícono + título */}
        <div className="text-center space-y-1 w-full">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-600 mb-3">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/>
            </svg>
          </div>
          <h2 className={`text-xl font-black ${text}`}>{titulos[paso - 1]}</h2>
          <p className="text-sm text-slate-500">{subtitulos[paso - 1]}</p>
        </div>

        {/* Indicador de pasos */}
        <PasoIndicador pasoActual={paso} />

        {/* Contenido del paso activo */}
        {paso === 1 && (
          <FormularioDatos
            darkMode={darkMode}
            onSiguiente={(datos) => { setDatos(datos); setPaso(2); }}
          />
        )}
        {paso === 2 && (
          <ValidacionDocumental
            darkMode={darkMode}
            datosFormulario={datosFormulario}
            onSiguiente={(archivo) => { setArchivoIne(archivo); setPaso(3); }}
          />
        )}
        {paso === 3 && (
          <VerificacionBiometrica
            darkMode={darkMode}
            datosFormulario={datosFormulario}
            archivoIne={archivoIne}
            onExito={onExito}
          />
        )}

        <p className="text-center text-xs text-slate-600 leading-relaxed">
          🔒 Tus datos biométricos se cifran y nunca se almacenan como fotografía.
        </p>
      </div>
    </div>
  );
}
