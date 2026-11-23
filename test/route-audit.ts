import 'reflect-metadata';
import { RequestMethod, type DynamicModule, type Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import { IS_PUBLIC_KEY } from '../src/auth/decorators/public.decorator.js';

export interface RouteInfo {
  /** Contoh: `POST /auth/login` */
  route: string;
  guards: string[];
  isPublic: boolean;
}

type ModuleLike = Type<unknown> | DynamicModule | unknown;

const joinPath = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => String(p).split('/'))
    .filter(Boolean)
    .join('/');

/** Semua controller yang terdaftar di modul dan modul yang di-import (rekursif, statis). */
export function collectControllers(root: ModuleLike): Type<unknown>[] {
  const controllers = new Set<Type<unknown>>();
  const seen = new Set<unknown>();

  const visit = (mod: ModuleLike): void => {
    if (!mod || seen.has(mod)) return;
    seen.add(mod);

    const dynamic = mod as Partial<DynamicModule>;
    const moduleClass =
      typeof mod === 'function'
        ? mod
        : (dynamic.module as Type<unknown> | undefined);
    if (!moduleClass) return;

    const own: Type<unknown>[] = [
      ...(Reflect.getMetadata('controllers', moduleClass) ?? []),
      ...(typeof mod === 'function' ? [] : (dynamic.controllers ?? [])),
    ];
    own.forEach((c) => controllers.add(c));

    const imports: ModuleLike[] = [
      ...(Reflect.getMetadata('imports', moduleClass) ?? []),
      ...(typeof mod === 'function' ? [] : (dynamic.imports ?? [])),
    ];
    imports.forEach(visit);
  };

  visit(root);
  return [...controllers];
}

const guardName = (guard: unknown): string =>
  typeof guard === 'function'
    ? guard.name
    : ((guard as object)?.constructor?.name ?? String(guard));

/** Semua route (method HTTP + path) dari daftar controller, beserta guard dan status publiknya. */
export function describeRoutes(controllers: Type<unknown>[]): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const controller of controllers) {
    const basePath: string =
      Reflect.getMetadata(PATH_METADATA, controller) ?? '';
    const classGuards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
    const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;

    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = controller.prototype[name];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;

      const handlerPath: string =
        Reflect.getMetadata(PATH_METADATA, handler) ?? '';
      const handlerGuards: unknown[] =
        Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
      routes.push({
        route: `${RequestMethod[method]} ${joinPath(basePath, handlerPath)}`,
        guards: [...classGuards, ...handlerGuards].map(guardName),
        isPublic:
          classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
      });
    }
  }
  return routes;
}

/** Route yang tidak dijaga `requiredGuard` dan tidak ditandai `@Public()`. */
export function findUnprotectedRoutes(
  routes: RouteInfo[],
  requiredGuard: string,
): string[] {
  return routes
    .filter((r) => !r.isPublic && !r.guards.includes(requiredGuard))
    .map((r) => r.route);
}
