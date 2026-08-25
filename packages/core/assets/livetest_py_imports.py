"""Extrator de imports Python para o Live Test Runner.

Le de stdin um JSON no formato ``{"files": ["/abs/a.py", ...]}`` e escreve em
stdout ``{"results": [{"file": ..., "imports": [...], "error": ...}]}``.

Cada import e descrito por::

    {"module": "pacote.modulo" | None, "level": 0, "names": ["Simbolo", ...]}

onde ``level`` e a quantidade de pontos de um import relativo (``from . import x``
tem ``level == 1``). A resolucao para caminhos de arquivo acontece do lado
TypeScript, que conhece a raiz do projeto.

O script e intencionalmente sem dependencias externas e compativel com
Python 3.8+, para rodar em qualquer interpretador que o projeto do usuario use.
"""

from __future__ import annotations

import ast
import json
import sys
from typing import Any, Dict, List


def extract_imports(source: str) -> List[Dict[str, Any]]:
    """Devolve a lista de imports de um modulo Python."""
    tree = ast.parse(source)
    found: List[Dict[str, Any]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.append({"module": alias.name, "level": 0, "names": []})
        elif isinstance(node, ast.ImportFrom):
            found.append(
                {
                    "module": node.module,
                    "level": node.level or 0,
                    "names": [alias.name for alias in node.names if alias.name != "*"],
                }
            )
    return found


def analyze(path: str) -> Dict[str, Any]:
    """Analisa um arquivo, jamais lancando excecao."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            source = handle.read()
    except OSError as error:
        return {"file": path, "imports": [], "error": f"leitura falhou: {error}"}

    try:
        return {"file": path, "imports": extract_imports(source), "error": None}
    except SyntaxError as error:
        return {"file": path, "imports": [], "error": f"sintaxe invalida: {error}"}
    except (ValueError, RecursionError) as error:
        return {"file": path, "imports": [], "error": f"falha ao analisar: {error}"}


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as error:
        json.dump({"results": [], "error": f"stdin invalido: {error}"}, sys.stdout)
        return 1

    files = payload.get("files") or []
    results = [analyze(path) for path in files if isinstance(path, str)]
    json.dump({"results": results, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
