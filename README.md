# GoHighLevel (GHL) Pipeline Maestro & Autopilot

Sistema inteligente y autónomo diseñado para automatizar la gestión, distribución y clasificación de leads en GoHighLevel (GHL).

**Desarrollado y Arquitectado por: Gabriel Loayza** 🚀

---

##  Características Principales

* **Micromotor de Peinado Histórico (El "Peinador"):** Un motor en segundo plano que barre continuamente toda la base de datos (página por página) para recuperar contactos antiguos o perdidos y acomodarlos en el flujo comercial.
* **Sincronizador 24/7 en Tiempo Real:** Un servidor en la nube que lee los contactos modificados más recientemente cada 2 minutos, asegurando que ninguna oportunidad nueva se quede sin ser atendida.
* **Lógica Anti-Duplicados Inteligente:** El sistema audita si el cliente ya existe en el Pipeline. Si el usuario estaba "Precalificado" y de pronto obtiene un número de teléfono, el bot lo **mueve** automáticamente de etapa en lugar de duplicarlo.
* **Asignación de Sedes Automática:** Lee las etiquetas de origen (Páginas de Meta) dinámicamente y asigna la tarjeta de oportunidad al asesor correspondiente (Palacios, Benavides, Roosevelt, Piura, etc.) garantizando una distribución limpia.

---

##  Lógica Comercial del Pipeline

1. **💬 Precalificado (Sin Teléfono / En Chat):**
   * Contactos que entraron por redes pero aún no proporcionan su número de contacto.
2. **📞 Lead Calificado (Con Teléfono / Listo para Llamar):**
   * Contactos que ya cuentan con número de teléfono verificado. El sistema los arrastra aquí automáticamente para que el equipo comercial inicie las llamadas.
3. **⏳ En Llamada / Negociación:** Etapa de seguimiento comercial activo.
4. **🎉 Venta Cerrada (Ganado):** ¡Cierre exitoso!
5. **❌ No Contesta / Descalificado:** Prospectos descartados.

---

##  Arquitectura de Archivos

* **`webhook_server.js`**: El cerebro principal. Mantiene el servidor 24/7 vivo, ejecutando el sincronizador en tiempo real y el "Micromotor" histórico de peinado continuo.
* **`distribute_contacts.js`**: Contiene el núcleo de la lógica inteligente (`processContactPipeline`) que audita, crea o mueve las oportunidades dentro del tablero de GHL. También permite inyecciones masivas (Batch).
* **`config.js`**: El corazón de la configuración. Define las credenciales de GHL, el ID del Pipeline Maestro y la tabla dinámica de emparejamiento entre Sedes, Etiquetas y Vendedores.
* **`pipeline_manager.js`**: Script de infraestructura. Instala, valida y crea la estructura del Tablero Kanban dentro de la subcuenta de GHL.
* **`index.js` & `ejecutar_pipeline.bat`**: Interfaz de línea de comandos (CLI) interactiva para que un operador ejecute rutinas manualmente de forma fácil y rápida con solo presionar números.

---
*© 2026 Gabriel Loayza - Soluciones de Automatización Avanzada para Call Centers.*
