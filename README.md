# laboral.djlabs.cl — Asistente Laboral (corazón `leylaboral`)

Front independiente del producto **Asistente Laboral B2C**: diagnóstico legal en
lenguaje simple con citas verbatim de la **BCN (Ley Chile)**, chat con el asesor
y **generación de escritos** que quedan en «Mis documentos». Clon de
`leydatos.djlabs.cl` adaptado al pack SIP (`laboral.djlabs.cl/sip_x5f_laboral_x5f_dev.zip`).

```
Navegador ──REST JSON + cookies──▶ api.djlabs.cl (corazón leylaboral)
   │                                    │
   │                                    ├─ RAG «chile_laboral» (109 chunks, texto verbatim BCN)
   │                                    ├─ BcnClient (scraper oficial Ley Chile + cache)
   │                                    └─ Tarifas heart-scoped: chat 1 crédito · escrito 3 créditos
   └─ CORS: el origen del front debe estar en `cors.origins`
```

## Qué funciona HOY (verificado en vivo, E2E CDP 6/6)

| Flujo | Cómo se comprueba |
|---|---|
| Registro | Formulario real → 100 créditos de bienvenida del corazón → redirige al panel |
| Login | Contraseña (sesión 30 min + refresh httpOnly) |
| Perfil | Cambio de nombre por UI, persistido (`PUT /profile`) |
| Consulta laboral | Chat del panel: formato B2C de 5 partes con citas «Art. + Ley + BCN» (ej. despido con licencia → Ley 19.728 Art. 10; acoso → CT 211 A / 211 B bis) |
| Cargar saldo | UI Billetera → chip (1000/5000/10000 CLP) → orden PENDING → confirmación → saldo exacto; idempotencia por `Idempotency-Key` |
| **Generar escrito** | Botón en el chat → **22 tipos** (4 del SIP + 14 ampliados + 4 judiciales) → 3 créditos (idempotente) → aparece en «Mis documentos» |
| **Formulario de datos** | **Modal** (se abre desde el botón del panel, desde el acceso «Generar un escrito» del chat o desde la acción que ofrece el asistente): los campos del tipo elegido (vienen de la API), prellenados con el perfil, y lo que falte marcado como `[COMPLETAR - verificar]` |
| **Datos desde el perfil y el chat** | Lo que la persona responde en el chat para un dato que el perfil tiene (nombre, RUT, teléfono) se guarda solo por el mismo `PUT /profile`; junto a los adjuntos se avisa que lo escrito va anonimizado a la IA |
| **Descarga real** | PDF, DOCX y TXT desde «Mis documentos» — **sin costo adicional** (los 3 créditos ya pagan el escrito) |
| **Quick replies** | 4 chips en la landing que llevan la pregunta al chat del panel (se envía una sola vez) |

Los escritos se generan con **plantillas deterministas** (nunca texto libre del
LLM): los campos sin datos quedan como `[COMPLETAR - verificar]`. Un escrito
jamás inventa RUTs, fechas ni montos. Todo escrito lleva el aviso de borrador
con revisión humana.

## Catálogo de escritos disponibles (22)

| Grupo | Tipos (`tipo_documento`) |
|---|---|
| **Reclamos ante la Inspección del Trabajo** (12) | `reclamo_dt_despido` · `reclamo_finiquito_cotizaciones` · `reclamo_impago_sueldo` · `reclamo_horas_extra` · `reclamo_feriado` · `reclamo_descanso_semanal` · `reclamo_maternidad_fuero` · `reclamo_sala_cuna` · `reclamo_teletrabajo` · `reclamo_accidente_no_registrado` · `reclamo_40_horas` · `reclamo_gratificaciones` |
| **Cartas y solicitudes al empleador** (4) | `carta_autodespido` · `carta_disconformidad_finiquito` · `solicitud_certificado_laboral` · `reclamo_postnatal_parental` |
| **Denuncias de protección** (2) | `denuncia_ley_karin` · `denuncia_condiciones_inseguras` |
| **Escritos judiciales** (4) | `demanda_despido_injustificado` (Arts. 168/169) · `demanda_nulidad_despido` (Art. 162) · `tutela_laboral` (Art. 485) · `ejecucion_finiquito` (Juicio de Ejecución) |

Los 4 Judiciales son **modelos de borrador**: llevan un banner explícito de que
una demanda solo se presenta con la revisión de un abogado y ante el juzgado
competente.

El catálogo y los campos por tipo viven **solo en la API**
(`GET /laboral/document/types` → 4 grupos, 22 tipos, campos con etiqueta y
placeholder); el front los pinta, no los duplica.

## Arquitectura

- **Front** (este repositorio): HTML + Tailwind CDN + JS vanilla ES6. La única
  perilla de despliegue es `api-config.js` (`window.__API_BASE__`); en local,
  `?api=http://127.0.0.1:8086` (solo se respeta en localhost).
- **API** (`api.djlabs.cl`): PHP, una instalación = un corazón en producción
  (`HEART_ID=leylaboral`). En `development` el corazón viaja por request
  (`heart=leylaboral`) — ver `HeartResolver`.
- **Verdad legal**: `App\Legal\BcnClient` scrapea los endpoints internos de
  Ley Chile (browser UA + gzip + cache en disco) y `LawDocument` parsea los 7
  formatos reales del CT refundido (`Art. N.`, `Artículo 211-F`, `40 bis E`, …).
- **RAG `chile_laboral`** (heart `leylaboral`, scope global): CT Arts. 7-13,
  21-40 bis, 159-171, 184, 211 A-E + Ley 21.561 + 21.643 + 19.728 — 109 chunks
  con la línea `[BCN] Ley: … | Art.: … | Fuente: …` dentro de cada bloque.
  Regenerable con `php bin/ingest-laboral-bcn.php` (dry-run con `--dry-run`).
- **Corazón**: `php bin/seed-leylaboral-heart.php` — marca, skin, bono 100,
  personas (regla BCN-only) y tarifas heart-scoped
  (`chat_simple`/`chat_doc` = 1, `laboral_document` = 3).
- **Escritos**: `App\Heart\LeyLaboral\DocumentoServicio` + `POST
  /laboral/document/generate` (Idempotency-Key obligatoria; re-enviar la misma
  key devuelve el MISMO documento sin recobro). Persistidos como artefacto
  `lab_…` (36 chars, convención de la casa) vía `registrarArtefacto`.

## Publicación y producción

El front se publica en dos destinos, con **un solo archivo de configuración**
(`api-config.js`, `window.__API_BASE__`):

```bash
# Copia dentro de la API (deploy de un solo servidor: api.djlabs.cl/public/laboral/)
cd api.djlabs.cl && bash scripts/publish-laboral-front.sh --dry-run
cd api.djlabs.cl && bash scripts/publish-laboral-front.sh   # publica + verifica (200 en cada ruta)
```

En **producción** el corazón lo manda `HEART_ID` del entorno, no el `heart` del
request (`HeartResolver` solo honra el request en `development`): por eso el
producto necesita una **instalación dedicada** con `HEART_ID=leylaboral`.
Runbook completo (variables, seed, ingesta BCN, verificación, rollback):
`api.djlabs.cl/docs/leylaboral-produccion.md`.

## Cómo probarlo en local

```bash
# API (config.php: app.env=development, base_url=http://127.0.0.1:8086)
# El router de dev es necesario: el front publicado vive en public/laboral/
# y sin router el servidor embebido resuelve /laboral/document/* como el
# index.html del front en vez de llegar a la API.
cd api.djlabs.cl && php -S 127.0.0.1:8086 -t public bin/dev-router.php

# Front
cd laboral.djlabs.cl && python3 -m http.server 8001

# Navegador: http://127.0.0.1:8001/index.html?api=http://127.0.0.1:8086

# E2E visual completo (CDP, Chrome headed en :0.0)
node /tmp/opencode/cdp_drive.mjs

# Verificación funcional de los escritos (22 tipos, esquema, descarga)
cd api.djlabs.cl && php tests/test_laboral_documentos.php
```

Requisitos de config: `cors.origins` incluye `http://127.0.0.1:8001`; pagos en
`provider: fake` (dev) simulan la pasarela con
`GET /payments/fake/confirm?order=…`.

## Evidencia

- E2E CDP: `/tmp/opencode/cdp_summary.json` + capturas `01…09_*.png`.
- Defectos cazados y corregidos en vivo: orden de `api-config.js` vs boot del
  tema (404 de `/ui/theme` en 2-servidores), redirect a `app.html` que perdía
  `?api=`, tarifas de chat ignorando el corazón (cobraba 15 en vez de 1),
  parser BCN del CT refundido (228 → 736 artículos).

## Pendiente (build siguiente)

1. Facturación propia para las demandas judiciales (hoy 3 créditos, como el resto).
2. Dictámenes DT (24 meses) para la colección RAG.
3. Formulario de datos en el **chat** (hoy el formulario es el del generador de escritos).
4. Verificación en la sesión real del usuario final (hoy E2E con cuenta de pruebas).
