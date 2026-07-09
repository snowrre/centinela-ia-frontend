/**
 * useLivenessChallenge.js  ─── Custom Hook
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsabilidad ÚNICA: orquestar la "Prueba de Vida" (Liveness Detection).
 *
 * MIGRACIÓN face-api.js → @vladmandic/human
 * ──────────────────────────────────────────
 * Reto ÚNICO: Girar la cabeza.
 * Validamos matemáticamente usando ángulos de Euler (pitch, yaw).
 * Fases: CENTER -> SIDE_1 -> SIDE_2 -> UP -> DOWN -> SUCCESS
 *
 * Emociones: APAGADAS (emotion: false en HUMAN_CONFIG) → ahorra CPU/RAM.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useRef, useState, useCallback } from 'react';

// ── HOOK PRINCIPAL ─────────────────────────────────────────────────────────────
export function useLivenessChallenge() {
  const [challengeStatus, setChallengeStatus] = useState('waiting'); // waiting | detecting | success
  const [progress, setProgress] = useState(0);   // 0-100 para barra visual
  const [challengeStep, setChallengeStep] = useState('CENTER'); // CENTER, SIDE_1, SIDE_2, UP, DOWN, SUCCESS

  // ── Estado interno de la máquina de estados ──
  const successFiredRef = useRef(false); // Guard: onSuccess se llama solo 1 vez
  const startTimeRef = useRef(performance.now());
  const challengeStepRef = useRef('CENTER'); // Para lectura síncrona en el RAF
  const directionRef = useRef(0); // Guarda el signo del primer giro
  const challengeStatusRef = useRef('waiting'); // Bug #4 Fix: guardia para no llamar setter si no cambia

  /**
   * Analiza un HumanResult y actualiza el estado del reto.
   * Debe llamarse en cada iteración del bucle requestAnimationFrame.
   */
  const analyzeFrame = useCallback((humanResult, onSuccess) => {
    // Guards de seguridad
    if (!humanResult || successFiredRef.current) return;
    if (humanResult.face?.length === 0) return;   // Sin rostro → ignorar frame

    // Bug #4 Fix: solo actualizar el estado si cambió para no provocar
    // re-renders de React 10 veces por segundo cuando el valor es idéntico.
    if (challengeStatusRef.current !== 'detecting') {
      challengeStatusRef.current = 'detecting';
      setChallengeStatus('detecting');
    }

    // ── FASE 1: PERÍODO DE CALIBRACIÓN (Warm-up) ─────────────────────────────
    if (performance.now() - startTimeRef.current < 2000) {
      return;
    }

    // Obtenemos los ángulos de Euler del rostro
    const angle = humanResult.face[0]?.rotation?.angle;
    if (!angle) return;

    const { pitch, yaw } = angle;
    const currentStep = challengeStepRef.current;

    // ── FASE 2: MÁQUINA DE ESTADOS (Euler Angles) ────────────────────────────
    if (currentStep === 'CENTER') {
      if (Math.abs(yaw) < 0.15 && Math.abs(pitch) < 0.15) {
        console.log('[Liveness] ⚓ Anclaje al centro completado.');
        challengeStepRef.current = 'SIDE_1';
        setChallengeStep('SIDE_1');
        setProgress(25);
      }
    } else if (currentStep === 'SIDE_1') {
      if (Math.abs(yaw) > 0.25) {
        directionRef.current = Math.sign(yaw);
        console.log(`[Liveness] ➡ Giro suave a un lado completado. (signo: ${directionRef.current})`);
        challengeStepRef.current = 'SIDE_2';
        setChallengeStep('SIDE_2');
        setProgress(50);
      }
    } else if (currentStep === 'SIDE_2') {
      if (Math.abs(yaw) > 0.25 && Math.sign(yaw) !== directionRef.current) {
        console.log('[Liveness] ⬅ Giro suave al lado opuesto completado.');
        challengeStepRef.current = 'UP';
        setChallengeStep('UP');
        setProgress(75);
      }
    } else if (currentStep === 'UP') {
      if (pitch < -0.12) { // ← Reducido de -0.18: micromovimiento para no perder landmarks
        console.log('[Liveness] ⬆ Mirando hacia arriba completado.');
        challengeStepRef.current = 'DOWN';
        setChallengeStep('DOWN');
        setProgress(90);
      }
    } else if (currentStep === 'DOWN') {
      if (pitch > 0.08) { // ← Reducido de 0.18: máxima sensibilidad, lentes ocultan ojos al bajar
        console.log('[Liveness] ⬇ Mirando hacia abajo completado. ¡ÉXITO!');
        challengeStepRef.current = 'SUCCESS';
        setChallengeStep('SUCCESS');
        setProgress(100);
        
        successFiredRef.current = true;
        setChallengeStatus('success');
        const embedding = humanResult.face[0]?.embedding ?? null;
        onSuccess?.(embedding);
      }
    }
  }, []);

  // Permite reiniciar el reto si el usuario quiere intentarlo de nuevo
  const resetChallenge = useCallback(() => {
    successFiredRef.current = false;
    startTimeRef.current = performance.now();
    directionRef.current = 0;
    challengeStepRef.current = 'CENTER';
    challengeStatusRef.current = 'waiting'; // Bug #4 Fix: sincronizar ref al resetear
    setChallengeStep('CENTER');
    setChallengeStatus('waiting');
    setProgress(0);
  }, []);

  return {
    challengeStatus,
    challengeStep,
    progress,
    analyzeFrame,
    resetChallenge,
  };
}
