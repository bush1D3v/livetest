/**
 * O dialogo de busca.
 *
 * O indice e baixado na primeira vez que alguem abre a busca, e nao no
 * carregamento da pagina: quem so veio ler um paragrafo nao paga por ele. A
 * partir dai tudo roda em memoria, e cada tecla digitada consulta o indice
 * direto, sem rede e sem espera.
 *
 * O motor de ranqueamento vive em `modules/search.ts`, sem DOM. Aqui ha apenas
 * a montagem dos resultados, a navegacao por teclado e o ciclo de abrir e
 * fechar.
 *
 * @packageDocumentation
 */

import {
  buildIndex,
  search,
  type SearchDoc,
  type SearchHit,
  type SearchIndex,
  type Segmento,
} from '../modules/search.js';
import * as icone from '../modules/icons.js';

/** Opcoes de {@link setupSearch}. */
export interface SearchSetupOptions {
  /** Documento usado. @defaultValue `document` */
  doc?: Document;
  /** Como buscar o indice. @defaultValue `fetch` */
  carregar?: (url: string) => Promise<SearchDoc[]>;
  /** Quantos resultados mostrar. @defaultValue `20` */
  limite?: number;
}

/** Busca montada. */
export interface Search {
  /** Abre o dialogo, carregando o indice se ainda nao foi. */
  open(): Promise<void>;
  /** Fecha o dialogo. */
  close(): void;
  /** `true` enquanto o dialogo esta aberto. */
  isOpen(): boolean;
  /** Consulta e redesenha a lista. */
  query(texto: string): SearchHit[];
  /** `true` quando os ganchos do dialogo foram encontrados. */
  readonly mounted: boolean;
  /** Remove os ouvintes registrados. */
  destroy(): void;
}

/** Monta os pedacos marcados de um trecho em elementos. */
function pintar(destino: HTMLElement, segmentos: readonly Segmento[]): void {
  for (const segmento of segmentos) {
    if (segmento.marcado) {
      const marca = destino.ownerDocument.createElement('mark');
      marca.textContent = segmento.texto;
      destino.appendChild(marca);
    } else {
      destino.appendChild(destino.ownerDocument.createTextNode(segmento.texto));
    }
  }
}

/**
 * Liga o dialogo de busca.
 *
 * @example
 * ```ts
 * const busca = setupSearch({ carregar: async () => documentos });
 * await busca.open();
 * busca.query('profundidade');
 * ```
 */
export function setupSearch(options: SearchSetupOptions = {}): Search {
  const doc = options.doc ?? document;
  const limite = options.limite ?? 20;

  const caixa = doc.querySelector<HTMLElement>('[data-busca]');
  const entrada = doc.querySelector<HTMLInputElement>('[data-busca-entrada]');
  const lista = doc.querySelector<HTMLElement>('[data-busca-resultados]');
  const vazio = doc.querySelector<HTMLElement>('[data-busca-vazio]');
  const termo = doc.querySelector<HTMLElement>('[data-busca-termo]');

  const vazia: Search = {
    open: async () => {},
    close: () => {},
    isOpen: () => false,
    query: () => [],
    mounted: false,
    destroy: () => {},
  };

  if (!caixa || !entrada || !lista || !vazio) return vazia;

  const alvoCaixa = caixa;
  const alvoEntrada = entrada;
  const alvoLista = lista;
  const alvoVazio = vazio;

  const raiz = doc.body.dataset['raiz'] ?? './';
  const locale = doc.body.dataset['locale'] ?? 'en';

  const carregar =
    options.carregar ??
    (async (url: string) => (await (await fetch(url)).json()) as SearchDoc[]);

  let indice: SearchIndex | null = null;
  let carregando: Promise<void> | null = null;
  let resultados: SearchHit[] = [];
  let ativo = 0;
  let anterior: Element | null = null;

  /** Move o realce da lista, rolando o item para dentro da vista. */
  function marcarAtivo(novo: number): void {
    ativo = resultados.length === 0 ? 0 : (novo + resultados.length) % resultados.length;
    const itens = [...alvoLista.querySelectorAll<HTMLElement>('.busca__item')];
    itens.forEach((item, n) => {
      item.classList.toggle('is-active', n === ativo);
      if (n === ativo) item.scrollIntoView({ block: 'nearest' });
    });
  }

  /** Redesenha a lista inteira. */
  function desenhar(texto: string): void {
    alvoLista.textContent = '';

    if (resultados.length === 0) {
      alvoVazio.hidden = texto.trim() === '';
      if (termo) termo.textContent = texto;
      return;
    }

    alvoVazio.hidden = true;
    let paginaAnterior = '';

    resultados.forEach((hit, n) => {
      // Os resultados vem ordenados por pontuacao, nao por pagina; o cabecalho
      // aparece quando a pagina muda, que e o que agrupa visualmente sem
      // reordenar e estragar o ranqueamento.
      if (hit.doc.p !== paginaAnterior) {
        const grupo = doc.createElement('p');
        grupo.className = 'busca__grupo';
        grupo.textContent = hit.doc.p;
        alvoLista.appendChild(grupo);
        paginaAnterior = hit.doc.p;
      }

      const item = doc.createElement('a');
      item.className = 'busca__item';
      item.href = `${raiz}${hit.doc.u}`;
      item.setAttribute('role', 'option');

      const simbolo = doc.createElement('span');
      simbolo.innerHTML = hit.doc.s === '' ? icone.DOCUMENTO : icone.SECAO;
      item.appendChild(simbolo.firstElementChild as Element);

      const corpo = doc.createElement('span');

      const titulo = doc.createElement('span');
      titulo.className = 'busca__titulo';
      pintar(titulo, hit.titulo);
      corpo.appendChild(titulo);

      if (hit.doc.s !== '') {
        const contexto = doc.createElement('span');
        contexto.className = 'busca__contexto';
        contexto.textContent = hit.doc.p;
        corpo.appendChild(contexto);
      }

      const trecho = doc.createElement('span');
      trecho.className = 'busca__trecho';
      pintar(trecho, hit.trecho);
      corpo.appendChild(trecho);

      item.appendChild(corpo);
      item.addEventListener('mousemove', () => marcarAtivo(n));
      alvoLista.appendChild(item);
    });

    marcarAtivo(0);
  }

  /** Consulta o indice e redesenha. */
  function consultar(texto: string): SearchHit[] {
    resultados = indice === null ? [] : search(indice, texto, limite);
    desenhar(texto);
    return resultados;
  }

  /** Baixa o indice uma unica vez. */
  function garantirIndice(): Promise<void> {
    carregando ??= carregar(`${raiz}search-${locale}.json`)
      .then((docs) => {
        indice = buildIndex(docs);
      })
      .catch(() => {
        // Sem indice, o dialogo continua abrindo e apenas nao acha nada. Uma
        // busca que falha em silencio e melhor que uma pagina que trava.
        indice = buildIndex([]);
      });
    return carregando;
  }

  async function abrir(): Promise<void> {
    anterior = doc.activeElement;
    alvoCaixa.hidden = false;
    doc.documentElement.style.overflow = 'hidden';
    alvoEntrada.focus();
    alvoEntrada.select();
    await garantirIndice();
    consultar(alvoEntrada.value);
  }

  function fechar(): void {
    alvoCaixa.hidden = true;
    doc.documentElement.style.overflow = '';
    (anterior as HTMLElement | null)?.focus?.();
  }

  const aoClicar = (evento: Event): void => {
    const alvo = evento.target as HTMLElement | null;
    if (alvo?.closest('[data-busca-abrir]')) {
      evento.preventDefault();
      void abrir();
      return;
    }
    if (alvo?.closest('[data-busca-fechar]')) fechar();
  };

  const aoDigitar = (): void => void consultar(alvoEntrada.value);

  const aoTeclarGlobal = (evento: KeyboardEvent): void => {
    const atalho = (evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k';
    if (atalho) {
      evento.preventDefault();
      if (alvoCaixa.hidden) void abrir();
      else fechar();
      return;
    }

    if (alvoCaixa.hidden) return;

    if (evento.key === 'Escape') {
      evento.preventDefault();
      fechar();
      return;
    }

    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      marcarAtivo(ativo + (evento.key === 'ArrowDown' ? 1 : -1));
      return;
    }

    if (evento.key === 'Enter' && resultados.length > 0) {
      evento.preventDefault();
      alvoLista.querySelectorAll<HTMLAnchorElement>('.busca__item')[ativo]?.click();
    }
  };

  doc.addEventListener('click', aoClicar);
  doc.addEventListener('keydown', aoTeclarGlobal);
  alvoEntrada.addEventListener('input', aoDigitar);

  return {
    open: abrir,
    close: fechar,
    isOpen: () => !alvoCaixa.hidden,
    query: consultar,
    mounted: true,
    destroy(): void {
      doc.removeEventListener('click', aoClicar);
      doc.removeEventListener('keydown', aoTeclarGlobal);
      alvoEntrada.removeEventListener('input', aoDigitar);
    },
  };
}
