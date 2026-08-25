"""Rodape: tambem importa `login` diretamente."""

from app.login import login


def footer(user: str, password: str) -> str:
    return "Sair" if login(user, password) else ""
