/**
 * Registro de adapters de grafo de dependencia.
 *
 * Mantem os adapters embutidos e aceita adapters de terceiros, permitindo
 * suportar novas linguagens sem alterar o core (secao 4.4 do PRD).
 *
 * @packageDocumentation
 */

import type {
  DependencyGraphAdapter,
  DependencyGraphAdapterFactory,
  GraphAdapterContext,
} from '../types/graph.js';
import { createJsTsGraphAdapter } from './jsts/adapter.js';
import { createPythonGraphAdapter } from './python/adapter.js';

/** Fabricas embutidas, indexadas pelo id usado em `runners[].graph`. */
export const BUILTIN_GRAPH_ADAPTERS: Readonly<Record<string, DependencyGraphAdapterFactory>> = {
  'js-ts': (context) => createJsTsGraphAdapter(context),
  python: (context) => createPythonGraphAdapter(context),
};

/** Opcoes de {@link createGraphAdapters}. */
export interface CreateGraphAdaptersOptions {
  /** Ids requeridos pela configuracao dos runners. */
  ids: readonly string[];
  context: GraphAdapterContext;
  /** Fabricas extras, sobrepondo as embutidas quando o id coincide. */
  custom?: Readonly<Record<string, DependencyGraphAdapterFactory>>;
}

/**
 * Instancia os adapters pedidos, ignorando (com aviso) ids desconhecidos.
 *
 * @returns Adapters instanciados e a lista de ids nao encontrados.
 */
export function createGraphAdapters(options: CreateGraphAdaptersOptions): {
  adapters: DependencyGraphAdapter[];
  missing: string[];
} {
  const factories = { ...BUILTIN_GRAPH_ADAPTERS, ...(options.custom ?? {}) };
  const adapters: DependencyGraphAdapter[] = [];
  const missing: string[] = [];

  for (const id of new Set(options.ids)) {
    const factory = factories[id];
    if (!factory) {
      missing.push(id);
      continue;
    }
    adapters.push(factory(options.context));
  }
  return { adapters, missing };
}
