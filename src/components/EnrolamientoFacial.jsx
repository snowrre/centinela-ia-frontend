/**
 * EnrolamientoFacial.jsx  ─── Componente de Registro de FaceID
 * ─────────────────────────────────────────────────────────────────────────────
 * Pantalla de primer uso: permite al alumno registrar su huella biométrica
 * antes de presentar un examen por primera vez.
 *
 * Flujo:
 *   1. Carga los modelos de @vladmandic/human (reutiliza el singleton global)
 *   2. Inicia la cámara (con anti-cámara-virtual heredado de useFaceDetection)
 *   3. Al presionar "Escanear Rostro":
 *      a. Captura el embedding facial real de 512 dimensiones
 *      b. Hace UPDATE en la tabla `alumnos` → huella_biometrica + biometria_registrada
 *   4. Llama a onSuccess() para continuar al flujo normal
 *
 * Props:
 *   correoInstitucional  {string}   — Correo del alumno para el WHERE del UPDATE
 *   matricula            {string}   — Matrícula del alumno (display + fallback)
 *   darkMode             {boolean}  — Tema visual
 *   onSuccess            {Function} — Callback al guardar con éxito
 *   onError              {Function} — Callback en error irrecuperable
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useFaceDetection } from '../hooks/useFaceDetection';

// ────────────────────────────────────────────────────────────────────────────
// Constantes de UX
// ────────────────────────────────────────────────────────────────────────────
const MIN_CAPTURAS = 3;        // Número de frames con rostro antes de promediar
const DETECT_INTERVAL_MS = 150; // Throttle de inferencia (~7 FPS, seguro para Celeron)

export default function EnrolamientoFacial({
  correoInstitucional,
  matricula,
  darkMode = false,
  onSuccess,
  onError,
}) {
  // ── Hooks de cámara e IA ───────────────────────────────────────────────────
  const {
    loadModels,
    startCamera,
    detectFaceInFrame,
    stopCamera,
    modelsLoaded,
  } = useFaceDetection();

  // ── Referencias ──────────────────────────────────────────────────────────
  const videoRef          = useRef(null);
  const rafRef            = useRef(null);
  const isDetectingRef    = useRef(false);
  const lastDetectTimeRef = useRef(0);
  const capturaRef        = useRef([]);      // Acumula embeddings para promediar
  const escaneandoRef     = useRef(false);   // Guard: evita doble clic

  // ── Estado de UI ──────────────────────────────────────────────────────────
  // 'cargando_modelos' | 'listo' | 'escaneando' | 'guardando' | 'exito' | 'error'
  const [fase, setFase]       = useState('cargando_modelos');
  const [mensaje, setMensaje] = useState('Iniciando sistema biométrico...');
  const [progreso, setProgreso] = useState(0);   // 0-100 para la barra de captura
  const [errorDetalle, setErrorDetalle] = useState('');

  // ── BOOTSTRAP: modelos → cámara ──────────────────────────────────────────
  useEffect(() => {
    let cancelado = false;

    const arrancar = async () => {
      setMensaje('Cargando motor de Inteligencia Artificial...');
      const ok = await loadModels();
      if (cancelado) return;

      if (!ok) {
        setErrorDetalle('No se pudieron cargar los modelos de IA. Verifica tu conexión.');
        setFase('error');
        onError?.('MODEL_LOAD_FAILED');
        return;
      }

      setMensaje('Activando cámara...');
      try {
        await startCamera(videoRef.current);
      } catch (err) {
        if (cancelado) return;
        if (err.message === 'VIRTUAL_CAMERA_DETECTED') {
          setErrorDetalle('Cámara virtual detectada (OBS, ManyCam...). Usa tu webcam física.');
        } else if (err.message === 'PERMISOS_DENEGADOS') {
          setErrorDetalle('Permisos de cámara denegados. Habilítalos en el navegador y recarga.');
        } else {
          setErrorDetalle('No se pudo acceder a la cámara. Recarga la página e inténtalo de nuevo.');
        }
        setFase('error');
        onError?.(err.message);
        return;
      }

      if (!cancelado) {
        setMensaje('¡Cámara lista! Coloca tu rostro en el centro del círculo y presiona "Escanear Rostro".');
        setFase('listo');
      }
    };

    arrancar();

    // Protocolo de limpieza profunda al desmontar (Deep Cleanup)
    return () => {
      cancelado = true;
      detenerRaf();
      stopCamera();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── RAF loop (solo activo durante el escaneo) ─────────────────────────────
  const detenerRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    isDetectingRef.current = false;
    lastDetectTimeRef.current = 0;
  }, []);

  const iniciarRafDeCaptura = useCallback(() => {
    if (rafRef.current) return;

    const loop = async (timestamp) => {
      // ¿Seguimos en modo escaneo?
      if (!escaneandoRef.current) return;

      const now = performance.now();
      const msSinceLast = now - lastDetectTimeRef.current;

      if (msSinceLast >= DETECT_INTERVAL_MS && !isDetectingRef.current) {
        isDetectingRef.current = true;
        try {
          const h = window.__HUMAN_INSTANCE__;
          if (!h?.models) {
            // Motor aún calentando — esperar
            rafRef.current = requestAnimationFrame(loop);
            isDetectingRef.current = false;
            return;
          }

          const result = await detectFaceInFrame(videoRef.current);

          if (result?.face?.length > 0) {
            const embedding = result.face[0]?.embedding;
            if (embedding && embedding.length > 0) {
              capturaRef.current.push(Array.from(embedding));
              const nuevoPct = Math.min(
                Math.round((capturaRef.current.length / MIN_CAPTURAS) * 100),
                100
              );
              setProgreso(nuevoPct);

              // ¿Tenemos suficientes muestras?
              if (capturaRef.current.length >= MIN_CAPTURAS) {
                detenerRaf();
                await guardarHuellaEnSupabase();
                return;
              }
            }
          }
        } finally {
          isDetectingRef.current = false;
          lastDetectTimeRef.current = performance.now();
        }
      }

      if (escaneandoRef.current) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [detectFaceInFrame, detenerRaf]);

  // ── Promediar embeddings (más estable que un solo frame) ─────────────────
  const promediarEmbeddings = (listaEmbeddings) => {
    if (!listaEmbeddings || listaEmbeddings.length === 0) return null;
    const dim = listaEmbeddings[0].length;
    const suma = new Array(dim).fill(0);
    listaEmbeddings.forEach(emb => {
      emb.forEach((v, i) => { suma[i] += v; });
    });
    return suma.map(v => v / listaEmbeddings.length);
  };

  // ── Guardado en Supabase ──────────────────────────────────────────────────
  const guardarHuellaEnSupabase = async () => {
    setFase('guardando');
    setMensaje('Cifrando y guardando tu huella biométrica...');

    try {
      const vectorFinal = promediarEmbeddings(capturaRef.current);

      if (!vectorFinal) {
        throw new Error('No se pudo calcular el vector biométrico.');
      }

      // Agregamos .select() para forzar a Supabase a decirnos qué actualizó
      const { data, error } = await supabase
        .from('alumnos')
        .update({
          huella_biometrica: vectorFinal,
          biometria_registrada: true,
        })
        .eq('matricula', matricula) // <-- Usamos la matrícula como llave maestra
        .select(); 

      if (error) throw error;
      
      // Pequeña validación para asegurarnos de que no hubo fallo silencioso
      if (!data || data.length === 0) {
          console.error("Fallo silencioso: No se encontró la matrícula en la BD.");
          throw new Error("No se pudo guardar la biometría, verifica tu conexión.");
      } else {
          console.log("¡Biometría guardada con éxito!", data);
      }

      setMensaje('¡FaceID configurado con éxito! Tu identidad quedó registrada.');
      setFase('exito');
      setTimeout(() => onSuccess?.(), 2500);

    } catch (err) {
      console.error('[EnrolamientoFacial] Error al guardar huella:', err);
      setErrorDetalle('Hubo un error al guardar en la base de datos. Intenta de nuevo.');
      setFase('error');
      setProgreso(0);
      capturaRef.current = [];
      escaneandoRef.current = false;
    }
  };

  // ── Disparador del botón ──────────────────────────────────────────────────
  const iniciarEscaneo = useCallback(() => {
    if (escaneandoRef.current || fase !== 'listo') return;
    capturaRef.current = [];
    setProgreso(0);
    escaneandoRef.current = true;
    setFase('escaneando');
    setMensaje(`Analizando tu rostro... (${MIN_CAPTURAS} muestras)`);
    iniciarRafDeCaptura();
  }, [fase, iniciarRafDeCaptura]);

  const reintentar = useCallback(() => {
    detenerRaf();
    capturaRef.current = [];
    escaneandoRef.current = false;
    setProgreso(0);
    setFase('listo');
    setErrorDetalle('');
    setMensaje('¡Cámara lista! Coloca tu rostro en el centro del círculo y presiona "Escanear Rostro".');
  }, [detenerRaf]);

  // ── RENDER ────────────────────────────────────────────────────────────────
  const bg   = darkMode ? 'bg-[#0a0a0a]' : 'bg-slate-50';
  const card = darkMode ? 'bg-[#111111] border-white/10' : 'bg-white border-slate-200';
  const text = darkMode ? 'text-white' : 'text-slate-900';
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`min-h-screen ${bg} flex items-center justify-center p-4`}>
      <div className={`w-full max-w-md rounded-3xl border shadow-2xl p-8 ${card} flex flex-col items-center gap-6`}>

        {/* Encabezado */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-600 mb-3">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h2 className={`text-xl font-black ${text}`}>Configuración de Seguridad</h2>
          <p className={`text-xs font-semibold uppercase tracking-widest ${sub}`}>
            {matricula ? `Alumno: ${matricula}` : 'Registro biométrico'}
          </p>
        </div>

        {/* Visor circular de cámara */}
        <div className={`relative w-64 h-64 rounded-full overflow-hidden border-4 shadow-lg ${
          fase === 'exito'    ? 'border-green-500 shadow-green-500/30' :
          fase === 'error'    ? 'border-red-500   shadow-red-500/30'   :
          fase === 'escaneando' || fase === 'guardando' ? 'border-blue-500 shadow-blue-500/40 animate-pulse' :
          'border-blue-400'
        }`}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover scale-x-[-1]"
          />

          {/* Overlay de estado */}
          {(fase === 'cargando_modelos' || fase === 'guardando') && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
              <svg className="w-8 h-8 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-white text-xs font-bold text-center px-4">
                {fase === 'guardando' ? 'Guardando...' : 'Cargando IA...'}
              </span>
            </div>
          )}

          {fase === 'exito' && (
            <div className="absolute inset-0 bg-green-900/70 flex flex-col items-center justify-center gap-2">
              <svg className="w-14 h-14 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          )}

          {fase === 'error' && (
            <div className="absolute inset-0 bg-red-900/70 flex flex-col items-center justify-center gap-2">
              <svg className="w-12 h-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
          )}
        </div>

        {/* Barra de progreso de captura */}
        {(fase === 'escaneando') && (
          <div className="w-full space-y-1">
            <div className="flex justify-between text-xs font-bold text-blue-400">
              <span>Capturando muestras</span>
              <span>{progreso}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-300"
                style={{ width: `${progreso}%` }}
              />
            </div>
          </div>
        )}

        {/* Mensaje de estado */}
        <p className={`text-center text-sm font-medium ${
          fase === 'exito' ? 'text-green-400' :
          fase === 'error' ? 'text-red-400' :
          sub
        }`}>
          {fase === 'error' ? errorDetalle : mensaje}
        </p>

        {/* Botones de acción */}
        <div className="w-full space-y-3">
          {(fase === 'listo') && (
            <button
              onClick={iniciarEscaneo}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold py-3 rounded-2xl shadow-lg shadow-blue-500/30 transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Escanear Rostro
            </button>
          )}

          {(fase === 'escaneando' || fase === 'guardando') && (
            <div className="w-full flex items-center justify-center gap-2 bg-blue-600/50 text-white/70 font-bold py-3 rounded-2xl cursor-not-allowed">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {fase === 'guardando' ? 'Guardando en la nube...' : 'Escaneando...'}
            </div>
          )}

          {fase === 'error' && (
            <button
              onClick={reintentar}
              className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-bold py-3 rounded-2xl transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Intentar de nuevo
            </button>
          )}
        </div>

        {/* Nota de privacidad */}
        <p className={`text-center text-xs ${sub} opacity-60 leading-relaxed`}>
          🔒 Tu huella facial se almacena como un vector matemático cifrado.<br />
          No es una fotografía y nunca puede reconstruirse tu imagen.
        </p>
      </div>
    </div>
  );
}
