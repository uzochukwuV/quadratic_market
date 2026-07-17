# -------------------------------------------------------
# Hidden directories & dotfiles (blanket)
# Many apps lazily create hidden config dirs at runtime
# (.openclaw/, .config/, .npm/, .cache/, etc.).
# Catch them all, then whitelist the ones we actually need.
# -------------------------------------------------------
.*

# Whitelist: hidden files that SHOULD be included in the deploy artifact
!.dockerignore
!.runtmignore
!.env.example
!.node-version
!.nvmrc
!.python-version
!.tool-versions

# Dependencies
node_modules/
.venv/
venv/
env/
vendor/
bower_components/

# Build outputs
dist/
build/
.next/
out/
__output/
*.tsbuildinfo
target/

# Caches
__pycache__/
*.pyc

# Environment secrets (never ship)
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*

# Core dumps
core
core.*
*.core
*.dump

# Large binary artifacts
*.exe
*.dll
*.so
*.dylib
*.db
*.sqlite
*.sqlite3
