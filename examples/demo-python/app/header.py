"""Cabecalho: importa `login` diretamente."""

from .login import login


def header(user: str, password: str) -> str:
    return f"Ola, {user}" if login(user, password) else "Entrar"
