/**
 * BiometricContext.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Contexto global que almacena el "Rostro Maestro" (descriptor facial de 128
 * dimensiones) capturado durante la fase de Prueba de Vida (Login).
 *
 * Este vector flotante es la "firma biométrica" del alumno registrado.
 * Se mantiene en memoria RAM durante toda la sesión del examen y NUNCA
 * se persiste en disco/localStorage (privacidad por diseño).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { createContext, useContext, useState, useCallback } from 'react';

// Forma del estado del contexto:
// {
//   rostroMaestro: Float32Array | null,  — Embedding de 512-dim extraído por @vladmandic/human en el login
//   livenessApproved: boolean,           — true cuando el reto biométrico fue superado
//   modelsLoaded: boolean,               — true cuando @vladmandic/human terminó de cargar
//   setRostroMaestro: (embedding) => void,
//   setLivenessApproved: (bool) => void,
//   setModelsLoaded: (bool) => void,
//   clearBiometric: () => void,          — Limpia todo (logout / expulsión)
// }

const BiometricContext = createContext(null);

export function BiometricProvider({ children }) {
  const [rostroMaestro, setRostroMaestroState] = useState(null);
  const [livenessApproved, setLivenessApproved] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  // Setter encapsulado — acepta Float32Array de 512-dim de @vladmandic/human
  const setRostroMaestro = useCallback((descriptor) => {
    setRostroMaestroState(descriptor);
  }, []);

  // Limpieza completa en logout/expulsión
  const clearBiometric = useCallback(() => {
    setRostroMaestroState(null);
    setLivenessApproved(false);
    // modelsLoaded lo dejamos en true — los pesos ya están cacheados en memoria
  }, []);

  return (
    <BiometricContext.Provider
      value={{
        rostroMaestro,
        livenessApproved,
        modelsLoaded,
        setRostroMaestro,
        setLivenessApproved,
        setModelsLoaded,
        clearBiometric,
      }}
    >
      {children}
    </BiometricContext.Provider>
  );
}

// Hook consumidor — lanza error si se usa fuera del Provider
export function useBiometric() {
  const ctx = useContext(BiometricContext);
  if (!ctx) {
    throw new Error('[Centinela] useBiometric debe usarse dentro de <BiometricProvider>');
  }
  return ctx;
}
