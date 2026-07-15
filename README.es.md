# Sleepy Cat

**Tu biblioteca personal de prompts.**

## Demostraciones

Haz clic en una vista previa para reproducir el video.

| Codex App | Grupos de prompts en Codex |
| :---: | :---: |
| [![Demostración de Codex App](docs/previews/codex-app-demo.jpg)](docs/codex-app-demo.mp4) | [![Demostración de grupos de prompts en Codex](docs/previews/codex-prompt-group-demo.jpg)](docs/codex-prompt-group-demo.mp4) |
| **Cursor App** | **Claude App** |
| [![Demostración de Cursor App](docs/previews/cursor-app-demo.jpg)](docs/cursor-app-demo.mp4) | [![Demostración de Claude App](docs/previews/claude-app-demo.jpg)](docs/claude-app-demo.mp4) |
| **ChatGPT Web** | **Gemini Web** |
| [![Demostración de ChatGPT Web](docs/previews/chatgpt-web-demo.jpg)](docs/chatgpt-web-demo.mp4) | [![Demostración de Gemini Web](docs/previews/gemini-web-demo.jpg)](docs/gemini-web-demo.mp4) |
| **CLI** | |
| [![Demostración de CLI](docs/previews/cli-demo.jpg)](docs/cli-demo.mp4) | |

**Leer en:** [English](README.md) | [简体中文](README.zh-CN.md) | [हिन्दी](README.hi.md) | **Español** | [العربية](README.ar.md)

Todos merecen una biblioteca personal de prompts.

Sleepy Cat es una biblioteca local de prompts para aplicaciones de escritorio, terminales y herramientas de IA en el navegador, como Codex, Cursor, Claude, ChatGPT, Gemini y muchas más. Selecciona un prompt guardado y Sleepy Cat lo introduce en el campo activo y lo envía en una sola acción. Sin copiar, pegar ni pulsar Return repetidamente. Cambia a **Solo insertar** cuando quieras revisar el contenido antes de enviarlo.

Crea grupos de prompts para enviar una secuencia de prompts en orden.

## Uso

1. Crea prompts individuales, grupos de prompts y categorías en tu biblioteca.
2. Pon el foco en el campo de entrada donde quieras trabajar.
3. Abre Sleepy Cat y elige un prompt o un grupo.

## Descarga

Descarga el DMG más reciente para macOS Apple Silicon o el instalador x64 para Windows desde [GitHub Releases](https://github.com/Imd11/sleepy-cat/releases/latest).

En macOS, se necesita permiso de Accesibilidad para insertar y enviar prompts en las aplicaciones compatibles.

## Tu biblioteca de prompts

Sleepy Cat guarda tu biblioteca localmente y nunca sube el contenido de los prompts a un servidor. Importa o exporta bibliotecas JSON cuando necesites una copia de seguridad o quieras mover tus prompts.

Hay bibliotecas de ejemplo en:

- `examples/prompts/prompts-zh.json`
- `examples/prompts/prompts-en.json`

## Desarrollo

```bash
npm install
npm test
npm run tauri -- build
```

## Licencia

MIT
