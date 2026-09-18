/**
 * Busca em todo o site, sem servidor e sem biblioteca.
 *
 * O indice e montado no build, um por idioma, e chega ao navegador como um JSON
 * baixado na primeira vez que alguem abre a busca. A partir dai tudo acontece em
 * memoria: nao ha requisicao por tecla digitada, nao ha servico externo, e a
 * pagina continua funcionando aberta direto do disco.
 *
 * O ranqueamento e um BM25 com tres ajustes que importam mais, na pratica, que a
 * formula:
 *
 * - **Campo pesa.** Um termo no titulo da pagina vale mais que o mesmo termo
 *   perdido no meio de um paragrafo.
 * - **Cobertura pesa mais.** Quem casa com todas as palavras digitadas sobe na
 *   frente de quem casa com uma so, mesmo que a segunda repita muito o termo.
 * - **A ultima palavra e um prefixo.** Quem digita `confi` ainda esta digitando,
 *   entao `configuracao` casa. A expansao usa busca binaria sobre o vocabulario
 *   ordenado, e nao uma varredura por tecla.
 *
 * Acentos sao removidos dos dois lados, entao `configuracao` acha
 * "configuração"; nomes em camelCase sao quebrados, entao `depth` acha
 * `dependencyDepth`; e uma palavra com um erro de digitacao ainda acha o termo
 * certo, desde que seja uma edicao so.
 *
 * @packageDocumentation
 */

/**
 * Uma secao indexada.
 *
 * As chaves sao curtas de proposito: o indice inteiro viaja pela rede, e nomes
 * longos repetidos algumas centenas de vezes custam mais que o texto.
 */
export interface SearchDoc {
  /** URL da secao, relativa a raiz do site. */
  u: string;
  /** Titulo da pagina. */
  p: string;
  /** Titulo da secao. Vazio quando e a abertura da pagina. */
  s: string;
  /** Texto corrido da secao, ja sem marcacao. */
  t: string;
}

/** Ocorrencia de um termo em um documento. */
interface Ocorrencia {
  /** Indice do documento. */
  doc: number;
  /** Frequencia ja ponderada pelo campo onde apareceu. */
  peso: number;
}

/** Indice pronto para consulta. */
export interface SearchIndex {
  /** Documentos, na ordem em que foram indexados. */
  readonly docs: readonly SearchDoc[];
  /** Vocabulario, em ordem alfabetica. */
  readonly termos: readonly string[];
  /** Ocorrencias de cada termo, paralelo a {@link SearchIndex.termos}. */
  readonly ocorrencias: readonly (readonly Ocorrencia[])[];
  /** Tamanho ponderado de cada documento. */
  readonly tamanhos: readonly number[];
  /** Tamanho medio, usado na normalizacao do BM25. */
  readonly tamanhoMedio: number;
}

/** Um pedaco de texto, marcado ou nao, para a interface montar o realce. */
export interface Segmento {
  /** Texto do pedaco. */
  texto: string;
  /** `true` quando casa com o que foi digitado. */
  marcado: boolean;
}

/** Um resultado. */
export interface SearchHit {
  /** A secao encontrada. */
  doc: SearchDoc;
  /** Pontuacao final; so faz sentido comparada com a dos outros. */
  pontuacao: number;
  /** Titulo da secao, com as partes que casaram marcadas. */
  titulo: readonly Segmento[];
  /** Trecho do corpo em volta do primeiro casamento. */
  trecho: readonly Segmento[];
}

/** Peso de cada campo na montagem do indice. */
const PESO = { pagina: 6, secao: 4, corpo: 1 } as const;

/** Constantes do BM25. `k` satura a repeticao; `b` corrige o tamanho. */
const K = 1.2;
const B = 0.6;

/** Tamanho do trecho mostrado em cada resultado. */
const TRECHO = 150;

/** Menor palavra que vale tentar corrigir. */
const MINIMO_PARA_CORRIGIR = 4;

/**
 * Tira acentos sem mexer no resto.
 *
 * @example
 * ```ts
 * semAcento('configuração'); // 'configuracao'
 * ```
 */
export function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Quebra um texto nas palavras que o indice conhece.
 *
 * A ordem das etapas importa: o acento sai antes, a divisao de camelCase
 * acontece enquanto ainda ha maiusculas, e so entao tudo vira minusculo.
 *
 * @example
 * ```ts
 * tokenize('dependencyDepth: "transitive"'); // ['dependency', 'depth', 'transitive']
 * ```
 */
export function tokenize(texto: string): string[] {
  return semAcento(texto)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra !== '');
}

/**
 * Indica se duas palavras estao a no maximo uma edicao de distancia.
 *
 * Substituicao, insercao ou remocao de um caractere. E uma versao limitada de
 * Levenshtein: para saber se a distancia e 1 nao e preciso a matriz inteira, e
 * a versao limitada custa uma passada.
 *
 * @example
 * ```ts
 * umaEdicao('adapter', 'adaper');  // true
 * umaEdicao('adapter', 'runner');  // false
 * ```
 */
export function umaEdicao(a: string, b: string): boolean {
  if (a === b) return true;

  const [curta, longa] = a.length <= b.length ? [a, b] : [b, a];
  if (longa.length - curta.length > 1) return false;

  // Ponto onde as duas deixam de ser iguais. Ate aqui, nada foi gasto.
  let i = 0;
  while (i < curta.length && curta[i] === longa[i]) i++;

  // Mesmo tamanho: a unica edicao possivel e uma substituicao, entao o resto
  // das duas, depois do caractere trocado, tem de bater.
  if (curta.length === longa.length) return curta.slice(i + 1) === longa.slice(i + 1);

  // Tamanhos diferentes por um: a edicao e a insercao do caractere que sobra na
  // palavra longa, entao o resto dela, pulando esse caractere, tem de bater com
  // o resto da curta.
  return curta.slice(i) === longa.slice(i + 1);
}

/**
 * Monta o indice.
 *
 * @param docs - Secoes a indexar.
 *
 * @example
 * ```ts
 * const indice = buildIndex([{ u: 'config', p: 'Config', s: '', t: 'watch e ignore' }]);
 * search(indice, 'watch')[0]?.doc.u; // 'config'
 * ```
 */
export function buildIndex(docs: readonly SearchDoc[]): SearchIndex {
  const acumulado = new Map<string, Map<number, number>>();
  const tamanhos: number[] = [];

  docs.forEach((doc, indice) => {
    let tamanho = 0;

    const somar = (texto: string, peso: number): void => {
      for (const termo of tokenize(texto)) {
        tamanho += peso;
        const porDoc = acumulado.get(termo) ?? new Map<number, number>();
        porDoc.set(indice, (porDoc.get(indice) ?? 0) + peso);
        acumulado.set(termo, porDoc);
      }
    };

    somar(doc.p, PESO.pagina);
    somar(doc.s, PESO.secao);
    somar(doc.t, PESO.corpo);
    tamanhos.push(tamanho);
  });

  const termos = [...acumulado.keys()].sort();
  const ocorrencias = termos.map((termo) =>
    [...(acumulado.get(termo) as Map<number, number>)].map(([doc, peso]) => ({ doc, peso })),
  );

  const total = tamanhos.reduce((soma, valor) => soma + valor, 0);

  return {
    docs,
    termos,
    ocorrencias,
    tamanhos,
    tamanhoMedio: tamanhos.length === 0 ? 1 : total / tamanhos.length || 1,
  };
}

/**
 * Primeiro indice do vocabulario cujo termo nao vem antes de `alvo`.
 *
 * Busca binaria: e o que torna a expansao de prefixo barata o bastante para
 * rodar a cada tecla.
 */
export function limiteInferior(termos: readonly string[], alvo: string): number {
  let baixo = 0;
  let alto = termos.length;

  while (baixo < alto) {
    const meio = (baixo + alto) >> 1;
    if ((termos[meio] as string) < alvo) baixo = meio + 1;
    else alto = meio;
  }

  return baixo;
}

/**
 * Todos os termos do vocabulario que comecam com o prefixo.
 *
 * @example
 * ```ts
 * expandirPrefixo(['adapter', 'adapters', 'batch'], 'adap');
 * // ['adapter', 'adapters']
 * ```
 */
export function expandirPrefixo(termos: readonly string[], prefixo: string): number[] {
  const inicio = limiteInferior(termos, prefixo);
  const achados: number[] = [];

  for (let i = inicio; i < termos.length && (termos[i] as string).startsWith(prefixo); i++) {
    achados.push(i);
  }

  return achados;
}

/**
 * Resolve uma palavra digitada nos indices de vocabulario que ela alcanca.
 *
 * A ultima palavra vale como prefixo, porque quem digita ainda esta digitando.
 * Nao ha um caso separado para o termo exato da ultima palavra: uma palavra e
 * prefixo de si mesma, entao a expansao ja a devolve.
 */
function resolverTermo(indice: SearchIndex, palavra: string, ultima: boolean): number[] {
  if (ultima) {
    const porPrefixo = expandirPrefixo(indice.termos, palavra);
    if (porPrefixo.length > 0) return porPrefixo;
  } else {
    const exato = limiteInferior(indice.termos, palavra);
    if (indice.termos[exato] === palavra) return [exato];
  }

  if (palavra.length < MINIMO_PARA_CORRIGIR) return [];

  // Ultimo recurso: aceitar um erro de digitacao.
  const proximos: number[] = [];
  indice.termos.forEach((termo, i) => {
    if (umaEdicao(termo, palavra)) proximos.push(i);
  });
  return proximos;
}

/** Satura a frequencia e corrige pelo tamanho do documento, a la BM25. */
function saturar(peso: number, tamanho: number, medio: number): number {
  return (peso * (K + 1)) / (peso + K * (1 - B + (B * tamanho) / medio));
}

/**
 * Consulta o indice.
 *
 * @param indice - Devolvido por {@link buildIndex}.
 * @param consulta - O que foi digitado.
 * @param limite - Maximo de resultados. @defaultValue `24`
 *
 * @example
 * ```ts
 * search(indice, 'profundidade transitive', 5);
 * ```
 */
export function search(indice: SearchIndex, consulta: string, limite = 24): SearchHit[] {
  const palavras = tokenize(consulta);
  if (palavras.length === 0) return [];

  const pontos = new Map<number, number>();
  const cobertura = new Map<number, number>();

  palavras.forEach((palavra, posicao) => {
    const ultima = posicao === palavras.length - 1;
    const alcancados = resolverTermo(indice, palavra, ultima);
    if (alcancados.length === 0) return;

    // Um prefixo que casa com muitos termos e pouco informativo; a raiz corta o
    // peso de `a` sem apagar o de uma palavra rara escrita pela metade.
    const diluicao = 1 / Math.sqrt(alcancados.length);
    const vistos = new Set<number>();

    for (const termo of alcancados) {
      const ocorrencias = indice.ocorrencias[termo] as readonly Ocorrencia[];
      const idf = Math.log(1 + (indice.docs.length - ocorrencias.length + 0.5) / (ocorrencias.length + 0.5));

      for (const { doc, peso } of ocorrencias) {
        const tamanho = indice.tamanhos[doc] as number;
        const ganho = idf * saturar(peso, tamanho, indice.tamanhoMedio) * diluicao;
        pontos.set(doc, (pontos.get(doc) ?? 0) + ganho);
        vistos.add(doc);
      }
    }

    for (const doc of vistos) cobertura.set(doc, (cobertura.get(doc) ?? 0) + 1);
  });

  if (pontos.size === 0) return [];

  const frase = semAcento(consulta).trim().toLowerCase();
  const resultados: SearchHit[] = [];

  for (const [doc, bruto] of pontos) {
    const alvo = indice.docs[doc] as SearchDoc;

    // Casar com todas as palavras vale muito mais que casar com uma. Todo
    // documento pontuado passou por `cobertura`, entao a leitura sempre acha.
    const fracao = (cobertura.get(doc) as number) / palavras.length;
    let pontuacao = bruto * fracao * fracao;

    // A frase inteira no titulo e o sinal mais forte que existe. Na abertura de
    // uma pagina o titulo e o da propria pagina: sem isso, quem busca "vscode"
    // recebia a secao do changelog que cita a extensao antes da pagina sobre
    // ela, porque so a secao tinha um titulo para comparar.
    const titulo = semAcento(alvo.s === '' ? alvo.p : alvo.s).toLowerCase();

    if (titulo === frase) pontuacao *= 3.2;
    else if (titulo.includes(frase)) pontuacao *= 2.2;
    else if (semAcento(alvo.p).toLowerCase().includes(frase)) pontuacao *= 1.5;

    // Entre dois resultados parecidos, a pagina inteira serve melhor que um
    // pedaco dela: quem chega na abertura ainda alcanca o resto rolando.
    if (alvo.s === '') pontuacao *= 1.15;

    resultados.push({
      doc: alvo,
      pontuacao,
      titulo: marcar(alvo.s === '' ? alvo.p : alvo.s, palavras, Infinity),
      trecho: marcar(alvo.t, palavras, TRECHO),
    });
  }

  resultados.sort((a, b) => b.pontuacao - a.pontuacao || a.doc.u.localeCompare(b.doc.u));
  return resultados.slice(0, limite);
}

/** Posicoes onde alguma das palavras aparece no texto. */
function casamentos(texto: string, palavras: readonly string[]): Array<[number, number]> {
  const alvo = semAcento(texto).toLowerCase();
  const achados: Array<[number, number]> = [];

  for (const palavra of palavras) {
    let de = alvo.indexOf(palavra);
    while (de !== -1) {
      achados.push([de, de + palavra.length]);
      de = alvo.indexOf(palavra, de + palavra.length);
    }
  }

  return achados.sort((a, b) => a[0] - b[0]);
}

/**
 * Recorta o texto em volta do primeiro casamento e marca o que casou.
 *
 * @param texto - Texto de origem.
 * @param palavras - Palavras digitadas, ja normalizadas.
 * @param janela - Tamanho maximo do recorte; `Infinity` nao recorta.
 *
 * @example
 * ```ts
 * marcar('o grafo reverso', ['grafo'], Infinity);
 * // [{ texto: 'o ', marcado: false }, { texto: 'grafo', marcado: true }, ...]
 * ```
 */
export function marcar(
  texto: string,
  palavras: readonly string[],
  janela: number,
): Segmento[] {
  const achados = casamentos(texto, palavras);

  // Comeca um pouco antes do primeiro casamento, para a frase ter contexto.
  const primeiro = achados[0]?.[0] ?? 0;
  const de = janela === Infinity ? 0 : Math.max(0, primeiro - Math.floor(janela / 3));
  const ate = janela === Infinity ? texto.length : Math.min(texto.length, de + janela);

  const segmentos: Segmento[] = [];
  const empurrar = (pedaco: string, marcado: boolean): void => {
    if (pedaco === '') return;
    const anterior = segmentos[segmentos.length - 1];
    if (anterior !== undefined && anterior.marcado === marcado) anterior.texto += pedaco;
    else segmentos.push({ texto: pedaco, marcado });
  };

  let cursor = de;
  for (const [inicio, fim] of achados) {
    if (fim <= cursor) continue;
    if (inicio >= ate) break;
    empurrar(texto.slice(cursor, Math.max(cursor, inicio)), false);
    empurrar(texto.slice(Math.max(cursor, inicio), Math.min(fim, ate)), true);
    cursor = Math.min(fim, ate);
  }
  empurrar(texto.slice(cursor, ate), false);

  if (de > 0) empurrar_inicio(segmentos);
  if (ate < texto.length) empurrar('…', false);

  return segmentos;
}

/** Marca que o recorte comecou no meio da frase. */
function empurrar_inicio(segmentos: Segmento[]): void {
  const primeiro = segmentos[0];
  if (primeiro !== undefined && !primeiro.marcado) primeiro.texto = `…${primeiro.texto}`;
  else segmentos.unshift({ texto: '…', marcado: false });
}
