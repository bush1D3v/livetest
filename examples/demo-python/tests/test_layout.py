from app.layout import layout


def test_embrulha_cabecalho():
    assert layout("ana", "senha1234") == "<div>Ola, ana</div>"
