import * as faceMesh from '@mediapipe/face_mesh';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';

export class CentinelaEngine {
    constructor(callbacks) {
        this.callbacks = callbacks; 
        this.faceMesh = null;
        this.objectModel = null;
        this.isRunning = false;
        this.lastAlertTime = 0;
        this.suspicionScore = 0;
        this.lastScoreUpdate = Date.now();
        
        // Variables para calibración de IA
        this.lastViolationTime = 0;
        this.violationStartTime = 0;
        this.currentViolationType = null;

        // Audio properties
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.audioDataArray = null;

        // Debounce de ruido: contador de frames consecutivos con ruido alto
        this.noiseFramesCount = 0;
        this.animationFrameId = null; // A-1 Fix: ref cancelable del bucle de inferencia
    }

    async init(stream = null) {
        try {
            // Cargar Face Mesh
            this.faceMesh = new faceMesh.FaceMesh({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
            });

            this.faceMesh.setOptions({
                maxNumFaces: 2, // Detectar hasta 2 para ver si hay alguien más
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            this.faceMesh.onResults(this.onFaceResults.bind(this));

            // Cargar COCO-SSD para objetos
            this.objectModel = await cocoSsd.load();

            // Inicializar Audio si hay stream
            if (stream) {
                this.initAudio(stream);
            }

            console.log("Centinela Engine: Inicializado [OK]");
            return true;
        } catch (error) {
            console.error("Centinela Engine: Error de inicialización", error);
            return false;
        }
    }

    initAudio(stream) {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);
            this.analyser.fftSize = 256;
            this.audioDataArray = new Uint8Array(this.analyser.frequencyBinCount);
            console.log("Centinela Audio: Inicializado [OK]");
        } catch (e) {
            console.warn("Centinela Audio: No se pudo iniciar el monitoreo de audio", e);
        }
    }

    async start(videoElement) {
        this.isRunning = true;
        const process = async () => {
            if (!this.isRunning) return;
            
            if (videoElement.readyState === 4) {
                const now = Date.now();
                if (now - this.lastScoreUpdate > 1000) {
                    // Enfriamiento Acelerado (-8% por segundo) si no hubo violaciones en el último segundo
                    if (now - this.lastViolationTime > 1000) {
                        this.suspicionScore = Math.max(0, this.suspicionScore - 8);
                        this.callbacks.onStatus?.({ suspicionScore: Math.round(this.suspicionScore) });
                    }
                    this.lastScoreUpdate = now;
                }

                // Monitoreo de Audio
                this.checkAudio();

                // Procesar cara
                await this.faceMesh.send({ image: videoElement });
                
                // Procesar objetos
                if (Math.random() > 0.85) {
                    const predictions = await this.objectModel.detect(videoElement);
                    this.checkObjects(predictions);
                }
            }
            
            this.animationFrameId = requestAnimationFrame(process); // A-1 Fix: guardar ID
        };
        process();
    }

    checkAudio() {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(this.audioDataArray);

        let sum = 0;
        let validBins = 0;

        // FILTRO DE FRECUENCIAS: Ignoramos los primeros 5 bins (sub-graves: ventiladores,
        // vibración de hardware) y los últimos 10 (agudos extremos, fuera del rango vocal).
        // Solo analizamos el rango aproximado de la voz humana (250 Hz – 4 kHz).
        for (let i = 5; i < this.audioDataArray.length - 10; i++) {
            sum += this.audioDataArray[i];
            validBins++;
        }

        const average = sum / validBins;

        // UMBRAL (70/255 ≈ 27%) + DEBOUNCE de 60 frames (~1s a 60fps)
        // Requiere ruido sostenido antes de disparar — teclazos y estornudos no acumulan.
        if (average > 70) {
            this.noiseFramesCount++;

            if (this.noiseFramesCount >= 60) {
                this.handleViolation("RUIDO_DETECTADO", "Se detectó voz o ruido continuo", 2);
                this.noiseFramesCount = 0; // Reiniciar para no hacer spam de alertas
            }
        } else {
            // Enfriamiento rápido: silencio descuenta 2 frames por ciclo.
            // Evita que golpes aislados se acumulen hasta el umbral.
            this.noiseFramesCount = Math.max(0, this.noiseFramesCount - 2);
        }
    }

    stop() {
        this.isRunning = false;
        cancelAnimationFrame(this.animationFrameId); // A-1 Fix: cancelar frame pendiente
        this.animationFrameId = null;
        if (this.audioContext) this.audioContext.close();
    }

    onFaceResults(results) {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            this.handleViolation("AUSENCIA_ROSTRO", "No se detecta rostro frente a la cámara", 5);
            // Resetear streak de múltiples caras si no hay ninguna cara
            this.multiFaceStreak = 0;
            return;
        }

        // ── Debounce de Múltiples Caras (Anti-FP audífonos) ──────────────────
        // Un audífono/brazo genera detecciones esporádicas (1-5 frames).
        // Una segunda persona real mantiene la detección por 20+ frames consecutivos.
        // Solo disparamos la alerta si se supera el umbral de frames continuos.
        const MULTI_FACE_FRAMES_REQUIRED = 20;
        if (results.multiFaceLandmarks.length > 1) {
            this.multiFaceStreak = (this.multiFaceStreak || 0) + 1;
            if (this.multiFaceStreak >= MULTI_FACE_FRAMES_REQUIRED) {
                this.handleViolation("MULTIPLE_PERSONA", "Se detectan múltiples personas", 10);
            }
            // Si está en período de gracia (streak < 20), no hacemos nada
        } else {
            // Volvió a 1 cara → resetear el contador
            this.multiFaceStreak = 0;
        }
        // ─────────────────────────────────────────────────────────────────────

        const landmarks = results.multiFaceLandmarks[0];
        if (!landmarks || !landmarks[1] || !landmarks[234] || !landmarks[454]) return;

        const nose = landmarks[1];
        const leftSide = landmarks[234];
        const rightSide = landmarks[454];
        const horizontalRatio = (nose.x - leftSide.x) / (rightSide.x - leftSide.x);
        
        if (horizontalRatio < 0.32) {
            this.handleViolation("MIRADA_LATERAL", "Mirando hacia la izquierda", 2);
        } else if (horizontalRatio > 0.68) {
            this.handleViolation("MIRADA_LATERAL", "Mirando hacia la derecha", 2);
        }
    }

    checkObjects(predictions) {
        // COCO-SSD clases: cell phone, book, laptop, person, etc.
        const suspicious = predictions.filter(p => p.score > 0.55);
        
        suspicious.forEach(p => {
            if (p.class === 'cell phone') {
                this.handleViolation("OBJETO_PROHIBIDO", "Teléfono detectado", 15);
            } else if (p.class === 'book') {
                this.handleViolation("OBJETO_PROHIBIDO", "Libro detectado", 7);
            }
            // Audífonos no están en COCO-SSD por defecto, 
            // pero podemos alertar si hay objetos desconocidos cerca de la cabeza? 
            // Por ahora solo clases estándar.
        });
    }

    handleViolation(type, msg, originalPenalty = 10) {
        const now = Date.now();
        
        // Manejo de "Grace Period" (Periodo de gracia)
        if (this.currentViolationType !== type || (now - this.lastViolationTime > 2000)) {
            // Nueva anomalía o regresando de un estado normal
            this.currentViolationType = type;
            this.violationStartTime = now;
        }
        
        this.lastViolationTime = now;
        const isGracePeriod = (now - this.violationStartTime) < 1500;
        
        if (!isGracePeriod) {
            // Penalización Suave: Superado el periodo de gracia, sumamos poco a poco (+1%)
            this.suspicionScore = Math.min(100, this.suspicionScore + 1);
        } else {
            // Durante el periodo de gracia, permitimos movimientos naturales (penalización casi nula)
            this.suspicionScore = Math.min(100, this.suspicionScore + 0.1);
        }

        this.callbacks.onStatus?.({ suspicionScore: Math.round(this.suspicionScore) });

        // Suavizado de Alertas: Solo enviamos a la BD si la sospecha cruzó el 85% (o es gravísimo)
        if (this.suspicionScore >= 85 && (now - this.lastAlertTime > 5000)) { 
            this.lastAlertTime = now;
            this.callbacks.onAlert({ type, message: msg, timestamp: now });
        }
    }
}
