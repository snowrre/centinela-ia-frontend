#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# download_face_api_models.sh
# Script para descargar los pesos neuronales de face-api.js
#
# USO: chmod +x download_face_api_models.sh && ./download_face_api_models.sh
#
# Descarga 4 modelos (~15 MB total) desde el repositorio oficial de face-api.js
# y los coloca en /public/models/ para que Vite los sirva estáticamente.
#
# Modelos descargados:
#   1. ssd_mobilenetv1        — Detección de cajas delimitadoras de rostros
#   2. face_landmark_68       — 68 puntos faciales (para EAR blink detection)
#   3. face_recognition       — Descriptor de 128 dimensiones (face matching)
#   4. face_expression        — Clasificación de emociones (para smile detection)
# ─────────────────────────────────────────────────────────────────────────────

set -e

MODELS_DIR="public/models"
BASE_URL="https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"

echo "📦 Descargando modelos de face-api.js → $MODELS_DIR"
mkdir -p "$MODELS_DIR"

# ── MODELO 1: SSD MobileNet v1 (Detector de rostros) ─────────────────────────
echo "  ⬇️  ssd_mobilenetv1_model..."
curl -sL "$BASE_URL/ssd_mobilenetv1_model-weights_manifest.json" -o "$MODELS_DIR/ssd_mobilenetv1_model-weights_manifest.json"
curl -sL "$BASE_URL/ssd_mobilenetv1_model-shard1" -o "$MODELS_DIR/ssd_mobilenetv1_model-shard1"
curl -sL "$BASE_URL/ssd_mobilenetv1_model-shard2" -o "$MODELS_DIR/ssd_mobilenetv1_model-shard2"

# ── MODELO 2: Face Landmark 68 (Puntos faciales para EAR) ────────────────────
echo "  ⬇️  face_landmark_68_model..."
curl -sL "$BASE_URL/face_landmark_68_model-weights_manifest.json" -o "$MODELS_DIR/face_landmark_68_model-weights_manifest.json"
curl -sL "$BASE_URL/face_landmark_68_model-shard1" -o "$MODELS_DIR/face_landmark_68_model-shard1"

# ── MODELO 3: Face Recognition Net (Descriptor 128-dim) ──────────────────────
echo "  ⬇️  face_recognition_model..."
curl -sL "$BASE_URL/face_recognition_model-weights_manifest.json" -o "$MODELS_DIR/face_recognition_model-weights_manifest.json"
curl -sL "$BASE_URL/face_recognition_model-shard1" -o "$MODELS_DIR/face_recognition_model-shard1"
curl -sL "$BASE_URL/face_recognition_model-shard2" -o "$MODELS_DIR/face_recognition_model-shard2"

# ── MODELO 4: Face Expression Net (Emociones para smile detection) ────────────
echo "  ⬇️  face_expression_model..."
curl -sL "$BASE_URL/face_expression_model-weights_manifest.json" -o "$MODELS_DIR/face_expression_model-weights_manifest.json"
curl -sL "$BASE_URL/face_expression_model-shard1" -o "$MODELS_DIR/face_expression_model-shard1"

echo ""
echo "✅ Modelos descargados correctamente en ./$MODELS_DIR"
echo "   Total de archivos: $(ls $MODELS_DIR | wc -l)"
echo ""
echo "📌 IMPORTANTE: Estos archivos deben ser incluidos en el repositorio"
echo "   (NO añadir /public/models/ al .gitignore)"
echo ""
echo "🚀 Ahora puedes ejecutar: npm run dev"
