import { lazy, Suspense, type ComponentProps, type JSXElementConstructor, type ReactNode } from 'react'

/**
 * A component split out of the main bundle, so the first open of the app only
 * downloads and runs what the first screen needs. `preload()` fetches it ahead
 * of need; once it has arrived it renders straight away without suspending, so
 * a view transition never captures a loading state. Until then it shows
 * `fallback`, or without one suspends to the nearest <Suspense>.
 */
export function lazyComponent<C extends JSXElementConstructor<any>>(
  load: () => Promise<C>,
  fallback?: (props: ComponentProps<C>) => ReactNode,
) {
  let loaded: C | undefined
  let pending: Promise<C> | undefined
  const preload = () =>
    (pending ??= load().then(
      (component) => (loaded = component),
      (err) => {
        pending = undefined // a dropped connection shouldn't stick
        throw err
      },
    ))
  const Lazy = lazy(() => preload().then((component) => ({ default: component })))
  function Component(props: ComponentProps<C>) {
    const Ready = (loaded ?? Lazy) as JSXElementConstructor<ComponentProps<C>>
    if (loaded || !fallback) return <Ready {...props} />
    return (
      <Suspense fallback={fallback(props)}>
        <Ready {...props} />
      </Suspense>
    )
  }
  return Object.assign(Component, { preload })
}

/** Preloads components once the page has settled after starting. */
export function preloadWhenIdle(...components: { preload: () => Promise<unknown> }[]) {
  const go = () => components.forEach((c) => void c.preload().catch(() => {}))
  setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 2000 }) : go()), 1500)
}
