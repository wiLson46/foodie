"""
Generador de Thumbnails para Comer.ar
=====================================
Recorre todas las subcarpetas de ./fotos/ y genera thumbnails comprimidos
en una carpeta paralela ./fotos_thumb/ manteniendo la misma estructura.

- Redimensiona a 400px de ancho (mantiene aspect ratio)
- Comprime JPEG a quality=60 (~30-50KB vs ~800KB original)
- Genera JPEG progresivo para carga incremental real en el navegador
- Solo procesa archivos nuevos (no re-genera si el thumb ya existe)

Uso: python generate_thumbnails.py
"""

import os
import sys
from PIL import Image

# Config
SOURCE_DIR = './fotos'
THUMB_DIR = './fotos_thumb'
THUMB_WIDTH = 400          # px (ancho máximo del thumbnail)
JPEG_QUALITY = 60          # Calidad JPEG (60 = buen balance calidad/tamaño)
SUPPORTED_EXT = {'.jpg', '.jpeg', '.png', '.webp'}

def generate_thumbnails():
    if not os.path.isdir(SOURCE_DIR):
        print(f"❌ No se encontró el directorio '{SOURCE_DIR}'")
        sys.exit(1)

    total = 0
    skipped = 0
    errors = 0
    saved_bytes = 0

    for root, dirs, files in os.walk(SOURCE_DIR):
        # Skip 'imagenes' folder (logos, not restaurant photos)
        if 'imagenes' in root:
            continue

        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in SUPPORTED_EXT:
                continue

            src_path = os.path.join(root, filename)
            # Build the equivalent path in thumb directory
            rel_path = os.path.relpath(src_path, SOURCE_DIR)
            # Force .jpg extension for thumbnails
            thumb_filename = os.path.splitext(rel_path)[0] + '.jpg'
            thumb_path = os.path.join(THUMB_DIR, thumb_filename)

            # Skip if thumbnail already exists and is newer than source
            if os.path.exists(thumb_path):
                src_mtime = os.path.getmtime(src_path)
                thumb_mtime = os.path.getmtime(thumb_path)
                if thumb_mtime >= src_mtime:
                    skipped += 1
                    continue

            # Create the directory structure
            os.makedirs(os.path.dirname(thumb_path), exist_ok=True)

            try:
                with Image.open(src_path) as img:
                    # Handle EXIF rotation
                    try:
                        from PIL import ImageOps
                        img = ImageOps.exif_transpose(img)
                    except Exception:
                        pass

                    # Calculate new height maintaining aspect ratio
                    orig_width, orig_height = img.size
                    if orig_width <= THUMB_WIDTH:
                        # Image is already small enough
                        new_size = (orig_width, orig_height)
                    else:
                        ratio = THUMB_WIDTH / orig_width
                        new_size = (THUMB_WIDTH, int(orig_height * ratio))

                    # Resize with high-quality downsampling
                    img_resized = img.resize(new_size, Image.LANCZOS)

                    # Convert to RGB if necessary (for PNG with alpha)
                    if img_resized.mode in ('RGBA', 'P'):
                        img_resized = img_resized.convert('RGB')

                    # Save as progressive JPEG
                    img_resized.save(
                        thumb_path,
                        'JPEG',
                        quality=JPEG_QUALITY,
                        progressive=True,
                        optimize=True
                    )

                    # Calculate savings
                    src_size = os.path.getsize(src_path)
                    thumb_size = os.path.getsize(thumb_path)
                    saved_bytes += (src_size - thumb_size)

                    total += 1
                    print(f"  ✅ {rel_path}: {src_size//1024}KB → {thumb_size//1024}KB ({100 - (thumb_size*100//src_size)}% reducción)")

            except Exception as e:
                errors += 1
                print(f"  ❌ Error procesando {rel_path}: {e}")

    print(f"\n{'='*50}")
    print(f"📊 Resumen:")
    print(f"  Generados: {total}")
    print(f"  Omitidos (ya existían): {skipped}")
    print(f"  Errores: {errors}")
    if saved_bytes > 0:
        print(f"  Espacio ahorrado: {saved_bytes // 1024 // 1024}MB ({saved_bytes // 1024}KB)")
    print(f"\n💡 Los thumbnails están en '{THUMB_DIR}/'")
    print(f"   Usá las mismas rutas pero reemplazando 'fotos/' por 'fotos_thumb/'")

if __name__ == '__main__':
    print(f"🖼️  Generando thumbnails...")
    print(f"  Origen: {os.path.abspath(SOURCE_DIR)}")
    print(f"  Destino: {os.path.abspath(THUMB_DIR)}")
    print(f"  Tamaño máx: {THUMB_WIDTH}px | Calidad JPEG: {JPEG_QUALITY}")
    print(f"{'='*50}")
    generate_thumbnails()
