# Fixtures de runtime del Extension Host

Extensiones **reales** (CommonJS, sin dependencias) que el `ExtensionRuntime`
carga en `tests/extensions/extension-runtime.test.cjs`. Cubren los cuatro
resultados que el modelo de fallos del diseño §6 distingue:

| Fixture | Qué ejercita |
| --- | --- |
| `healthy` | `require('vscode')`, `context.subscriptions`, exports, `deactivate()` |
| `throwing` | excepción en `activate` tras registrar un disposable |
| `unsupported` | uso de una API que Forge todavía no implementa |
| `silent` | `main` válido sin `activate` exportado (extensión declarativa) |
| `escaping` | `main` que apunta fuera del directorio instalado |

Ninguna se descarga: el documento de seguridad prohíbe depender de un
registro externo, así que viven en el repo con su versión fijada.
