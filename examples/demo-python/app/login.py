"""Autenticacao. Base da cadeia de dependencia do exemplo."""


def login(user: str, password: str) -> bool:
    """Aceita usuario nao vazio com senha de 8 caracteres ou mais."""
    return len(user) > 0 and len(password) >= 8
