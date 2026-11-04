<h1 align="center">agent-wt</h1>

<p align="center">
  <b>Un git worktree por tarea. Cualquier agente. Cualquier IDE.</b><br>
  Claude Code, Codex, Gemini, Copilot, Cursor, OpenCode o Aider trabajando a la vez sobre el mismo repositorio,<br>
  cada uno en su rama, con sus puertos, sus dependencias y su simulador.
</p>

<p align="center"><a href="README.md">English</a></p>

<p align="center"><img src="docs/ls.svg" alt="agent-wt ls: cinco agentes trabajando en cinco ramas del mismo repositorio"></p>

## Por qué

Dos agentes en el mismo checkout se pisan los ficheros. `git worktree` lo resuelve, pero un worktree
recién creado no está listo para trabajar: le falta el `.env`, los `node_modules` y el proyecto de
Xcode generado, comparte puerto con las demás copias y todos usan el mismo simulador. agent-wt hace
esa preparación con un comando, igual para todos los agentes: abres cinco terminales y cinco agentes
trabajan en paralelo.

## Cómo funciona

<p align="center"><img src="docs/architecture.svg" alt="agent-wt crea el worktree, copia ficheros ignorados, reserva puertos, prepara el proyecto y lanza el agente"></p>

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
git clone https://github.com/diegoperezg7/agent-wt.git
cd agent-wt && ./install.sh          # enlaza agent-wt en ~/.local/bin
```

Necesita `git` 2.31+ y `bash` 3.2+ (vale el de macOS). `jq` para los hooks de Claude Code y `tmux` para `--tmux`.

## Uso

```bash
agent-wt new feat/login -a claude -p "añade login con magic links"
agent-wt new fix/cart -a codex -i cursor          # agente en la terminal y el worktree abierto en Cursor
agent-wt new ios/widget -i xcode                  # abre el .xcodeproj generado
agent-wt new docs/api -a opencode --tmux          # sesión tmux en segundo plano
agent-wt open fix/cart -a gemini                  # reabrir un worktree con otro agente

agent-wt ls                                       # todos los worktrees de un vistazo
agent-wt graph                                    # grafo de ramas con el agente de cada una
agent-wt rm fix/cart                              # se niega si algo se perdería
agent-wt prune                                    # borra los worktrees limpios ya mergeados
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

<p align="center"><img src="docs/graph.svg" alt="agent-wt graph: grafo de commits de todas las ramas, con su agente"></p>

`agent-wt graph` dice qué agente trabaja en qué rama y dibuja el grafo de commits de todas, para ver
qué ha hecho cada agente, qué está subido y qué está listo para mergear.

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
agent-wt install instructions
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

Los dos scripts son opcionales y pueden quedarse sin versionar: agent-wt también los busca en el
checkout principal. Ejemplos en [`examples/`](examples):

- [`ios-xcodegen`](examples/ios-xcodegen): `xcodegen generate` y un simulador propio por worktree
  (`SIM_UDID`), que se borra con él.
- [`web`](examples/web): `npm ci` y un `.env.local` que fija Vite y la API a los puertos del worktree.

## Integración con Claude Code

```bash
agent-wt install claude-hooks
```

Registra agent-wt como hooks `WorktreeCreate` y `WorktreeRemove` de Claude Code (con copia de
`~/.claude/settings.json`). Desde entonces `claude --worktree`, las sesiones en segundo plano,
`/batch`, los workflows y los subagentes con `isolation: worktree` crean sus worktrees con agent-wt,
con la misma estructura, puertos y preparación que el resto de agentes. Claude Code conserva los
worktrees de los subagentes al terminar, así que conviene lanzar `agent-wt prune` de vez en cuando.

## Seguridad

- `rm` se niega si hay cambios sin commitear o commits que no están ni mergeados ni subidos.
- `rm --force` descarta los cambios sin commitear pero **nunca borra una rama con commits sin
  mergear**: se va el worktree y se queda la rama.
- `prune` solo borra worktrees limpios y ya mergeados.
- El checkout principal no se toca, salvo una línea en `.git/info/exclude` (`/.worktree.env`).

## Configuración

| Variable            | Por defecto    |
|---------------------|----------------|
| `AGENT_WT_ROOT`     | `~/.worktrees` |
| `AGENT_WT_PORT_MIN` | `4100`         |
| `AGENT_WT_PORT_MAX` | `4990`         |
| `NO_COLOR`          | sin definir    |

## Tests

```bash
bash tests/run.sh
```

Tests de punta a punta contra repositorios desechables con agentes simulados, en macOS y Linux en la CI.

## Licencia

[MIT](LICENSE)
