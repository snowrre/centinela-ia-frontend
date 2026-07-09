/**
 * useDeviceRestriction.js  ─── Custom Hook
 * ─────────────────────────────────────────────────────────────────────────────
 * Detecta si el alumno intenta acceder desde un dispositivo móvil o tablet y
 * bloquea el acceso al sistema de supervisión.
 *
 * ¿Por qué THREE señales en vez de solo userAgent?
 * ──────────────────────────────────────────────────
 * • userAgent: fácilmente falsificable con DevTools o extensiones del navegador.
 * • maxTouchPoints > 1: detecta hardware táctil (presente en tablets/móviles).
 *   Los laptops con pantalla táctil tienen maxTouchPoints = 1.
 * • screen.width < 1024: los teléfonos, incluso en landscape, no superan 1024px
 *   de ancho físico real (no CSS). Es el complemento más difícil de falsificar.
 *
 * La combinación de las tres hace prácticamente imposible evadir el bloqueo
 * con trucos simples del navegador.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from 'react';

/**
 * Expresión regular que cubre:
 *   • Android (teléfonos y tablets)
 *   • iOS: iPhone, iPod, iPad (incluyendo el nuevo userAgent de iPad en iOS 13+)
 *   • Plataformas basadas en WebKit para tablets: Silk (Amazon), PlayBook (BlackBerry)
 *   • Windows Phone / Windows Mobile
 */
const MOBILE_UA_REGEX = /android|ipad|iphone|ipod|playbook|silk|windows phone|mobile/i;

/**
 * @returns {{ isMobile: boolean, isChecking: boolean }}
 *   isMobile   → true si se detectó un dispositivo no permitido
 *   isChecking → true mientras se ejecuta la detección (evita flash de contenido)
 */
export function useDeviceRestriction() {
  const [isMobile, setIsMobile]     = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const ua = navigator.userAgent || navigator.vendor || window.opera || '';

    // Señal 1: User-Agent string
    const mobileByUA = MOBILE_UA_REGEX.test(ua);

    // Señal 2: Hardware táctil con más de 1 punto de contacto simultáneo.
    // Los trackpads de Mac/PC con touchpad regresan 1. Los móviles retornan ≥ 2.
    const mobileByTouch = navigator.maxTouchPoints > 1;

    // Señal 3: Ancho físico real de la pantalla (no el viewport CSS).
    // screen.width NO cambia si el alumno "falsifica" el tamaño de ventana.
    const mobileByScreen = window.screen.width < 1024;

    // Política: bastante con DOS de las TRES señales para bloquear.
    // Esto evita falsos positivos en laptops con pantalla táctil (solo señal 2)
    // y en monitores de baja resolución (solo señal 3).
    const signals = [mobileByUA, mobileByTouch, mobileByScreen];
    const positiveCount = signals.filter(Boolean).length;
    const detected = positiveCount >= 2;

    if (detected) {
      console.warn(
        '[Centinela] Dispositivo móvil detectado.',
        { mobileByUA, mobileByTouch, mobileByScreen }
      );
    }

    setIsMobile(detected);
    setIsChecking(false);
  }, []);

  return { isMobile, isChecking };
}
