from app.footer import footer


def test_mostra_sair():
    assert footer("ana", "senha1234") == "Sair"
