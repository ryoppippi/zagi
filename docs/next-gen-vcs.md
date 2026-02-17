# Next-Gen VCS: Design Spec

> git clone, but it runs

## One Problem

The gap between `git clone` and "the thing works" is the single biggest
friction in software. Every repo is a puzzle: which runtime, which package
manager, which system deps, which env vars, which services, which version
of which tool. Humans spend hours on READMEs. Agents can't even start.

Codespaces and Gitpod attack this with cloud containers. But that's someone
else's machine. You can't use your own tools, your own agent, your own
workflow. And it's slow, expensive, and requires internet.

## One Solution

**Mount any repo as a runnable directory on your local filesystem.**

```
$ zagi mount github.com/mattzcarey/zagi ./zagi

Resolving environment... cached
Mounting... done (340ms)

$ cd zagi
$ zig build test    # just works
$ bun run test      # just works
```

That's it. The directory has the source code AND a fully resolved
environment. The right compilers, runtimes, packages, system libraries --
all present, all the correct versions. No install step. No README. No
Dockerfile. It works.

You open this directory in whatever you want. VS Code. Neovim. Cursor.
You point Claude Code at it. You point Codex at it. Any agent, any editor.
They all see a normal directory where everything works.

This is `git clone` that gives you a running VM, except it's a local
directory and it's instant.

## How It Works

### The mount

Under the hood, `zagi mount` does three things:

1. **Fetches the source** -- git clone, sparse checkout, whatever is fastest
2. **Resolves the environment** -- deterministic, content-addressed, cached
3. **Assembles the overlay** -- source (read-write) on top of env (read-only)

The result is a single directory. Inside it, `PATH`, library paths, and
tool locations all point to the resolved environment. It's not a container.
It's not a VM. It's an overlay mount on your actual filesystem. Your
terminal, your shell, your tools -- they all work normally. You just `cd`
into it.

```
~/zagi/                         # what you see
  src/                          # your source (read-write)
  build.zig
  ...
  .zagi/env/                    # resolved environment (read-only, cached)
    bin/zig                     # zig 0.15
    bin/bun                     # bun 1.2
    lib/libgit2.so              # libgit2
    ...
```

When you `cd` into a mounted repo, the environment activates (like `nix
develop` but invisible). When you leave, it deactivates. No global
pollution.

### The environment spec

The spec lives in the repo:

```
.zagi/
  env.toml       # what the project needs (human-readable)
  env.lock       # exact versions, content hashes (generated)
```

`env.toml` is simple:

```toml
[project]
name = "zagi"

[tools]
zig = "0.15"
bun = "1.2"

[system]
packages = ["libgit2"]

[services]
# postgres = "16"    # if you need it
```

`env.lock` is generated and pinned. Every transitive dependency has a
content hash. Same lock file = same environment on any machine, every time.

**Users don't write this.** For new projects, `zagi init` generates it by
detecting your project. For existing repos, `zagi mount` infers it:

- `package.json` -> node + npm/bun/pnpm
- `Cargo.toml` -> rust + cargo
- `go.mod` -> go
- `requirements.txt` / `pyproject.toml` -> python + pip/uv
- `Dockerfile` -> parse and extract
- `flake.nix` -> use directly

If the inference is wrong, you fix `env.toml` and it's right forever.

### The cache

Environments are built from Nix under the hood, but users never see Nix.
The `env.toml` compiles down to a Nix derivation. The result is
content-addressed and cached.

```
~/.zagi/store/
  a3f8c9d1.../    # zig 0.15 + bun 1.2 + libgit2
  b7e2a4f0.../    # node 20 + pnpm + postgres-client
  ...
```

Most environments share 90%+ of their contents (glibc, coreutils, common
runtimes). The store deduplicates at the file level. Mounting a new repo
that uses Node 20 when you already have Node 20 cached = instant.

A public cache server means first-time setup is a download, not a build.
Like Nix binary caches but for complete project environments.

### Secrets

Secrets live in the repo directory but are isolated:

```
.zagi/
  secrets.enc     # encrypted, only decrypted at runtime
```

- Encrypted with age, keyed to your identity
- Decrypted into the environment at mount time
- Available to the app process (your server can read DATABASE_URL)
- **Not available to agents** -- the agent process sees the directory but
  secrets are mounted into a separate namespace that only child processes
  of `zagi run` can access
- Never in git history, never in plaintext on disk

An agent can build your code, run your tests, modify your source -- but it
physically cannot read your Stripe key. The isolation is at the mount
level, not the honor system.

## What Changes

| Today | With zagi mount |
|-------|----------------|
| Clone, read README, install deps, debug errors, give up | Mount, it works |
| "works on my machine" | Content-addressed env, same everywhere |
| Agents need hand-holding to set up | Agents see a directory that runs |
| Env setup is ephemeral tribal knowledge | Env spec is versioned in the repo |
| Secrets in .env files, gitignored, copy-pasted | Secrets encrypted, scoped, isolated |
| Different env per machine, per dev, per CI | One env, content-hashed, reproducible |

## Why This Wins

**Singular value prop: any repo, instantly runnable, locally.**

Not a cloud IDE (you use your own tools). Not a container registry (it's a
mount, not an image). Not a package manager (it manages the whole env, not
just deps). Not a VCS replacement (git underneath).

It's the layer that's missing between "I have the code" and "I can run the
code." Nobody owns this.

### Why not Nix directly?

Nix delivers this technically but fails as a product. The learning curve is
brutal, the documentation is labyrinthine, and flakes are still
"experimental" after years. zagi uses Nix as a backend but hides it
entirely. You write `zig = "0.15"` in a TOML file, not a Nix expression.

### Why not Docker?

Docker solves deployment, not development. A Dockerfile is imperative,
non-reproducible (same Dockerfile can produce different images on different
days), and gives you an isolated machine instead of a local directory.
You can't `docker run` and then open the result in your editor with your
dotfiles.

### Why not devcontainers?

Closer, but still a container. Tied to VS Code. Requires Docker. Doesn't
work with arbitrary editors/agents. And the setup is still manual --
someone has to write the devcontainer.json. zagi infers the environment.

## Build In The Open

This is an open source project. The core (`zagi mount`, env resolution,
the store, the cache) is fully open. The value isn't in the code -- it's
in the public cache (pre-built environments for popular repos) and the
network effect (more repos with env specs = more useful for everyone).

**What's open:**
- `zagi` CLI (already open, Zig + libgit2)
- Environment resolution engine
- Mount/overlay implementation
- Cache protocol
- Auto-detection heuristics

**What could be a service:**
- Public cache server (hosting pre-built envs)
- Mirror service (auto-generating env specs for GitHub repos)
- Teams features (shared secrets, access control)

## Technical Approach

| Component | Implementation | Why |
|-----------|---------------|-----|
| Mount | FUSE (Linux), macFUSE/NFS (macOS) | Local directory, no container overhead |
| Env resolution | Nix (hidden) | Only system that delivers reproducibility |
| Env spec | TOML -> Nix compilation | Human-writable, machine-resolvable |
| Store | Content-addressed, file-level dedup | Efficient, shared across projects |
| Cache | HTTP, content-addressed | Simple, cacheable, CDN-friendly |
| Secrets | age encryption + mount namespaces | Simple crypto, kernel-level isolation |
| VCS | git (with jj optional) | Zero migration cost |

### The mount in detail

On Linux: FUSE filesystem that presents the overlay. Source files are
real (read-write on your disk). Environment files are from the store
(read-only, shared). The FUSE layer merges them and sets up PATH/env
vars via a shell hook.

On macOS: Similar via macFUSE or a local NFS mount. Alternatively, a
simpler approach: symlink forest from the store + direnv-style shell
activation. Less elegant but works without FUSE.

Fallback: If FUSE isn't available, `zagi mount` can just materialize
the environment into a local `.zagi/env` directory (copies or hardlinks
from the store). Slower first time, but works everywhere.

## What To Build First

One command that works end to end:

```
$ zagi mount github.com/some/repo ./repo
$ cd repo
$ <the thing runs>
```

In order:

1. **Auto-detection** -- Given a repo, infer `env.toml` from lockfiles
   and config. Support the big languages first: JS/TS, Python, Rust, Go,
   Zig. This is the core intelligence.

2. **Env resolution** -- Compile `env.toml` to a Nix derivation. Build it.
   Cache the result in a local content-addressed store.

3. **Mount** -- Assemble the overlay directory. Shell hook for env
   activation. Start with the simple approach (symlinks + direnv) and
   upgrade to FUSE later.

4. **Public cache** -- A server that hosts pre-built environments. Push to
   it, pull from it. Makes first-time mount fast.

5. **Mirror** -- `zagi mirror github.com/foo/bar` auto-detects the env,
   builds it, pushes to cache. The viral loop: "I made your repo
   instantly runnable, here's the link."
