/**
 * BiometricAuth.jsx  ─── Componente de Prueba de Vida
 * ─────────────────────────────────────────────────────────────────────────────
 * Fase 1 del flujo biométrico: captura y valida la identidad del alumno
 * ANTES de que comience el examen.
 *
 * MIGRACIÓN face-api.js → @vladmandic/human
 * ──────────────────────────────────────────
 * • Bucle de análisis migrado de setInterval a requestAnimationFrame (RAF).
 *   RAF se sincroniza con el ciclo de pintado del GPU → más eficiente y sin
 *   bloquear el hilo principal entre frames.
 *
 * • Canvas superpuesto sobre el <video>: Human dibuja la malla facial en
 *   tiempo real para darle retroalimentación visual al alumno.
 *
 * • El descriptor del Rostro Maestro ahora es un Float32Array de 512 dimensiones
 *   (vs 128 de face-api.js).
 *
 * Flujo interno:
 *   1. Carga los modelos de @vladmandic/human (incluye warmup en WebGL)
 *   2. Inicia la cámara web del alumno
 *   3. Muestra el reto biométrico dinámico (parpadear OR sonreír, aleatorio)
 *   4. Analiza frame a frame con useLivenessChallenge (vía RAF loop)
 *   5. Human dibuja la malla facial sobre el canvas en cada frame
 *   6. Al superar el reto → extrae el embedding y lo guarda en BiometricContext
 *   7. Llama a onSuccess() para continuar al examen
 *
 * Diseño: mantiene el sistema de Tailwind/dark mode del proyecto.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, RotateCcw, ShieldCheck, Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { useFaceDetection } from '../hooks/useFaceDetection';
import { useLivenessChallenge } from '../hooks/useLivenessChallenge';
import { useBiometric } from '../context/BiometricContext';
import { supabase } from '../lib/supabase';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * @param {Object}   props
 * @param {Function} props.onSuccess    — Callback al superar la prueba de vida
 * @param {Function} props.onError      — Callback en error irrecuperable
 * @param {boolean}  props.darkMode
 * @param {Object}   props.studentInfo  — { matricula, nombre_completo }
 */
export default function BiometricAuth({ onSuccess, onError, darkMode, studentInfo }) {
  const { setRostroMaestro, setLivenessApproved } = useBiometric();
  const {
    loadModels,
    startCamera,
    detectFaceInFrame,
    stopCamera,
    modelsLoaded,
    human,            // Instancia Human para human.draw() sobre el canvas
  } = useFaceDetection();

  const {
    challengeStatus,
    challengeStep,
    progress,
    analyzeFrame,
    resetChallenge,
  } = useLivenessChallenge();

  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const rafRef        = useRef(null);      // requestAnimationFrame handle
  const successRef    = useRef(false);     // Guard: evita disparar onSuccess dos veces

  // ── Refs del throttle de FPS (NO son estado de React) ──────────────────────
  // Usar useRef en lugar de variables locales evita que el cierre de
  // la función loop() capture valores obsoletos entre re-renders.
  const lastDetectTimeRef = useRef(0);     // Timestamp del último human.detect() completado
  const isDetectingRef    = useRef(false); // Guard: evita llamadas concurrentes a detect()

  const [uiPhase, setUiPhase]       = useState('loading_models');
  // 'loading_models' | 'starting_camera' | 'challenge' | 'success' | 'error'
  const [errorMsg, setErrorMsg]     = useState('');
  const [loadingStep, setLoadingStep] = useState(0);

  // ── BOOTSTRAP: Cargar modelos → cámara → iniciar reto ──────────────────────
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setUiPhase('loading_models');
      setLoadingStep(1);

      const ok = await loadModels();
      if (cancelled) return;
      if (!ok) {
        setErrorMsg('No se pudieron cargar los modelos de IA. Verifica tu conexión a internet.');
        setUiPhase('error');
        return;
      }
      setLoadingStep(3);

      setUiPhase('starting_camera');
      try {
        await startCamera(videoRef.current);
      } catch (err) {
        if (cancelled) return;
        if (err.message === 'VIRTUAL_CAMERA_DETECTED') {
          setErrorMsg('Cámara virtual detectada (OBS, ManyCam, etc.). Usa tu webcam física.');
        } else {
          setErrorMsg('No se pudo acceder a la cámara. Concede permiso y recarga la página.');
        }
        setUiPhase('error');
        onError?.(err);
        return;
      }

      if (!cancelled) {
        setLoadingStep(4);
        setUiPhase('challenge');
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
      stopRafLoop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Arrancar el RAF loop cuando uiPhase cambia a 'challenge' ───────────────
  useEffect(() => {
    // Bug #2 Fix: flag local de "este efecto está vigente"
    // En React StrictMode, el componente se monta dos veces. Si el primer
    // cleanup corre DESPUÉS del segundo mount, rafRef.current ya fue
    // reiniciado y el guard `if (rafRef.current) return` no protege.
    // Con este flag, solo el efecto más reciente puede arrancar el loop.
    let active = true;

    if (uiPhase === 'challenge') {
      if (active) startRafLoop();
    } else {
      stopRafLoop();
    }
    return () => {
      active = false;
      stopRafLoop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPhase]);

  // ── BUCLE RAF con THROTTLE de 10 FPS ─────────────────────────────────────
  //
  // Arquitectura de dos niveles:
  //   • RAF corre al ritmo del monitor (~60fps) → el canvas siempre se ve fluido
  //   • human.detect() se llama máximo cada DETECT_INTERVAL_MS (~100ms = 10 FPS)
  //
  // Por qué esta separación:
  //   • En equipos Celeron/Pentium, detect() puede tardar 80-200ms por frame.
  //   • Sin el throttle, el bucle llama a detect() sin haber terminado el anterior
  //     → la cola se satura → el navegador congela la pestaña.
  //   • Con el throttle, el canvas se dibuja siempre (suave), pero la IA solo
  //     procesa cuando la CPU está lista.
  //
  const DETECT_INTERVAL_MS = 100; // 1000ms / 10 FPS = 100ms entre detecciones

  const startRafLoop = useCallback(() => {
    if (rafRef.current) return; // Ya corriendo

    console.log('[BiometricAuth] 🚀 RAF loop iniciado — esperando human.ready...');
    // Flag interno para loggear sólo UNA vez que el candado se abre
    let humanReadyLogged = false;

    const loop = async (timestamp) => {
      // Guard: si el reto ya fue superado, salir del bucle limpiamente
      if (successRef.current) return;

      // Fix #ALPHA: leer el singleton DENTRO del loop, SIEMPRE en caliente.
      // Nunca desde el closure del useCallback — ese valor puede estar
      // congelado con human.ready = false si WASM tardó en compilar.
      const h = window.__HUMAN_INSTANCE__;

      // CANDADO: Si el engine aún no terminó warmup(), saltamos el frame.
      // NOTA: en @vladmandic/human v3.3.6 la propiedad .ready no existe
      // (undefined). Usamos .models que sí está disponible tras h.load().
      if (!h?.models) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Log diagnóstico: imprime UNA sola vez cuando el candado se abre
      if (!humanReadyLogged) {
        humanReadyLogged = true;
        console.log('[BiometricAuth] 🟢 human.models listo — arrancando inferencia.');
      }

      const canvas = canvasRef.current;
      const video  = videoRef.current;

      // Fix #BETA: sincronizar canvas solo si el video tiene frames reales (>= 3)
      if (canvas && video && video.readyState >= 3) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width  = video.videoWidth  || 640;
          canvas.height = video.videoHeight || 480;
        }
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }

      // ── Throttle: ¿Pasaron ya los DETECT_INTERVAL_MS? ───────────────────
      const now = performance.now();
      const msSinceLast = now - lastDetectTimeRef.current;
      const isReady = msSinceLast >= DETECT_INTERVAL_MS;

      if (isReady && !isDetectingRef.current) {
        isDetectingRef.current = true;

        try {
          const result = await detectFaceInFrame(video);

          if (result && !successRef.current) {
            // ── Pintar la malla facial sobre el canvas transparente ────────────
            if (canvas && result.face.length > 0) {
              h.draw.face(canvas, result.face, {
                drawBoxes:    false,
                drawPoints:   false,
                drawPolygons: true,
                fillPolygons: false,
                drawGaze:     false,
                drawLabels:   false,
                useDepth:     false,
              });
            }

            // ── Analizar gestos del frame ──────────────────────────────────────
            analyzeFrame(result, async (embedding) => {
              if (successRef.current) return;
              successRef.current = true;
              stopRafLoop();

              setRostroMaestro(embedding);

              // ── NUEVO: Persistencia de Huella Maestra en Supabase ────────────
              try {
                if (studentInfo?.matricula && (studentInfo?.roomCode || studentInfo?.pin)) {
                  const pin = studentInfo.roomCode || studentInfo.pin;
                  const { error } = await supabase
                    .from('exam_sessions')
                    .update({ huella_facial_maestra: Array.from(embedding) })
                    .eq('matricula_alumno', studentInfo.matricula)
                    .eq('pin_sala', pin);
                  
                  if (error) {
                    console.error('[BiometricAuth] Error de Supabase al guardar huella:', error);
                  } else {
                    console.log('[BiometricAuth] Huella maestra guardada exitosamente en Supabase.');
                  }
                }
              } catch (err) {
                console.error('[BiometricAuth] Error guardando huella maestra:', err);
              }

              setLivenessApproved(true);
              setUiPhase('success');
              setTimeout(() => onSuccess?.(), 2000);
            });
          }
        } finally {
          isDetectingRef.current = false;
          lastDetectTimeRef.current = performance.now();
        }
      }

      // Programar el siguiente frame RAF (si el reto no terminó)
      if (!successRef.current) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [detectFaceInFrame, analyzeFrame, setRostroMaestro, setLivenessApproved, onSuccess]);

  const stopRafLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // Bug #2 Fix: liberar el lock de detección y resetear el throttle
    // para que no queden atascados entre re-montajes de StrictMode.
    isDetectingRef.current = false;
    lastDetectTimeRef.current = 0;
  }, []);

  // ── REINTENTAR reto ─────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    successRef.current = false;
    stopRafLoop();
    resetChallenge();
    setUiPhase('challenge');
  }, [stopRafLoop, resetChallenge]);

  // ── RENDERIZADO ─────────────────────────────────────────────────────────────
  const isDark = darkMode;

  const getInstructions = (step) => {
    switch (step) {
      case 'CENTER':
        return { title: 'Paso 1: Mira fijamente al frente', subtitle: 'Alinea tu rostro en el centro del marco.' };
      case 'SIDE_1':
        return { title: 'Paso 2: Gira el rostro hacia un lado', subtitle: 'Gira lentamente hasta mostrar tu perfil.' };
      case 'SIDE_2':
        return { title: 'Paso 3: Gira hacia el lado opuesto', subtitle: 'Ahora gira lentamente hacia el otro lado.' };
      case 'UP':
      case 'DOWN':
        return { title: 'Paso 4: Haz un círculo con tu nariz (arriba y abajo)', subtitle: 'Mira hacia arriba y luego hacia abajo.' };
      default:
        return { title: 'RETO: GIRA LA CABEZA', subtitle: 'Mueve tu rostro ligeramente hacia la izquierda o la derecha.' };
    }
  };
  const { title, subtitle } = getInstructions(challengeStep);

  return (
    <div
      className={cn(
        'min-h-screen flex items-center justify-center p-4 transition-colors duration-500',
        isDark ? 'bg-[#0a0a0a]' : 'bg-slate-50'
      )}
    >
      <div className="w-full max-w-lg">
        {/* ── Encabezado ──────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 shadow-xl shadow-blue-600/30 mb-4">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className={cn('text-2xl font-black tracking-tight', isDark ? 'text-white' : 'text-slate-900')}>
            Verificación Biométrica
          </h1>
          <p className={cn('text-sm mt-1', isDark ? 'text-slate-400' : 'text-slate-500')}>
            Prueba de vida requerida antes del examen
          </p>
          {studentInfo?.nombre_completo && (
            <p className={cn('text-xs mt-2 font-bold', isDark ? 'text-blue-400' : 'text-blue-600')}>
              {studentInfo.nombre_completo} · {studentInfo.matricula}
            </p>
          )}
        </motion.div>

        {/* ── Panel Principal ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            'rounded-3xl border overflow-hidden shadow-2xl',
            isDark ? 'bg-[#111] border-white/10' : 'bg-white border-slate-200'
          )}
        >
          {/* Vista de Cámara + Canvas superpuesto */}
          <div className="relative aspect-video bg-black overflow-hidden">
            {/*
              CAPA 1: <video> visible — muestra el feed de cámara a 60fps nativos.
              El navegador lo renderiza directamente (sin pasar por JavaScript),
              por lo que siempre se ve fluido independientemente del throttle de la IA.
              scale-x-[-1] espeja la imagen para que el alumno vea un "espejo" natural.
            */}
            <video
              ref={videoRef}
              id="biometric-video"
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover scale-x-[-1]"
            />

            {/*
              CAPA 2: <canvas> transparente en posición absoluta encima del <video>.
              Solo contiene los overlays de la IA (malla facial, puntos de iris).
              El fondo es completamente transparente — el video se ve a través de él.
              scale-x-[-1] lo espeja igual que el video para que los landmarks
              coincidan con el rostro visible.
            */}
            <canvas
              ref={canvasRef}
              id="biometric-canvas"
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none"
              style={{ background: 'transparent' }}
            />

            {/* Overlay de carga */}
            <AnimatePresence>
              {(uiPhase === 'loading_models' || uiPhase === 'starting_camera') && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4"
                >
                  <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
                  <div className="text-center">
                    <p className="text-white font-bold text-sm">
                      {uiPhase === 'loading_models' ? 'Cargando motor de IA...' : 'Iniciando cámara...'}
                    </p>
                    <p className="text-slate-400 text-xs mt-1">
                      {uiPhase === 'loading_models'
                        ? 'Iniciando motor WebAssembly (WASM)...'
                        : 'Solicitando acceso a la cámara...'
                      }
                    </p>
                  </div>
                  {/* Barra de progreso de carga */}
                  <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-blue-500 rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${loadingStep * 25}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Marco guía de posición del rostro */}
            {uiPhase === 'challenge' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className={cn(
                    'w-44 h-56 rounded-full border-4 transition-colors duration-300',
                    challengeStatus === 'detecting'
                      ? 'border-blue-400/70 shadow-[0_0_30px_rgba(59,130,246,0.4)]'
                      : 'border-white/30'
                  )}
                  style={{ borderRadius: '50% / 60%' }}
                />
              </div>
            )}



            {/* Overlay de Éxito */}
            <AnimatePresence>
              {uiPhase === 'success' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 bg-green-900/90 backdrop-blur-sm flex flex-col items-center justify-center gap-4"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
                  >
                    <CheckCircle2 className="w-20 h-20 text-green-400" />
                  </motion.div>
                  <p className="text-white font-black text-xl">¡Identidad Verificada!</p>
                  <p className="text-green-300 text-sm">Preparando el examen...</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Panel de Instrucciones del Reto ──────────────────────────── */}
          <div className="p-6">
            <AnimatePresence mode="wait">
              {uiPhase === 'error' && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center gap-4 text-center"
                >
                  <AlertTriangle className="w-10 h-10 text-red-500" />
                  <p className={cn('font-bold text-sm', isDark ? 'text-white' : 'text-slate-800')}>
                    {errorMsg}
                  </p>
                  <button
                    id="biometric-retry-btn"
                    onClick={() => window.location.reload()}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Reintentar
                  </button>
                </motion.div>
              )}

              {uiPhase === 'challenge' && (
                <motion.div
                  key="challenge"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  {/* Instrucción del reto */}
                  <div className={cn(
                    'flex items-center gap-4 p-4 rounded-2xl border',
                    isDark ? 'bg-blue-950/40 border-blue-800/40' : 'bg-blue-50 border-blue-100'
                  )}>
                    <div className={cn(
                      'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
                      isDark ? 'bg-blue-700' : 'bg-blue-600'
                    )}>
                      <RotateCcw className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <p className={cn('font-black text-sm uppercase tracking-tight', isDark ? 'text-blue-300' : 'text-blue-700')}>
                        {title}
                      </p>
                      <p className={cn('text-xs mt-0.5', isDark ? 'text-slate-400' : 'text-slate-500')}>
                        {subtitle}
                      </p>
                    </div>
                  </div>

                  {/* Barra de Progreso del Reto */}
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                        Detección de giro
                      </span>
                      <span className={cn('font-black', progress > 50 ? 'text-blue-500' : isDark ? 'text-slate-400' : 'text-slate-500')}>
                        {progress}%
                      </span>
                    </div>
                    <div className={cn('h-2.5 rounded-full overflow-hidden', isDark ? 'bg-white/10' : 'bg-slate-100')}>
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.2 }}
                      />
                    </div>
                  </div>

                  {/* Estado actual + botón de cambio */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        'w-2 h-2 rounded-full',
                        challengeStatus === 'detecting' ? 'bg-blue-500 animate-pulse' : 'bg-slate-400'
                      )} />
                      <span className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>
                        {challengeStatus === 'detecting' ? 'Analizando con IA...' : 'Esperando movimiento...'}
                      </span>
                    </div>
                    <button
                      id="biometric-change-challenge-btn"
                      onClick={handleRetry}
                      className={cn('text-xs flex items-center gap-1 font-bold hover:underline', isDark ? 'text-slate-400' : 'text-slate-500')}
                    >
                      <RefreshCw className="w-3 h-3" /> Reiniciar reto
                    </button>
                  </div>
                </motion.div>
              )}

              {(uiPhase === 'loading_models' || uiPhase === 'starting_camera') && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-2"
                >
                  <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>
                    {uiPhase === 'loading_models'
                      ? '🧠 Inicializando motor de IA con backend WebGL...'
                      : '📷 Solicitando acceso a la cámara...'
                    }
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer informativo */}
          <div className={cn('px-6 pb-5 flex items-center gap-2', isDark ? 'text-slate-600' : 'text-slate-400')}>
            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
            <p className="text-[10px]">
              Tu rostro se procesa localmente en tu navegador. No se almacena ninguna imagen.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
