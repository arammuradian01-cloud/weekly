"use client";

import { createContext, createElement, useContext, useMemo, type ComponentType } from "react";
import { extendRegistryLookup, type RegistryLookup } from "./registry-lookup";
import { dtoPersonLabels } from "./person-labels";

export const RegistryContext = createContext<RegistryLookup | null>(null);

export function useRegistry(): RegistryLookup {
  const lookup = useContext(RegistryContext);
  if (!lookup) throw new Error("Справочник доступен только внутри приложения");
  return lookup;
}

/** Подписи принадлежат данным компонента и его потомкам, но не общему справочнику приложения. */
export function withRegistryLabels<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  function WithLabels(props: P) {
    const parent = useRegistry();
    const lookup = useMemo(() => {
      const labels = dtoPersonLabels(props);
      return labels.length ? extendRegistryLookup(parent, labels) : parent;
    }, [parent, props]);
    return <RegistryContext.Provider value={lookup}>{createElement(Component, props)}</RegistryContext.Provider>;
  }
  return WithLabels;
}
