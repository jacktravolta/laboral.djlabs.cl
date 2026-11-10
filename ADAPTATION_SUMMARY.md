# Adaptación Front Ley Laboral — estado real verificado

## Origen
Clon completo de `leydatos.djlabs.cl` → `/home/test/test/controldecarroceria/laboral.djlabs.cl`
(el folder `leylaboral/` fue el paso intermedio; `leydatos.djlabs.cl` quedó intacto — solo análisis)

## Corazón leylaboral — CREADO Y VERIFICADO EN DB
- Seeder nuevo: `api.djlabs.cl/bin/seed-leylaboral-heart.php` (patrón de `seed-cotizaia-heart.php`, CLI-only, idempotente).
- Verificado en `asistente_judicial` (MySQL 3306):
  - `heart_settings`: site_title=Asistente Laboral, site_skin=indigo, welcome_bonus_credits=100
  - `heart_personas`: authenticated (1493 chars, system_laboral_b2c_v1 + contrato de empatía) y anonymous (480 chars)
  - `tariffs` (heart-scoped, activas): chat_simple=1, chat_doc=1 (SIP: chat consume 1 crédito), laboral_document=3
- Bug corregido en el seeder: `TariffService::current()` hace fallback a filas GLOBALES (heart_id NULL: chat 8/15). Hay que validar `heart_id` de la fila devuelta antes de saltarse la creación.
- Resolución de corazón: `HeartResolver` honra el heart por request SOLO en `development` (config local: `app.env=development` → OK local). En producción: una instalación = un corazón (`HEART_ID=leylaboral` en su propio deploy).

## Correcciones aplicadas al front (defectos del agente anterior)
- `sed` ciego había dejado: "Asistente Laboral 21.719", "Tu sitio web, al día con la Asistente Laboral", Ley 21.719 en hero/SVG/cómo-funciona/qué-ofrece. Corregido a copy laboral (Código del Trabajo / BCN).
- Títulos sin actualizar: `verificar.html`, `contrasena.html` → Asistente Laboral.
- `debug-sources.html` con heart huérfano `ley_datos_21719` → `leylaboral`.
- `.htaccess` y `README.md` encabezados → laboral.djlabs.cl / Asistente Laboral.
- `app.html`: widget de chat "Asistente Ley 21.719" + welcome → "Asistente Laboral" + copy laboral.
- Todos los `heart_id` defaults: `ley_datos_21719` → `leylaboral` (index.html, app.html, README).

## HECHO Y VERIFICADO (estado real)
- **API**: `POST /laboral/document/generate` + `GET /laboral/document/types` + `POST /laboral/document/download`. `App\Heart\LeyLaboral\DocumentoServicio` genera **22 tipos** con plantillas deterministas + idempotencia (`sourceId` = `lab_`+sha256(key|tipo|user)[:32]); `DocumentoDescargaServicio` entrega **PDF/DOCX/TXT sin recobro** (dueño verificado, footer obligatorio, auditoría en `documents`).
- **RAG**: colección `chile_laboral` ingerida desde BCN — **109 chunks** (CT refundido 68 arts/45 chunks, 21.561, 21.643, 19.728). Ley 21.645 NO se ingiere (ley modificatoria: su verdad ya vive en el CT refundido).
- **Front**: escáner de páginas web eliminado del panel y de la landing; botón «Generar escrito» en el chat; «Mis documentos» acumula los escritos; **selector dinámico con 22 tipos en 4 grupos** (la API es la fuente de verdad); **formulario inline `faltan_datos`**; descarga **PDF/DOCX/TXT sin costo adicional**; **4 quick replies** en la landing; **Términos y Privacidad** reescritos para el producto real.
- **Correcciones de seguridad/contrato**: escape HTML que no escapaba nada (el HTML crudo entraba al PDF), tags huérfanos del escáner en la landing, `heart` con fallback `'default'`, y el re-ingreso de escritos al RAG (un artefacto nunca se recupera: `chat_enabled=0`).
- **E2E en vivo (CDP)**: **6/6 PASS** (landing, registro 100 créditos, panel, perfil, chat con citas BCN, carga exacta 99+1000=1099) + generación con datos, descarga PDF (`%PDF-1.4`) y DOCX (`PK`) desde la UI, quick reply enviado una sola vez, 10/10 escritos con botones de descarga y 0 con «editar/reprocesar».
- **Test funcional**: `php api.djlabs.cl/tests/test_laboral_documentos.php` → 915 comprobaciones, 0 fallos (idempotencia, esquema, dueño ajeno rechazado, saldo intacto).

## PENDIENTE (siguiente build)
1. **Facturación propia** para las demandas judiciales (hoy 3 créditos, como el resto).
2. **Dictámenes DT** (24 meses) para la colección RAG.
3. **Formulario de datos en el chat** (hoy el formulario es el del generador de escritos).
4. **Cutover a producción**: instalar la API dedicada con `HEART_ID=leylaboral` (host, credenciales, DNS y TLS pendientes de autorización).

- **Despliegue**: script `api.djlabs.cl/scripts/publish-laboral-front.sh` (publica el front en `public/laboral/` y verifica cada ruta con 200) + runbook `api.djlabs.cl/docs/leylaboral-produccion.md` (instalación dedicada con `HEART_ID=leylaboral`, seed, ingesta BCN, verificación y rollback). El cutover remoto queda pendiente de autorización (host, credenciales, DNS).
- **Router de desarrollo**: `api.djlabs.cl/bin/dev-router.php` — sin él, `php -S -t public` resuelve `/laboral/document/*` con el `index.html` del front publicado en vez de llegar a la API.

## Comprobación
- Servidor estático: `python3 -m http.server 8001` (200 OK).
- Seeder: ejecutado 2×; idempotente (segunda pasada solo versiona lo que falta).
- Verificación DB: query directa sobre `tariffs`, `heart_settings`, `heart_personas`.
