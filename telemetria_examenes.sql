-- ═══════════════════════════════════════════════════════════════════════════════
-- telemetria_examenes — Tabla de telemetría del monitor biométrico silencioso
-- Centinela IA · Edge Node
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Descripción:
--   Almacena los eventos de anomalía detectados por useBiometricMonitor.js
--   durante el examen. Un alumno puede generar múltiples registros por sesión.
--
-- tipos de anomalía posibles (tipo_anomalia):
--   • rostro_no_detectado    → el alumno no está frente a la cámara
--   • suplantacion_identidad → el rostro no coincide con el Rostro Maestro
--   • multiples_rostros      → más de una persona frente a la cámara
--   • dispositivo_movil      → celular o tablet detectado en el frame
--
-- nivel_confianza:
--   • Para 'rostro_no_detectado'    → siempre 1.0 (certeza total)
--   • Para 'suplantacion_identidad' → 1 - similarity (0.0=casi match, 1.0=totalmente diferente)
--   • Para 'multiples_rostros'      → promedio del score de los rostros extras
--   • Para 'dispositivo_movil'      → score del objeto detectado por MobileNet
--
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.telemetria_examenes (
  id              BIGSERIAL        PRIMARY KEY,
  estudiante_id   TEXT             NOT NULL,         -- Matrícula del alumno
  tipo_anomalia   TEXT             NOT NULL,         -- Clave del tipo de evento
  nivel_confianza DOUBLE PRECISION DEFAULT 0,        -- Score del modelo (0.0–1.0)
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- Índice para consultas rápidas por alumno en el dashboard del docente
CREATE INDEX IF NOT EXISTS idx_telemetria_estudiante
  ON public.telemetria_examenes (estudiante_id, created_at DESC);

-- Índice para filtrar por tipo en gráficas de resumen
CREATE INDEX IF NOT EXISTS idx_telemetria_tipo
  ON public.telemetria_examenes (tipo_anomalia, created_at DESC);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────────
-- Alumno (anon) solo puede INSERTAR.
-- Docente (authenticated) puede LEER todo.
ALTER TABLE public.telemetria_examenes ENABLE ROW LEVEL SECURITY;

-- Política de inserción abierta para el cliente del alumno (anon key)
CREATE POLICY "telemetria_insert_anon"
  ON public.telemetria_examenes
  FOR INSERT TO anon
  WITH CHECK (true);

-- Política de lectura para el dashboard del docente (authenticated)
CREATE POLICY "telemetria_read_authenticated"
  ON public.telemetria_examenes
  FOR SELECT TO authenticated
  USING (true);

-- ── REALTIME (opcional) ───────────────────────────────────────────────────────
-- Habilita que el dashboard del docente reciba nuevas alertas en tiempo real
-- sin polling. Ejecuta esto desde el SQL Editor de Supabase:
--
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.telemetria_examenes;
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- EJEMPLO DE QUERY para el dashboard del docente:
--
--   SELECT estudiante_id, tipo_anomalia, nivel_confianza, created_at
--   FROM telemetria_examenes
--   WHERE created_at > NOW() - INTERVAL '2 hours'
--   ORDER BY created_at DESC;
--
-- ═══════════════════════════════════════════════════════════════════════════════
