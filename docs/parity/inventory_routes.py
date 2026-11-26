"""Mechanical route inventory for the old nexus server (read-only on the old repo).

Usage: python -I inventory_routes.py <server/nexus_server> <out.csv>
"""
import csv
import os
import re
import sys
from collections import Counter

ROOT, OUT = sys.argv[1], sys.argv[2]
DEC = re.compile(r"@(\w+)\.(get|post|put|delete|patch|websocket|route|api_route)\(")
ORDER = {"dev": 0, "dev,prod": 1, "prod": 2, "core": 3, "legacy": 4, "core-lib": 5}


def const_re(name):
    return re.compile(r"^[ \t]*" + re.escape(name) + r"[ \t]*=[ \t]*([\"'])(.*?)\1", re.M)


def service_for(rel):
    if rel.startswith("prod/"):
        return "prod"
    if rel == "identity/registry.py":
        return "dev,prod"
    if rel == "identity/oracle.py":
        return "dev"
    if rel == "dev/routers/datajobs_routes.py":
        return "dev,prod"
    if rel.startswith("dev/"):
        return "dev"
    if rel.startswith("cyberneticscore/"):
        return "core"
    if rel.startswith("legacy/"):
        return "legacy"
    return "core-lib"


def balanced(text, start):
    depth, i, instr, esc = 0, start, None, False
    while i < len(text):
        c = text[i]
        if instr:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == instr:
                instr = None
        else:
            if c in "\"'":
                instr = c
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    return text[start + 1:i], i + 1
        i += 1
    return text[start + 1:], len(text)


def top_split(s, sep=","):
    parts, depth, instr, cur, esc = [], 0, None, [], False
    for c in s:
        if instr:
            cur.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == instr:
                instr = None
            continue
        if c in "\"'":
            instr = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        if c == sep and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
    parts.append("".join(cur))
    return [p.strip() for p in parts]


def resolve(expr, src):
    """Literal, or + concatenation, or simple f-string of module constants. Returns (path, ok)."""
    e = expr.strip()
    if not e:
        return "", False
    out, ok = "", True
    for part in [p.strip() for p in top_split(e, "+")]:
        m = re.match(r"^([fuU]*)([\"'])(.*)\2$", part, re.S)
        if not m:
            ok = False
            out += part
            continue
        flag, body = m.group(1), m.group(3)
        if "f" in flag:
            def sub(mm):
                cm = const_re(mm.group(1).strip()).search(src)
                if cm:
                    return cm.group(2)
                return mm.group(0)

            new_body = re.sub(r"\{([^{}]+)\}", sub, body)
            if new_body == body and "{" in body:
                ok = False
            body = new_body
        out += body
    return out, ok


rows = []
for dp, dn, fn in os.walk(ROOT):
    dn[:] = [d for d in dn if d != "__pycache__"]
    for f in fn:
        if not f.endswith(".py"):
            continue
        path = os.path.join(dp, f)
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        src = open(path, encoding="utf-8", errors="replace").read()
        for m in DEC.finditer(src):
            args, end = balanced(src, m.end() - 1)
            line = src.count("\n", 0, m.start()) + 1
            parts = top_split(args)
            pos = [p for p in parts if not re.match(r"^\w+\s*=", p)]
            kw = {p.split("=", 1)[0].strip(): p.split("=", 1)[1].strip() for p in parts if re.match(r"^\w+\s*=", p)}
            raw_path = pos[0] if pos else ""
            pathv, ok = resolve(raw_path, src)
            if m.group(2) in ("route", "api_route"):
                meths = ",".join(re.findall(r"[\"']([A-Za-z]+)[\"']", kw.get("methods", ""))).upper() or "?"
            else:
                meths = m.group(2).upper()
            tail = src[end:end + 800]
            hm = re.search(r"^(?:[ \t]*@.*\n|[ \t]*\n)*[ \t]*(?:async[ \t]+)?def[ \t]+(\w+)", tail, re.M)
            handler = hm.group(1) if hm else "?"
            rows.append(dict(
                service=service_for(rel), file=rel, line=line, method=meths, path=pathv, handler=handler,
                resolved="yes" if ok else "no",
                raw=(raw_path[:70] + ("..." if len(raw_path) > 70 else "")) if not ok else ""))

rows.sort(key=lambda r: (ORDER.get(r["service"], 9), r["file"], r["line"]))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    w = csv.writer(fh, lineterminator="\n")
    w.writerow(["rid", "services", "file", "line", "method", "path", "handler", "path_resolved", "raw_path_expr"])
    for i, r in enumerate(rows, 1):
        w.writerow([f"R{i:03d}", r["service"], r["file"], r["line"], r["method"], r["path"],
                    r["handler"], r["resolved"], r["raw"]])

print("total routes:", len(rows))
print("by service:", dict(Counter(r["service"] for r in rows)))
print("by file:")
for k, v in sorted(Counter(r["file"] for r in rows).items(), key=lambda kv: (-kv[1], kv[0])):
    print(f"  {v:3d}  {k}")
bad = [r for r in rows if r["resolved"] == "no"]
print("unresolved path expressions:", len(bad))
for r in bad:
    print("  ", r["file"], r["line"], r["method"], r["raw"])
dups = Counter((r["service"], r["method"], r["path"]) for r in rows)
print("duplicate (service,method,path):", [(k, v) for k, v in dups.items() if v > 1][:10])
