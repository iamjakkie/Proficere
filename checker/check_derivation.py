"""Check a derivation with SymPy. The submission is data and is never executed."""

import json
import re
import sys

from sympy import (
    Add,
    E,
    Float,
    I,
    Integer,
    Matrix,
    Mul,
    Pow,
    Rational,
    Symbol,
    Tuple,
    cos,
    det,
    exp,
    eye,
    log,
    oo,
    pi,
    simplify,
    sin,
    sqrt,
    trace,
    zeros,
    N,
)
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

ALLOWED = {
    "Matrix": Matrix,
    "eye": eye,
    "zeros": zeros,
    "sqrt": sqrt,
    "exp": exp,
    "log": log,
    "sin": sin,
    "cos": cos,
    "det": det,
    "trace": trace,
    "simplify": simplify,
    "Rational": Rational,
    "pi": pi,
    "E": E,
    "I": I,
    "oo": oo,
    "Add": Add,
    "Mul": Mul,
    "Pow": Pow,
    "Integer": Integer,
    "Float": Float,
    "Symbol": Symbol,
    "Tuple": Tuple,
}
TRANSFORMS = standard_transformations + (convert_xor, implicit_multiplication_application)
SAFE = re.compile(r"^[A-Za-z0-9_+\-*/^().,\s<>\[\].]+$")


def empty(error: str) -> dict:
    return {"ok": False, "error": error, "targetMatches": False, "steps": [], "required": []}


def parse_safe(expr: str, symbols: dict, evaluate: bool = False):
    if not isinstance(expr, str) or len(expr) > 2000 or "__" in expr or "=" in expr:
        raise ValueError("rejected")
    if not SAFE.fullmatch(expr):
        raise ValueError("rejected")
    return parse_expr(
        expr,
        local_dict=symbols,
        global_dict=ALLOWED,
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
        difference = simplify(left - right)
        if difference == 0:
            return True
        if getattr(difference, "is_Matrix", False) and difference.is_zero_matrix:
            return True
    except Exception:
        pass
    try:
        return abs(complex(N(left - right))) < 1e-6
    except Exception:
        return False


def check(payload: dict) -> dict:
    reference = payload.get("reference") if isinstance(payload.get("reference"), str) else ""
    required = payload.get("required") if isinstance(payload.get("required"), list) else []
    target = payload.get("target") if isinstance(payload.get("target"), str) else ""
    steps = payload.get("steps") if isinstance(payload.get("steps"), list) else []
    if not reference.strip() or not target.strip():
        return empty("The derivation checker has no reference for this exam.")
    try:
        reference_expr = parse_safe(reference, {})
        required_expr = [parse_safe(item, {}) for item in required if isinstance(item, str)]
    except Exception:
        return empty("The stored reference could not be checked.")
    if len(required_expr) != len([item for item in required if isinstance(item, str)]):
        return empty("The stored reference could not be checked.")

    symbolic: dict = {}
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
        missing = undefined_owner(expr, set(values) | set(ALLOWED))
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
        symbols = {key: Symbol(key) for key in values}
        parsed = None
        try:
            parsed = parse_safe(expr, symbols)
            recorded.append(parsed)
        except Exception:
            parsed = None
        value = None
        if parsed is not None:
            try:
                value = simplify(parsed.subs(values))
            except Exception:
                value = None
        if value is None or "." in expr or "[" in expr:
            concrete = None
            for evaluate in (False, True):
                try:
                    concrete = simplify(parse_safe(expr, dict(values), evaluate=evaluate))
                    break
                except Exception:
                    concrete = None
            if concrete is not None:
                value = concrete
                recorded.append(concrete)
        if value is None:
            unknown = [
                item
                for item in re.findall(r"\b([A-Za-z][A-Za-z0-9_]*)\b", expr)
                if item not in values and item not in ALLOWED
            ]
            failed.add(name)
            step_rows.append(
                {
                    "line": line,
                    "name": name,
                    "status": "failed",
                    "explanation": f"{unknown[0]} is undefined." if unknown else "This expression could not be read.",
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
                    "explanation": f"{leaked[0]} is undefined.",
                }
            )
            continue
        symbolic[name] = parsed if parsed is not None else value
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
    target_matches = target in values and same(values[target], reference_expr)
    return {
        "ok": True,
        "error": None,
        "targetMatches": target_matches,
        "steps": step_rows,
        "required": required_rows,
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
