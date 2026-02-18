# Next-Gen VCS: Design Spec

> version control that includes the environment

## One Problem

The gap between `git clone` and "the thing works" is the single biggest
friction in software. Humans spend hours on READMEs. Agents can't even
start. Codespaces and Gitpod attack this with cloud containers, but that's
someone else's machine -- slow, expensive, locked in.

Git tracks your source. npm/pip/cargo track your dependencies. Docker
tracks your system. Nix tracks your environment. Four systems, four mental
models, four places where things go wrong. And a lock file in the middle
holding it all together with string.

**The environment is part of the code. Track it all in one place.**

## One Idea

Version control where everything is tracked. Source, dependencies,
tools, services. No install step on clone. Use your existing package
manager, zagi tracks the result. One system.

```
$ curl -sf zagi.sh | sh
$ zagi clone mattzcarey/zagi
$ cd zagi
$ zig build test    # works. no install. no README.
```

## Use Your Tools, Track Everything

zagi doesn't replace your package manager. npm knows how to resolve
node packages. pip knows Python. cargo knows Rust. Let them do their
job. zagi's job is to **track the result**.

```
$ zagi add node@22             # env: zagi handles tools and services
$ npm i express                # deps: npm does what npm does
$ zagi commit -m "add express" # zagi chunks and tracks node_modules
```

That's it. npm writes to `node_modules`. zagi sees the change, chunks
it, content-addresses it, deduplicates it against the global store.
The dependency is now tracked the same way source is tracked. No lock
file needed on the consumer side -- the actual code is in the store.

`zagi add` is for **environment stuff** -- tools and services that
don't have their own package manager:

```
$ zagi add node@22        # runtime/tool
$ zagi add postgres@16    # service
$ zagi add zig@0.15       # compiler
```

For everything else, use the native package manager. It already
knows what it's doing.

```
$ npm i express           # node packages
$ pip install flask       # python packages
$ cargo add serde         # rust crates
$ zagi commit -m "add deps"
```

zagi tracks the result. The log shows everything:

```
$ zagi log
  @  kpqx  matt: wip auth routes
  o  vrnt  matt: add express (npm i)
  o  zspm  matt: add node@22, postgres@16
  o  root
```

Revert `vrnt` and express is gone. Checkout a branch that doesn't
have express and it's not there. The dependency history IS the source
history. One graph.

### Edit your dependencies

Want to patch a bug in a dependency? Just edit it. It's tracked.

```
$ vim node_modules/express/lib/router/index.js   # just edit it
$ zagi commit -m "fix express body-parser edge case"

$ zagi log
  @  mfpz  matt: fix express body-parser edge case
  o  vrnt  matt: add express (npm i)
```

When express releases a new version, you `npm update express` and
commit. Your patch is re-applied automatically (jj-style conflict
resolution). If it conflicts, the conflict is data -- you or an
agent resolve it. No patch files. No fork. Just tracked changes on
tracked code.

Agents are great at this. "Update express and re-apply our body-parser
fix" is a one-shot prompt.

### Merging

Deps are files. jj merges files. Nothing special needed.

Content-addressing helps: shared transitive deps have identical
hashes across branches, so they never conflict. You never re-run
`npm install` during a merge.

### Supply chain security

Today, every `npm install` on every machine runs postinstall scripts
from strangers. Every CI run, every new developer, every `git clone`
triggers arbitrary code execution from the registry.

With zagi, `npm install` runs **once** -- on the developer's machine
who adds the dependency. The result is chunked, hashed, and tracked.
Everyone else gets the pre-built, content-addressed result. No
postinstall scripts. No registry fetch. The code you reviewed is the
code everyone runs.

If someone publishes a compromised version of a package, it has a
different hash. Your project still points to the original hash.
Nothing changes unless someone explicitly upgrades and commits.

## User Experience

### Fresh machine to running project

```
$ curl -sf zagi.sh | sh
$ zagi clone mattzcarey/zagi
$ cd zagi
$ zig build test    # works
```

**Line 1: Install.** Downloads a single static binary. No runtime, no
dependencies, no Nix, no Docker, no FUSE, no sudo. One binary in
`~/.local/bin`. Adds one line to your shell rc:

```bash
eval "$(zagi hook)"
```

The hook activates the environment when you `cd` into a zagi project
(prepends `.zagi/env/bin` to PATH, sets library paths) and deactivates
when you leave.

**Line 2: Clone.** Fetches everything from the content-addressed store:
source, dependencies, tools, services -- all pre-built for your OS/arch.
No manifest to read. No dependencies to resolve. The tracked state tells
zagi exactly what chunks to download.

**Line 3: cd.** Shell hook fires. Environment is active.

**Line 4: Build.** `zig` resolves to `.zagi/env/bin/zig`. Everything
works.

### What agents see

An agent gets pointed at the directory. It sees a normal project where
every tool, every dependency, every service is available. It doesn't
know or care about zagi. It just runs commands and they work.

Need redis for integration tests? It's there. Need to modify a
dependency to debug an issue? Edit it, it's tracked. Need to run the
full test suite against a real database? Postgres is running.

The agent operates in prod-like state by default. No mocks unless you
choose them.

### Day-to-day

```
$ zagi add postgres@16      # env: tool/service
$ npm i lodash              # deps: use npm
$ zagi commit -m "add lodash, postgres"
$ zagi checkout feature     # switches source AND env atomically

$ zagi log
  @  kpqx  matt: wip feature
  o  vrnt  matt: add lodash, postgres@16
  o  main
```

No `docker-compose up`. No `brew install postgresql`. No second
`npm install` on another machine. Switching branches switches
everything -- source, deps, tools, services.

## How Storage Works

Tracking all dependencies and tools means storing a lot of data.
A typical Node project has 200MB+ of node_modules. A Python ML
project can have GBs of packages. This is solvable.

### Content-defined chunking

Borrowed from Hugging Face's Xet storage (which handles 77 PB
across 6M+ repos).

Files are split into ~64KB chunks using a rolling hash (GearHash).
Chunk boundaries are determined by the content itself, so inserting
or modifying part of a file only affects nearby chunks. All other
chunks remain identical.

```
express@4.21.0:
  lib/router/index.js  -> chunks [a3f8, b7e2, c9d1]
  lib/router/route.js  -> chunks [d4e5, f6a7]
  ...

express@4.21.1:
  lib/router/index.js  -> chunks [a3f8, NEW1, c9d1]  # only middle changed
  lib/router/route.js  -> chunks [d4e5, f6a7]         # identical, deduped
```

Upgrading express from 4.21.0 to 4.21.1 stores only the changed
chunks. Everything else deduplicates.

### Cross-project deduplication

10,000 projects use express 4.21.0. The chunks are stored **once**.
Each project references them by hash. Node 22 is Node 22 whether
it's for project A or project B. One copy.

In practice, 70-90% of a clone is already in the store because the
same packages and tools are shared across projects. The first clone
is slow. Every subsequent clone is fast.

### Chunks are grouped into packs

Storing millions of ~64KB chunks as individual objects in S3 would
be expensive. Chunks are grouped into ~64MB packs (like HF's xorbs).
Downloads use HTTP Range requests to fetch specific chunks within a
pack. Keeps object count manageable, enables CDN caching.

```
s3://zagi/
  packs/
    ab/cdef1234.pack    # ~1024 chunks, ~64MB
    cd/ef5678.pack
  manifests/
    mattzcarey/zagi/main.manifest    # maps paths to chunk hashes
```

### Clone size vs install time

| Today | With zagi |
|-------|-----------|
| Clone: 5MB (source only) | Clone: 50MB (source + deps + tools) |
| Then: npm install (200MB, 30s) | Then: nothing |
| Then: brew install postgres (100MB) | |
| Then: read README, configure env | |
| Total: 300MB, 5 minutes | Total: 50MB (deduped), 10 seconds |

The clone is bigger but the total is smaller because there's no
install step, and cross-project dedup means most chunks are already
local.

### Lazy fetching

Not everything needs to be downloaded on clone. The manifest lists
all files and their chunk hashes. zagi can fetch lazily:

- Tools and runtime: fetched immediately (you need these to build)
- Direct dependencies: fetched immediately (you need these to run)
- Transitive deps: fetched on first access
- Dev dependencies: fetched when you run tests
- Large assets: fetched on demand

This keeps initial clone fast while still having everything available.

## Architecture

### Dumb client, smart server

The client is a single static binary. It does:
1. Download chunks from the server/CDN
2. Assemble files from chunks
3. Set PATH when you cd into a project

No package manager, no solver, no build system on the client.

### The server

The server has Nix. It handles two things:

**Environment builds** (`zagi add node@22`):
1. Resolves the tool/service via Nix
2. Builds or fetches pre-built binaries (Nix binary cache)
3. Chunks the result, deduplicates, stores in packs

**Dependency tracking** (`zagi commit` after `npm i`):
1. Client chunks node_modules (or venv, target, etc.)
2. Client sends new chunks to server
3. Server deduplicates against global store, stores in packs

The server never runs npm/pip/cargo. It just stores chunks.

### Object storage

Everything lives in S3/R2/GCS:

```
s3://zagi/
  packs/                         # chunked content
    ab/cdef1234.pack
  manifests/                     # path -> chunk mappings
    mattzcarey/zagi/
      main.manifest
      feature-branch.manifest
  objects/                       # git objects (commits, trees)
    ab/cdef1234
  refs/
    mattzcarey/zagi/heads/main   # branch pointers
```

Content-addressed, CDN-cached, immutable packs. The server is thin.

### Local store

```
~/.zagi/store/
  packs/              # downloaded pack files
  cache/              # extracted files, hardlinked into projects
```

Multiple projects sharing express 4.21.0 share the same files
on disk via hardlinks. Disk usage is proportional to unique content,
not number of projects.

### One object model

From jj: working copy is a change, stable change IDs, first-class
conflicts (rebases always succeed, conflicts are data), operation log
(every mutation recorded, everything undoable).

From Nix: content-addressed storage, reproducible resolution.

From HF/Xet: content-defined chunking, pack-based storage, cross-repo
deduplication, lazy fetching.

Combined: **a change = source + deps + env.** One history, one graph,
one diff, one revert. No lock files. No install step.

## Secrets

Encrypted in the repo, isolated from agents:

```
.zagi/secrets.enc     # age-encrypted, keyed to your identity
```

- Decrypted into env vars when you run the app (`zagi run`)
- Agents cannot access them (process namespace isolation)
- Never in history, never in plaintext on disk

## Why Not X

**Why not just npm/pip/cargo?**
You DO use npm/pip/cargo. zagi doesn't replace them. But today,
every machine that clones the repo has to re-run `npm install`,
re-fetch from the registry, re-run postinstall scripts. zagi
tracks the result so nobody has to do that twice.

**Why not vendoring (Go-style)?**
Go vendor copies deps into the repo as regular files. This bloats git
history (git stores full copies, no chunk-level dedup) and makes
updates painful. zagi's content-addressed chunking solves both: dedup
across versions and across projects.

**Why not Nix directly?**
Nix the technology is right. Nix the product failed. zagi uses Nix
on the server and hides it completely.

**Why not Docker?**
Docker is for deployment. Imperative, non-reproducible, isolated VM.

## Build In The Open

Everything is open source. The moat is the global content-addressed
store (every package, every tool, every version, chunked and deduped)
and the network effect.

## Build Plan

End goal:

```
$ zagi clone mattzcarey/cool-app
$ cd cool-app
$ node index.js    # works. fresh machine. no install.
```

Everything below is ordered by what to build, with a POC at each
stage that proves the approach before moving on.

---

### Phase 1: Chunking engine

Build the content-defined chunking library in Zig.

- GearHash rolling hash, ~64KB target chunk size
- Chunk a directory tree → list of (path, [chunk_hash, ...])
- Reassemble from chunks → original files
- BLAKE3 for chunk hashes (fast, 256-bit)

**POC 1: "Can we store node_modules efficiently?"**

```
$ cd some-nextjs-project
$ zagi-chunk node_modules/
  Files: 14,832
  Total: 218 MB
  Chunks: 3,412
  Unique: 3,290 (dedup ratio: 3.6%)

$ npm update next    # minor version bump
$ zagi-chunk node_modules/
  Chunks: 3,445
  New chunks: 89 (97.4% reuse from previous version)
```

This answers the first skeptic question: tracking node_modules
is feasible because cross-version dedup is extremely high.

---

### Phase 2: Local store + round-trip

Store chunks locally, prove the round-trip works.

- Local store: `~/.zagi/store/` with chunk files
- Manifest format: `{path → [chunk_hashes], permissions, symlinks}`
- `zagi snapshot <dir>` → chunks dir, writes manifest, stores chunks
- `zagi restore <manifest> <dir>` → reads manifest, assembles from chunks
- Hardlink cache: extracted files hardlinked from store into projects

**POC 2: "Round-trip works, hardlinks save disk"**

```
$ zagi snapshot .          # chunks everything, writes manifest
  Manifest: .zagi/snapshots/abc123.manifest
  Stored: 3,412 chunks (218 MB logical, 214 MB stored)

$ rm -rf node_modules/
$ zagi restore .zagi/snapshots/abc123.manifest .
  Restored: 14,832 files (hardlinked from store)
  Time: 0.8s

$ ls -la node_modules/express/package.json
  ... 2 ...   # hardlink count = 2 (store + working copy)
```

---

### Phase 3: Remote store + push/pull

Push chunks to R2/S3, pull them on another machine.

- Pack format: group ~1024 chunks into ~64MB pack files
- Pack index: maps chunk_hash → (pack_file, offset, length)
- `zagi push` → uploads new chunks (packed) to R2
- `zagi pull` → downloads manifest + packs, assembles locally
- HTTP Range requests for fetching individual chunks from packs
- Cross-project dedup: chunks are global, packs are shared

**POC 3: "Clone a project on another machine without npm install"**

Machine A (developer):
```
$ cd my-node-app
$ npm i                    # normal npm install, one time
$ zagi snapshot .
$ zagi push
  Uploading: 4 packs (212 MB), manifest
  Done.
```

Machine B (fresh):
```
$ zagi pull user/my-node-app
  Downloading: 4 packs (212 MB)
  Assembling: 14,832 files
  Done.

$ ls node_modules/express/   # it's there
$ node index.js              # it works (if node is installed)
```

This proves the storage model end-to-end. The only missing piece
is: node itself isn't tracked yet (you still need it pre-installed).

---

### Phase 4: Shell hook + `zagi add`

Make tools part of the tracked environment.

- `zagi add node@22` → server fetches pre-built node from Nix
  binary cache, chunks it, stores in global store. Client downloads
  to `.zagi/env/node/22.0.0/`, symlinks `.zagi/env/bin/node`
- Shell hook: `eval "$(zagi hook)"` → on `cd` into a zagi project,
  prepends `.zagi/env/bin` to PATH. On `cd` out, restores PATH.
- Server: thin Nix wrapper. Maps `node@22` → `nixpkgs.nodejs_22`,
  fetches from Nix binary cache, re-chunks into our format.

**POC 4: "Clone and it works. No install. No README."**

Machine A:
```
$ zagi init
$ zagi add node@22
$ npm i express
$ echo 'require("express")().listen(3000)' > index.js
$ zagi commit -m "init"
$ zagi push
```

Machine B (fresh machine, no node installed):
```
$ zagi clone user/my-app
$ cd my-app                # shell hook fires, node is on PATH
$ node index.js            # works
```

**This is the demo.** Everything after this is making it real.

---

### Phase 5: VCS -- history, branching, merging

Replace snapshot/push/pull with real version control (jj-based).

- Change graph: each commit = tree of (path → chunk_hashes)
- Stable change IDs (jj-style short IDs like `kpqx`)
- `zagi commit` replaces `zagi snapshot` -- records a change
- `zagi log` shows history (source + deps + env in one graph)
- `zagi branch`, `zagi checkout` -- switches everything atomically
- Merging: jj's three-way merge, conflicts are data
- Operation log: every mutation recorded, `zagi undo` works

**POC 5: "Branch switches everything"**

```
$ zagi branch feature
$ npm i lodash
$ zagi commit -m "add lodash"
$ zagi checkout main        # node_modules/lodash disappears
$ zagi checkout feature     # it's back
```

---

### Phase 6: Services

Run postgres, redis, etc. as part of the environment.

- `zagi add postgres@16` fetches postgres binary (same as tools)
- `zagi run` starts services defined in the env (supervised)
- Services store data in `.zagi/data/postgres/` (per-project)
- `zagi checkout` stops services on old branch, starts on new
- Process isolation: services run in a namespace, agents can't
  access secrets

This is where agents get a prod-like environment by default.

---

### Phase 7: Mirror + viral loop

Convert existing GitHub repos into zagi projects automatically.

- `zagi mirror github.com/foo/bar`
- Reads package.json/Cargo.toml/requirements.txt
- Detects tools (node version from .nvmrc, engines field, etc.)
- Runs native package manager to install deps
- Runs `zagi add` for detected tools
- Commits everything, pushes to zagi store
- Result: anyone can `zagi clone foo/bar` and it just works

**POC 7: "Any popular GitHub repo, one command"**

```
$ zagi mirror github.com/vercel/next.js
  Detected: node@20 (from .nvmrc), pnpm@9 (from packageManager)
  Running: pnpm install
  Adding: node@20
  Chunking: 847 MB (node_modules + tools)
  Stored: 112 MB (87% deduped against global store)
  Done.

$ zagi clone vercel/next.js    # anyone can do this now
$ cd next.js
$ pnpm build                   # works
```
