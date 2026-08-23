import os
import json
import fitz  # PyMuPDF
from PIL import Image
import io
import google.generativeai as genai
from dotenv import load_dotenv
from flask import Flask, request, jsonify

# Cargamos las variables de entorno
load_dotenv()
genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))

app = Flask(__name__)

@app.route('/api/lector_examenes', methods=['POST'])
def procesar_pdf_a_json():
    try:
        # Validamos que venga el archivo
        if 'examen_pdf' not in request.files:
            return jsonify({"error": "No se envió ningún archivo PDF."}), 400
            
        archivo_pdf = request.files['examen_pdf']
        
        # 1. Convertimos la primera página del PDF a imagen (usamos PyMuPDF porque no necesita poppler en Vercel)
        pdf_document = fitz.open(stream=archivo_pdf.read(), filetype="pdf")
        primera_pagina = pdf_document.load_page(0)
        pix = primera_pagina.get_pixmap()
        
        # Convertir a formato PIL Image para enviarlo a Gemini
        imagen_bytes = pix.tobytes("jpeg")
        imagen_examen = Image.open(io.BytesIO(imagen_bytes))

        # 2. El modelo de IA que usaremos
        modelo = genai.GenerativeModel('gemini-1.5-pro')
        
        # 3. Las instrucciones estrictas para la IA
        instrucciones = """
        Eres un analizador de exámenes. Lee la imagen de este examen y devuelve un objeto JSON válido.
        Tu respuesta debe ser EXCLUSIVAMENTE el JSON, sin texto antes ni después (sin bloques de código ```json).
        
        Sigue estrictamente esta estructura:
        {
          "titulo_examen": "Nombre o tema del examen",
          "preguntas": [
            {
              "numero": 1,
              "tipo": "opcion_multiple", 
              "texto": "¿Cuál es la pregunta?",
              "opciones": ["Opción A", "Opción B", "Opción C"],
              "respuesta_correcta": "Aquí va la respuesta correcta o null si no se infiere"
            }
          ]
        }
        """
        
        # 4. Hacemos la llamada a Gemini mandando la imagen y las instrucciones
        respuesta = modelo.generate_content(
            [imagen_examen, instrucciones],
            generation_config={"response_mime_type": "application/json"}
        )
        
        # 5. Convertimos el texto JSON a un diccionario nativo de Python
        examen_estructurado = json.loads(respuesta.text)
        return jsonify(examen_estructurado), 200

    except json.JSONDecodeError:
        return jsonify({"error": "Gemini no devolvió un JSON válido."}), 500
    except Exception as e:
        print("Error interno:", str(e))
        return jsonify({"error": "Error al procesar el examen", "detalle": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5001)
