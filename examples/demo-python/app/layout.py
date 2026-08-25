"""Layout: importa `header`, logo depende de `login` transitivamente."""

from .header import header


def layout(user: str, password: str) -> str:
    return f"<div>{header(user, password)}</div>"
