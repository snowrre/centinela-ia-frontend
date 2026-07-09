/**
 * useBiometricMonitor.js  ─── Custom Hook  (v3 — Arquitectura Edge Node)
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsabilidad ÚNICA: ciclo de monitoreo continuo SILENCIOSO durante el
 * examen. Corre en segundo plano cada N segundos sin bloquear el hilo principal.
 *
 * ── ARQUITECTURA DEL CICLO (setTimeout recursivo) ────────────────────────────
 *
 *  ┌─ scheduleNextTick() ─────────────────────────────────────────────────┐
 *  │   setTimeout(runMonitorTick, 10_000)                                 │
 *  └──────────────────────────────────────────────────────────────────────┘
 *         │ (10s después)
 *         ▼
 *  ┌─ runMonitorTick() ───────────────────────────────────────────────────┐
 *  │  1. await h.detect(video, configOverride)  ← puede tardar 80-400ms  │
 *  │  2. Evaluar las 4 reglas de negocio                                  │
 *  │  3. Si hay anomalía → enviar JSON a Supabase (telemetria_examenes)   │
 *  │  4. finally → scheduleNextTick()   ← SIEMPRE, incluso si hay error   │
 *  └──────────────────────────────────────────────────────────────────────┘
 *
 * Por qué setTimeout recursivo y NO setInterval:
 *   setInterval no espera a que el callback anterior termine. Si detect() tarda
 *   más de 10s (Celeron/Pentium bajo carga), los ticks se acumulan y saturan la
 *   GPU. Con el patrón recursivo, el siguiente tick empieza DESPUÉS del anterior.
 *
 * ── REGLAS DE NEGOCIO ────────────────────────────────────────────────────────
 *
 *   Regla 1 — SUPLANTACIÓN/ABANDONO:
 *     result.face.length === 0  →  tipo_anomalia: 'rostro_no_detectado'
 *     Además: si el embedding del rostro detectado ≠ Rostro Maestro (similitud
 *     de coseno < FACE_MATCH_THRESHOLD), tipo_anomalia: 'suplantacion_identidad'
 *
 *   Regla 2 — AYUDA EXTERNA:
 *     result.face.length > 1   →  tipo_anomalia: 'multiples_rostros'
 *
 *   Regla 3 — DISPOSITIVOS:
 *     Analiza result.object[] buscando etiquetas que contengan 'phone',
 *     'mobile' o 'cell'        →  tipo_anomalia: 'dispositivo_movil'
 *     NOTA: Human activa object detection en modo "override" por frame usando
 *     h.detect() con config local — sin mutar el singleton global para no
 *     afectar el Liveness Challenge que corre en BiometricAuth.
 *
 * ── TABLA DE DESTINO (Supabase): telemetria_examenes ─────────────────────────
 *
 *   estudiante_id   TEXT    — matrícula del alumno
 *   tipo_anomalia   TEXT    — clave de la regla disparada
 *   nivel_confianza FLOAT   — score o similitud del evento (0.0 – 1.0)
 *   created_at      TIMESTAMPTZ
 *
 *   Script DDL mínimo para crear la tabla si no existe:
 *
 *   CREATE TABLE IF NOT EXISTS public.telemetria_examenes (
 *     id              BIGSERIAL PRIMARY KEY,
 *     estudiante_id   TEXT         NOT NULL,
 *     tipo_anomalia   TEXT         NOT NULL,
 *     nivel_confianza FLOAT,
 *     created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
 *   );
 *   ALTER TABLE public.telemetria_examenes ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "insert_only_anon" ON public.telemetria_examenes
 *     FOR INSERT TO anon WITH CHECK (true);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useRef, useCallback, useEffect } from 'react';
import { useBiometric } from '../context/BiometricContext';
import { supabase } from '../lib/supabase';
import { getHumanInstance } from './useFaceDetection';

// ── CONSTANTES DE CONFIGURACIÓN ───────────────────────────────────────────────
const MONITOR_INTERVAL_MS  = 10_000;  // 10 s entre cada escaneo
const FACE_MATCH_THRESHOLD = 0.40;    // similarity < 0.40 → suplantación
const ALERT_COOLDOWN_MS    = 15_000;  // Anti-spam: mínimo 15 s entre alertas iguales

/**
 * Palabras clave COCO-SSD / MobileNet que identifican un teléfono móvil
 * en el resultado de object detection de @vladmandic/human.
 * Incluye variantes en inglés (etiquetas del dataset COCO) y español.
 */
const PHONE_LABELS = [
  'cell phone', 'mobile phone', 'phone', 'smartphone', 'celular', 'móvil',
];

/**
 * CONFIG OVERRIDE para el tick del monitor:
 *   • Activa object detection (desactivado en el singleton global para no
 *     cargar el modelo de 6MB durante el Liveness Challenge).
 *   • Esta config se pasa como 2° arg a h.detect() y es local al tick —
 *     NO muta la config global del singleton.
 *   • En CPUs Celeron/Pentium, el modelo MobileNet-Lite de Human
 *     tarda ~150-300ms adicionales; es aceptable porque el siguiente tick
 *     no arranca hasta que finalice este (patrón setTimeout recursivo).
 */
const DETECT_CONFIG_OVERRIDE = {
  object: { enabled: true },
};

// ── HOOK PRINCIPAL ─────────────────────────────────────────────────────────────
export function useBiometricMonitor() {
  const { rostroMaestro, modelsLoaded } = useBiometric();

  const timeoutRef       = useRef(null);   // Handle del setTimeout activo
  const isRunningRef     = useRef(false);  // Guard: evita arranques dobles
  const humanReadyRef    = useRef(false);  // True tras el primer h.load()

  // Cooldowns independientes por tipo de anomalía para no silenciar un tipo
  // por el cooldown de otro tipo de alerta.
  const lastAlertTimeRef = useRef({
    rostro_no_detectado:    0,
    suplantacion_identidad: 0,
    multiples_rostros:      0,
    dispositivo_movil:      0,
  });

  // ── Inicialización lazy de Human ─────────────────────────────────────────────
  // Se llama solo una vez. Reutiliza el singleton para no re-registrar el backend.
  const ensureHumanReady = useCallback(async () => {
    if (humanReadyRef.current) return true;
    try {
      const h = getHumanInstance();
      await h.load();
      humanReadyRef.current = true;
      console.log('[BioMonitor] Motor Human listo ✓');
      return true;
    } catch (err) {
      console.error('[BioMonitor] Error inicializando Human:', err);
      return false;
    }
  }, []);

  // ── Envío de telemetría a Supabase ───────────────────────────────────────────
  /**
   * Inserta un registro en `telemetria_examenes`.
   * Aplica un cooldown POR TIPO para evitar spam de la misma anomalía.
   *
   * Privacidad por diseño: solo se envían metadatos textuales (JSON).
   * Ningún pixel, frame de video ni dato biométrico crudo llega a Supabase.
   *
   * @param {string} estudianteId    — Matrícula del alumno
   * @param {string} tipoAnomalia    — Clave de la regla disparada
   * @param {number} nivelConfianza  — Score de confianza (0.0 – 1.0)
   */
  const enviarTelemetria = useCallback(async (estudianteId, tipoAnomalia, nivelConfianza = 0) => {
    const now = Date.now();
    const lastTime = lastAlertTimeRef.current[tipoAnomalia] ?? 0;

    if (now - lastTime < ALERT_COOLDOWN_MS) {
      console.log(`[BioMonitor] ${tipoAnomalia} en cooldown, omitiendo.`);
      return;
    }
    lastAlertTimeRef.current[tipoAnomalia] = now;

    // ── PRIVACIDAD ESTRICTA: Solo JSON de metadatos. Ningún dato biométrico crudo. ──
    const payload = {
      estudiante_id:   estudianteId,
      tipo_anomalia:   tipoAnomalia,
      nivel_confianza: parseFloat(nivelConfianza.toFixed(4)),
      created_at:      new Date().toISOString(),
    };

    try {
      const { error } = await supabase
        .from('telemetria_examenes')
        .insert([payload]);

      if (error) throw error;

      console.warn(
        `[BioMonitor] 🚨 Telemetría enviada → ${tipoAnomalia} ` +
        `(confianza: ${nivelConfianza.toFixed(2)})`,
        payload,
      );
    } catch (err) {
      console.error('[BioMonitor] Fallo al enviar telemetría:', err);
    }
  }, []);

  // ── Función principal del ciclo ───────────────────────────────────────────────
  /**
   * startMonitoring — arranca el bucle silencioso de monitoreo.
   *
   * @param {HTMLVideoElement} videoElement   — Feed de la cámara del alumno
   * @param {string}           estudianteId  — Matrícula (clave primaria del alumno)
   * @param {Function}         onStatusUpdate — Callback opcional para la UI
   *   Recibe: { tipoAnomalia, nivelConfianza, esMatch, timestamp }
   */
  const startMonitoring = useCallback(async (videoElement, estudianteId = '', onStatusUpdate = null) => {
    // Guards de arranque
    if (isRunningRef.current) {
      console.warn('[BioMonitor] Ya está corriendo. Ignorando llamada duplicada.');
      return;
    }
    if (!modelsLoaded) {
      console.warn('[BioMonitor] Modelos no cargados. Monitoreo cancelado.');
      return;
    }
    if (!rostroMaestro) {
      console.warn('[BioMonitor] Sin Rostro Maestro. Monitoreo cancelado.');
      return;
    }

    const ready = await ensureHumanReady();
    if (!ready) {
      console.error('[BioMonitor] Human no pudo inicializarse. Monitoreo cancelado.');
      return;
    }

    const h = getHumanInstance();
    isRunningRef.current = true;
    console.log(
      '[BioMonitor] ▶ Iniciando ciclo silencioso cada',
      MONITOR_INTERVAL_MS / 1000,
      's | Alumno:',
      estudianteId,
    );

    // ────────────────────────────────────────────────────────────────────────────
    // BUCLE PRINCIPAL: setTimeout recursivo
    //
    // Flujo por tick:
    //   scheduleNextTick()
    //     → setTimeout(runMonitorTick, 10_000)
    //       → runMonitorTick()
    //         → await h.detect(video, override)  [puede tardar 80-500ms]
    //         → evaluar reglas 1, 2 y 3
    //         → enviarTelemetria() [si hay anomalía, solo JSON]
    //         → finally: scheduleNextTick()       [SIEMPRE]
    // ────────────────────────────────────────────────────────────────────────────

    const scheduleNextTick = () => {
      if (!isRunningRef.current) return;
      timeoutRef.current = setTimeout(runMonitorTick, MONITOR_INTERVAL_MS);
    };

    const runMonitorTick = async () => {
      if (!isRunningRef.current) return;

      // Guard pasivo: si el backend aún no está listo (primera carga lenta),
      // saltamos el tick sin llamar detect() para no bloquear la red.
      if (!h.ready) {
        console.log('[BioMonitor] Human no listo todavía, saltando tick.');
        scheduleNextTick();
        return;
      }

      // Guard: el elemento video debe tener datos reales de píxeles
      if (!videoElement || videoElement.readyState < 2 || videoElement.paused) {
        scheduleNextTick();
        return;
      }

      try {
        // ── DETECCIÓN COMPLETA DEL FRAME ────────────────────────────────────
        //
        // Se pasa DETECT_CONFIG_OVERRIDE como 2° argumento para activar
        // object detection en este tick sin mutar la config global.
        // Esto permite detectar celulares (Regla 3) de forma aislada.
        //
        // h.detect() corre los modelos habilitados:
        //   • face        — FaceMesh 468 puntos
        //   • description — embedding 512-dim (para face match)
        //   • object      — MobileNet-COCO (activado por override → Regla 3)
        //
        const result = await h.detect(videoElement, DETECT_CONFIG_OVERRIDE);

        if (!result) {
          scheduleNextTick();
          return;
        }

        const faceCount = result.face?.length ?? 0;

        // ── REGLA 1A: AUSENCIA DE ROSTRO ─────────────────────────────────────
        // El alumno se fue de la cámara o está tapando la cara.
        if (faceCount === 0) {
          console.log('[BioMonitor] ⚠ Regla 1A: Ningún rostro detectado.');
          await enviarTelemetria(estudianteId, 'rostro_no_detectado', 1.0);
          onStatusUpdate?.({
            tipoAnomalia:   'rostro_no_detectado',
            nivelConfianza: 1.0,
            esMatch:        false,
            timestamp:      Date.now(),
          });
          return; // No evaluar más reglas este tick
        }

        // ── REGLA 2: MÚLTIPLES ROSTROS ────────────────────────────────────────
        // Hay más de una persona frente a la cámara → posible ayuda externa.
        if (faceCount > 1) {
          // Confianza = promedio del score de detección de todos los rostros extras
          const avgScore = result.face
            .slice(1) // ignoramos el primer rostro (el alumno)
            .reduce((sum, f) => sum + (f.score ?? 0.95), 0) / (faceCount - 1);

          console.warn(`[BioMonitor] ⚠ Regla 2: ${faceCount} rostros detectados.`);
          await enviarTelemetria(estudianteId, 'multiples_rostros', avgScore);
          onStatusUpdate?.({
            tipoAnomalia:   'multiples_rostros',
            nivelConfianza: avgScore,
            esMatch:        false,
            timestamp:      Date.now(),
          });
          // No retornamos: seguimos para evaluar también la identidad del rostro 0
        }

        // ── REGLA 1B: SUPLANTACIÓN DE IDENTIDAD ──────────────────────────────
        // Hay exactamente 1 rostro pero no coincide con el Rostro Maestro.
        // (Si hay múltiples, comparamos el primero igualmente.)
        const embeddingActual = result.face[0]?.embedding;

        if (embeddingActual?.length > 0 && rostroMaestro?.length > 0) {
          const matchResult = h.match(embeddingActual, rostroMaestro);
          const similitud   = matchResult.similarity ?? 0;
          const esMatch     = similitud >= FACE_MATCH_THRESHOLD;

          console.log(
            `[BioMonitor] Face match → similitud: ${similitud.toFixed(4)} ` +
            `| umbral: ${FACE_MATCH_THRESHOLD} | ${esMatch ? '✅ OK' : '❌ MISMATCH'}`,
          );

          onStatusUpdate?.({
            tipoAnomalia:   esMatch ? null : 'suplantacion_identidad',
            nivelConfianza: similitud,
            esMatch,
            timestamp:      Date.now(),
          });

          if (!esMatch) {
            // nivel_confianza aquí = qué tan SEGURO está el sistema de que NO es él
            // → usamos el complemento de la similitud (1 - similarity)
            await enviarTelemetria(estudianteId, 'suplantacion_identidad', 1 - similitud);
          }
        }

        // ── REGLA 3: DISPOSITIVO MÓVIL ───────────────────────────────────────
        // Busca en result.object[] objetos cuya etiqueta incluya palabras clave
        // de teléfonos. Human popula este array gracias al DETECT_CONFIG_OVERRIDE
        // que activa el modelo MobileNet-COCO en este tick específico.
        //
        // Privacidad: si se detecta un phone, solo enviamos su score (número).
        // No se envía el boundingBox ni ningún fragmento de imagen.
        const objects = result.object ?? [];
        if (objects.length > 0) {
          const phoneObj = objects.find(obj => {
            // Human puede usar `label` (v3) o `class` (v2 legacy)
            const etiqueta = (obj.label ?? obj.class ?? '').toLowerCase();
            return PHONE_LABELS.some(kw => etiqueta.includes(kw));
          });

          if (phoneObj) {
            const confianzaPhone = phoneObj.score ?? phoneObj.confidence ?? 0.9;
            console.warn('[BioMonitor] ⚠ Regla 3: Dispositivo móvil detectado.', {
              label:  phoneObj.label ?? phoneObj.class,
              score:  confianzaPhone,
            });
            await enviarTelemetria(estudianteId, 'dispositivo_movil', confianzaPhone);
            onStatusUpdate?.({
              tipoAnomalia:   'dispositivo_movil',
              nivelConfianza: confianzaPhone,
              esMatch:        false,
              timestamp:      Date.now(),
            });
          }
        }

      } catch (err) {
        // Capturar cualquier error de la pipeline sin romper el bucle.
        // Un frame corrupto o un error de WebGL son transitorios; el siguiente
        // tick probablemente funcionará bien.
        console.error('[BioMonitor] Error en tick de monitoreo:', err);
      } finally {
        // ✅ CLAVE: el siguiente tick se agenda SIEMPRE en el bloque finally,
        // incluso si hubo un error. Esto garantiza que el bucle nunca muere
        // silenciosamente aunque detect() falle varias veces seguidas.
        scheduleNextTick();
      }
    };

    // Arrancar el primer tick
    scheduleNextTick();

  }, [rostroMaestro, modelsLoaded, ensureHumanReady, enviarTelemetria]);

  // ── PARADA DEL CICLO ────────────────────────────────────────────────────────
  /**
   * stopMonitoring — cancela el setTimeout pendiente y marca el bucle como inactivo.
   * Debe llamarse al desmontar el componente, al terminar el examen o al expulsar.
   */
  const stopMonitoring = useCallback(() => {
    isRunningRef.current = false;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    console.log('[BioMonitor] ⏹ Ciclo de monitoreo detenido.');
  }, []);

  // Limpieza automática al desmontar el componente (ciclo de vida de React)
  useEffect(() => {
    return () => stopMonitoring();
  }, [stopMonitoring]);

  return {
    startMonitoring,
    stopMonitoring,
    isRunning:          isRunningRef,   // Ref, no estado → no causa re-renders
    FACE_MATCH_THRESHOLD,
    MONITOR_INTERVAL_MS,
  };
}
