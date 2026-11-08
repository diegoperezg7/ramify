<p align="center"><img src="docs/logo.png" width="160" alt="Logo de Ramify"></p>

<h1 align="center">Ramify</h1>

<p align="center">
  <b>Trabaja con varios asistentes de IA a la vez, sin que se pisen.</b><br>
  Claude Code, Codex, Gemini, Copilot, Cursor y 35 más pueden construir partes distintas de tu proyecto al mismo
  tiempo. Ramify le da a cada uno su propio espacio, te enseña quién está haciendo qué ahora mismo y te deja llevar
  cada trabajo a tu proyecto con un clic cuando está listo.
</p>

<p align="center">
  <a href="https://github.com/diegoperezg7/ramify/releases/latest"><b>Descargar para macOS</b></a> ·
  <a href="https://github.com/diegoperezg7/ramify/releases/latest"><b>Descargar para Windows</b></a> ·
  <a href="#para-desarrolladores">CLI, extensión de editor y plugin de Claude Code</a>
</p>

<p align="center"><a href="README.md">English</a></p>

<p align="center"><a href="docs/ramify-demo.mp4"><img src="docs/ramify-hero.gif" width="800" alt="Ramify: arranca un agente en una rama propia y lleva su trabajo a main con un clic"></a></p>

<p align="center"><sub><b><a href="docs/ramify-demo.mp4">▶ Ver la demo completa (55 s)</a></b>: agentes trabajando ahora, un agente nuevo y su terminal, horas de los agentes, cualquier día al detalle, las ramas y un merge con un clic</sub></p>

## En pocas palabras

Los asistentes de IA que escriben código son rápidos, y cuando pruebas a usar dos a la vez ya no quieres volver
atrás. El problema: si los pones en el mismo proyecto, se pisan el trabajo. Si le das a cada uno una copia aparte,
a la semana nadie recuerda en qué copia estaba el cambio que necesitabas.

**Ramify es el organizador de mesas de tu equipo de IA.**

- **Cada asistente tiene su propia mesa.** Una copia aparte de tu proyecto (una *rama*), preparada y lista, para
  que nadie toque el trabajo de otro. Pasa sola, también cuando abres un asistente desde la terminal.
- **Ves toda la oficina de un vistazo.** Quién está trabajando ahora, en qué, desde cuándo y qué ha cambiado. Los
  encuentra solo: no hay que configurar nada en cada herramienta.
- **Tú decides qué entra.** Cuando un trabajo está listo, ves exactamente qué ha cambiado y lo llevas a tu proyecto
  con un clic. Si algo choca, Ramify te dice por qué en palabras normales y no cambia nada.

Todo se queda en tu ordenador.

## Para quién es

- **Construyes con IA.** Usas Claude Code, Codex, Cursor o parecidos para hacer apps, webs o herramientas, y quieres
  varios trabajando a la vez sin perder el hilo.
- **Eres desarrollador.** Ya lanzas agentes en paralelo y quieres que las ramas, los puertos y las dependencias se
  resuelvan solos, con una pantalla donde ver todas las ramas en construcción.
- **Llevas un equipo pequeño.** Quieres ver por dónde va el trabajo de la IA, qué está listo y qué necesita una revisión.

## Empieza en tres pasos

**1. Instálalo.** Descarga la app para [macOS o Windows](https://github.com/diegoperezg7/ramify/releases/latest).
En Mac, arrastra Ramify a Aplicaciones.

<p align="center"><img src="docs/screenshots/install-dmg.png" width="560" alt="La ventana del instalador de Ramify: arrastra la app a Aplicaciones"></p>

**2. Deja que prepare este ordenador.** La primera vez, Ramify te enseña las herramientas de IA que ha encontrado y
te ofrece dejarlo todo listo con un clic: desde entonces cada asistente trabaja en su propia rama, también los que
abres desde una terminal. Se puede deshacer en Ajustes.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-setup-dark.png"><img src="docs/screenshots/app-setup-light.png" alt="Prepara este equipo: Claude Code, los demás agentes, la terminal y el comando ramify, listos con un clic"></picture></p>

**3. Trabaja como siempre.** Abre tus asistentes como ya lo haces. Ramify los ve, le da a cada uno su espacio y los
muestra en el centro de control. Cuando uno termina, revisa sus cambios y llévalos a tu proyecto.

## Qué puedes hacer

### Ver quién está trabajando ahora mismo

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-control-dark.png"><img src="docs/screenshots/app-control-light.png" alt="Centro de control: seis agentes trabajando ahora, cada uno con su proyecto, su rama, cuánto lleva y qué ha cambiado; uno marcado porque te necesita"></picture>

Una tarjeta por cada asistente trabajando: cuál es, en qué proyecto y rama, desde cuándo y qué ha cambiado hasta
ahora. El que se ha parado a preguntarte algo lo dice. Si no hay nadie trabajando, te enseña dónde y con qué
asistentes trabajaste por última vez. Si uno empieza a cambiar la versión principal de tu proyecto, aparece un aviso
con un botón para llevarlo a su propia rama.

### Ver cuánto y cuándo trabajan tus asistentes

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-activity-dark.png"><img src="docs/screenshots/app-activity-light.png" alt="Actividad de los agentes: tiempo con agentes, máximo a la vez, sesiones y proyecto principal, horas por día apiladas por agente y un día hora a hora"></picture>

La semana o el mes en cuatro cifras (tiempo con agentes, máximo a la vez, sesiones y proyecto principal), las horas
por día de cada asistente y cualquier día hora a hora: quién trabajó cuándo y cuántos había a la vez.

### Tu historial de un vistazo, y cualquier día al detalle

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-heatmap-dark.png"><img src="docs/screenshots/app-heatmap-light.png" alt="Un año de commits en una cuadrícula, la racha actual y el día con más commits, y un día abierto: sus cifras, los commits hora a hora, un carril por proyecto con sus commits y sus sesiones de IA, y los commits de cada proyecto"></picture>

Un año de trabajo en una cuadrícula de cuadraditos, tu racha actual y tu día con más trabajo. Pulsa cualquier
cuadradito para abrir ese día: cuánto se guardó y a qué horas, un carril por proyecto con sus commits y los
asistentes que trabajaron en él, y qué se guardó en cada uno.

### Todas las conversaciones de IA de tu ordenador

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-sessions-dark.png"><img src="docs/screenshots/app-sessions-light.png" alt="Sesiones de IA: una tarjeta por agente trabajando ahora con su tarea, su último paso, su actividad en la última hora, los archivos que ha editado y los commits y cambios de su rama, y uno que te necesita"></picture>

Asistentes en cualquier terminal, el chat de tu editor y las apps de IA de escritorio, encontrados solos. Una tarjeta
por conversación: qué se le pidió, su último paso, cuánto ha trabajado en la última hora, los archivos que ha editado
y qué tiene su rama. Dentro de cada una, los agentes que ha lanzado y la rama en la que trabaja cada uno: subagentes de
Claude Code en plena tarea, compañeros de un equipo de agentes en su propio panel, worktrees que ha creado un subagente
y los hilos de Codex de la app de ChatGPT. Debajo, las horas con IA por día, los proyectos de la semana y un historial
de cada sesión agrupado por días, exportable a una hoja de cálculo.

### Saber cuándo te necesita un asistente

La barra de menús cuenta en ámbar los asistentes que te necesitan: uno esperando una respuesta, dos trabajando en la
misma rama, uno cambiando la versión principal directamente o uno que terminó en una rama lista para llevar al
proyecto. En violeta, los que están trabajando; ábrela para ver qué hace cada uno. El Dock muestra la misma cuenta, la
barra lateral marca los proyectos con algo que mirar y una notificación te avisa una sola vez cuando una rama está
lista (Ramify te pregunta antes y puedes quitarla en Ajustes).

### Ver exactamente qué ha cambiado cada asistente

https://github.com/user-attachments/assets/6fb28701-b117-49b2-a899-73d64cae7ea8

Cada rama con su asistente, y sus cambios línea a línea como en GitHub: verde lo añadido, rojo lo quitado. Ábrela en
los editores que tienes instalados, vuelve a lanzar el asistente, llévala a tu proyecto o quítala. Ramify nunca borra
trabajo que no esté guardado o llevado al proyecto.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-branches-dark.png"><img src="docs/screenshots/app-branches-light.png" alt="Árbol de ramas: main en violeta, cada rama del color de su asistente, y una rama abierta con sus cambios, sus commits, sus puertos y botones para abrirla en un editor, volver a lanzar el agente, mergearla o quitarla"></picture>

La versión principal destaca en violeta en el árbol, en la lista y en el detalle. Con la sesión de GitHub iniciada,
cada rama muestra además su pull request abierta.

### Llevar el trabajo a tu proyecto con un clic

https://github.com/user-attachments/assets/70585f1f-0d82-400b-bede-42561499f0c9

Cuando un trabajo está listo, un clic lo lleva a tu proyecto y un mensaje corto te lo confirma. Si choca con otra
cosa, una ventana te explica qué ha pasado, qué ficheros chocan y qué hacer. No se cambia nada.

### Todas las ramas en una línea de tiempo

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-timeline-dark.png"><img src="docs/screenshots/app-timeline-light.png" alt="Línea de tiempo: ramas activas, paradas y mergeadas, desde donde empezó cada una hasta donde entró en el proyecto"></picture>

Una banda por rama, desde donde empezó hasta donde entró en el proyecto, del color del asistente que trabajó en ella.
Las ramas terminadas y borradas siguen ahí, para que la historia quede completa.

### Lanzar un asistente con un clic

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-new-agent-dark.png"><img src="docs/screenshots/app-new-agent-light.png" alt="Nuevo agente: el repositorio, los asistentes instalados en este equipo con sus logos, la tarea y la rama que toma su nombre"></picture>

Elige el asistente por su logo (primero los que tienes instalados, el resto a un clic), di qué tiene que hacer y
Ramify crea su rama y lo abre en tu terminal.

### Ajustes que se ven de un vistazo

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-settings-dark.png"><img src="docs/screenshots/app-settings-light.png" alt="Ajustes, General: la terminal, el editor por defecto y cuánto guardar el historial de sesiones, cada uno como una fila de opciones con su logo"></picture>

Los ajustes van en pestañas laterales: General, Agentes, Automatización, Avisos, GitHub y Sistema. La
terminal, el editor y el asistente por defecto se eligen por su logo en vez de en una lista larga. El inicio de sesión
con GitHub tiene su propia pestaña y está en la barra de estado, en cualquier momento después de la introducción.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-settings-agents-dark.png"><img src="docs/screenshots/app-settings-agents-light.png" alt="Ajustes, Agentes: todos los asistentes compatibles con su logo oficial"></picture>

### Claro u oscuro, como tu sistema

<img src="docs/screenshots/app-control-light.png" width="49%" alt="El centro de control con el tema claro"> <img src="docs/screenshots/app-control-dark.png" width="49%" alt="El centro de control con el tema oscuro">

## Palabras que vas a ver

| Palabra | Qué significa |
|---|---|
| **Agente** o **asistente** | Una IA que escribe código por ti: Claude Code, Codex, Gemini, Copilot, Cursor… |
| **Rama** | Una versión aparte de tu proyecto donde se hace un trabajo sin tocar el resto. |
| **Worktree** | La carpeta donde vive una rama, para que cada agente tenga su propia copia en la que trabajar. |
| **main** | La versión principal de tu proyecto, a la que van los trabajos terminados. |
| **Merge** | Llevar el trabajo de una rama a main. |
| **Commit** | Un paso de trabajo guardado, con una frase de qué ha cambiado. |

## Funciona con

<p align="center"><img src="docs/works-with.svg" alt="Funciona con Claude Code, Codex, Gemini CLI, Copilot, Cursor, Qwen Code, DeepSeek, Kimi, Mistral Vibe, Grok, Amp, OpenCode, Kiro, Junie, Cline, Goose, VS Code, Cursor, Windsurf, Antigravity, Zed, Xcode, IntelliJ, Android Studio, PyCharm, Trae, iTerm, Ghostty, Warp, WezTerm, Windows Terminal, tmux, ChatGPT, Claude y GitHub"></p>

Cualquier otro agente también funciona: Ramify lanza el comando que le digas.

## Privado por diseño

- **Todo en local, sin telemetría.** Nada de tu código, tus prompts o tus sesiones sale de tu ordenador.
- **GitHub en solo lectura.** El login usa una GitHub App con device flow: lectura de metadatos de repos y de pull
  requests, solo en los repos que tú elijas. La app no lleva ningún secreto dentro.
- **Tokens en el llavero del sistema**, cifrados, renovados cada 8 h, nunca en texto plano ni en logs y nunca
  entregados a la interfaz.
- **Endurecido.** La configuración git de un repo no puede hacer que Ramify ejecute programas; la ventana tiene una
  Content Security Policy estricta, ningún permiso del navegador y los fuses de Electron cerrados; los enlaces solo se abren por https (o a tu propio equipo).

## Antes y después

| | Sin Ramify | Con Ramify |
|---|---|---|
| Dos agentes, un repo | Se pisan los ficheros | Cada uno en su rama y su carpeta |
| Rama nueva para un agente | Copiar `.env`, instalar dependencias, buscar un puerto libre… | Un comando o un clic |
| Qué hace cada agente | Ir saltando entre pestañas de terminal | Una pantalla, en vivo, detectado solo |
| Un agente trabajando en `main` | Te enteras después | Un aviso y una rama con un clic |
| Un agente esperando una respuesta | Lo ves al cambiar de pestaña | Una cuenta en ámbar en la barra de menús |
| Qué cambió cada agente | `git diff` en cada carpeta | Diff estilo GitHub por rama |
| Las ramas del mes pasado | Olvidadas | Una línea de tiempo, mergeadas incluidas |

## Preguntas

**¿Necesito saber git?** No. Ramify crea y nombra las ramas, mantiene a cada asistente en la suya y lleva el trabajo
al proyecto cuando haces clic. Las palabras que vas a ver están explicadas [arriba](#palabras-que-vas-a-ver).

**¿Funciona con las herramientas de IA que ya uso?** Casi seguro: reconoce 40 asistentes, 32 editores, 16 terminales
y 14 apps de IA, y cualquier otro comando puede trabajar en su propia rama igualmente.

**¿Qué pasa si dos asistentes cambian el mismo fichero?** Ramify te avisa mientras trabajan (la rama muestra que toca
los mismos ficheros que otra). Al llevar la segunda al proyecto, si los cambios chocan de verdad, se para, no cambia
nada y te explica qué hacer.

**¿Tengo que cambiar mi forma de trabajar?** No. Sigue abriendo los agentes como siempre; Ramify los ve.
Usa `ramify new` (o *Nuevo agente* en la app) cuando quieras una rama nueva para una tarea.

**¿Envía mi código a algún sitio?** No. Todo corre en tu ordenador. Las únicas llamadas de red van a github.com,
para que la app busque una versión nueva de sí misma (se puede desactivar en Ajustes), y las funciones de GitHub solo si
inicias sesión (o a través del CLI `gh` que ya usas).

**¿Qué agentes soporta?** Los 40 que reconoce se detectan y se muestran con su logo; cualquier otro comando se puede
lanzar en un worktree igualmente.

**¿Cómo detecta el chat de Cursor o VS Code?** Por la actividad del propio editor en ese proyecto. Esas sesiones se
marcan como *inferidas*, porque que el editor esté activo no prueba que haya una conversación.

**¿Y Windows?** La app, los worktrees y la detección de sesiones funcionan en Windows. Una diferencia: Windows no deja
que otro programa lea la carpeta de trabajo de un proceso, así que ahí los agentes de terminal salen sin su repo.

**¿Qué pasa con las ramas cuando termino?** Nada que no hayas pedido. `ramify prune` solo quita worktrees limpios y
mergeados, y `rm` se niega si queda algo sin commitear o sin mergear.

## Para desarrolladores

Todo lo anterior es la app de escritorio. Ramify también es una herramienta de línea de comandos, una extensión para
VS Code / Cursor y un plugin de Claude Code, todo compilado desde este repositorio. Esta parte es para quien quiera
instalar esas piezas, compilar desde el código o saber cómo funciona por dentro.

## Estado

**Versión 0.10.0.** App de escritorio para macOS (Apple silicon) y Windows (x64), extensión de VS Code / Cursor,
CLI y plugin de Claude Code, todo compilado desde este repositorio.

- **Probado:** la CI ejecuta las baterías de tests del CLI, del núcleo y de la app (ver [Tests](#tests)).
- **Descargas:** todas las versiones están en [Releases](https://github.com/diegoperezg7/ramify/releases). Para compilarla
  tú: `npm ci && npm run build:desktop` (los instaladores quedan en `apps/desktop/release/`).
- **Firma:** la app de macOS está firmada con Developer ID y notarizada. El instalador de Windows aún no está firmado y
  avisa la primera vez (ver abajo).
- **Login con GitHub:** usa la GitHub App [Ramify Desktop](https://github.com/apps/ramify-desktop); sin iniciar sesión,
  las funciones de GitHub usan el CLI `gh` con el que ya hayas iniciado sesión.
- **Windows:** los agentes de terminal salen sin su repositorio (Windows no deja leer la carpeta de otro proceso) y la
  app se ha verificado en CI, no a mano.

## Instalación

**App de escritorio** (macOS 12+ en Apple silicon, Windows 10+): descárgala de la
[última release](https://github.com/diegoperezg7/ramify/releases/latest). En macOS se abre como cualquier otra app. En Windows,
que aún no está firmado, *Más información* → *Ejecutar de todas formas*. En Windows necesita [Git para Windows](https://git-scm.com/download/win).

**Actualizaciones** (desde la 0.7.6): cuando sale una release nueva, la app lo avisa en una esquina con un botón *Descargar*.
Se descarga en segundo plano y *Reiniciar y actualizar* la instala (o se instala la próxima vez que la cierres). El comando
`ramify` y el plugin de Claude Code instalados desde la app se actualizan con ella, porque viven dentro. En Ajustes,
*Buscar versiones nuevas de Ramify* desactiva la comprobación.

**Extensión VS Code / Cursor**: el `.vsix` de la [última release](https://github.com/diegoperezg7/ramify/releases/latest) y luego
`code --install-extension ramify-*.vsix` (o `cursor --install-extension …`).

**CLI** (macOS y Linux; en Windows desde Git Bash):

```bash
git clone https://github.com/diegoperezg7/ramify.git
cd ramify && ./install.sh          # deja ramify en ~/.local/bin
```

Necesita `git` 2.20+ y `bash` 3.2+, y `jq` para los hooks de Claude Code (viene con macOS 15+; `brew install jq`
en versiones anteriores). Sin `jq` los hooks nunca bloquean tu trabajo, pero no se pueden crear worktrees para
`EnterWorktree` y la guarda de `main` lee su entrada con un parser mínimo; cada sesión de Claude Code lo avisa al empezar.
Opcional: `python3` para `ramify ui` y `tmux` para `--tmux`. La app de escritorio y la extensión de VS Code / Cursor
necesitan `git` 2.31+.

**Plugin de Claude Code**: todos los worktrees que crea Claude Code (`--worktree`, sesiones en segundo plano,
`/batch`, subagentes) pasan por Ramify.

```text
/plugin marketplace add diegoperezg7/ramify
/plugin install ramify@ramify
```

Añade skills de buenas prácticas: `/ramify:nueva-rama` (empezar una tarea en su rama), `/ramify:portar-tarea` (sacar el
trabajo de main), `/ramify:preparar-pr` (al día, pequeña, commits convencionales, PR en borrador) y
`/ramify:terminar-tarea` (comprobar que está mergeada y quitar worktree y rama), además de `/ramify:status` y `/ramify:ui`.

## Preparar un Mac con tu agente de IA

Pásale este repositorio a Claude Code (o a cualquier agente con terminal) en un Mac nuevo y pídele que *"prepare Ramify
en este Mac siguiendo el README"*. Estos son los pasos que ejecuta; hacen lo mismo que *Preparar este ordenador* de la
app, sin clics. Apple silicon, macOS 12 o posterior.

```bash
# 1. La app, de la última release (firmada y notarizada: sin aviso de Gatekeeper)
v=$(curl -fsSL https://api.github.com/repos/diegoperezg7/ramify/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
d=$(mktemp -d)
curl -fL -o "$d/ramify.dmg" "https://github.com/diegoperezg7/ramify/releases/download/v$v/ramify-$v-arm64.dmg"
hdiutil attach -nobrowse -readonly -quiet "$d/ramify.dmg" -mountpoint "$d/mnt"
rm -rf /Applications/Ramify.app && ditto "$d/mnt/Ramify.app" /Applications/Ramify.app
hdiutil detach -quiet "$d/mnt"

# 2. El comando ramify, el de dentro de la app (se actualiza con ella)
mkdir -p ~/.local/bin
ln -sf /Applications/Ramify.app/Contents/Resources/bin/ramify ~/.local/bin/ramify
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc ;; esac
export PATH="$HOME/.local/bin:$PATH"

# 3. Claude Code: el plugin (hooks de worktree, la guarda sobre main, las skills)
command -v jq >/dev/null || brew install jq
claude plugin marketplace add /Applications/Ramify.app/Contents/Resources/claude-marketplace
claude plugin install ramify@ramify

# 4. Cada agente instalado aprende las reglas; los que se abren en un checkout principal reciben su rama
ramify install instructions
ramify install shell

# 5. Comprobar
ramify --version && claude plugin list | grep -A2 ramify@ramify
```

Después abre una terminal nueva (o reinicia Claude Code) para que carguen el plugin y la integración con la shell, y abre `/Applications/Ramify.app`
una vez: encontrará todo ya preparado. Los proyectos no necesitan nada; si quieres, añade en cada repositorio un
`.worktreeinclude` (por ejemplo `.env`) y un `.worktree/setup.sh`, ver [Preparación por proyecto](#preparación-por-proyecto).

## Empezar

```bash
cd ~/code/tu-repo
ramify new feat/login  -a claude -p "añade login con magic links"
ramify new fix/cart    -a codex  -p "corrige el redondeo del total del carrito"
ramify ls              # quién trabaja dónde, qué ha cambiado y qué está listo para mergear
```

Cuando un agente termina, revisas su diff en la app, lo mergeas y quitas el worktree con `ramify rm`.

## Referencia

### Comandos

```bash
ramify new feat/login -a claude -p "añade login con magic links"
ramify new fix/cart -a codex -i cursor          # agente en la terminal y el worktree abierto en Cursor
ramify new ios/widget -i xcode                  # abre el .xcodeproj generado
ramify new docs/api -a opencode --tmux          # sesión tmux en segundo plano
ramify open fix/cart -a gemini                  # reabrir un worktree con otro agente

ramify ls                                       # todos los worktrees de un vistazo
ramify graph                                    # grafo de ramas con el agente de cada una
ramify who src/cart.ts src/pay/                 # otros worktrees que cambian estos archivos (sale con 1 si hay)
ramify ready                                    # rama terminada: trae main y entra en la cola de merge (1 espera, 2 conflicto)
ramify ui                                       # panel web en el navegador
ramify app                                      # abre este repo en la app de escritorio
ramify rm fix/cart                              # se niega si algo se perdería
ramify prune                                    # borra los worktrees limpios ya mergeados

ramify ls --json                                # lo mismo, para scripts
ramify graph -n 50                              # los últimos 50 commits
ramify ui --port 4977                           # el panel en un puerto fijo
ramify path fix/cart                            # imprime la carpeta de un worktree: cd "$(ramify path fix/cart)"
ramify rm fix/cart --force                      # descarta lo no commiteado (una rama con commits sin mergear se queda)

ramify install all                              # el plugin de Claude Code (sus hooks si no hay claude) y las reglas de los agentes
ramify install claude-plugin                    # solo el plugin de Claude Code
ramify install claude-hooks                     # solo los dos hooks de worktree en ~/.claude/settings.json
ramify install instructions                     # las reglas de worktrees en las instrucciones globales de cada agente instalado
ramify install shell                            # los agentes abiertos en el checkout principal reciben su rama
ramify install secrets                          # en un repositorio: gitleaks antes de cada commit y push
ramify install guard                            # en un repositorio: git rechaza commits en main y pushes a main
ramify uninstall shell                          # deshace install shell (también: ramify uninstall instructions)
ramify run claude                               # abre un agente; desde un checkout principal en main recibe antes su rama
ramify move feat/tax -a claude                  # lleva el trabajo sin commitear de main a su propia rama
ramify shell-init                               # las funciones que carga install shell (claude() ejecuta ramify run claude)
ramify hook guard < entrada.json                # los hooks de Claude Code: create, remove, session-start, guard, nudge
ramify version
```

`-f <ref>` elige la base, `--no-setup` omite la preparación y lo que va después de `--` se pasa al agente.
`-a` acepta cualquier agente (`claude`, `codex`, `gemini`, `copilot`, `cursor`, `opencode`, `qwen`, `kimi`, `aider`…)
o cualquier otro comando; `-p` se pasa como lo espera cada agente, o se copia al portapapeles.
`-i` abre un editor: `xcode`, `cursor`, `code`, `zed`, `idea` o cualquier app por su nombre (`-i "Android Studio"`).

<p align="center"><img src="docs/graph.svg" alt="ramify graph: grafo de commits de todas las ramas, con su agente"></p>

### Cómo se prepara un worktree

<p align="center"><img src="docs/architecture.svg" alt="Ramify crea el worktree, copia ficheros ignorados, reserva puertos, prepara el proyecto y lanza el agente"></p>

1. **Worktree** en `~/.worktrees/<repo>/<nombre>`, fuera del repo, para que los editores y los watchers del checkout principal no lo indexen.
2. **Ficheros ignorados** de `.worktreeinclude` (sintaxis gitignore, el mismo fichero que lee Claude Code), como `.env`.
3. **Puertos**: un bloque de 10 (`PORT` a `PORT+9`) a partir del 4100.
4. **Preparación**: `.worktree/setup.sh` si el proyecto lo tiene; si no, `xcodegen generate`, `pnpm`/`yarn`/`bun`/`npm ci` o `uv sync`.
5. **Arranque**: el agente dentro del worktree con `.worktree.env` exportado, y/o tu editor.

### Dentro de un worktree

Cada worktree tiene un `.worktree.env`, excluido de git, que se exporta al agente:

| Variable        | Ejemplo                                      | Significado |
|-----------------|----------------------------------------------|-------------|
| `WT_NAME`       | `feat-login`                                 | Nombre de la carpeta |
| `WT_BRANCH`     | `feat/login`                                 | Rama |
| `WT_PATH`       | `~/.worktrees/shop/feat-login`               | El worktree |
| `WT_MAIN`       | `~/code/shop`                                | El checkout principal |
| `WT_AGENT`      | `claude`                                     | Último agente abierto en él |
| `PORT`          | `4100` (usa del `4100` al `4109`)            | Primer puerto de su bloque de 10 |
| `DERIVED_DATA`  | `~/.worktrees/shop/.derived-data/feat-login` | Carpeta de build de Xcode propia (`xcodebuild -derivedDataPath`) |
| `WT_SESSION`    | `0b7c…`                                      | La conversación de Claude Code que lo creó (`EnterWorktree`): la misma conversación lo reutiliza, otra recibe el suyo |
| `WT_READY`      | un commit                                    | Lo pone `ramify ready`: el commit marcado como listo para mergear |
| `WT_READY_BASE` | un commit                                    | El commit de `main` contra el que se comprobó; si `main` se mueve, la marca pasa a `stale` |
| `WT_READY_WAIT` | un commit                                    | Se pone cuando `ramify ready` sale con 1: espera su turno en este commit de `main` |
| `SIM_UDID`      | un id de simulador                           | No lo pone Ramify: la preparación del ejemplo [`ios-xcodegen`](examples/ios-xcodegen) añade el simulador del worktree |

`WT_SESSION` y las variables `WT_READY*` solo están cuando aplican.

Los agentes conocen las reglas por un bloque corto en sus instrucciones globales:

```bash
ramify install instructions
```

Añade [`snippets/agent-instructions.md`](snippets/agent-instructions.md) una sola vez a cada agente
instalado: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`,
`~/.config/opencode/AGENTS.md`, `~/.copilot/copilot-instructions.md` y `~/.config/amp/AGENTS.md`.
No escribe nada en tus repositorios.

### Preparación por proyecto

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

### Integración con Claude Code

El plugin (ver [Instalación](#instalación), o `ramify install claude-plugin`) registra Ramify como hooks
`WorktreeCreate` y `WorktreeRemove` de Claude Code, más una guarda que protege la rama compartida (ediciones,
commits, merges y pushes: ver [Qué garantiza Ramify](#qué-garantiza-ramify)). Sin el plugin, `ramify install claude-hooks` escribe solo los dos hooks de worktree en
`~/.claude/settings.json` (reemplaza solo sus propias entradas: los demás hooks se quedan, y la primera copia,
`settings.json.bak-ramify`, nunca se sobrescribe); al instalar el plugin después se quitan, así nunca se ejecutan dos veces. Desde entonces `claude --worktree`, las sesiones en segundo plano,
`/batch`, los workflows y los subagentes con `isolation: worktree` crean sus worktrees con Ramify,
con la misma estructura, puertos y preparación que el resto de agentes. Claude Code conserva los
worktrees de los subagentes al terminar, así que conviene lanzar `ramify prune` de vez en cuando.

**Antes de editar, comprueba que nadie más lo hace.** `ramify who <archivos o carpetas>` lista los otros worktrees
del repositorio que los cambian (con commit, sin commitear o nuevos), uno por línea como `rama, agente, working|idle,
archivo`, y sale con 1 si hay alguno; sin rutas comprueba los archivos que cambia el worktree actual. La skill
`coordinar` del plugin lo ejecuta antes de un cambio y, si hay solape, te avisa y puede escribir a la otra sesión de
Claude Code (`ListAgents` / `SendMessage`) en lugar de editar los mismos archivos.

**Al terminar una rama, dilo.** `ramify ready`, ejecutado en su worktree con todo commiteado, trae `main` y mira las
ramas ya marcadas como listas. Sale con 0: ninguna otra rama lista cambia los mismos archivos, así que esta queda
marcada lista para mergear. Sale con 1: alguna sí; no se marca nada y esta rama espera a que se mergee la otra. Sale
con 2: `main` choca con esta rama; el merge se deshace y se listan los archivos: mergea `main`, resuelve, haz commit y
repítelo. `ramify ls` enseña la cola en la columna READY: `ready`, `stale` cuando la rama o `main` se han movido
desde entonces, y `wait` para una rama que espera turno. Con el plugin, Claude Code se entera en su siguiente turno
cuando `main` se mueve bajo una rama lista o en espera; los demás agentes lo ven en `ramify ls`, y la app de
escritorio puede avisarte.

### Seguridad

- `rm` se niega si hay cambios sin commitear o commits que no están ni mergeados ni subidos.
- `rm --force` descarta los cambios sin commitear pero **nunca borra una rama con commits sin
  mergear**: se va el worktree y se queda la rama.
- `prune` solo borra worktrees limpios y ya mergeados.
- El checkout principal no se toca, salvo una línea en `.git/info/exclude` (`/.worktree.env`).

### Qué garantiza Ramify

Ramify guarda la rama por defecto (`main`) para ti: los agentes trabajan en ramas propias y tú decides qué entra.
Una parte está bloqueada de verdad; el resto son instrucciones que reciben los agentes.

**Bloqueado de verdad**

- **Claude Code con el plugin.** En el checkout principal sobre `main`, la guarda rechaza editar archivos y los
  comandos de git que cambian `main`: `commit`, `merge`, `cherry-pick`, `revert`, `am`, `rebase`, `reset --hard` y un
  `pull` de otra rama, y `git branch -M`/`git update-ref HEAD` sobre ella. Desde cualquier carpeta rechaza un push que
  actualice `main` (`git push origin HEAD:main`, `:main`, `origin main`, `--all`, o `git push` a secas estando en
  ella), y mover o sobrescribir la propia `main` (`git update-ref refs/heads/main`, `git branch -f`/`-m`/`-M`/`-C`
  hacia ella o de ella, `git checkout -B main`, `git switch -C main`). `fetch`, `pull --ff-only` y `--abort` siguen
  funcionando. Claude Code no puede quitar la guarda: un comando que fije `ramify.allowMain` también se rechaza.
- **Cualquier agente, con `ramify install guard`** en el repositorio (Codex, Gemini, Cursor, una terminal sin más):
  el propio git rechaza `git commit` en `main` en el checkout principal y cualquier push que actualice `main`, con los
  hooks pre-commit y pre-push del repositorio (que además buscan secretos si gitleaks está instalado). Mergear desde
  la app de Ramify no se ve afectado: la app ejecuta git sin hooks.
- **La salida es tuya:** `RAMIFY_ALLOW_MAIN=1` para una sesión o un comando, `git config ramify.allowMain true` para
  el repositorio.

**Solo instrucciones** (al agente se le dice; nada lo impide)

- Escrituras desde la terminal que no hacen commit (`echo > archivo`, `sed -i`, `tee`, un script) en el checkout
  principal. La guarda no intenta juzgarlas (rechazaría demasiado que es inofensivo). Se quedan como cambios sin
  commitear, y `ramify move` los lleva a una rama propia.
- El git que la guarda no ve en la línea de comandos. Lee `git` donde se ejecuta como comando: al principio de la
  línea o tras `;`, `&&`, `||`, `|`, `(`, `$(` o una comilla invertida, tras `env`, `command`, `time`, `nohup`,
  `xargs`, `sudo` o `VAR=x`, y dentro de lo que ejecutan `eval` o `bash -c`. El git que se lanza desde un script, un
  alias o una función, o un comando guardado en una variable, pasa; también `echo git commit` (con razón: solo
  imprime). Sin `jq`, un comando cuyo JSON lleva escapes `\u` no se juzga.
- Ediciones y commits en el worktree de otro agente. Permitido a propósito, porque una sesión puede coordinar
  varias: `ramify who` y la skill `coordinar` avisan antes.
- Agentes lanzados desde un IDE o una app, sin `ramify install guard`: solo tienen las reglas de
  `ramify install instructions`.
- Con `ramify install guard` solo, los hooks de git solo ven commits y pushes: un merge, rebase o reset de `main` en el
  checkout principal pasa (su push no), y `--no-verify` se salta los hooks.

### Configuración

| Variable               | Por defecto                                          |
|------------------------|------------------------------------------------------|
| `RAMIFY_ROOT`          | `~/.worktrees`                                       |
| `RAMIFY_PORT_MIN`      | `4100`                                               |
| `RAMIFY_PORT_MAX`      | `4990`                                               |
| `RAMIFY_FETCH_TIMEOUT` | `30` (segundos que `ramify ready` espera a `origin`) |
| `NO_COLOR`             | sin definir                                          |

### Tests

```bash
bash tests/run.sh             # CLI, contra repos desechables con agentes simulados
npm run test:core             # motor, detección de sesiones, login de GitHub, validación del IPC, línea de tiempo
npm run test:e2e -w packages/core   # la UI real en Chromium: navegador, editor y nada cortado de 390 a 1920 px
```

La CI ejecuta las baterías de tests del CLI, del núcleo y de la app. `tests/run.sh` prueba el CLI de punta a punta:
crear worktrees, puertos, agentes, la seguridad de `rm`, los hooks de Claude Code y la guarda de `main` (con y sin
`jq`), instalar y desinstalar, `ready`, `move` y la integración con la shell. `tests/git-guard.sh` (también dentro de
`tests/run.sh`) comprueba `ramify install guard` solo con bash y git, así que corre también en Git Bash.

### Contribuir

Issues y pull requests son bienvenidos. Antes de abrir una PR pasa las tres baterías de tests de arriba; si cambias
`ui/web`, recompílalo con `npm run build:web` y sincroniza el plugin con `scripts/sync-plugin.sh` (CI lo comprueba).

## Licencia

[MIT](LICENSE). Los logos de las herramientas con las que trabaja Ramify son marcas de sus dueños y solo se muestran
para identificarlas. Los iconos vienen de [LobeHub Icons](https://github.com/lobehub/lobe-icons) (MIT),
[Simple Icons](https://simpleicons.org) (CC0) y [Devicon](https://devicon.dev) (MIT); `node scripts/brand-icons.mjs` los regenera.
