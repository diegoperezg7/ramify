<p align="center"><img src="docs/logo.png" width="112" alt="Ramify logo"></p>

<h1 align="center">Ramify</h1>

<p align="center">
  <b>Un git worktree por tarea. Cualquier agente. Cualquier IDE.</b><br>
  Claude Code, Codex, Gemini, Copilot, Cursor, OpenCode o Aider trabajando a la vez sobre el mismo repositorio,<br>
  cada uno en su rama, con sus puertos, sus dependencias y su simulador.
</p>

<p align="center"><a href="README.md">English</a> · macOS · Windows · Linux</p>

<p align="center">
  <a href="#empezar">Empezar</a> ·
  <a href="#uso">Uso</a> ·
  <a href="#apps">App, extensión y plugin</a> ·
  <a href="#dentro-de-un-worktree">Dentro de un worktree</a> ·
  <a href="#seguridad">Seguridad</a>
</p>

<p align="center"><img src="docs/ls.svg" alt="ramify ls: cinco agentes trabajando en cinco ramas del mismo repositorio"></p>

## Empezar

```bash
git clone https://github.com/diegoperezg7/ramify.git && cd ramify && ./install.sh

cd ~/code/tu-repo
ramify new feat/login  -a claude -p "añade login con magic links"
ramify new fix/cart    -a codex  -p "corrige el redondeo del total del carrito"
ramify ls              # quién trabaja dónde, qué ha cambiado y qué está listo para mergear
```

Cada agente tiene su carpeta, su rama, sus puertos y sus dependencias. Cuando uno termina, revisas el
diff, lo mergeas como siempre y quitas el worktree con `ramify rm`. ¿Prefieres una ventana? Descarga la
[app de escritorio o la extensión de VS Code / Cursor](https://github.com/diegoperezg7/ramify/releases/latest).

## Qué ofrece

- **Cualquier agente**: Claude Code, Codex, Gemini, Copilot, Cursor, OpenCode, Aider, Amp o cualquier comando.
- **Cualquier IDE**: Xcode, Cursor, VS Code, Zed, IntelliJ o cualquier app.
- **Listo para trabajar**: copia los ficheros ignorados, instala dependencias, reserva puertos libres y en iOS un simulador por worktree.
- **Todo a la vista**: grafo de ramas coloreado por agente, detección en vivo de qué agente trabaja dónde, diffs y merge desde la interfaz.
- **Todas las sesiones de IA de tu ordenador**: la app encuentra Claude Code, Codex, Gemini… en cualquier terminal o tmux, el chat de IA de Cursor y VS Code y las apps de IA de escritorio; guarda un historial (dónde, qué repo y rama, cuánto duró, su pull request) y lo exporta a CSV o JSON.
- **Cuatro interfaces, un motor**: CLI, app de escritorio para macOS y Windows, extensión de VS Code / Cursor y plugin de Claude Code.
- **Difícil perder trabajo**: quitar un worktree se niega si hay algo sin commitear o sin mergear.
- **Nada en tu repo**: no hace falta ningún fichero de configuración; solo una línea en `.git/info/exclude`.

## Por qué

Dos agentes en el mismo checkout se pisan los ficheros. `git worktree` lo resuelve, pero un worktree
recién creado no está listo para trabajar: le falta el `.env`, los `node_modules` y el proyecto de
Xcode generado, comparte puerto con las demás copias y todos usan el mismo simulador. Ramify hace
esa preparación con un comando, igual para todos los agentes: abres cinco terminales y cinco agentes
trabajan en paralelo.

## Cómo funciona

<p align="center"><img src="docs/architecture.svg" alt="Ramify crea el worktree, copia ficheros ignorados, reserva puertos, prepara el proyecto y lanza el agente"></p>

1. **Worktree**: en `~/.worktrees/<repo>/<nombre>`, fuera del repo, para que los IDE, los tests y los
   watchers del checkout principal no lo indexen. Parte de tu `HEAD` actual.
2. **Ficheros ignorados**: copia los que indique `.worktreeinclude` (sintaxis gitignore, el mismo
   fichero que lee Claude Code), como `.env` o `Local.xcconfig`.
3. **Puertos**: cada worktree recibe un bloque de 10 (`PORT` a `PORT+9`) a partir del 4100.
4. **Preparación**: `.worktree/setup.sh` si el proyecto lo tiene; si no, la detecta:
   `xcodegen generate`, `pnpm`/`yarn`/`bun`/`npm ci`, `uv sync`.
5. **Arranque**: el agente dentro del worktree con `.worktree.env` exportado, y/o tu IDE.

## Instalación

```bash
git clone https://github.com/diegoperezg7/ramify.git
cd ramify && ./install.sh          # enlaza ramify en ~/.local/bin
```

Necesita `git` 2.20+ y `bash` 3.2+ (vale el de macOS). `python3` para el panel, `jq` para los hooks de Claude Code y `tmux` para `--tmux`.

## Uso

```bash
ramify new feat/login -a claude -p "añade login con magic links"
ramify new fix/cart -a codex -i cursor          # agente en la terminal y el worktree abierto en Cursor
ramify new ios/widget -i xcode                  # abre el .xcodeproj generado
ramify new docs/api -a opencode --tmux          # sesión tmux en segundo plano
ramify open fix/cart -a gemini                  # reabrir un worktree con otro agente

ramify ls                                       # todos los worktrees de un vistazo
ramify graph                                    # grafo de ramas con el agente de cada una
ramify ui                                       # panel web en vivo
ramify app                                      # abre este repo en la app de escritorio
ramify rm fix/cart                              # se niega si algo se perdería
ramify prune                                    # borra los worktrees limpios ya mergeados
```

`-f <ref>` elige la base, `--no-setup` omite la preparación y lo que va después de `--` se pasa al agente.

### Agentes

| `-a`       | Ejecuta        | El prompt de `-p` va como |
|------------|----------------|---------------------------|
| `claude`   | `claude`       | primer argumento          |
| `codex`    | `codex`        | primer argumento          |
| `gemini`   | `gemini`       | `-i <prompt>`             |
| `copilot`  | `copilot`      | `-i <prompt>`             |
| `cursor`   | `cursor-agent` | primer argumento          |
| `opencode` | `opencode`     | portapapeles (sin flag)   |
| `aider`    | `aider`        | portapapeles (sin flag)   |
| `amp`      | `amp`          | portapapeles (sin flag)   |
| cualquier otro | ese comando | portapapeles            |

`ls` muestra además qué agente está **ejecutándose** ahora mismo dentro de cada worktree.

### IDE

`-i xcode` abre el `.xcworkspace` o `.xcodeproj` del proyecto. `cursor`, `code`, `zed` e `idea` se
traducen a su app, y cualquier otro valor se abre como nombre de app de macOS (`-i "Android Studio"`)
o como comando en Linux.

## Ver todas las ramas

<p align="center"><img src="docs/graph.svg" alt="ramify graph: grafo de commits de todas las ramas, con su agente"></p>

`ramify graph` dice qué agente trabaja en qué rama y dibuja el grafo de commits de todas, para ver
qué ha hecho cada agente, qué está subido y qué está listo para mergear.

## Apps

La misma interfaz corre en cuatro sitios, y todas leen el repositorio en vivo cada pocos segundos.

<p align="center"><img src="docs/app-dark.png" alt="App de escritorio de Ramify: repos con agentes trabajando, worktrees, árbol de ramas por agente e inspector con diff"></p>

| | Qué tienes |
|---|---|
| **App de escritorio** (macOS, Windows) | Vive en la barra de menús con el número de agentes trabajando, lo pone en el icono del Dock y te avisa cuando un agente termina (pulsas y ves sus cambios). `ramify app` abre el repo en el que estés. Todos tus repos en una ventana. Los repos donde hay un agente trabajando aparecen solos en *Trabajando ahora*, y tus repos de GitHub están a un clic (añadir el clon local o clonarlo). Creas un worktree, eliges agente y se abre en Terminal, iTerm o Ghostty. Paleta de comandos ⌘K, ⌘N nuevo worktree, ↑/↓ para moverte. |
| **Sesiones de IA** (app de escritorio) | Todas las conversaciones con IA del ordenador, detectadas solas: agentes en cualquier terminal (con la app en la que corren: Terminal, iTerm, Ghostty, tmux, Windows Terminal o un IDE), el chat de IA de Cursor, VS Code + Copilot y Windsurf (inferido por la actividad del editor, y marcado así) y las apps de ChatGPT y Claude. Tiempo, repos, ramas y sus pull requests; exportación a CSV o JSON; y los repos en los que trabajó un agente que aún no están en GitHub se pueden subir desde ahí. |
| **Extensión VS Code / Cursor** | El panel como pestaña del editor (`Ramify: Open dashboard`, ⌘⌥W), los agentes en el terminal integrado y un contador de agentes trabajando en la barra de estado. |
| **Plugin de Claude Code** | Todos los worktrees de Claude Code (`--worktree`, sesiones en segundo plano, `/batch`, subagentes) los crea Ramify, más `/ramify:status` y `/ramify:ui`. |
| **Navegador** (`ramify ui`) | Panel de un repositorio desde el terminal: solo 127.0.0.1 y token de un solo uso. |

<p align="center">
  <img src="docs/app-light.png" width="49%" alt="Ramify en modo claro">
  <img src="docs/app-palette.png" width="49%" alt="Paleta de comandos de Ramify">
</p>

Modo claro y oscuro (o el del sistema), español e inglés, densidad cómoda o compacta, y un diseño que pasa de tres
columnas en pantalla ancha a un inspector deslizante y a una sola columna en el móvil.

### Instalación

Cada [release](https://github.com/diegoperezg7/ramify/releases/latest) incluye ya compilados el `.dmg` (Apple silicon e Intel), el instalador `.exe` de Windows y el `.vsix`. Para compilarlos tú:

```bash
# app de escritorio
npm ci && npm run build:desktop        # → apps/desktop/release/ramify-<versión>-arm64.dmg

# VS Code / Cursor
npm ci && npm run build:vscode         # → apps/vscode/ramify.vsix
cursor --install-extension apps/vscode/ramify.vsix   # o: code --install-extension ...
```

```text
# Plugin de Claude Code (usa el plugin o `ramify install claude-hooks`, no los dos)
/plugin marketplace add diegoperezg7/ramify
/plugin install ramify@ramify
```

La app no está firmada: en macOS, la primera vez, clic derecho y *Abrir*; en Windows, SmartScreen pregunta una vez (*Más información* → *Ejecutar de todas formas*). En Windows necesita [Git para Windows](https://git-scm.com/download/win), cuyo bash ejecuta el script `ramify`. La integración con GitHub usa el CLI `gh` con el
que ya tienes sesión. El panel de navegador necesita `python3` y usa el `ui/dist` ya compilado.

### Cómo está hecho

`packages/core` es el motor en TypeScript (estado, diffs, merge, crear, detección de proyectos, GitHub). La app
(Electron) y la extensión lo comparten y llevan dentro el script `ramify`, así que funcionan sin el CLI instalado.
`ui/web` es una sola app React que habla con el host en el que corre: IPC de Electron, mensajes del webview de VS Code o HTTP.

## Dentro de un worktree

Cada worktree tiene un `.worktree.env`, excluido de git, que se exporta al agente:

| Variable       | Ejemplo                                  |
|----------------|------------------------------------------|
| `WT_NAME`      | `feat-login`                             |
| `WT_BRANCH`    | `feat/login`                             |
| `WT_PATH`      | `~/.worktrees/shop/feat-login`           |
| `WT_MAIN`      | `~/code/shop`                            |
| `WT_AGENT`     | `claude`                                 |
| `PORT`         | `4100` (usa del `4100` al `4109`)        |
| `DERIVED_DATA` | `~/.worktrees/shop/.derived-data/feat-login` |

Los agentes conocen las reglas por un bloque corto en sus instrucciones globales:

```bash
ramify install instructions
```

Añade [`snippets/agent-instructions.md`](snippets/agent-instructions.md) una sola vez a cada agente
instalado: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`,
`~/.config/opencode/AGENTS.md`, `~/.copilot/copilot-instructions.md` y `~/.config/amp/AGENTS.md`.
No escribe nada en tus repositorios.

## Preparación por proyecto

```
tu-repo/
├── .worktreeinclude          # ficheros ignorados que se copian: .env, Local.xcconfig ...
└── .worktree/
    ├── setup.sh              # se ejecuta en cada worktree nuevo, con .worktree.env exportado
    └── teardown.sh           # se ejecuta antes de borrar el worktree
```

Los dos scripts son opcionales y pueden quedarse sin versionar: Ramify también los busca en el
checkout principal. Ejemplos en [`examples/`](examples):

- [`ios-xcodegen`](examples/ios-xcodegen): `xcodegen generate` y un simulador propio por worktree
  (`SIM_UDID`), que se borra con él.
- [`web`](examples/web): `npm ci` y un `.env.local` que fija Vite y la API a los puertos del worktree.

## Integración con Claude Code

```bash
ramify install claude-hooks
```

Registra Ramify como hooks `WorktreeCreate` y `WorktreeRemove` de Claude Code (con copia de
`~/.claude/settings.json`). Desde entonces `claude --worktree`, las sesiones en segundo plano,
`/batch`, los workflows y los subagentes con `isolation: worktree` crean sus worktrees con Ramify,
con la misma estructura, puertos y preparación que el resto de agentes. Claude Code conserva los
worktrees de los subagentes al terminar, así que conviene lanzar `ramify prune` de vez en cuando.

## Seguridad

- `rm` se niega si hay cambios sin commitear o commits que no están ni mergeados ni subidos.
- `rm --force` descarta los cambios sin commitear pero **nunca borra una rama con commits sin
  mergear**: se va el worktree y se queda la rama.
- `prune` solo borra worktrees limpios y ya mergeados.
- El checkout principal no se toca, salvo una línea en `.git/info/exclude` (`/.worktree.env`).

## Configuración

| Variable          | Por defecto    |
|-------------------|----------------|
| `RAMIFY_ROOT`     | `~/.worktrees` |
| `RAMIFY_PORT_MIN` | `4100`         |
| `RAMIFY_PORT_MAX` | `4990`         |
| `NO_COLOR`        | sin definir    |

## Tests

```bash
bash tests/run.sh             # CLI, contra repos desechables con agentes simulados (macOS y Linux)
npm run test:core             # motor
npm run test:e2e -w packages/core   # la UI real en Chromium: navegador, editor y nada cortado de 390 a 1920 px
```

Todos corren en la CI.

## Contribuir

Issues y pull requests son bienvenidos. Antes de abrir una PR pasa las tres baterías de tests de arriba; si cambias
`ui/web`, recompílalo con `npm run build:web` y sincroniza el plugin con `scripts/sync-plugin.sh` (CI lo comprueba).

Los logos de las herramientas con las que trabaja Ramify son marcas de sus dueños y solo se muestran para identificarlas. Los iconos vienen de
[LobeHub Icons](https://github.com/lobehub/lobe-icons) (MIT), [Simple Icons](https://simpleicons.org) (CC0) y [Devicon](https://devicon.dev) (MIT); `node scripts/brand-icons.mjs` los regenera.

## Licencia

[MIT](LICENSE)
