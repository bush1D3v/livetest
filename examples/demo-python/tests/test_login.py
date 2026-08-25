from app.login import login


def test_aceita_senha_longa():
    assert login("ana", "senha1234") is True


def test_rejeita_senha_curta():
    assert login("ana", "123") is False
