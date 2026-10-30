"""Check a derivation with SymPy. The submission is data and is never executed."""

import inspect
import json
import re
import sys

import sympy
from sympy import N, Symbol, simplify
from sympy.core.basic import Basic
from sympy.parsing.sympy_parser import (
    convert_xor,
    parse_expr,
    standard_transformations,
)


def blocked(name: str) -> bool:
    if name in {
        "lambdify",
        "preview",
        "init_printing",
        "init_session",
        "interactive_traversal",
        "textplot",
        "doctest",
        "pager_print",
        "dotprint",
    }:
        return True
    return name.startswith(("print_", "pprint", "plot"))


def namespace() -> dict:
    allowed = {}
    for name, value in vars(sympy).items():
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) or name.startswith("_") or blocked(name):
            continue
        if len(name) == 1 and name not in {"E", "I"}:
            continue
        if inspect.ismodule(value):
            continue
        if callable(value) or isinstance(value, Basic):
            allowed[name] = value
    return allowed


ALLOWED = namespace()
ALLOWED["True"] = True
ALLOWED["False"] = False
CONSTANTS = {name for name, value in ALLOWED.items() if not callable(value)}
TRANSFORMS = standard_transformations + (convert_xor,)
SAFE = re.compile(r"^[A-Za-z0-9_+\-*/^().,\s<>\[\].=]+$")


def empty(error: str) -> dict:
    return {"ok": False, "error": error, "targetMatches": False, "steps": [], "required": []}


def parse_safe(expr: str, symbols: dict, allowed: dict, evaluate: bool = False):
    if not isinstance(expr, str) or len(expr) > 2000 or "__" in expr:
        raise ValueError("rejected")
    if not SAFE.fullmatch(expr):
        raise ValueError("rejected")
    return parse_expr(
        expr,
        local_dict=symbols,
        global_dict=allowed,
        transformations=TRANSFORMS,
        evaluate=evaluate,
    )


def undefined_owner(expr: str, known: set[str]) -> str | None:
    for name in re.findall(r"\b([A-Za-z][A-Za-z0-9_]*)\s*\.", expr):
        if name not in known:
            return name
    return None


def shown(expr) -> str:
    try:
        text = str(expr).replace("\n", " ")
    except Exception:
        return ""
    if len(text) > 300:
        return text[:300] + "..."
    return text


def same(left, right) -> bool:
    try:
        if simplify(left) == simplify(right):
            return True
    except Exception:
        pass
    try:
        difference = simplify(left - right)
        if difference == 0:
            return True
        if getattr(difference, "is_Matrix", False) and difference.is_zero_matrix:
            return True
    except Exception:
        pass
    try:
        return bool(getattr(left, "equals", None) and left.equals(right))
    except Exception:
        pass
    try:
        return abs(complex(N(left - right))) < 1e-6
    except Exception:
        return False


def names_in(expr: str) -> list[str]:
    return re.findall(r"\b([A-Za-z][A-Za-z0-9_]*)\b", expr)


def called_names(expr: str) -> set[str]:
    return set(re.findall(r"(?<!\.)\b([A-Za-z][A-Za-z0-9_]*)\s*\(", expr))


def local_for(expr: str, values: dict, allowed: dict, forced: set[str]) -> dict:
    called = called_names(expr)
    keywords = set(re.findall(r"\b([A-Za-z][A-Za-z0-9_]*)\s*=", expr))
    local = {}
    for name in names_in(expr):
        if name in keywords:
            continue
        if name in values:
            local[name] = values[name]
            continue
        if name in allowed and (name in called or name in CONSTANTS or name in forced):
            continue
        local[name] = Symbol(name)
    return local


def present(value):
    if isinstance(value, dict):
        return {key: present(item) for key, item in value.items()}
    if isinstance(value, list):
        return [present(item) for item in value]
    if isinstance(value, tuple):
        return tuple(present(item) for item in value)
    try:
        return simplify(value)
    except Exception:
        return value


def is_matrix(value) -> bool:
    return bool(getattr(value, "is_Matrix", False))


def failure_text(expr: str, values: dict, failed: set[str], allowed: dict, exc: Exception) -> str:
    used = names_in(expr)
    blocked_names = [name for name in used if name in failed]
    if blocked_names:
        return f"{blocked_names[0]} did not run."
    missing = undefined_owner(expr, set(values) | set(allowed))
    if missing:
        return f"{missing} is undefined."
    if isinstance(exc, TypeError):
        matrices = [name for name in used if name in values and is_matrix(values[name])]
        others = [name for name in used if name in values and not is_matrix(values[name])]
        if matrices and others:
            return f"{others[0]} is not a matrix, and {matrices[0]} is a matrix."
        methods = set(re.findall(r"\.([A-Za-z][A-Za-z0-9_]*)", expr))
        calls = [
            name
            for name in called_names(expr)
            if name not in values and name not in allowed and name not in methods
        ]
        if calls:
            return f"{calls[0]} is undefined."
        unknown = [name for name in used if name not in values and name not in allowed and name not in methods]
        if unknown and len(matrices) < 2:
            listed = " and ".join(unknown[:2])
            return f"{listed} {'is' if len(unknown) == 1 else 'are'} undefined."
        return "These values do not have the same shape."
    return "This expression could not be read."


def run_steps(steps: list, allowed: dict, forced: set[str]) -> tuple[list, list, dict]:
    recorded = []
    values: dict = {}
    failed: set[str] = set()
    step_rows = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        line = step.get("line")
        name = step.get("name") if isinstance(step.get("name"), str) else ""
        expr = step.get("expr") if isinstance(step.get("expr"), str) else ""
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name):
            step_rows.append(
                {
                    "line": line,
                    "name": name,
                    "status": "failed",
                    "explanation": "This assignment could not be read.",
                }
            )
            continue
        missing = undefined_owner(expr, set(values) | set(allowed))
        if missing:
            failed.add(name)
            step_rows.append(
                {
                    "line": line,
                    "name": name,
                    "status": "failed",
                    "explanation": f"{missing} is undefined.",
                }
            )
            continue
        value = None
        error = None
        try:
            recorded.append(parse_safe(expr, local_for(expr, {}, allowed, forced), allowed, evaluate=False))
        except Exception:
            pass
        try:
            value = present(parse_safe(expr, local_for(expr, values, allowed, forced), allowed, evaluate=True))
        except TypeError as exc:
            error = failure_text(expr, values, failed, allowed, exc)
        except Exception:
            try:
                value = present(parse_safe(expr, local_for(expr, values, allowed, forced), allowed, evaluate=False))
            except Exception as exc:
                error = failure_text(expr, values, failed, allowed, exc)
        if error is not None or value is None:
            failed.add(name)
            step_rows.append(
                {
                    "line": line,
                    "name": name,
                    "status": "failed",
                    "explanation": error or "This expression could not be read.",
                }
            )
            continue
        leaked = [str(sym) for sym in getattr(value, "free_symbols", ()) if str(sym) in failed]
        if leaked:
            failed.add(name)
            step_rows.append(
                {
                    "line": line,
                    "name": name,
                    "status": "failed",
                    "explanation": f"{leaked[0]} did not run.",
                }
            )
            continue
        recorded.append(value)
        values[name] = value
        step_rows.append(
            {
                "line": line,
                "name": name,
                "status": "passed",
                "explanation": "Calculation recorded.",
                "value": shown(value),
            }
        )

    return step_rows, recorded, values


def imported_names(payload: dict) -> tuple[dict, set[str], list[str]]:
    allowed = dict(ALLOWED)
    forced: set[str] = set()
    unknown: list[str] = []
    requested = payload.get("imports") if isinstance(payload.get("imports"), list) else []
    for item in requested:
        name = item if isinstance(item, str) else ""
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) or blocked(name):
            unknown.append(name or "import")
            continue
        value = getattr(sympy, name, None)
        if value is None or inspect.ismodule(value):
            unknown.append(name)
            continue
        allowed[name] = value
        forced.add(name)
    return allowed, forced, unknown


def named_checks(payload: dict, allowed: dict, forced: set[str], values: dict) -> list[dict] | None:
    raw = payload.get("checks")
    if not isinstance(raw, list) or not raw:
        return []
    rows = []
    for item in raw:
        if not isinstance(item, dict):
            return None
        name = item.get("name") if isinstance(item.get("name"), str) else ""
        expr = item.get("expr") if isinstance(item.get("expr"), str) else ""
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) or not expr.strip():
            return None
        try:
            parsed = parse_safe(expr, local_for(expr, values, allowed, forced), allowed, evaluate=True)
        except Exception:
            return None
        matched = name in values and same(values[name], parsed)
        if name not in values:
            explanation = f"{name} was not assigned."
        elif matched:
            explanation = f"{name} matches."
        else:
            explanation = f"{name} does not match."
        rows.append({"status": "passed" if matched else "failed", "explanation": explanation})
    return rows


def check(payload: dict) -> dict:
    reference = payload.get("reference") if isinstance(payload.get("reference"), str) else ""
    required = payload.get("required") if isinstance(payload.get("required"), list) else []
    target = payload.get("target") if isinstance(payload.get("target"), str) else ""
    steps = payload.get("steps") if isinstance(payload.get("steps"), list) else []
    allowed, forced, unknown = imported_names(payload)
    step_rows, recorded, values = run_steps(steps, allowed, forced)
    if not reference.strip() or not target.strip():
        return {
            "ok": True,
            "error": "The derivation checker has no reference for this exam.",
            "targetMatches": False,
            "steps": step_rows,
            "required": [],
            "unknownImports": unknown,
        }
    named = named_checks(payload, allowed, forced, values)
    if named is None:
        return {
            "ok": True,
            "error": "The stored reference could not be checked.",
            "targetMatches": False,
            "steps": step_rows,
            "required": [],
            "unknownImports": unknown,
        }
    if named:
        return {
            "ok": True,
            "error": None,
            "targetMatches": all(row["status"] == "passed" for row in named),
            "steps": step_rows,
            "required": named,
            "unknownImports": unknown,
        }
    try:
        reference_expr = parse_safe(reference, local_for(reference, {}, allowed, forced), allowed)
        required_text = [item for item in required if isinstance(item, str)]
        required_expr = [parse_safe(item, local_for(item, {}, allowed, forced), allowed) for item in required_text]
    except Exception:
        return {
            "ok": True,
            "error": "The stored reference could not be checked.",
            "targetMatches": False,
            "steps": step_rows,
            "required": [],
            "unknownImports": unknown,
        }
    if len(required_expr) != len(required_text):
        return {
            "ok": True,
            "error": "The stored reference could not be checked.",
            "targetMatches": False,
            "steps": step_rows,
            "required": [],
            "unknownImports": unknown,
        }

    required_rows = []
    for expr in required_expr:
        found = any(same(stored, expr) for stored in recorded)
        required_rows.append(
            {
                "status": "passed" if found else "failed",
                "explanation": "A required intermediate form is present."
                if found
                else "A required intermediate form does not appear.",
            }
        )
    return {
        "ok": True,
        "error": None,
        "targetMatches": target in values and same(values[target], reference_expr),
        "steps": step_rows,
        "required": required_rows,
        "unknownImports": unknown,
    }


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("rejected")
        result = check(payload)
    except Exception:
        result = empty("The derivation checker could not read this submission.")
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
