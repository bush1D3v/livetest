from app.header import header


def test_sauda_usuario_autenticado():
    assert header("ana", "senha1234") == "Ola, ana"
