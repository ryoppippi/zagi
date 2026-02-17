# Next-Gen VCS: Design Spec

> version control that includes the environment

## One Problem

The gap between `git clone` and "the thing works" is the single biggest
friction in software. Humans spend hours on READMEs. Agents can't even
start. Codespaces and Gitpod attack this with cloud containers, but that's
someone else's machine -- slow, expensive, locked in.

Git tracks source. Nix tracks environments. They're separate systems with
separate concepts, separate histories, separate mental models. When you
change a dependency, that's a different workflow than changing a source
file. It shouldn't be. **The environment is part of the code.**

## One Idea

Version control where the environment is a first-class part of every
change. Not "VCS + env manager." One system.

## User Experience

### Fresh machine to running project

```
$ curl -sf zagi.sh | sh
$ zagi clone github.com/mattzcarey/zagi
$ cd zagi
$ zig build test    # works
```

That's everything. No other steps. Here's what happened:

**Line 1: Install.** Downloads a single static binary. No runtime, no
dependencies, no Nix, no Docker, no FUSE, no sudo. One binary in
`~/.local/bin`. Adds one line to your shell rc:

```bash
eval "$(zagi hook)"
```

That's the only setup that ever happens. It runs once on first install.
The hook does one thing: when you `cd` into a directory with `.zagi/env`,
it prepends `.zagi/env/bin` to PATH and sets library paths. When you `cd`
out, it undoes it. Like a lightweight direnv but built into zagi.

**Line 2: Clone.** Fetches two things from the server in parallel:
1. The source (git objects, like normal)
2. A pre-built environment tarball (the server already built this)

The env tarball extracts into `.zagi/env/` inside the project. It
contains real binaries: the zig compiler, the bun runtime, libgit2.so,
everything the project needs. These are pre-built on the server for your
OS/arch. Downloaded, not compiled.

**Line 3: cd.** The shell hook fires. PATH now includes `.zagi/env/bin`.
Library paths include `.zagi/env/lib`. You're in a working environment.

**Line 4: Build.** `zig` resolves to `.zagi/env/bin/zig`. It works.
Everything works. No `npm install`, no `pip install`, no `apt-get`, no
README.

### Second project, same machine

```
$ zagi clone github.com/someone/node-app
$ cd node-app
$ npm test    # works
```

Node 20 was already in the local store from a previous project. The
clone just hardlinks it. Sub-second env setup.

### Existing project, adding zagi

```
$ cd my-existing-project
$ zagi init

Detected: node 20, typescript, postgres
Generated .zagi/env.toml

$ zagi env pull

Fetching env... done (1.2s)

$ npm test    # now works without global node install
```

`zagi init` looks at your lockfiles and generates the env spec.
`zagi env pull` fetches the pre-built env from the server.
That's it. Two commands to make any existing project portable.

### Day-to-day

```
$ zagi add node@22           # adds node 22 to env.toml, fetches it
$ zagi log
  @  kpqx  matt: upgrade to node 22
  o  main
```

Adding a dependency is a versioned change, same as editing a source file.
`zagi add` updates env.toml, resolves the new env, fetches the pre-built
result, and records it as a change. You can revert it, diff it, branch
from before it.

Switching branches switches the env:

```
$ zagi checkout feature-branch

Switching env: +postgres@16, node 20->22
Done (180ms)
```

No "remember to re-run nix develop." The env travels with the change.

### What agents see

An agent (Claude Code, Cursor, Codex, whatever) gets pointed at the
directory. It sees a normal project where all tools are available.
It doesn't know or care about zagi. It just runs commands and they work.

No agent integration needed. No plugin. No protocol. Just a directory
where things work.

## Architecture

### No Nix on the client

Previous drafts had Nix on the client. Wrong. Nix is only on the
server. The server builds environments. The client downloads pre-built
binaries.

The client is dumb. It does three things:
1. Download files from the server
2. Put them in the right place on disk
3. Set PATH when you cd into a project

That's it. No package manager, no solver, no build system on the client.
One static binary.

### The server builds everything

The server has Nix. When someone pushes an env.toml change, or when
a new mirror is created, the server:

1. Reads env.toml
2. Compiles it to a Nix derivation
3. Builds the closure (or pulls from Nix binary cache)
4. Packages it as a tarball per OS/arch (linux-x64, darwin-arm64, etc)
5. Stores it in object storage, keyed by content hash

The tarball is a self-contained environment. All binaries, all
libraries, all tools. No symlinks to /nix/store. Relocatable.

### Object storage

Everything lives in object storage. Git objects, env tarballs, refs.

```
s3://zagi/
  objects/
    ab/cdef1234...    # git blobs, trees, commits
  envs/
    a3f8c9d1-linux-x64.tar.zst     # pre-built env
    a3f8c9d1-darwin-arm64.tar.zst
  refs/
    mattzcarey/zagi/heads/main     # branch pointers
```

Content-addressed, CDN-cached, immutable. The server is thin -- mostly
routing requests to object storage.

### The local store

Extracted env closures live in `~/.zagi/store/`, keyed by content hash.
Projects hardlink from `.zagi/env/` into the store. Deduplication is
automatic -- if two projects use Node 20, there's one copy on disk.

```
~/.zagi/store/
  a3f8c9d1/
    bin/zig
    bin/bun
    lib/libgit2.so
  b7e2a4f0/
    bin/node
    bin/npm
    lib/...

~/project-a/.zagi/env/ -> hardlinks to a3f8c9d1
~/project-b/.zagi/env/ -> hardlinks to b7e2a4f0
```

### One object model

From jj: working copy is a change, stable change IDs, first-class
conflicts, operation log.

From Nix: content-addressed storage, declarative environments,
reproducible resolution.

Combined: a change = source + env. The env.toml diff shows up in
`zagi log` and `zagi diff` just like source changes. Checkout moves
both source and env atomically.

## The env spec

```toml
# .zagi/env.toml -- human-writable, auto-generated

[project]
name = "zagi"

[tools]
zig = "0.15"
bun = "1.2"

[system]
packages = ["libgit2"]

[services]
# postgres = "16"
```

`env.lock` is generated, pinning every transitive dep to a content hash.
Users don't edit the lock file. Same lock = same env, always.

**Auto-detection for existing projects:**
- `package.json` -> node + npm/bun/pnpm
- `Cargo.toml` -> rust + cargo
- `go.mod` -> go
- `pyproject.toml` -> python + uv
- `Dockerfile` -> parse and extract
- `flake.nix` -> use directly

## Secrets

Encrypted in the repo, isolated from agents:

```
.zagi/secrets.enc     # age-encrypted, keyed to your identity
```

- Decrypted into env vars when you run the app (`zagi run`)
- Not in PATH, not in files -- only in the process env of `zagi run`
- Agents cannot access them (they run outside `zagi run`)
- Never in git history, never in plaintext on disk

## Why Not X

**Why not Nix directly?**
Nix the technology is right. Nix the product failed. Learning curve,
documentation, "experimental" flakes, massive client-side install.
zagi uses Nix on the server and hides it completely.

**Why not Docker?**
Docker is for deployment. Imperative, non-reproducible, isolated VM.
You can't point Cursor at a container and have it feel native.

**Why not devcontainers?**
Container. Tied to VS Code. Requires Docker. Manual setup.

**Why not Homebrew / asdf / mise?**
Package managers, not version control. They don't travel with the code.
`brew install node` is global, not per-project. And they don't include
system libraries.

## Build In The Open

Everything is open source. The moat is the public cache (pre-built
envs for every popular project) and network effect.

## What To Build

```
$ zagi clone github.com/some/repo
$ cd repo
$ <it runs>
```

1. **Auto-detection.** Infer env.toml from lockfiles. JS/TS, Python,
   Rust, Go, Zig first.

2. **Server-side builds.** Compile env.toml to Nix, build, package
   as relocatable tarball per OS/arch. Store in object storage.

3. **Client fetch + activate.** Download tarball, extract to store,
   hardlink into project. Shell hook for PATH activation.

4. **Object storage backend.** Git objects + env tarballs in S3/R2.

5. **Public cache.** Pre-built envs for top 1000 GitHub projects.
   First clone is fast for everyone.

6. **Mirror.** `zagi mirror github.com/foo/bar` generates env.toml
   and pre-builds the env. Viral: "I made your repo runnable."
