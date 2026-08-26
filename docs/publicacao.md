# Publicação

Guia para colocar as três entregas no ar: o site na Vercel, as bibliotecas no
npm e a extensão no Marketplace do VSCode.

As três são independentes — dá para fazer numa ordem só se quiser, mas o site
é o único totalmente reversível, então costuma ser o primeiro.

## Antes de tudo: o repositório

Os manifestos ainda carregam o marcador `SEU-USUARIO`. O `preflight` recusa
publicar enquanto ele estiver lá, porque a URL entra nos metadados do npm e
não sai mais de lá naquela versão.

```bash
# 1. Crie o repositório no GitHub e envie o código
git remote add origin https://github.com/SEU-USUARIO/livetest.git
git push -u origin master

# 2. Grave a URL nos três pacotes de uma vez
npm run set-repo -- https://github.com/SEU-USUARIO/livetest

# 3. Confira tudo
npm run verify     # typecheck + testes com cobertura 100% + build
npm run preflight  # conferências específicas de publicação
```

O `preflight` verifica: LICENSE em todo pacote, README presente e sem link
relativo, arquivos listados em `files` que não existem no disco, versão já
ocupada no registro, alinhamento entre `@livetest/cli` e `@livetest/core`,
ícone PNG no tamanho mínimo, e o bundle da extensão construído.

O `set-repo` também conserta os links dos READMEs. Um `](../../docs/x.md)`
funciona ao navegar o repositório, mas o pacote publicado não tem repositório em
volta: o npm e o `vsce` reescrevem esses links sozinhos, e o `vsce` produz
`blob/HEAD/../../docs/x.md` — que não resolve em navegador nenhum, nem com o
repositório público. Deixá-los absolutos funciona nos dois lugares.

### O repositório precisa ser público?

Nenhuma das três plataformas exige. Um repositório privado publica na Vercel,
no npm e no Marketplace sem reclamar. O que muda:

| | Com repositório privado |
| --- | --- |
| **Vercel** | Funciona, inclusive no plano gratuito. O site fica público, o código não. |
| **npm** | Publica normalmente, mas o link "Repository" na página do pacote dá 404 para quem clicar. E `--provenance` **não funciona** — ele exige repositório e CI públicos. |
| **Marketplace** | Publica normalmente; mesmo problema de link na página da extensão. |

Há um detalhe que costuma decidir a questão: `@livetest/core` e `@livetest/cli`
publicam a pasta `src/` dentro do tarball — de propósito, para que "ir para
definição" funcione no editor de quem instala. Ou seja, **o código-fonte vai
junto de qualquer jeito**, e qualquer pessoa pode lê-lo com `npm pack`. Somado à
licença MIT, manter o repositório privado não esconde nada; só quebra os links e
tira o selo de proveniência.

A recomendação, então, é tornar público antes de publicar no npm. Se preferir
mantê-lo privado, nada trava — só não use `--provenance`, e saiba que os links
de repositório vão para o vazio.

---

## 1. O site na Vercel

A landing é um site estático de Vite. Sem servidor, sem variável de ambiente,
sem banco.

### 1.1 Pelo painel (recomendado na primeira vez)

1. Entre em [vercel.com](https://vercel.com) e faça login **com a conta do
   GitHub** — é o que permite o deploy automático a cada push.
2. **Add New → Project** e escolha o repositório.
3. Na tela de configuração:
   - **Framework Preset**: `Other`
   - **Root Directory**: deixe na raiz (`./`)
   - Não mexa em Build Command nem em Output Directory.

   O [`vercel.json`](../vercel.json) na raiz já define tudo:

   ```json
   {
     "buildCommand": "npm run build --workspace @livetest/landing && npm run build:standalone --workspace @livetest/landing",
     "outputDirectory": "packages/landing/dist",
     "installCommand": "npm install"
   }
   ```

   É por isso que o Root Directory fica na raiz e não em `packages/landing`:
   o `npm install` precisa rodar onde está o `package-lock.json` do workspace.

4. **Deploy**. O primeiro build leva cerca de um minuto e sai em
   `https://<projeto>.vercel.app`.

### 1.2 Pela CLI

```bash
npm i -g vercel
vercel login
vercel          # cria um deploy de pré-visualização
vercel --prod   # promove para produção
```

### 1.3 Domínio próprio

**Project → Settings → Domains → Add**. A Vercel mostra os registros de DNS
para apontar no seu registrador (um `A` para o apex, um `CNAME` para o `www`).
O certificado HTTPS é emitido sozinho depois que o DNS propaga.

### 1.4 O endereço nos metadados

Quase toda a página usa caminho relativo. Três coisas não podem: `og:image`
(o cartão que aparece no WhatsApp e no Slack), o `<link rel="canonical">` e o
`sitemap.xml` — as três exigem URL absoluta, e o endereço só existe depois do
deploy.

Na Vercel isso se resolve sozinho: ela preenche
`VERCEL_PROJECT_PRODUCTION_URL` com o domínio de produção, inclusive um domínio
próprio, e o build lê essa variável. **Não há nada a configurar.**

Se quiser fixar o endereço à mão — outro host, ou um domínio que ainda não está
apontado — defina `SITE_URL` em *Settings → Environment Variables*:

```
SITE_URL = https://livetest.dev
```

Depois de trocar o domínio, refaça o deploy: os metadados são gravados no build,
não em tempo de requisição.

### 1.5 O que já vem configurado

O `vercel.json` também define:

- `cleanUrls` — `/index.html` responde em `/`
- cache imutável de um ano em `/assets/*` (os nomes têm hash, então é seguro)
- cache curto no navegador e longo na borda para imagens, ícones e manifesto
- `X-Content-Type-Options`, `Referrer-Policy` e `X-Frame-Options`

O `dist/` sai com o pacote completo de uma página profissional: `robots.txt` e
`sitemap.xml` gerados com a URL absoluta, `site.webmanifest` com os ícones em
PNG (inclusive a variante *maskable* que o Android exige), `apple-touch-icon`,
`favicon.ico`, dados estruturados em JSON-LD e uma página `404.html` própria.

Além do site, o build gera `standalone.html`: a página inteira num arquivo só,
com CSS, JS e favicon embutidos. Fica acessível em `/standalone.html` e serve
para mandar por e-mail ou abrir offline.

### 1.6 Depois de mexer na marca

Os ícones e o cartão social são arquivos versionados, gerados a partir do
`favicon.svg` e de `scripts/social-card.html`. Nada disso roda no deploy — só
quando a marca muda:

```bash
npm run build:assets --workspace @livetest/landing
```

### 1.7 Conferir o cartão antes de divulgar

Depois do primeiro deploy, valide como o link aparece:

- [cards-dev.twitter.com/validator](https://cards-dev.twitter.com/validator)
- [developers.facebook.com/tools/debug](https://developers.facebook.com/tools/debug/)
  — o botão *Scrape Again* força o Facebook e o WhatsApp a reler o cartão
- [linkedin.com/post-inspector](https://www.linkedin.com/post-inspector/)

O Facebook guarda o primeiro cartão em cache por muito tempo. Se você trocar a
imagem depois de compartilhar o link, precisa passar pelo *Scrape Again* — do
contrário o cartão antigo continua aparecendo.

### 1.8 Depois do primeiro deploy

Todo push na branch principal vira produção; todo push em outra branch e todo
pull request ganham uma URL de pré-visualização própria. Não há passo manual.

---

## 2. As bibliotecas no npm

São dois pacotes: `@livetest/core` (o motor) e `@livetest/cli` (o binário
`livetest`). Os dois estão livres no registro hoje.

> O nome sem escopo `livetest` **já está ocupado** por outro projeto. É por
> isso que o escopo `@livetest/` existe — não é preferência de estilo.

### 2.1 Criar a conta e o escopo

Um pacote `@livetest/algo` só pode ser publicado por quem controla o escopo
`livetest`. Como seu usuário não se chama `livetest`, é preciso criar uma
**organização** com esse nome:

1. Crie a conta em [npmjs.com/signup](https://www.npmjs.com/signup) (se ainda
   não tiver).
2. Ative o 2FA em **Account → Two-Factor Authentication**. Hoje o npm exige
   2FA para publicar.
3. Vá em [npmjs.com/org/create](https://www.npmjs.com/org/create) e crie a
   organização **`livetest`**, no plano **Free** — que é justamente o plano de
   pacotes públicos ilimitados.

Se o nome `livetest` estiver tomado quando você chegar lá, escolha outro
escopo e renomeie: troque `@livetest/` por `@seu-escopo/` em
`packages/core/package.json`, `packages/cli/package.json` (inclusive na
dependência) e nos `import` do código.

### 2.2 Entrar

```bash
npm login          # abre o navegador
npm whoami         # deve imprimir seu usuário
npm org ls livetest  # deve listar você na organização
```

### 2.3 Publicar

**A ordem importa.** O `@livetest/cli` depende de `@livetest/core` numa versão
exata (`"0.1.0"`, sem `^`). Publicar a CLI antes deixa um pacote quebrado no
registro por alguns minutos.

```bash
npm run verify
npm run preflight

npm publish --workspace @livetest/core --access public
npm publish --workspace @livetest/cli  --access public
```

Ou de uma vez, com as conferências embutidas:

```bash
npm run release:npm
```

`--access public` é obrigatório: pacotes com escopo nascem privados por
padrão, e publicar privado numa conta Free simplesmente falha.

O `prepublishOnly` de cada pacote roda `typecheck + test + build` de novo
antes de subir. É redundante com o `verify`, e de propósito: é a última rede
antes de uma ação irreversível.

### 2.4 Conferir

```bash
npm view @livetest/core
npx @livetest/cli --help

# Teste de verdade, num diretório limpo:
mkdir /tmp/teste && cd /tmp/teste && npm init -y
npm i -D @livetest/cli
npx livetest --version
```

### 2.5 Versões seguintes

Publicado, o par `nome@versão` é definitivo: não dá para republicar o mesmo
número com outro conteúdo, e `npm unpublish` só funciona nas primeiras 72
horas — e ainda assim queima aquele número para sempre.

```bash
npm version patch --workspace @livetest/core   # 0.1.0 -> 0.1.1
# alinhe a dependência da CLI na mão, no package.json dela
npm version patch --workspace @livetest/cli
npm run release:npm
```

Para testar sem ocupar a versão estável, use uma tag:

```bash
npm publish --workspace @livetest/core --access public --tag next
# quem instalar sem pedir nada continua recebendo a última "latest"
```

### 2.6 Publicar pelo CI

Com 2FA ligado, o `npm publish` local pede um código a cada publicação. Num
GitHub Action, use um **Automation token** (Account → Access Tokens → Generate
New Token → Automation), que ignora o 2FA, e guarde-o como o segredo
`NPM_TOKEN`:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    registry-url: https://registry.npmjs.org
- run: npm ci
- run: npm run verify
- run: npm publish --workspace @livetest/core --access public --provenance
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

`--provenance` adiciona no npm o selo verificado que liga o pacote ao commit
que o gerou. Só funciona a partir de um CI público.

---

## 3. A extensão no Marketplace do VSCode

O Marketplace não é do GitHub nem da Microsoft-em-geral: é do **Azure DevOps**.
Essa é a única parte burocrática das três, e ela pega quase todo mundo de
surpresa. São três contas encadeadas: Microsoft → Azure DevOps → publisher.

### 3.1 Criar o publisher

1. **Conta Microsoft.** Qualquer uma serve (Outlook, Live, corporativa).
2. **Organização no Azure DevOps.** Entre em
   [dev.azure.com](https://dev.azure.com) com a conta acima e crie uma
   organização. O nome não aparece para ninguém — ela existe só para emitir o
   token.
3. **Personal Access Token.** No canto superior direito: **User settings →
   Personal Access Tokens → New Token**.

   Estes três campos precisam estar exatamente assim, ou o `vsce` responde
   `401 Unauthorized` sem explicar por quê:

   | Campo        | Valor                                     |
   | ------------ | ----------------------------------------- |
   | Organization | **All accessible organizations**          |
   | Expiration   | até 1 ano                                 |
   | Scopes       | **Custom defined** → **Marketplace → Manage** |

   Copie o token na hora. Ele não é exibido de novo.

4. **Publisher.** Vá em
   [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage/createpublisher)
   e crie um publisher com o ID **`livetest`** — tem que ser idêntico ao campo
   `publisher` de `packages/vscode-extension/package.json`. Se o ID estiver
   ocupado, escolha outro e ajuste o manifesto.

### 3.2 Empacotar e conferir antes

```bash
cd packages/vscode-extension
npm run package     # gera livetest-<versão>.vsix
```

O `.vsix` fica com cerca de 35 kB: o bundle do esbuild, o ícone e o README.
O `--no-dependencies` no script é necessário porque o `@livetest/core` já está
embutido no bundle — sem ele, o `vsce` tentaria empacotar o `node_modules`
inteiro.

Instale o arquivo local e use a extensão de verdade antes de publicar:

```bash
code --install-extension livetest-0.1.0.vsix
```

Para desinstalar: `code --uninstall-extension livetest.livetest`.

### 3.3 Publicar

```bash
npx vsce login livetest    # cola o PAT quando pedir
npm run publish:marketplace   # build + vsce publish --no-dependencies
```

Ou sem guardar o token na máquina:

```bash
npx vsce publish --no-dependencies --pat $VSCE_PAT
```

A extensão aparece na busca do Marketplace em alguns minutos. A página fica em
`https://marketplace.visualstudio.com/items?itemName=livetest.livetest`.

### 3.4 Versões seguintes

O `vsce` sobe a versão para você:

```bash
npx vsce publish patch   # 0.1.0 -> 0.1.1, com commit e tag do git
npx vsce publish minor
```

Diferente do npm, o Marketplace deixa **despublicar** (`vsce unpublish
livetest.livetest`) — mas isso apaga instalações, avaliações e contagem de
downloads. Trate como igualmente definitivo.

### 3.5 Open VSX (opcional)

VSCodium, Cursor, Gitpod e Windsurf não acessam o Marketplace da Microsoft.
Para alcançá-los, publique também no [Open VSX](https://open-vsx.org):

```bash
npx ovsx publish livetest-0.1.0.vsix -p <token-do-open-vsx>
```

---

## Resumo

| Entrega            | Onde                     | Comando                    | Reversível?         |
| ------------------ | ------------------------ | -------------------------- | ------------------- |
| Site               | Vercel                   | `vercel --prod`            | sim, sempre         |
| `@livetest/core`   | npm                      | `npm run release:npm`      | não                 |
| `@livetest/cli`    | npm                      | (mesmo comando, na ordem)  | não                 |
| Extensão           | Marketplace do VSCode    | `npm run publish:marketplace` | tecnicamente, sim   |

## Problemas comuns

| Sintoma                                            | Causa                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `npm ERR! 402 Payment Required`                     | faltou `--access public` num pacote com escopo                    |
| `npm ERR! 404 Not Found - PUT`                      | o escopo não existe ou você não pertence à organização            |
| `npm ERR! You cannot publish over ... version`      | a versão já foi publicada; suba o número                          |
| `vsce ERROR 401 Unauthorized`                       | o PAT não está em "All accessible organizations" + Marketplace/Manage |
| `vsce ERROR ... publisher 'x' doesn't exist`        | o campo `publisher` não bate com o publisher criado no Marketplace |
| `vsce` tentando empacotar o `node_modules` inteiro  | faltou `--no-dependencies`                                        |
| Vercel: `No Output Directory named "public" found`  | o `vercel.json` não foi lido — confira o Root Directory na raiz    |
