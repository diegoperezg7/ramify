"""Local web dashboard for ramify. Python standard library only.

Started by `ramify ui`. Listens on 127.0.0.1, every API call needs the session
token, and mutating actions go through the ramify CLI so they keep its safety rules.
"""
import argparse
import hmac
import json
import mimetypes
import os
import socket
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DIST = Path(__file__).resolve().parent / "dist"
MAX_COMMITS = 300
MAX_DIFF = 400_000
IDES = {"xcode", "cursor", "code", "zed", "idea", "Finder"}


def run(args, cwd=None, check=True):
    # git output is bytes: a file or a commit in another encoding must not fail the whole request.
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip() or f"{args[0]} failed")
    return p


def git(repo, *args, check=True):
    return run(["git", "-C", repo, *args], check=check).stdout


class Dashboard:
    def __init__(self, main, bin_path):
        self.main = main
        self.bin = bin_path

    # --- reads ---------------------------------------------------------------

    def worktrees(self):
        out = run([self.bin, "ls", "--json"], cwd=self.main).stdout
        return json.loads(out)

    def base(self):
        return git(self.main, "branch", "--show-current").strip() or "HEAD"

    def state(self):
        wts = self.worktrees()
        base = self.base()
        branches = [w["branch"] for w in wts if w["branch"]]
        owner = {}
        for w in wts:
            if w["main"] or not w["branch"]:
                continue
            for h in git(self.main, "rev-list", f"{base}..{w['branch']}", check=False).split():
                owner.setdefault(h, w["branch"])
        commits = []
        if branches:
            fmt = "%H%x1f%P%x1f%s%x1f%an%x1f%ct%x1f%D%x1e"
            log = git(self.main, "log", "--date-order", f"-n{MAX_COMMITS}", f"--format={fmt}",
                      *branches, "--", check=False)
            for rec in log.split("\x1e"):
                rec = rec.strip("\n")
                if not rec:
                    continue
                h, parents, subject, author, ct, refs = rec.split("\x1f")
                commits.append({
                    "hash": h, "parents": parents.split(), "subject": subject,
                    "author": author, "time": int(ct), "owner": owner.get(h),
                    "refs": [r.strip() for r in refs.split(",") if r.strip()],
                })
        return {
            "repo": os.path.basename(self.main), "main": self.main, "base": base,
            "worktrees": wts, "commits": commits, "now": int(time.time()),
        }

    def worktree(self, path):
        wt = self.find(path)
        base = self.base()
        detail = {"path": path, "branch": wt["branch"], "commits": [], "files": []}
        if wt["main"]:
            mb = "HEAD"
        else:
            mb = git(path, "merge-base", base, "HEAD", check=False).strip() or "HEAD"
            log = git(path, "log", f"{base}..HEAD", "--format=%H%x1f%s%x1f%ct", check=False)
            for line in log.splitlines():
                h, s, t = line.split("\x1f")
                detail["commits"].append({"hash": h, "subject": s, "time": int(t)})
        # -z everywhere: paths with spaces, accents or renames come through verbatim.
        files = {}
        rec = git(path, "diff", "-z", "--numstat", mb, check=False).split("\0")
        i = 0
        while i < len(rec):
            if rec[i]:
                add, rem, name = rec[i].split("\t", 2)
                if name == "":
                    i += 2
                    name = rec[i] if i < len(rec) else ""
                if name:
                    files[name] = {"file": name, "status": "M", "add": add, "del": rem}
            i += 1
        rec = git(path, "diff", "-z", "--name-status", mb, check=False).split("\0")
        i = 0
        while i < len(rec):
            st = rec[i]
            if st:
                i += 1
                name = rec[i] if i < len(rec) else ""
                if st[0] in "RC":
                    i += 1
                    name = rec[i] if i < len(rec) else ""
                if name:
                    files.setdefault(name, {"file": name, "add": "0", "del": "0"})["status"] = st[0]
            i += 1
        uncommitted = set()
        rec = git(path, "status", "-z", "--porcelain", check=False).split("\0")
        i = 0
        while i < len(rec):
            r = rec[i]
            if r:
                code, name = r[:2], r[3:]
                uncommitted.add(name)
                if code == "??":
                    files[name] = {"file": name, "status": "?", "add": "", "del": ""}
                if code[0] in "RC":
                    i += 1
            i += 1
        for f in files.values():
            f["uncommitted"] = f["file"] in uncommitted
        detail["files"] = sorted(files.values(), key=lambda f: f["file"])
        detail["mergeBase"] = mb
        return detail

    def diff(self, path, file):
        self.find(path)
        base = self.base()
        mb = git(path, "merge-base", base, "HEAD", check=False).strip() or "HEAD"
        if path == self.main:
            mb = "HEAD"
        untracked = git(path, "ls-files", "--others", "--exclude-standard", "--", file, check=False).strip()
        if untracked:
            text = run(["git", "-C", path, "diff", "--no-index", "--", "/dev/null", file], check=False).stdout
        else:
            text = git(path, "diff", mb, "--", file, check=False)
        return text[:MAX_DIFF]

    def commit_ref(self, hash_):
        """A commit id from the UI, checked to be a commit here: (full hash, parents)."""
        if not (4 <= len(hash_) <= 64 and all(ch in "0123456789abcdefABCDEF" for ch in hash_)):
            raise ValueError("invalid commit")
        line = git(self.main, "rev-list", "--parents", "-n", "1", hash_ + "^{commit}", "--", check=False).strip()
        if not line:
            raise LookupError("unknown commit")
        full, *parents = line.split(" ")
        return full, parents

    @staticmethod
    def tree_range(full, parents):
        # A merge shows what it brought in (against its first parent); the first commit, everything.
        return [parents[0], full] if parents else ["--root", full]

    def commit(self, hash_):
        full, parents = self.commit_ref(hash_)
        author, ct, subject, *body = git(self.main, "show", "-s", "--format=%an%x1f%ct%x1f%s%x1f%b", full, "--").split("\x1f")
        rng = self.tree_range(full, parents)
        files = {}
        recs = git(self.main, "diff-tree", "-r", "-z", "-M", "--no-commit-id", "--numstat", *rng, "--").split("\0")
        i = 0
        while i < len(recs):
            rec = recs[i]
            if rec:
                add, dele, name = rec.split("\t", 2)
                if name == "":  # rename: "add\tdel\t" then old\0new\0
                    i += 2
                    name = recs[i] if i < len(recs) else ""
                if name:
                    files[name] = {"file": name, "status": "M", "add": add, "del": dele, "uncommitted": False}
            i += 1
        recs = git(self.main, "diff-tree", "-r", "-z", "-M", "--no-commit-id", "--name-status", *rng, "--").split("\0")
        i = 0
        while i < len(recs):
            st = recs[i]
            if st:
                i += 1
                if st[0] in "RC":
                    i += 1
                name = recs[i] if i < len(recs) else ""
                if name in files:
                    files[name]["status"] = st[0]
            i += 1
        return {
            "hash": full, "parents": parents, "author": author, "time": int(ct), "subject": subject,
            "body": "\x1f".join(body).strip(), "files": sorted(files.values(), key=lambda f: f["file"]),
        }

    def commit_diff(self, hash_, file):
        full, parents = self.commit_ref(hash_)
        text = git(self.main, "diff-tree", "-p", "-M", "--no-commit-id", "--no-ext-diff", "--no-textconv",
                   *self.tree_range(full, parents), "--", file, check=False)
        return text[:MAX_DIFF]

    def find(self, path):
        """Validate a worktree path with one `git worktree list` (no process scan)."""
        cur = None
        for line in git(self.main, "worktree", "list", "--porcelain").splitlines() + [""]:
            if line.startswith("worktree "):
                cur = {"path": line[9:], "branch": "", "main": line[9:] == self.main}
            elif cur and line.startswith("branch "):
                cur["branch"] = line[7:].replace("refs/heads/", "", 1)
            elif not line and cur:
                if cur["path"] == path:
                    return cur
                cur = None
        raise LookupError("unknown worktree")

    # --- actions -------------------------------------------------------------

    def open_ide(self, path, ide):
        self.find(path)
        if ide not in IDES:
            raise ValueError("unknown IDE")
        if ide == "Finder":
            run(["open", path])
        else:
            run([self.bin, "open", path, "-i", ide], cwd=self.main)
        return "ok"

    def remove(self, path, force):
        if self.find(path)["main"]:
            raise ValueError("that is the main checkout")
        args = [self.bin, "rm", path] + (["--force"] if force else [])
        p = run(args, cwd=self.main, check=False)
        msg = (p.stderr or p.stdout).strip()
        if p.returncode != 0:
            raise RuntimeError(msg.replace("ramify: ", ""))
        return msg

    def merge(self, path):
        wt = self.find(path)
        if wt["main"] or not wt["branch"]:
            raise ValueError("nothing to merge")
        if git(self.main, "status", "--porcelain", "--untracked-files=no").strip():
            raise RuntimeError("the main checkout has uncommitted changes")
        if git(path, "status", "--porcelain").strip():
            raise RuntimeError("the worktree has uncommitted changes")
        p = run(["git", "-C", self.main, "merge", "--no-ff", "--no-edit", wt["branch"]], check=False)
        if p.returncode != 0:
            run(["git", "-C", self.main, "merge", "--abort"], check=False)
            raise RuntimeError("merge conflict, nothing was changed:\n" + (p.stdout + p.stderr).strip())
        return p.stdout.strip()


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        # HTTPServer.server_bind calls socket.getfqdn(), which can stall for seconds on macOS.
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind(self.server_address)
        self.server_address = self.socket.getsockname()
        self.server_name, self.server_port = "127.0.0.1", self.server_address[1]


def make_handler(dash, token, port):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def guard(self):
            if self.headers.get("Host") not in allowed_hosts:
                self.send(403, {"error": "bad host"}); return False
            if not hmac.compare_digest(self.headers.get("X-Token", "").encode(), token.encode()):
                self.send(401, {"error": "bad token"}); return False
            return True

        def do_GET(self):
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            if url.path.startswith("/api/"):
                if not self.guard():
                    return
                try:
                    if url.path == "/api/state":
                        return self.send(200, dash.state())
                    if url.path == "/api/worktree":
                        return self.send(200, dash.worktree(q.get("path", "")))
                    if url.path == "/api/diff":
                        return self.send(200, {"diff": dash.diff(q.get("path", ""), q.get("file", ""))})
                    if url.path == "/api/commit":
                        return self.send(200, dash.commit(q.get("hash", "")))
                    if url.path == "/api/commit-diff":
                        return self.send(200, {"diff": dash.commit_diff(q.get("hash", ""), q.get("file", ""))})
                    return self.send(404, {"error": "not found"})
                except (LookupError, ValueError) as e:
                    return self.send(400, {"error": str(e)})
                except Exception as e:  # noqa: BLE001 - report to the UI
                    return self.send(500, {"error": str(e)})
            if self.headers.get("Host") not in allowed_hosts:
                return self.send(403, {"error": "bad host"})
            rel = url.path.lstrip("/") or "index.html"
            f = (DIST / rel).resolve()
            if not f.is_relative_to(DIST) or not f.is_file():
                f = DIST / "index.html"
            ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
            self.send(200, f.read_bytes(), ctype)

        def do_POST(self):
            if not self.guard():
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                path = body.get("path", "")
                if self.path == "/api/open":
                    return self.send(200, {"message": dash.open_ide(path, body.get("ide", ""))})
                if self.path == "/api/remove":
                    return self.send(200, {"message": dash.remove(path, bool(body.get("force")))})
                if self.path == "/api/merge":
                    return self.send(200, {"message": dash.merge(path)})
                return self.send(404, {"error": "not found"})
            except (LookupError, ValueError) as e:
                return self.send(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001 - report to the UI
                return self.send(409, {"error": str(e)})

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--main", required=True)
    ap.add_argument("--bin", required=True)
    ap.add_argument("--port", type=int, default=0)
    # The token comes in RAMIFY_UI_TOKEN: a command-line argument is visible to every user of the machine (ps).
    ap.add_argument("--token", default=os.environ.get("RAMIFY_UI_TOKEN"))
    a = ap.parse_args()
    if not a.token:
        ap.error("the token is missing (RAMIFY_UI_TOKEN or --token)")
    if not (DIST / "index.html").is_file():
        sys.exit(f"ramify ui: missing {DIST}/index.html (build it with: cd ui/web && npm ci && npm run build)")
    dash = Dashboard(a.main, a.bin)
    srv = Server(("127.0.0.1", a.port), None)
    port = srv.server_address[1]
    srv.RequestHandlerClass = make_handler(dash, a.token, port)
    print(f"http://127.0.0.1:{port}/#token={a.token}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
