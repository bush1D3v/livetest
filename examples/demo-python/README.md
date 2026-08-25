# demo-python

Projeto de exemplo em Python com pytest.

Exercita as duas formas de import que o adapter de grafo resolve:
`header.py` usa import relativo (`from .login import login`) e `footer.py` usa
absoluto (`from app.login import login`). Os testes ficam em `tests/`, espelhando o
layout do pacote.

Requer `pytest` no interpretador configurado:

```bash
python -m pip install pytest
node ../../packages/cli/bin/livetest.mjs why app/login.py
node ../../packages/cli/bin/livetest.mjs run app/login.py
```

Usando um venv, aponte o caminho no `livetest.config.json`:

```jsonc
{ "pythonPath": ".venv/bin/python" }
```
